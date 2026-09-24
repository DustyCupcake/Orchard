import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { permissionGrant, task } from "@/db/schema";
import { NotFoundError } from "./errors";

export const PERMISSION_MODULE_KEYS = [
  "admin",
  "branch_coordination",
  "conflict_team",
  "feedback_review",
  "event_scheduling_owner",
  "recruitment",
  "spatial_planning",
  "announcements",
  "support",
  "backstop",
  "shift_management",
] as const;
export type PermissionModuleKey = (typeof PERMISSION_MODULE_KEYS)[number];

// Human-readable label/description per module — the single source of
// truth for both the settings panel's Access & permissions tab and a
// task's own "Permissions granted by this task" checkboxes
// (docs/development-plan.md's Phase 64), so the two entry points never
// drift into describing the same gate two different ways.
export const PERMISSION_MODULE_LABELS: Record<PermissionModuleKey, string> = {
  admin: "Admin",
  branch_coordination: "Branch coordination",
  conflict_team: "Conflict team",
  feedback_review: "Feedback review",
  event_scheduling_owner: "Event scheduling owner",
  recruitment: "Recruitment",
  spatial_planning: "Spatial planning",
  announcements: "Announcements",
  support: "Support (View-as)",
  backstop: "Backstop",
  shift_management: "Shift management",
};

// Each hint leads with its module's scope rule now (docs/cycle-scope-
// remediation-plan.md §5.1/§2.2): "a task grants what it sits in." The
// tier table below (PERMISSION_MODULE_SCOPE_TIER) is the same rule made
// concrete per module; these hints state it in words so the settings
// panel and the task-detail form never describe the same gate two
// different ways.
export const PERMISSION_MODULE_HINTS: Record<PermissionModuleKey, string> = {
  admin:
    "A community-wide role — keep its cycle unset. A cycle-placed Admin task is a contradiction (it would still grant community-wide Admins), so the interface warns rather than silently ignoring it. Whoever currently holds any task granted here gates this whole settings screen — see its own candidacy/endorsement flow on the task itself.",
  branch_coordination:
    "Cycle-shaped — placed in a cycle, it coordinates that cycle; cycle-less, it's a branch-wide coordinator at the community/evergreen scope. Whoever currently holds a task granted here does that task's branch's coordination — waiving requirements, seeing escalations and talk-to-coordinator pings for that branch.",
  conflict_team:
    "A community-wide role — keep its cycle unset; conflicts are relationship-shaped, not cycle-shaped. Whoever holds a task granted here is on the conflict team — a critical, multi-slot coordination task like any other. Reports can still be filed with nobody set, but nobody can review or acknowledge them until it is.",
  feedback_review:
    "Community-wide this pass — cycle scoping lands once responses carry a cycle. Whoever holds this task sees feedback responses on /feedback.",
  event_scheduling_owner:
    "Cycle-shaped — placed in a cycle, it owns that cycle's event scheduling; cycle-less, the community/evergreen scope. Members can still submit proposals without this set, but nobody can review, confirm, or publish until it is.",
  recruitment:
    "Community-wide this pass — cycle scoping lands once intake carries a cycle. Invite links and inquiries still work without this set, but nobody sees the inquiry inbox until it is.",
  spatial_planning:
    "Cycle-shaped — placed in a cycle, it owns that cycle's Zones; cycle-less, the community/evergreen scope. Nobody can draw or edit Zones until this is set — see /spatial-planning.",
  announcements:
    "Cycle-less, it gates community-wide announcements; placed in a cycle, it gates messages to that cycle's roster (coming and/or maybe) instead. Targeted messages (branch/task-holders/arrival-window) work without this.",
  support:
    "A community-wide role — keep its cycle unset. Whoever currently holds a task granted here can view the platform exactly as another member would, read-only — see docs/spec.md's View-as (support).",
  backstop:
    "Cycle-shaped, like Announcements: a task placed in a cycle is that cycle's backstop (covering its critical tasks); a cycle-less task is the community/evergreen backstop (covering cycle-less criticals only, D1). Unclaimed criticals stay open and claimable for anyone — being the backstop is about being named responsible, not closing the task off.",
  shift_management:
    "Cycle-shaped like Announcements: a task placed in a cycle manages that cycle's roster; a cycle-less task manages the community's standing series. Whoever holds it opens sign-ups, confirms proposals, and re-places series. Placing a series in a collecting cycle is open to any member; managing (and adding standing series) is not. A roster with no grant-backed manager stays visibly closed.",
};

// The §2.2 tier table made concrete — how each module's authority
// follows the granted task's placement (§2.1). The settings panel and
// the task-detail form read this to render each grant's derived scope
// and to flag a community-shaped grant that sits in a cycle, rather
// than hard-coding per-module exceptions at each surface:
//   "community"     — community-shaped: cycle-less only. A cycle-placed
//                     instance is a contradiction the interface warns
//                     about (admin, conflict_team, support).
//   "cycle"         — cycle-shaped: placement *is* the scope. In cycle C
//                     → cycle C; cycle-less → the community/evergreen
//                     scope (branch_coordination, event_scheduling_owner,
//                     spatial_planning, backstop, shift_management).
//   "cycle_variant" — community-shaped base with an optional per-cycle
//                     variant: cycle-less → community-wide; cycle-placed
//                     → that cycle (announcements).
//   "deferred"      — community-wide this pass; cycle-keyed data lands
//                     in a later pass (§4.3/D4) (feedback_review,
//                     recruitment).
export type PermissionModuleScopeTier = "community" | "cycle" | "cycle_variant" | "deferred";

export const PERMISSION_MODULE_SCOPE_TIER: Record<PermissionModuleKey, PermissionModuleScopeTier> = {
  admin: "community",
  branch_coordination: "cycle",
  conflict_team: "community",
  feedback_review: "deferred",
  event_scheduling_owner: "cycle",
  recruitment: "deferred",
  spatial_planning: "cycle",
  announcements: "cycle_variant",
  support: "community",
  backstop: "cycle",
  shift_management: "cycle",
};

// The derived-scope label a grant row shows (§5.1): the cycle the
// granting task is placed in, or — for a cycle-less task — "Community-
// wide" for a module whose authority is whole-community (and the
// deferred modules, community-wide this pass), and "Evergreen" for a
// cycle-shaped module's standing/community-less instance (§2.2).
export function describeGrantScope(
  moduleKey: PermissionModuleKey,
  cycleId: string | null,
  cycleName: string | null,
): string {
  if (cycleId) return cycleName ?? "that cycle";
  return PERMISSION_MODULE_SCOPE_TIER[moduleKey] === "cycle" ? "Evergreen" : "Community-wide";
}

// A community-shaped module whose granting task sits in a cycle — the
// contradiction §2.2 describes. The authority still applies (the server
// is the source of truth, D1), so this is a warning the interface shows,
// not a mistake it blocks.
export function isMisplacedCommunityGrant(moduleKey: PermissionModuleKey, cycleId: string | null): boolean {
  return PERMISSION_MODULE_SCOPE_TIER[moduleKey] === "community" && cycleId !== null;
}

// Modules where more than one task can simultaneously grant access
// (Phase 13/15/54's original tag-based gates) — every other module
// enforces at most one granting task, the same single-pointer
// cardinality its old Community column already had.
const MULTI_CARDINALITY_MODULES = new Set<PermissionModuleKey>([
  "admin",
  "branch_coordination",
  "support",
]);

export function allowsMultipleGrants(moduleKey: PermissionModuleKey): boolean {
  return MULTI_CARDINALITY_MODULES.has(moduleKey);
}

// Which task(s) currently grant this module for a Community — the one
// thing every one of the original fields/tags actually meant, and the
// one thing every enforcement check below reads instead of a Community
// column or a Task.tags match now. Scope is *not* an argument: it
// travels on the granting task's own placement (`task.cycleId` — see
// docs/cycle-scope-remediation-plan.md §2.1), so callers wanting a
// specific scope filter that themselves, either by scoping their join
// on task.cycleId (the per-cycle resolvers, e.g.
// src/lib/spatial-planning/access.ts) or through the
// listGrantingTaskIdsForScope helper below (the settings/spatial-
// planning "is anything designated in this scope?" checks).
export async function listGrantingTaskIds(
  communityId: string,
  moduleKey: PermissionModuleKey,
): Promise<string[]> {
  const rows = await db
    .select({ taskId: permissionGrant.taskId })
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey)));
  return rows.map((r) => r.taskId);
}

export async function listPermissionGrants(communityId: string, moduleKey: PermissionModuleKey) {
  return db
    .select()
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey)));
}

// Every grant across every module for a Community, with just enough
// task info (title, branchId, and the granted task's *placement*) to
// render a human-readable row — the settings panel's Access &
// permissions tab groups these by module and shows the derived scope
// ("cycle name, or community-wide" per task.cycleId), and a task's own
// edit/proposal-activation screen scans them to warn when checking a
// single-cardinality module would move it off another task in the same
// scope. cycleId is the granting task's `task.cycleId` (the one scope
// read, docs/cycle-scope-remediation-plan.md §2.1) — `permission_grant`
// carries no cycle column anymore (migration D8). Branch *name* is
// deliberately left to the caller (every one of these three screens
// already has its own branch list in hand) rather than joining branch
// here too.
export async function listGrantsWithTaskInfo(communityId: string) {
  return db
    .select({
      moduleKey: permissionGrant.moduleKey,
      taskId: permissionGrant.taskId,
      title: task.title,
      branchId: task.branchId,
      cycleId: task.cycleId,
    })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .where(eq(permissionGrant.communityId, communityId));
}

// The scope-aware "is anything designated in this scope?" check the
// spatial-planning page needs to render its "No Spatial-planning task
// designated yet" warning per cycle being viewed — filters the module's
// granting tasks by *their* placement (cycleId = null → cycle-less
// community/evergreen tasks only; a real id → tasks placed in that
// cycle). Plain listGrantingTaskIds covers the "any scope at all" form
// (nav/dashboard/conflict-team read paths never care which scope).
export async function listGrantingTaskIdsForScope(
  communityId: string,
  moduleKey: PermissionModuleKey,
  cycleId: string | null,
): Promise<string[]> {
  const grantingTaskIds = await listGrantingTaskIds(communityId, moduleKey);
  if (grantingTaskIds.length === 0) return [];
  const rows = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleId),
      ),
    );
  return rows.map((r) => r.id);
}

// Which modules a specific task currently grants — what the task
// detail view's "Permissions granted by this task" checkboxes diff
// their submission against.
export async function listModuleKeysGrantedByTask(
  communityId: string,
  taskId: string,
): Promise<Set<PermissionModuleKey>> {
  const rows = await db
    .select({ moduleKey: permissionGrant.moduleKey })
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.taskId, taskId)));
  return new Set(rows.map((r) => r.moduleKey));
}

// Defense in depth, not just a UI-layer check — the same "the lib
// function re-validates, it doesn't just trust whatever the caller
// already checked" posture this codebase's other write paths already
// take (e.g. Phase 25/26/36's own field-validation bug fixes). A
// caller with direct programmatic access (a test, a future script)
// should get the same real NotFoundError a cross-community task ID
// would have thrown under the old updateCommunity validation.
async function requireTaskInCommunity(communityId: string, taskId: string) {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Task not found in your community");
  }
}

// Single-cardinality modules only — makes taskId *the* task granting
// this module, replacing whatever task currently grants it in the same
// scope (docs/cycle-scope-remediation-plan.md §2.1/§2.3). The scope is
// not an argument: it comes from where the granted task itself sits
// (`task.cycleId`) — a task placed in cycle C grants cycle C only, a
// cycle-less task is the community/evergreen role — so the replacement
// set is "every other grant of this module whose granting task sits in
// that same scope." Cycle A's owner and cycle B's owner thus still
// coexist as two separate rows (each task placed in its own cycle),
// but two tasks placed in the same cycle can never both grant the same
// module: the second setPermissionGrant silently replaces the first,
// exactly like the old single-pointer-column semantics. Clearing a
// grant is removePermissionGrant(communityId, moduleKey, taskId) — the
// old null-taskId "clear" branch of this function is gone (there is no
// cycle-scope argument to omit, so "clear the community-wide one" has
// nothing left to mean). Never call this for a multi-cardinality
// module (admin/branch_coordination/support) — it would silently drop
// every other task already granting it; use addPermissionGrant instead.
export async function setPermissionGrant(
  communityId: string,
  moduleKey: PermissionModuleKey,
  taskId: string,
): Promise<void> {
  await requireTaskInCommunity(communityId, taskId);

  // The one scope read (§2.1): the granted task's own placement.
  const [grantingTask] = await db
    .select({ cycleId: task.cycleId })
    .from(task)
    .where(eq(task.id, taskId));
  const scopeCycleId = grantingTask.cycleId;

  const sameScopeTaskIds = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.communityId, communityId),
        scopeCycleId === null ? isNull(task.cycleId) : eq(task.cycleId, scopeCycleId),
      ),
    );
  await db
    .delete(permissionGrant)
    .where(
      and(
        eq(permissionGrant.communityId, communityId),
        eq(permissionGrant.moduleKey, moduleKey),
        inArray(
          permissionGrant.taskId,
          sameScopeTaskIds.map((r) => r.id),
        ),
      ),
    );
  await db.insert(permissionGrant).values({ communityId, moduleKey, taskId });
}

// Multi-cardinality modules — adds one more granting task without
// touching any others already granting the same module. A no-op if
// this exact (community, module, task) grant already exists.
export async function addPermissionGrant(
  communityId: string,
  moduleKey: PermissionModuleKey,
  taskId: string,
): Promise<void> {
  await requireTaskInCommunity(communityId, taskId);
  const existing = await db
    .select({ id: permissionGrant.id })
    .from(permissionGrant)
    .where(
      and(
        eq(permissionGrant.communityId, communityId),
        eq(permissionGrant.moduleKey, moduleKey),
        eq(permissionGrant.taskId, taskId),
      ),
    );
  if (existing.length === 0) {
    await db.insert(permissionGrant).values({ communityId, moduleKey, taskId });
  }
}

// Remove a specific task's grant of this module — the plain inverse of
// setPermissionGrant (and of addPermissionGrant for the multi-
// cardinality modules). No cycle argument: the grant row is keyed by
// task, and the scope it covered was just that task's placement, so
// removing the row removes the whole grant.
export async function removePermissionGrant(
  communityId: string,
  moduleKey: PermissionModuleKey,
  taskId: string,
): Promise<void> {
  await db
    .delete(permissionGrant)
    .where(
      and(
        eq(permissionGrant.communityId, communityId),
        eq(permissionGrant.moduleKey, moduleKey),
        eq(permissionGrant.taskId, taskId),
      ),
    );
}

// The shared core of cycle clone and task-pack import
// (docs/cycle-scope-remediation-plan.md §4.4): a copied task keeps the
// module grants its source had, as new bare { communityId, moduleKey,
// taskId } rows keyed by the copy's task id. No scope is copied — the
// copy's own placement re-scopes everything (§2.1): clone-previous-cycle
// places the copied task in the brand-new cycle, pack import places it in
// the imported cycle, so the grant rows already point at the right cycle's
// data before this is even called. Both that clone path
// (src/lib/cycles/crud.ts's clonePermissionGrants) and commitPackImport
// build their moduleKeysByTask map from their own source and call this
// once, so the two copy paths can never drift.
export async function copyPermissionGrants(
  tx: Tx,
  communityId: string,
  moduleKeysByTask: Map<string, readonly PermissionModuleKey[]>,
): Promise<void> {
  const rows: { communityId: string; moduleKey: PermissionModuleKey; taskId: string }[] = [];
  for (const [taskId, moduleKeys] of moduleKeysByTask) {
    for (const moduleKey of moduleKeys) {
      rows.push({ communityId, moduleKey, taskId });
    }
  }
  if (rows.length === 0) return;
  await tx.insert(permissionGrant).values(rows);
}
