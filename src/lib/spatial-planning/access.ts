import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, placementMember, task, taskAssignment } from "@/db/schema";
import type { member as memberTable, placement as placementTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";

type Member = typeof memberTable.$inferSelect;

// "The task is the authority" — same pattern isBudgetOwner/
// isRecruitmentTaskHolder already establish, just against Community's
// spatialPlanningTaskId. Used to gate Zone edits and pending-Placement
// review (see docs/spec.md's "Whoever holds a Spatial planning task
// reviews pending changes").
export async function isSpatialPlanningHolder(actor: Member, communityRow: { spatialPlanningTaskId: string | null }) {
  if (!communityRow.spatialPlanningTaskId) return false;
  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.id, communityRow.spatialPlanningTaskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function requireSpatialPlanningHolder(
  actor: Member,
  communityRow: { spatialPlanningTaskId: string | null },
) {
  if (!(await isSpatialPlanningHolder(actor, communityRow))) {
    throw new ForbiddenError("Only the current Spatial-planning task holder can do this");
  }
}

// Any current holder of the given Task — the same join every other
// "task is the authority" check in this codebase writes for its own
// pointer (isBudgetOwner, isRecruitmentTaskHolder, ...); spatial-
// planning needs its own copy since linkedTaskId can point at an
// arbitrary Task, not one fixed Community-level pointer.
async function isTaskHolder(actor: Member, taskId: string) {
  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(and(eq(task.id, taskId), eq(taskAssignment.memberId, actor.id), eq(taskAssignment.isShadow, false)));
  return Boolean(holding);
}

// "Three tiers of editing rights on a Placement, not two" (docs/
// spec.md's Multi-user placement) — this covers the two self-service
// tiers (a confirmed PlacementMember, or whoever holds linkedTaskId
// when there's no Member link). The third tier — neither link, or any
// Zone regardless of link — has no self-service editor at all, only
// requireSpatialPlanningHolder above; this function correctly returns
// false for that case; a Placement with a Member link is member-owned
// even if a linkedTaskId also happens to be set, matching the
// precedence spec's own "Member-linked, or — for a Task instead of a
// Member —" phrasing.
export async function isPlacementEditor(
  actor: Member,
  placementRow: Pick<typeof placementTable.$inferSelect, "id" | "linkedTaskId">,
) {
  const [confirmedLink] = await db
    .select({ memberId: placementMember.memberId })
    .from(placementMember)
    .where(
      and(
        eq(placementMember.placementId, placementRow.id),
        eq(placementMember.memberId, actor.id),
        eq(placementMember.status, "confirmed"),
      ),
    );
  if (confirmedLink) return true;

  const [anyMemberLink] = await db
    .select({ memberId: placementMember.memberId })
    .from(placementMember)
    .where(eq(placementMember.placementId, placementRow.id));
  if (anyMemberLink) return false; // Member-linked (even to someone else) takes precedence over a Task link

  if (placementRow.linkedTaskId) {
    return isTaskHolder(actor, placementRow.linkedTaskId);
  }
  return false;
}

export async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

export async function requireSpatialPlanningEnabled(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "spatial_planning");
  return communityRow;
}
