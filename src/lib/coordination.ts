import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { member, permissionGrant, task, taskAssignment } from "@/db/schema";
import { ForbiddenError } from "./errors";
import { isModuleOpenToEveryone, type PermissionModuleKey } from "./permissions";

type Member = typeof member.$inferSelect;

// The one scope read (docs/cycle-scope-remediation-plan.md §2.1/§2.4),
// passed by everything that asks "does this actor do coordination
// here?": `null` is the community-wide superset ("any coordination
// task, any branch, any cycle" — the Escalation/nav/dashboard gates);
// a bare `string` branchId is column semantics (a cycle-less
// branch_coordination task in that branch — the messages/board
// branch-only call sites, which never have a cycle in hand); an object
// holds the target task's own placement for §2.4's union below.
export type CoordinationScope = string | null | { branchId: string; cycleId: string | null };

// Whoever currently holds either coordination module is "whoever does
// branch coordination" — see docs/spec.md's "Branch" section. Not a
// dedicated relationship: a member coordinates a scope if they really
// hold (a shadow doesn't count, same as everywhere else) a task
// granted for one of COORDINATION_MODULE_KEYS, and that task's own
// placement decides how far the authority reaches.
//
// Two modules, one family, because one dimension of coverage is not
// expressible by task placement: `task.branchId` is NOT NULL, so a
// cycle-less task always lands in exactly one branch and can therefore
// only ever be a *branch*-wide coordinator. `community_coordination` is
// the whole-community option — a small event that doesn't need a
// coordinator per branch grants it once and is covered everywhere.
//
// It differs from branch_coordination in exactly one respect: the
// **branch is never part of its scope**. Everything else is identical —
// placement is still the scope, so a granted task placed in an event is
// that event's coordinator and nothing more, and it's only a grant with
// no event that goes community-wide. The branch on a granted
// community_coordination task is simply not read, which is what lets one
// grant cover branches a branch-scoped one couldn't reach. This is
// deliberately a module key rather than a scope column on
// permission_grant, which would reintroduce the second scope read that
// retired permission_grant.cycleId (D8).
export const COORDINATION_MODULE_KEYS = [
  "branch_coordination",
  "community_coordination",
] as const satisfies readonly PermissionModuleKey[];
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
// Scope resolution (docs/cycle-scope-remediation-plan.md §2.4):
// - `null` — any coordination authority at all, any branch, any cycle
//   (the Escalation/nav/dashboard gates, all explicitly cross-branch).
// - a `string` branchId — column semantics: a *cycle-less* granted
//   branch_coordination task in that branch covers every task in that
//   branch across all cycles. This is what the branch-only call sites
//   (messages.ts, board badges) mean, and it is deliberately narrower
//   than the old behavior of accepting a cycle-placed coordination task
//   there too: a cycle-placed task's authority stays inside its cycle
//   (§2.1). A community_coordination holder satisfies this too — that
//   module has no narrower form to fall back to.
// - `{ branchId, cycleId }` — the item-level union: a cycle-less
//   granted branch_coordination task in that branch OR a granted one
//   placed in that cycle. A task sitting in cycle C is covered by the
//   whole row of cycle C (any branch), and a task outside every cycle is
//   covered by its branch's column only.

// The actor's coordination coverage, resolved once. `branchIds` is
// column semantics (cycle-less branch_coordination grants — authority
// over every cycle of that branch), `cycleIds` is row semantics
// (cycle-placed branch_coordination grants — the whole row of that
// cycle, any branch), and `communityWide` is the community_coordination
// grant, which covers all three at once and is deliberately not
// expressed as "every id" — callers that would otherwise need the full
// branch/cycle lists to expand it (the board, the escalation queue, the
// coordination view gate) read this flag instead and stay O(1).
export interface CoordinationCoverage {
  communityWide: boolean;
  branchIds: Set<string>;
  cycleIds: Set<string>;
}

// The one query behind both public resolvers below. Reads the actor's
// real (non-shadow) holds across both coordination modules together with
// the granted task's placement, then splits them by module key — *not*
// by cycleId — so a community_coordination grant that somehow sits in an
// event still resolves community-wide here, matching
// isMisplacedCommunityGrant's "the server is the source of truth, the
// interface only warns" behaviour.
async function resolveCoordinationCoverage(actor: Member): Promise<CoordinationCoverage> {
  // An open module of either kind answers community-wide immediately
  // (docs/open-permissions-plan.md D3): `communityWide: true` short-circuits
  // every downstream isCoordinationHolder scope check, so an open
  // branch_coordination covers every branch and an open
  // community_coordination is unchanged in effect. Checked before the join
  // because there is nothing to join for a Community that granted no
  // coordination task at all.
  if (
    (await isModuleOpenToEveryone(actor.communityId, "branch_coordination")) ||
    (await isModuleOpenToEveryone(actor.communityId, "community_coordination"))
  ) {
    return { communityWide: true, branchIds: new Set(), cycleIds: new Set() };
  }

  const rows = await db
    .select({
      moduleKey: permissionGrant.moduleKey,
      branchId: task.branchId,
      cycleId: task.cycleId,
    })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .innerJoin(
      taskAssignment,
      and(eq(taskAssignment.taskId, task.id), eq(taskAssignment.isShadow, false)),
    )
    .where(
      and(
        eq(permissionGrant.communityId, actor.communityId),
        inArray(permissionGrant.moduleKey, [...COORDINATION_MODULE_KEYS]),
        eq(task.communityId, actor.communityId),
        eq(taskAssignment.memberId, actor.id),
      ),
    );

  const coverage: CoordinationCoverage = {
    communityWide: false,
    branchIds: new Set<string>(),
    cycleIds: new Set<string>(),
  };
  for (const r of rows) {
    // Placement first, module second — a cycle-placed grant is that
    // cycle's coordinator whichever module granted it, so
    // `communityWide` can only be set by a grant with no cycle at all.
    if (r.cycleId !== null) coverage.cycleIds.add(r.cycleId);
    else if (r.moduleKey === "community_coordination") coverage.communityWide = true;
    else coverage.branchIds.add(r.branchId);
  }
  return coverage;
}

export async function isCoordinationHolder(actor: Member, scope: CoordinationScope) {
  const { communityWide, branchIds, cycleIds } = await resolveCoordinationCoverage(actor);
  if (communityWide) return true;
  if (scope === null) return branchIds.size > 0 || cycleIds.size > 0;
  if (typeof scope === "string") return branchIds.has(scope);
  return (
    branchIds.has(scope.branchId) ||
    (scope.cycleId !== null && cycleIds.has(scope.cycleId))
  );
}

export async function requireCoordinationHolder(actor: Member, scope: CoordinationScope) {
  if (!(await isCoordinationHolder(actor, scope))) {
    throw new ForbiddenError("Only a current branch coordination holder can do this");
  }
}

// The board renders many tasks across many branches and cycles at once
// — one query up front instead of calling isCoordinationHolder() per
// task. See CoordinationCoverage for what each field means; callers
// that only ever have a branch in hand (messages, engagement) read
// `branchIds` and must also honour `communityWide`, which covers every
// branch they would otherwise have to enumerate.
export async function listCoordinationScopeIds(actor: Member): Promise<CoordinationCoverage> {
  return resolveCoordinationCoverage(actor);
}

export interface CoordinationHolder {
  memberId: string;
  memberName: string;
}

// The coordination holder for each of the given scopes, in one query —
// what the board needs to render its "Coordinated by {name}" tags
// (§5.3) across whatever branches and cycles are in view. Branch
// columns mean a cycle-less granted branch_coordination task in that
// branch; cycle rows mean one placed in that cycle. `community` is the
// single community_coordination holder, which covers every scope and so
// is resolved independently of the branch/cycle lists. First holder wins
// per scope (mirror of backstop.ts's listBackstopHoldersForScopes).
export interface CoordinationHoldersByScope {
  byBranch: Map<string, CoordinationHolder>;
  byCycle: Map<string, CoordinationHolder>;
  // The holder of a *cycle-less* community_coordination grant — the
  // whole-community coordinator, covering every branch and every event,
  // including events that didn't exist when the grant was made. Null when
  // there is none, and also when the community's only
  // community_coordination grant sits in an event (that's an event's
  // coordinator, found in byCycle). The board falls back to this last,
  // so a community-wide coordinator is named on a task that no branch or
  // event holder reaches.
  community: CoordinationHolder | null;
}

export async function listCoordinationHoldersForScopes(
  communityId: string,
  branchIds: string[],
  cycleIds: string[],
): Promise<CoordinationHoldersByScope> {
  const byBranch = new Map<string, CoordinationHolder>();
  const byCycle = new Map<string, CoordinationHolder>();
  let community: CoordinationHolder | null = null;
  if (branchIds.length === 0 && cycleIds.length === 0) return { byBranch, byCycle, community };

  const scopeConditions: (SQL | undefined)[] = [
    // A *cycle-less* community_coordination grant is whole-community
    // whatever its task's branch says — included unconditionally rather
    // than filtered by the scope lists, so a community-wide coordinator
    // still shows up when the board is filtered to one branch. The
    // isNull(task.cycleId) is what keeps this from also matching a
    // cycle-placed one, which is just that event's coordinator.
    and(
      eq(permissionGrant.moduleKey, "community_coordination"),
      isNull(task.cycleId),
    ),
  ];
  if (branchIds.length > 0) {
    scopeConditions.push(
      and(eq(permissionGrant.moduleKey, "branch_coordination"), isNull(task.cycleId), inArray(task.branchId, branchIds)),
    );
  }
  // Cycle rows: either module, since a grant placed in an event is that
  // event's coordinator whichever key granted it.
  for (const cid of cycleIds) {
    scopeConditions.push(eq(task.cycleId, cid));
  }

  const rows = await db
    .select({
      moduleKey: permissionGrant.moduleKey,
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
        inArray(permissionGrant.moduleKey, [...COORDINATION_MODULE_KEYS]),
        eq(task.communityId, communityId),
        or(...scopeConditions)!,
      ),
    );

  for (const r of rows) {
    const holder = { memberId: r.memberId, memberName: r.memberName };
    // Placement first, module second — the same order
    // resolveCoordinationCoverage uses, so the name shown on a card and
    // the authority behind it can never disagree. A cycle-placed grant
    // is that event's row, community_coordination or not; only a
    // cycle-less one is either a branch column or the whole community.
    if (r.cycleId !== null) {
      if (!byCycle.has(r.cycleId)) byCycle.set(r.cycleId, holder);
    } else if (r.moduleKey === "community_coordination") {
      community ??= holder;
    } else if (!byBranch.has(r.branchId)) {
      byBranch.set(r.branchId, holder);
    }
  }
  return { byBranch, byCycle, community };
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
