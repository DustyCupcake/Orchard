import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { member, permissionGrant, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "../errors";
import { isModuleOpenToEveryone } from "../permissions";

type Member = typeof memberTable.$inferSelect;

// The shift_management module (docs/cycle-scope-remediation-plan.md
// §2.6/§4.8/D10) — the holder of a shift_management-granted task in a
// matching scope is that scope's roster manager. Scope comes from the
// granted task's own placement, the §2.1 rule every module uses: a task
// placed in cycle C manages Cycle C's shift roster; a cycle-less task
// manages the community's standing series. This is the *only* authority
// — the old per-series creator/sourceTaskId routes are gone. A roster
// with no grant-backed manager is a visible unmanaged gap (its cycle
// roster stays closed), the same honest state every single-pointer
// module has. Mirrors src/lib/backstop.ts's resolver shape exactly.

// The current real (non-shadow) holder of a scope's shift_management
// task, or null when the scope has no filled manager. cycleId null =
// the standing (community-wide) series scope.
export async function resolveShiftManager(
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
        eq(permissionGrant.moduleKey, "shift_management"),
        eq(task.communityId, communityId),
        cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleId),
      ),
    )
    .limit(1);
  return rows[0]?.member ?? null;
}

// Is this member the current holder of the scope's shift_management
// task? The one check both the lib write-paths (series placement
// gating, open act, proposal confirmation, re-placing) and the UI
// (which roster sections render, whether a series counts as "mine" for
// needs-action) funnel through.
//
// An open `shift_management` module answers true for every scope
// (docs/open-permissions-plan.md D3). Note this is checked *before*
// resolveShiftManager, and that is not a workaround: resolveShiftManager
// picks one holder with `.limit(1)`, and the four
// requireShiftManagerForScope call sites all discard that member — the check
// is "is the actor one of the managers", so an arbitrary pick among several
// is harmless. Compare backstop, where the picked member is the person
// emailed, and which is therefore the one module that is not openable (D11).
export async function isShiftManagerForScope(actor: Member, cycleId: string | null): Promise<boolean> {
  if (await isModuleOpenToEveryone(actor.communityId, "shift_management")) {
    return true;
  }

  const manager = await resolveShiftManager(actor.communityId, cycleId);
  return manager?.id === actor.id;
}

export async function requireShiftManagerForScope(actor: Member, cycleId: string | null): Promise<Member> {
  const manager = await resolveShiftManager(actor.communityId, cycleId);
  if (manager?.id !== actor.id) {
    throw new ForbiddenError("Only the current holder of this scope's shift-management task can do that");
  }
  return manager;
}

// Every scope where this member is currently the shift manager — a list
// of placement cycleIds (null = the standing community scope). Powers
// the /shifts page's "my managed rosters" section and the proposals the
// actor is allowed to confirm (listPendingShiftProposals reads this).
export async function listShiftManagerScopesForMember(actor: Member): Promise<(string | null)[]> {
  const rows = await db
    .select({ cycleId: task.cycleId })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .innerJoin(taskAssignment, and(eq(taskAssignment.taskId, task.id), eq(taskAssignment.isShadow, false)))
    .where(
      and(
        eq(permissionGrant.communityId, actor.communityId),
        eq(permissionGrant.moduleKey, "shift_management"),
        eq(task.communityId, actor.communityId),
        eq(taskAssignment.memberId, actor.id),
      ),
    );
  return rows.map((r) => r.cycleId);
}

export interface ShiftManagerScopeHolder {
  memberId: string;
  memberName: string;
}

// The shift manager for each of the given scopes (cycleId null = the
// standing community scope), in one query — what the board-sized roster
// surfaces need to render "managed by {name}" across whatever scopes are
// in view. First holder wins per scope (at most one by the module's
// single-cardinality-per-scope rule).
export async function listShiftManagersForScopes(
  communityId: string,
  cycleIds: (string | null)[],
): Promise<Map<string | null, ShiftManagerScopeHolder>> {
  const byScope = new Map<string | null, ShiftManagerScopeHolder>();
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
        eq(permissionGrant.moduleKey, "shift_management"),
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