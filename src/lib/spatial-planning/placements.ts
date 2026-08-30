import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { member, placement, placementMember, placementRevertNotice, plot, task, taskAssignment, zone } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import {
  getCommunityRow,
  isPlacementEditor,
  isSpatialPlanningHolder,
  requireSpatialPlanningEnabled,
  requireSpatialPlanningHolder,
} from "./access";
import { getPlot } from "./plots";
import type { PlacementGeometry, PlacementShapeType } from "./geometry";

type Member = typeof memberTable.$inferSelect;

const point = z.object({ x: z.number(), y: z.number() });
const rectangleGeometryInput = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
});
const circleGeometryInput = z.object({ x: z.number(), y: z.number(), radius: z.number().positive() });
const polygonGeometryInput = z.object({ points: z.array(point).min(3, "A polygon Placement needs at least 3 points") });
const lineGeometryInput = z.object({ points: z.array(point).min(2, "A line Placement needs at least 2 points") });

// Picks the right shape based on the sibling `shapeType` field, rather
// than a zod discriminatedUnion — shapeType lives as its own DB column
// next to geometry, not nested inside it (see src/db/schema/spatial-
// planning.ts), so there's no single object with a discriminant key to
// union on.
function parsePlacementGeometry(shapeType: PlacementShapeType, geometry: unknown): PlacementGeometry {
  switch (shapeType) {
    case "rectangle":
      return rectangleGeometryInput.parse(geometry);
    case "circle":
      return circleGeometryInput.parse(geometry);
    case "polygon":
      return polygonGeometryInput.parse(geometry);
    case "line":
      return lineGeometryInput.parse(geometry);
  }
}

const placementShapeTypeInput = z.enum(["rectangle", "circle", "polygon", "line"]);
const placementCategoryInput = z.enum(["tent", "vehicle", "structure", "furniture", "generic"]);

export const createPlacementInput = z.object({
  zoneId: z.string().uuid().nullable().optional(),
  shapeType: placementShapeTypeInput,
  geometry: z.unknown(),
  label: z.string().min(1),
  category: placementCategoryInput,
  linkedTaskId: z.string().uuid().nullable().optional(),
  // Full-sync set of linked Members — see syncPlacementMembers below.
  // As of Phase 38, naming someone other than yourself here links them
  // as `invited`, not `confirmed` — "nobody is silently made a co-owner
  // of something they haven't agreed to" (docs/spec.md's Shared
  // placements) applies even when the Spatial-planning holder is the
  // one doing the naming at creation time, not just to later edits.
  memberIds: z.array(z.string().uuid()).optional(),
});
export type CreatePlacementInput = z.infer<typeof createPlacementInput>;

export const updatePlacementInput = createPlacementInput.partial();
export type UpdatePlacementInput = z.infer<typeof updatePlacementInput>;

async function requireLinkedTaskInCommunity(communityId: string, taskId: string) {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Task not found in your community");
  }
}

async function requireZoneOnPlot(plotId: string, zoneId: string) {
  const [row] = await db.select({ id: zone.id }).from(zone).where(and(eq(zone.id, zoneId), eq(zone.plotId, plotId)));
  if (!row) {
    throw new NotFoundError("Zone not found on this Plot");
  }
}

// Diffs the target memberIds set against what's currently linked,
// rather than the plain delete-everything-then-reinsert Phase 37 used
// — that would have silently wiped out a real `confirmed` acceptance
// every time anyone touched the Placement's member list again. Members
// present in both sets are left completely untouched (preserving
// whatever status they've actually reached); only genuinely new names
// are inserted (`invited`, unless it's the actor naming themselves —
// self-linking needs no separate consent step); names dropped from the
// set are removed outright, the same "drop names freely" / "no
// explanation required" posture declining already has.
async function syncPlacementMembers(tx: Tx, placementId: string, actorId: string, memberIds: string[] | undefined) {
  if (memberIds === undefined) return;
  const existingRows = await tx
    .select()
    .from(placementMember)
    .where(eq(placementMember.placementId, placementId));
  const existingIds = new Set(existingRows.map((r) => r.memberId));
  const newIds = new Set(memberIds);

  const toRemoveIds = existingRows.filter((r) => !newIds.has(r.memberId)).map((r) => r.memberId);
  const toAdd = memberIds.filter((id) => !existingIds.has(id));

  if (toRemoveIds.length > 0) {
    await tx
      .delete(placementMember)
      .where(and(eq(placementMember.placementId, placementId), inArray(placementMember.memberId, toRemoveIds)));
  }
  if (toAdd.length > 0) {
    await tx.insert(placementMember).values(
      toAdd.map((memberId) => ({
        placementId,
        memberId,
        status: memberId === actorId ? ("confirmed" as const) : ("invited" as const),
        invitedBy: actorId,
        respondedAt: memberId === actorId ? new Date() : null,
      })),
    );
  }
}

// Open to any member — "visible to any member" (docs/development-
// plan.md's Phase 37 done-when).
export async function listPlacements(actor: Member, plotId: string) {
  await getPlot(actor, plotId); // 404s if not in this community
  return db.select().from(placement).where(eq(placement.plotId, plotId)).orderBy(placement.createdAt);
}

export async function getPlacement(actor: Member, placementId: string) {
  const [row] = await db
    .select({ placement, communityId: plot.communityId })
    .from(placement)
    .innerJoin(plot, eq(plot.id, placement.plotId))
    .where(and(eq(placement.id, placementId), eq(plot.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Placement not found");
  }
  return row.placement;
}

export async function listPlacementMembers(actor: Member, placementId: string) {
  await getPlacement(actor, placementId); // 404s if not in this community
  return db.select().from(placementMember).where(eq(placementMember.placementId, placementId));
}

// Holder-gated — Placements are still only *created* by whoever holds
// the Spatial-planning task, same as Zone (docs/spec.md); self-service
// is limited to moving/resizing/rotating an existing one, plus the
// invite/accept/decline actions below — see proposePlacementMove.
export async function createPlacement(actor: Member, plotId: string, rawInput: CreatePlacementInput) {
  // Re-validated here, not just trusted from an API route's own
  // createPlacementInput.parse() — same defense-in-depth precedent
  // Phase 36's createPlot/createZone already established.
  const input = createPlacementInput.parse(rawInput);
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  await getPlot(actor, plotId); // 404s if not in this community
  const geometry = parsePlacementGeometry(input.shapeType, input.geometry);

  if (input.zoneId) await requireZoneOnPlot(plotId, input.zoneId);
  if (input.linkedTaskId) await requireLinkedTaskInCommunity(actor.communityId, input.linkedTaskId);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(placement)
      .values({
        plotId,
        zoneId: input.zoneId ?? null,
        shapeType: input.shapeType,
        geometry,
        label: input.label,
        category: input.category,
        linkedTaskId: input.linkedTaskId ?? null,
      })
      .returning();
    await syncPlacementMembers(tx, created.id, actor.id, input.memberIds);
    return created;
  });
}

// Still holder-only, and still covers every field including geometry
// (the holder's own edits never need to go through pending — see
// proposePlacementMove for the self-service, pending-flagged path).
export async function updatePlacement(actor: Member, placementId: string, rawInput: UpdatePlacementInput) {
  const input = updatePlacementInput.parse(rawInput);
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  const existing = await getPlacement(actor, placementId); // 404s if not in this community

  const shapeType = input.shapeType ?? existing.shapeType;
  const geometry =
    input.geometry !== undefined ? parsePlacementGeometry(shapeType, input.geometry) : undefined;

  if (input.zoneId) await requireZoneOnPlot(existing.plotId, input.zoneId);
  if (input.linkedTaskId) await requireLinkedTaskInCommunity(actor.communityId, input.linkedTaskId);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(placement)
      .set({
        ...(input.zoneId !== undefined && { zoneId: input.zoneId }),
        ...(input.shapeType !== undefined && { shapeType: input.shapeType }),
        ...(geometry !== undefined && { geometry }),
        ...(input.label !== undefined && { label: input.label }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.linkedTaskId !== undefined && { linkedTaskId: input.linkedTaskId }),
        updatedAt: new Date(),
      })
      .where(eq(placement.id, placementId))
      .returning();
    await syncPlacementMembers(tx, placementId, actor.id, input.memberIds);
    return updated;
  });
}

export async function deletePlacement(actor: Member, placementId: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  await getPlacement(actor, placementId); // 404s if not in this community

  await db.transaction(async (tx) => {
    await tx.delete(placementMember).where(eq(placementMember.placementId, placementId));
    await tx.delete(placementRevertNotice).where(eq(placementRevertNotice.placementId, placementId));
    await tx.delete(placement).where(eq(placement.id, placementId));
  });
}

// --- Phase 38: propose → pending → approve/revert ---

export const proposeMoveInput = z.object({ geometry: z.unknown() });

// The self-service path — see docs/spec.md's Multi-user placement.
// The Spatial-planning holder still edits directly (never gated, same
// as Zone); a confirmed Member link or the linkedTaskId holder can
// move/resize/rotate immediately, but it lands `pending` rather than
// `confirmed`. Anyone else is rejected — this never creates a fourth
// tier, just the two self-service ones spec names plus the holder's
// pre-existing direct-edit path.
export async function proposePlacementMove(actor: Member, placementId: string, rawInput: { geometry: unknown }) {
  const input = proposeMoveInput.parse(rawInput);
  const communityRow = await requireSpatialPlanningEnabled(actor);
  const existing = await getPlacement(actor, placementId); // 404s if not in this community
  const geometry = parsePlacementGeometry(existing.shapeType, input.geometry);

  if (await isSpatialPlanningHolder(actor, communityRow)) {
    const [updated] = await db
      .update(placement)
      .set({ geometry, updatedAt: new Date() })
      .where(eq(placement.id, placementId))
      .returning();
    return updated;
  }

  if (!(await isPlacementEditor(actor, existing))) {
    throw new ForbiddenError("You don't have edit rights on this Placement");
  }

  // If it's already pending from an earlier, still-unreviewed edit,
  // pendingPrevGeometry keeps pointing at the last genuinely *confirmed*
  // geometry, not the immediately-prior pending one — so a revert always
  // restores the true last-approved state, however many self-service
  // edits happened in between. pendingByMemberId does move to whoever
  // made *this* edit, since they're who a revert would need to notify.
  const prevGeometry = existing.status === "confirmed" ? existing.geometry : existing.pendingPrevGeometry;
  const [updated] = await db
    .update(placement)
    .set({
      geometry,
      status: "pending",
      pendingByMemberId: actor.id,
      pendingPrevGeometry: prevGeometry,
      updatedAt: new Date(),
    })
    .where(eq(placement.id, placementId))
    .returning();
  return updated;
}

export async function approvePendingPlacement(actor: Member, placementId: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  const existing = await getPlacement(actor, placementId);
  if (existing.status !== "pending") {
    throw new ConflictError("This Placement has no pending change to approve");
  }

  const [updated] = await db
    .update(placement)
    .set({ status: "confirmed", pendingByMemberId: null, pendingPrevGeometry: null, updatedAt: new Date() })
    .where(eq(placement.id, placementId))
    .returning();
  return updated;
}

// Restores pendingPrevGeometry and creates a real, persisted notice for
// whoever made the change — see src/db/schema/spatial-planning.ts's
// schema comment on placementRevertNotice for why this is the one case
// that needs a real row instead of a computed read.
export async function revertPendingPlacement(actor: Member, placementId: string, note?: string | null) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  const existing = await getPlacement(actor, placementId);
  if (existing.status !== "pending" || !existing.pendingByMemberId || existing.pendingPrevGeometry == null) {
    throw new ConflictError("This Placement has no pending change to revert");
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(placement)
      .set({
        geometry: existing.pendingPrevGeometry,
        status: "confirmed",
        pendingByMemberId: null,
        pendingPrevGeometry: null,
        updatedAt: new Date(),
      })
      .where(eq(placement.id, placementId))
      .returning();

    await tx.insert(placementRevertNotice).values({
      placementId,
      recipientMemberId: existing.pendingByMemberId!,
      revertedBy: actor.id,
      note: note ?? null,
    });

    return updated;
  });
}

// Holder-only — every Placement currently awaiting review, across
// every Plot in the Community (a Community realistically has very few
// Plots at once, so no cycle-scoping is worth the complexity it'd add).
export async function listPendingPlacementReviews(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  return db
    .select({ placement, movedByName: member.name })
    .from(placement)
    .innerJoin(plot, eq(plot.id, placement.plotId))
    .innerJoin(member, eq(member.id, placement.pendingByMemberId))
    .where(and(eq(plot.communityId, actor.communityId), eq(placement.status, "pending")));
}

// --- Phase 38: shared placements — invite → accept/decline ---

// Open to the Spatial-planning holder or any current editor of the
// Placement (a confirmed Member link, or the linkedTaskId holder) —
// "that person names who else should be linked... the creator can add
// or drop names freely," generalized to whoever currently has editing
// rights once self-service editing exists, not just the original
// creator (docs/spec.md's Shared placements).
async function requireCanManagePlacementMembers(actor: Member, placementRow: { id: string; linkedTaskId: string | null }) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (await isSpatialPlanningHolder(actor, communityRow)) return;
  if (await isPlacementEditor(actor, placementRow)) return;
  throw new ForbiddenError("You don't have edit rights on this Placement");
}

export async function invitePlacementMember(actor: Member, placementId: string, memberId: string) {
  const existing = await getPlacement(actor, placementId); // 404s if not in this community
  await requireCanManagePlacementMembers(actor, existing);

  const [memberRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.communityId, actor.communityId)));
  if (!memberRow) {
    throw new NotFoundError("Member not found in your community");
  }

  const [existingLink] = await db
    .select({ memberId: placementMember.memberId })
    .from(placementMember)
    .where(and(eq(placementMember.placementId, placementId), eq(placementMember.memberId, memberId)));
  if (existingLink) {
    throw new ConflictError("This member is already linked to this Placement");
  }

  const [created] = await db
    .insert(placementMember)
    .values({
      placementId,
      memberId,
      status: memberId === actor.id ? "confirmed" : "invited",
      invitedBy: actor.id,
      respondedAt: memberId === actor.id ? new Date() : null,
    })
    .returning();
  return created;
}

// "Drop names freely" — any current editor can remove any linked
// Member, confirmed or still-invited. A Member can also always remove
// *themselves*, regardless of whether they otherwise hold edit rights
// — "plans changed," the same no-explanation-required posture
// declining an invite already has, generalized to a confirmed co-owner
// wanting out.
export async function removePlacementMember(actor: Member, placementId: string, memberId: string) {
  const existing = await getPlacement(actor, placementId); // 404s if not in this community
  if (memberId !== actor.id) {
    await requireCanManagePlacementMembers(actor, existing);
  }
  await db
    .delete(placementMember)
    .where(and(eq(placementMember.placementId, placementId), eq(placementMember.memberId, memberId)));
}

export async function acceptPlacementInvite(actor: Member, placementId: string) {
  const [row] = await db
    .select()
    .from(placementMember)
    .where(and(eq(placementMember.placementId, placementId), eq(placementMember.memberId, actor.id)));
  if (!row || row.status !== "invited") {
    throw new NotFoundError("No pending invite found for you on this Placement");
  }
  const [updated] = await db
    .update(placementMember)
    .set({ status: "confirmed", respondedAt: new Date() })
    .where(and(eq(placementMember.placementId, placementId), eq(placementMember.memberId, actor.id)))
    .returning();
  return updated;
}

export async function declinePlacementInvite(actor: Member, placementId: string) {
  const [row] = await db
    .select()
    .from(placementMember)
    .where(and(eq(placementMember.placementId, placementId), eq(placementMember.memberId, actor.id)));
  if (!row || row.status !== "invited") {
    throw new NotFoundError("No pending invite found for you on this Placement");
  }
  await db
    .delete(placementMember)
    .where(and(eq(placementMember.placementId, placementId), eq(placementMember.memberId, actor.id)));
}

// --- Phase 38: computed feed helpers for the Dashboard ---

// "An invited Member is told they've been named on a Placement" —
// purely computed, the same "read live state, never a separately-
// maintained to-do list" posture src/lib/dashboard.ts's getPersonalFeed
// already uses everywhere else.
export async function listMyPlacementInvites(actor: Member) {
  return db
    .select({
      placementId: placementMember.placementId,
      placementLabel: placement.label,
      invitedByName: member.name,
      invitedAt: placementMember.invitedAt,
    })
    .from(placementMember)
    .innerJoin(placement, eq(placement.id, placementMember.placementId))
    .innerJoin(plot, eq(plot.id, placement.plotId))
    .innerJoin(member, eq(member.id, placementMember.invitedBy))
    .where(
      and(
        eq(placementMember.memberId, actor.id),
        eq(placementMember.status, "invited"),
        eq(plot.communityId, actor.communityId),
      ),
    );
}

// "Every Member linked to the Placement... gets notified when it
// moves" — the ambient visibility signal, also purely computed: any
// currently-`pending` Placement the actor is a confirmed Member on, or
// whose linkedTaskId they hold. Includes the mover's own edit — seeing
// "your edit is pending review" in your own feed is a harmless,
// useful confirmation it actually went through.
export async function listMyLinkedPendingPlacements(actor: Member) {
  const viaMember = await db
    .select({ placement })
    .from(placement)
    .innerJoin(placementMember, eq(placementMember.placementId, placement.id))
    .innerJoin(plot, eq(plot.id, placement.plotId))
    .where(
      and(
        eq(placement.status, "pending"),
        eq(placementMember.memberId, actor.id),
        eq(plot.communityId, actor.communityId),
      ),
    );

  // Reuses the taskAssignment table directly rather than the identical
  // join in access.ts's own isTaskHolder, since this needs the
  // surrounding placement/plot rows too, not just a boolean.
  const viaTask = await db
    .select({ placement })
    .from(placement)
    .innerJoin(plot, eq(plot.id, placement.plotId))
    .innerJoin(task, eq(task.id, placement.linkedTaskId))
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(placement.status, "pending"),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        eq(plot.communityId, actor.communityId),
      ),
    );

  const byId = new Map<string, (typeof viaMember)[number]["placement"]>();
  for (const row of [...viaMember, ...viaTask]) byId.set(row.placement.id, row.placement);
  return [...byId.values()];
}

// The one Placement-review outcome needing a real persisted notice —
// see placementRevertNotice's own schema comment.
export async function listMyRevertNotices(actor: Member) {
  return db
    .select({ notice: placementRevertNotice, placementLabel: placement.label, revertedByName: member.name })
    .from(placementRevertNotice)
    .innerJoin(placement, eq(placement.id, placementRevertNotice.placementId))
    .innerJoin(member, eq(member.id, placementRevertNotice.revertedBy))
    .where(
      and(eq(placementRevertNotice.recipientMemberId, actor.id), isNull(placementRevertNotice.acknowledgedAt)),
    );
}

export async function acknowledgeRevertNotice(actor: Member, noticeId: string) {
  const [row] = await db
    .select({ id: placementRevertNotice.id })
    .from(placementRevertNotice)
    .where(and(eq(placementRevertNotice.id, noticeId), eq(placementRevertNotice.recipientMemberId, actor.id)));
  if (!row) {
    throw new NotFoundError("Notice not found");
  }
  await db
    .update(placementRevertNotice)
    .set({ acknowledgedAt: new Date() })
    .where(eq(placementRevertNotice.id, noticeId));
}
