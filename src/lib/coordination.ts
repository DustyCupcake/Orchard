import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { listGrantingTaskIds } from "./permissions";

type Member = typeof memberTable.$inferSelect;

// "Whoever does branch coordination" — see docs/spec.md's "Branch"
// section and docs/development-plan.md's Phase 15 ("Who 'does branch
// coordination' (resolved)"). Not a dedicated relationship: a member
// currently does branch coordination for branchId if they currently
// hold (really hold — a shadow doesn't count, same as everywhere else)
// any task in that branch with a real `branch_coordination`-module
// PermissionGrant row (docs/development-plan.md's Phase 63 — previously
// a Task.tags match against Community.coordinationTag). Pass
// branchId=null for the community-wide check ("any coordination task,
// any branch at all") — used by the Escalation view, which is
// explicitly cross-branch per spec.
export async function isCoordinationHolder(actor: Member, branchId: string | null) {
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "branch_coordination");
  if (grantingTaskIds.length === 0) return false;

  const conditions = [
    eq(taskAssignment.memberId, actor.id),
    eq(taskAssignment.isShadow, false),
    eq(task.communityId, actor.communityId),
    inArray(taskAssignment.taskId, grantingTaskIds),
  ];
  if (branchId) {
    conditions.push(eq(task.branchId, branchId));
  }

  const [holding] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(and(...conditions));

  return Boolean(holding);
}

export async function requireCoordinationHolder(actor: Member, branchId: string | null) {
  if (!(await isCoordinationHolder(actor, branchId))) {
    throw new ForbiddenError("Only a current branch coordination holder can do this");
  }
}

// The board renders many tasks across many branches at once — one
// query up front instead of calling isCoordinationHolder() per task.
// Returns the set of branchIds the actor currently does coordination
// for, community-wide.
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
// branch coordination OR the task's own coordination slot.
export async function isAuthorizedToWaive(actor: Member, branchId: string, taskId: string) {
  return (
    (await isCoordinationHolder(actor, branchId)) || (await holdsTaskCoordinationSlot(actor, taskId))
  );
}
