import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { branch, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { isCoordinationHolder, requireCoordinationHolder } from "../coordination";
import { isBackstopForScope, listBackstopScopesForMember } from "../backstop";
import { ForbiddenError, NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

// "Unplaceable tasks surface in a shared 'needs an owner' view visible
// to all coordinators, with cross-branch placement encouraged" — see
// docs/spec.md's "Escalation" (Coordination mechanics). "Unplaceable"
// is read literally off Phase 10's attention_level: `escalated` is
// already the name that tier uses for exactly this — a critical task
// with no owner past its deadline (or a hard-flag past its own
// deadline, with phases off). Visible community-wide (branchId=null),
// not scoped to one branch, matching "cross-branch placement
// encouraged."
//
// docs/cycle-scope-remediation-plan.md §4.7/§5.3 admits a second
// viewer class: a scope's backstop sees the escalated tasks in their
// own scope (their cycle, or the community/evergreen scope for a
// cycle-less backstop) alongside the community-wide coordination gate.
// Coordinators still see the whole queue; a backstop that isn't also a
// coordinator sees only their own scope's segment.
export async function listEscalatedTasks(actor: Member) {
  const isCoordinator = await isCoordinationHolder(actor, null);
  const backstopScopes = isCoordinator ? [] : await listBackstopScopesForMember(actor);
  if (!isCoordinator && backstopScopes.length === 0) {
    throw new ForbiddenError("Only a coordination or backstop holder can see the escalated queue");
  }

  const scopeConditions = backstopScopes.map((cid) => (cid === null ? isNull(task.cycleId) : eq(task.cycleId, cid)));

  return db
    .select({
      id: task.id,
      title: task.title,
      status: task.status,
      branchId: task.branchId,
      branchName: branch.name,
      critical: task.critical,
      createdAt: task.createdAt,
    })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(
      and(
        eq(task.communityId, actor.communityId),
        eq(task.attentionLevel, "escalated"),
        isCoordinator ? undefined : or(...scopeConditions),
      ),
    )
    .orderBy(task.createdAt);
}

// A deliberate coordinator action — docs/spec.md's "Escalation"
// mechanic. Any coordinator can escalate any task in their community
// (not just their own branch), making it visible on the shared
// Escalation view for cross-branch placement. The task's own scope's
// backstop can escalate it too (§4.7, D5: the backstop is responsible
// when a task stalls, and escalating it is part of that) — but only
// inside their own scope, never cross-scope.
export async function escalateTask(actor: Member, taskId: string) {
  const [taskRow] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) throw new NotFoundError("Task not found");

  const isCoordinator = await isCoordinationHolder(actor, null);
  const isBackstop = await isBackstopForScope(actor, taskRow.cycleId);
  if (!isCoordinator && !isBackstop) {
    throw new ForbiddenError("Only a coordination holder, or the backstop of this task's scope, can escalate it");
  }

  const [updated] = await db
    .update(task)
    .set({ attentionLevel: "escalated" })
    .where(eq(task.id, taskId))
    .returning();

  return updated;
}

// Coordinators can also de-escalate a task (e.g. after it's been
// claimed or the situation resolved).
export async function deescalateTask(actor: Member, taskId: string) {
  await requireCoordinationHolder(actor, null);

  const [taskRow] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) throw new NotFoundError("Task not found");

  const [updated] = await db
    .update(task)
    .set({ attentionLevel: "ok" })
    .where(eq(task.id, taskId))
    .returning();

  return updated;
}
