import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { placement, placementMember, plot, task, zone } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { getCommunityRow, requireSpatialPlanningHolder } from "./access";
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
  // Full-replacement set of confirmed co-owners — see updatePlacement's
  // same handling. Phase 37 always creates these as `confirmed`
  // directly (the task holder places people, same single-editor model
  // as Zone); the `invited` state is Phase 38's.
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

// Full-replacement, the same posture Community.modulesEnabled's array
// takes elsewhere in this codebase — simplest correct semantics for a
// phase where only the Spatial-planning task holder ever writes this
// set at all (no self-service partial edits to reconcile against yet).
async function replacePlacementMembers(
  tx: Tx,
  placementId: string,
  actorId: string,
  memberIds: string[] | undefined,
) {
  if (memberIds === undefined) return;
  await tx.delete(placementMember).where(eq(placementMember.placementId, placementId));
  if (memberIds.length > 0) {
    await tx.insert(placementMember).values(
      memberIds.map((memberId) => ({
        placementId,
        memberId,
        status: "confirmed" as const,
        invitedBy: actorId,
        respondedAt: new Date(),
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

// Holder-gated — Placements are "edited directly by whoever holds the
// Spatial-planning task," the same single-editor model Zone already
// uses (docs/spec.md; self-service editing by a linked Member/Task
// holder is Phase 38's).
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
    await replacePlacementMembers(tx, created.id, actor.id, input.memberIds);
    return created;
  });
}

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
    await replacePlacementMembers(tx, placementId, actor.id, input.memberIds);
    return updated;
  });
}

export async function deletePlacement(actor: Member, placementId: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  await getPlacement(actor, placementId); // 404s if not in this community

  await db.transaction(async (tx) => {
    await tx.delete(placementMember).where(eq(placementMember.placementId, placementId));
    await tx.delete(placement).where(eq(placement.id, placementId));
  });
}
