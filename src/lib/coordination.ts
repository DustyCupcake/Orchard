import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { listGrantingTaskIds } from "./permissions";

type Member = typeof memberTable.$inferSelect;

// The one scope read (docs/cycle-scope-remediation-plan.md §2.1/§2.4),
// passed by everything that asks "does this actor do coordination
// here?": `null` is the community-wide superset ("any coordination
// task, any branch, any cycle" — the Escalation/nav/dashboard gates);
// a bare `string` branchId is column semantics (a cycle-less granted
// coordination task in that branch — the messages/board branch-only
// call sites, which never have a cycle in hand); an object holds the
// target task's own placement for §2.4's union below.
export type CoordinationScope = string | null | { branchId: string; cycleId: string | null };

// "Whoever does branch coordination" — see docs/spec.md's "Branch"
// section and docs/development-plan.md's Phase 15 ("Who 'does branch
// coordination' (resolved)"). Not a dedicated relationship: a member
// currently does branch coordination for a scope if they currently
// hold (really hold — a shadow doesn't count, same as everywhere else)
// a granted `branch_coordination`-module task whose own placement
// covers it (docs/development-plan.md's Phase 63 — previously a
// Task.tags match against Community.coordinationTag).
//
// Scope resolution (docs/cycle-scope-remediation-plan.md §2.4):
// - `null` — any granted coordination task, any branch, any cycle
//   (the community-wide check used by the Escalation view and the
//   coordination nav/dashboard gates, all explicitly cross-branch).
// - a `string` branchId — column semantics: a *cycle-less* granted
//   task in that branch covers every task in that branch across all
//   cycles. This is what the branch-only call sites (messages.ts,
//   board badges) mean, and it is deliberately narrower than the old
//   behavior of accepting a cycle-placed coordination task there too:
//   a cycle-placed task's authority stays inside its cycle (§2.1).
// - `{ branchId, cycleId }` — the item-level union: a cycle-less
//   granted task in that branch OR a granted task placed in that
//   cycle. A task sitting in cycle C is covered by the whole row of
//   cycle C (any branch), and a task outside every cycle is covered by
//   its branch's column only.
export async function isCoordinationHolder(actor: Member, scope: CoordinationScope) {
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "branch_coordination");
  if (grantingTaskIds.length === 0) return false;

  const conditions = [
    eq(taskAssignment.memberId, actor.id),
    eq(taskAssignment.isShadow, false),
    eq(task.communityId, actor.communityId),
    inArray(taskAssignment.taskId, grantingTaskIds),
  ];
  if (typeof scope === "string") {
    conditions.push(eq(task.branchId, scope), isNull(task.cycleId));
  } else if (scope !== null) {
    const parts = [];
    // Row C: a granted coordination task placed in the target's own
    // cycle covers it — every task in that cycle, any branch.
    if (scope.cycleId !== null) {
      parts.push(eq(task.cycleId, scope.cycleId));
    }
    // Column B: a cycle-less granted task in the target's branch
    // covers it — every task in that branch, cycle or not.
    parts.push(and(eq(task.branchId, scope.branchId), isNull(task.cycleId)));
    // Both never empty — the column part above always lands in `parts`.
    conditions.push(or(...parts)!);
  }

  const [holding] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(and(...conditions));

  return Boolean(holding);
}

export async function requireCoordinationHolder(actor: Member, scope: CoordinationScope) {
  if (!(await isCoordinationHolder(actor, scope))) {
    throw new ForbiddenError("Only a current branch coordination holder can do this");
  }
}

// The board renders many tasks across many branches at once — one
// query up front instead of calling isCoordinationHolder() per task.
// Returns the set of branchIds the actor currently does coordination
// for — column semantics (cycle-less granted tasks only, §2.4), so a
// cycle-scoped coordination task never lights up the community-wide
// branch columns it has no authority over.
export async function listCoordinationBranchIds(actor: Member) {
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "branch_coordination");
  if (grantingTaskIds.length === 0) return new Set<string>();

  const holdings = await db
    .select({ branchId: task.branchId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, actor.communityId),
        isNull(task.cycleId),
        inArray(taskAssignment.taskId, grantingTaskIds),
      ),
    );

  return new Set(holdings.map((h) => h.branchId));
}

// The task's own coordination slot (Phase 12's is_coordination_slot,
// within a multi-slot task) — a second, narrower way to be authorized
// for some coordination actions, per spec's "Whoever holds branch
// coordination for the task (or the task's own coordination slot, if
// it has one) can waive...".
export async function holdsTaskCoordinationSlot(actor: Member, taskId: string) {
  const [row] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .where(
      and(
        eq(taskAssignment.taskId, taskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isCoordinationSlot, true),
      ),
    );
  return Boolean(row);
}

// The combined check spec actually specifies for Requirement waiving:
// branch coordination (scoped to the target task's own placement) OR
// the task's own coordination slot.
export async function isAuthorizedToWaive(actor: Member, scope: CoordinationScope, taskId: string) {
  return (await isCoordinationHolder(actor, scope)) || (await holdsTaskCoordinationSlot(actor, taskId));
}
