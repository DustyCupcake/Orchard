import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

export async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "Whoever currently holds it is 'a recruitment-facing task' holder
// throughout this whole batch (Phases 32-35), not a dedicated role" —
// same access-follows-the-task pattern Event scheduling's
// isEventSchedulingOwner / Budget's isBudgetOwner already establish.
export async function isRecruitmentTaskHolder(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.recruitmentTaskId) return false;

  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.id, communityRow.recruitmentTaskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function requireRecruitmentTaskHolder(actor: Member) {
  if (!(await isRecruitmentTaskHolder(actor))) {
    throw new ForbiddenError("Only a current recruitment-task holder can do this");
  }
}
