import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
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
