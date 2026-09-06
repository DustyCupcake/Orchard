import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { community, placementMember, task, taskAssignment } from "@/db/schema";
import type { member as memberTable, placement as placementTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { listGrantingTaskIds } from "../permissions";

type Member = typeof memberTable.$inferSelect;

// "The task is the authority" — same pattern isBudgetOwner/
// isRecruitmentTaskHolder already establish, now against a real
// `spatial_planning`-module PermissionGrant row (docs/development-
// plan.md's Phase 63 — previously Community.spatialPlanningTaskId, a
// single scalar pointer). Used to gate Zone edits and pending-Placement
// review (see docs/spec.md's "Whoever holds a Spatial planning task
// reviews pending changes"). `cycleId` (Phase 68) follows
// listGrantingTaskIds' own undefined/null/string convention: omitted
// means "holds it for *any* cycle" (nav/dashboard visibility, and every
// genuinely cycle-agnostic write below — the shape-template library,
// space preferences); a real id or null checks only that specific
// cycle's grant, which every write touching one particular Plot must
// use — a cycle-A owner must not be able to edit cycle B's Plot just
// because that's a call site that forgot to pass one.
export async function isSpatialPlanningHolder(
  actor: Member,
  communityRow: { id: string },
  cycleId?: string | null,
) {
  const grantingTaskIds = await listGrantingTaskIds(communityRow.id, "spatial_planning", cycleId);
  if (grantingTaskIds.length === 0) return false;
  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function requireSpatialPlanningHolder(
  actor: Member,
  communityRow: { id: string },
  cycleId?: string | null,
) {
  if (!(await isSpatialPlanningHolder(actor, communityRow, cycleId))) {
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
