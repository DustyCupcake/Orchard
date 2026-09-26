import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "../errors";
import { isModuleOpenToEveryone, listGrantingTaskIds } from "../permissions";

type Member = typeof memberTable.$inferSelect;

// The Kitchen module's one gate — "whoever currently holds any task
// granting `kitchen` exercises the full module for that scope" (D2,
// docs/food-drinks-module-plan.md). Scope travels on the granting task's
// own placement (`task.cycleId`, the §2.1 convention every cycle-shaped
// module shares): a task placed in cycle C owns cycle C's menu, a
// cycle-less task owns the community's standing menu. Mirror of
// isEventSchedulingOwner (src/lib/event-scheduling/conflicts.ts) — same
// resolver, applied to a multi-cardinality module.
//
// An open `kitchen` module short-circuits before the cycleId tri-state —
// open is the community/evergreen scope, already a superset
// (docs/open-permissions-plan.md D3/D15). This is the capability half only:
// `sensitive-data.ts`'s `unlockedByGrantModuleKey` rules are unaffected, so
// opening Kitchen does **not** unlock a field gated to the Kitchen role
// (D9, deferred — and the reason the safe outcome holds without anyone
// deciding it).
export async function isKitchenOwner(actor: Member, cycleId?: string | null): Promise<boolean> {
  if (await isModuleOpenToEveryone(actor.communityId, "kitchen")) {
    return true;
  }

  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "kitchen");
  if (grantingTaskIds.length === 0) return false;

  const conditions = [
    inArray(task.id, grantingTaskIds),
    eq(taskAssignment.memberId, actor.id),
    eq(taskAssignment.isShadow, false),
  ];
  if (cycleId !== undefined) {
    conditions.push(cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleId));
  }

  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(and(...conditions));
  return Boolean(holding);
}

export async function requireKitchenOwner(actor: Member, cycleId?: string | null) {
  if (!(await isKitchenOwner(actor, cycleId))) {
    throw new ForbiddenError("Only a current kitchen task holder can do this");
  }
}