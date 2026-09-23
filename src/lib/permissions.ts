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
};

export const PERMISSION_MODULE_HINTS: Record<PermissionModuleKey, string> = {
  admin:
    "Whoever currently holds any task granted here gates this whole settings screen — see its own candidacy/endorsement flow on the task itself.",
  branch_coordination:
    "Whoever currently holds a task granted here does that task's branch's coordination — waiving requirements, seeing escalations and talk-to-coordinator pings for that branch.",
  conflict_team:
    "Whoever holds a task granted here is on the conflict team — a critical, multi-slot coordination task like any other. Reports can still be filed with nobody set, but nobody can review or acknowledge them until it is.",
  feedback_review: "Whoever holds this task sees feedback responses on /feedback.",
  event_scheduling_owner:
    "Members can still submit proposals without this set, but nobody can review, confirm, or publish until it is.",
  recruitment:
    "Invite links and inquiries still work without this set, but nobody sees the inquiry inbox until it is.",
  spatial_planning: "Nobody can draw or edit Zones until this is set — see /spatial-planning.",
  announcements:
    "Targeted messages (branch/task-holders/arrival-window) work without this — it only gates community-wide announcements.",
  support:
    "Whoever currently holds a task granted here can view the platform exactly as another member would, read-only — see docs/spec.md's View-as (support).",
};

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
// thing every one of the nine old fields/tags actually meant, and the
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
