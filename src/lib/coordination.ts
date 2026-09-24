import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { member, permissionGrant, task, taskAssignment } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { listGrantingTaskIds } from "./permissions";

type Member = typeof member.$inferSelect;

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

// The board renders many tasks across many branches and cycles at once
// — one query up front instead of calling isCoordinationHolder() per
// task. Returns both dimensions of the actor's current coordination
// coverage (§2.4 / §5.3): `branchIds` is column semantics (cycle-less
// granted tasks only — branch-wide authority across every cycle of
// that branch), `cycleIds` is row semantics (cycle-placed granted
// tasks — the whole row of that cycle, any branch). Callers that only
// ever have a branch in hand (messages, engagement) read `branchIds`
// and stay column-only; the board reads both.
export async function listCoordinationScopeIds(actor: Member) {
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "branch_coordination");
  if (grantingTaskIds.length === 0) {
    return { branchIds: new Set<string>(), cycleIds: new Set<string>() };
  }

  const rows = await db
    .select({ branchId: task.branchId, cycleId: task.cycleId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, actor.communityId),
        inArray(taskAssignment.taskId, grantingTaskIds),
      ),
    );

  const branchIds = new Set<string>();
  const cycleIds = new Set<string>();
  for (const r of rows) {
    if (r.cycleId === null) branchIds.add(r.branchId);
    else cycleIds.add(r.cycleId);
  }
  return { branchIds, cycleIds };
}

export interface CoordinationHolder {
  memberId: string;
  memberName: string;
}

// The coordination holder for each of the given scopes, in one query —
// what the board needs to render its "Coordinated by {name}" tags
// (§5.3) across whatever branches and cycles are in view. Branch
// columns mean a cycle-less granted coordination task in that branch;
// cycle rows mean a granted coordination task placed in that cycle.
// First holder wins per scope (mirror of backstop.ts's
// listBackstopHoldersForScopes).
export async function listCoordinationHoldersForScopes(
  communityId: string,
  branchIds: string[],
  cycleIds: string[],
): Promise<{ byBranch: Map<string, CoordinationHolder>; byCycle: Map<string, CoordinationHolder> }> {
  const byBranch = new Map<string, CoordinationHolder>();
  const byCycle = new Map<string, CoordinationHolder>();
  if (branchIds.length === 0 && cycleIds.length === 0) return { byBranch, byCycle };

  const scopeConditions: (SQL | undefined)[] = [];
  if (branchIds.length > 0) {
    scopeConditions.push(and(isNull(task.cycleId), inArray(task.branchId, branchIds)));
  }
  for (const cid of cycleIds) {
    scopeConditions.push(eq(task.cycleId, cid));
  }

  const rows = await db
    .select({
      branchId: task.branchId,
      cycleId: task.cycleId,
      memberId: taskAssignment.memberId,
      memberName: member.name,
    })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .innerJoin(taskAssignment, and(eq(taskAssignment.taskId, task.id), eq(taskAssignment.isShadow, false)))
    .innerJoin(member, eq(member.id, taskAssignment.memberId))
    .where(
      and(
        eq(permissionGrant.communityId, communityId),
        eq(permissionGrant.moduleKey, "branch_coordination"),
        eq(task.communityId, communityId),
        or(...scopeConditions)!,
      ),
    );

  for (const r of rows) {
    if (r.cycleId === null) {
      if (!byBranch.has(r.branchId)) {
        byBranch.set(r.branchId, { memberId: r.memberId, memberName: r.memberName });
      }
    } else if (!byCycle.has(r.cycleId)) {
      byCycle.set(r.cycleId, { memberId: r.memberId, memberName: r.memberName });
    }
  }
  return { byBranch, byCycle };
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
