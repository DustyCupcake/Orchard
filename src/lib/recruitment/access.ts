import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { community, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { listGrantingTaskIds } from "../permissions";

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
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "recruitment");
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

export async function requireRecruitmentTaskHolder(actor: Member) {
  if (!(await isRecruitmentTaskHolder(actor))) {
    throw new ForbiddenError("Only a current recruitment-task holder can do this");
  }
}

// The set of scopes the actor currently holds recruitment for — the
// placement cycleIds (`task.cycleId`) of the recruitment-granted tasks
// they hold. A `null` member of the set means they hold a cycle-less
// (community/evergreen) recruitment task, which covers every application
// — cycle-tagged or not — mirroring feedback_review's resolver and the
// two Phase 68 modules (docs/cycle-scope-remediation-plan.md §4.3).
export async function listHeldRecruitmentScopes(actor: Member): Promise<Set<string | null>> {
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "recruitment");
  if (grantingTaskIds.length === 0) return new Set();

  const rows = await db
    .select({ cycleId: task.cycleId })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        eq(task.communityId, actor.communityId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return new Set(rows.map((r) => r.cycleId));
}

// The write-side companion to listHeldRecruitmentScopes: "may this
// member act on an application that sits in (or, untagged, outside) a
// given cycle?" The community/evergreen scope (null) covers everything —
// untagged applications and every cycle's alike — while a cycle-placed
// holder covers only their own cycle's applications, §4.3's strictness
// rule (D1: no fallback between scopes).
export async function requireRecruitmentScopeForCycle(actor: Member, cycleId: string | null) {
  const heldScopes = await listHeldRecruitmentScopes(actor);
  if (heldScopes.size === 0) {
    throw new ForbiddenError("Only a current recruitment-task holder can do this");
  }
  if (!heldScopes.has(null) && !heldScopes.has(cycleId)) {
    throw new ForbiddenError("You don't hold the recruitment task for this application's cycle");
  }
}
