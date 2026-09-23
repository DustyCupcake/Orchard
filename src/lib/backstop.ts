import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity, permissionGrant, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { sendBackstopHardFlagEmail } from "./mailer";

type Member = typeof memberTable.$inferSelect;

// The backstop module (docs/cycle-scope-remediation-plan.md §2.5/§4.7) —
// the standing, task-granted accountable holder for critical tasks in a
// scope. Scope comes from the granted task's own placement, exactly the
// §2.1 rule every other module uses: a task placed in cycle C is cycle
// C's backstop; a cycle-less task is the community/evergreen backstop,
// which covers only cycle-less criticals (D1 — strict, no reach into a
// cycle's data). A scope's backstop is whoever currently holds (non-
// shadow) its backstop-granted task; single instance per scope, enforced
// by setPermissionGrant's ordinary per-scope single-cardinality rule.

// The current real (non-shadow) holder of a scope's backstop-granted
// task, or null when the scope has no filled backstop. cycleId null =
// the community/evergreen backstop.
export async function resolveBackstopHolder(
  communityId: string,
  cycleId: string | null,
): Promise<Member | null> {
  const rows = await db
    .select()
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .innerJoin(taskAssignment, and(eq(taskAssignment.taskId, task.id), eq(taskAssignment.isShadow, false)))
    .innerJoin(member, eq(member.id, taskAssignment.memberId))
    .where(
      and(
        eq(permissionGrant.communityId, communityId),
        eq(permissionGrant.moduleKey, "backstop"),
        eq(task.communityId, communityId),
        cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleId),
      ),
    )
    .limit(1);
  return rows[0]?.member ?? null;
}

// Is this member the current holder of the scope's backstop task?
export async function isBackstopForScope(actor: Member, cycleId: string | null): Promise<boolean> {
  const holder = await resolveBackstopHolder(actor.communityId, cycleId);
  return holder?.id === actor.id;
}

export async function requireBackstopForScope(actor: Member, cycleId: string | null): Promise<Member> {
  const holder = await resolveBackstopHolder(actor.communityId, cycleId);
  if (holder?.id !== actor.id) {
    throw new ForbiddenError("Only the current holder of this scope's backstop task can do that");
  }
  return holder;
}

// Every scope where this member is currently the backstop — a list of
// placement cycleIds (null = the community/evergreen scope). Shared by
// the escalation queue's view-scope gating (§5.5: the scope's backstop
// sees its own cycle's segment only) and the board's duty segment.
export async function listBackstopScopesForMember(actor: Member): Promise<(string | null)[]> {
  const rows = await db
    .select({ cycleId: task.cycleId })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .innerJoin(taskAssignment, and(eq(taskAssignment.taskId, task.id), eq(taskAssignment.isShadow, false)))
    .where(
      and(
        eq(permissionGrant.communityId, actor.communityId),
        eq(permissionGrant.moduleKey, "backstop"),
        eq(task.communityId, actor.communityId),
        eq(taskAssignment.memberId, actor.id),
      ),
    );
  return rows.map((r) => r.cycleId);
}

export interface BackstopScopeHolder {
  memberId: string;
  memberName: string;
}

// The backstop holder for each of the given scopes (cycleId null = the
// community/evergreen scope), in one query — what the board needs to
// render its "Backstop: {name}" markers across whatever cycles are in
// view. First holder wins per scope (there's at most one by the module's
// single-cardinality-per-scope rule).
export async function listBackstopHoldersForScopes(
  communityId: string,
  cycleIds: (string | null)[],
): Promise<Map<string | null, BackstopScopeHolder>> {
  const byScope = new Map<string | null, BackstopScopeHolder>();
  if (cycleIds.length === 0) return byScope;

  const scopeConditions = cycleIds.map((cid) => (cid === null ? isNull(task.cycleId) : eq(task.cycleId, cid)));
  const rows = await db
    .select({
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
        eq(permissionGrant.moduleKey, "backstop"),
        eq(task.communityId, communityId),
        or(...scopeConditions),
      ),
    );
  for (const r of rows) {
    if (byScope.has(r.cycleId)) continue;
    byScope.set(r.cycleId, { memberId: r.memberId, memberName: r.memberName });
  }
  return byScope;
}

// D7 — the only backstop notification: when a critical task in a scope
// hard-flags (unclaimed past the deadline staleness tolerates), its
// scope's backstop is told. Browse-close is deliberately un-notified —
// the duty view and board marker already show it. Emails only a holder
// who has opted into email delivery and actually has a login email to
// reach; a community/evergreen scope resolves cycleId null the same way.
export async function notifyBackstopOfHardFlag(input: {
  communityId: string;
  cycleId: string | null;
  taskId: string;
  taskTitle: string;
}): Promise<void> {
  const holder = await resolveBackstopHolder(input.communityId, input.cycleId);
  if (!holder || !holder.emailNotificationsEnabled) return;

  const [identity] = await db
    .select({ email: memberIdentity.loginEmail })
    .from(memberIdentity)
    .where(and(eq(memberIdentity.memberId, holder.id), inArray(memberIdentity.provider, ["magic_link", "oidc"])))
    .limit(1);
  if (!identity) return;

  await sendBackstopHardFlagEmail(identity.email, {
    taskTitle: input.taskTitle,
    taskUrl: `/tasks/${input.taskId}`,
  });
}