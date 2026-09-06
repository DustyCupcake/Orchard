import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
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

// The only two modules whose grant can be scoped to a real Cycle
// (docs/development-plan.md's Phase 68) — every other module always
// passes cycleId=null. Shared by the settings panel, the task detail
// view, and proposal activation, so the three surfaces never drift on
// which modules get the extra cycle-picker.
export const CYCLE_SCOPED_MODULES = new Set<PermissionModuleKey>(["event_scheduling_owner", "spatial_planning"]);

// Which task(s) currently grant this module for a Community — the one
// thing every one of the nine old fields/tags actually meant, and the
// one thing every enforcement check below reads instead of a Community
// column or a Task.tags match now. `cycleId` (docs/development-plan.md's
// Phase 68) follows the same undefined/null/string convention
// src/lib/event-scheduling/crud.ts's cycleScopeCondition already
// established: omitted means "every grant for this module, in any
// cycle or community-wide" — every one of the seven modules Phase 68
// doesn't touch calls this with no third argument, so their behavior
// is bit-for-bit unchanged. `null` or a real id filters to exactly
// that cycle's grant(s) — only event_scheduling_owner/spatial_planning
// ever pass this.
export async function listGrantingTaskIds(
  communityId: string,
  moduleKey: PermissionModuleKey,
  cycleId?: string | null,
): Promise<string[]> {
  const conditions = [eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey)];
  if (cycleId !== undefined) {
    conditions.push(cycleId === null ? isNull(permissionGrant.cycleId) : eq(permissionGrant.cycleId, cycleId));
  }
  const rows = await db.select({ taskId: permissionGrant.taskId }).from(permissionGrant).where(and(...conditions));
  return rows.map((r) => r.taskId);
}

export async function listPermissionGrants(communityId: string, moduleKey: PermissionModuleKey) {
  return db
    .select()
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey)));
}

// Every grant across every module for a Community, with just enough
// task info (title, branchId) to render a human-readable row — the
// settings panel's Access & permissions tab groups these by module,
// and a task's own edit/proposal-activation screen scans them to warn
// when checking a single-cardinality module would move it off another
// task. Branch *name* is deliberately left to the caller (every one of
// these three screens already has its own branch list in hand) rather
// than joining branch here too.
export async function listGrantsWithTaskInfo(communityId: string) {
  return db
    .select({
      moduleKey: permissionGrant.moduleKey,
      taskId: permissionGrant.taskId,
      title: task.title,
      branchId: task.branchId,
      cycleId: permissionGrant.cycleId,
    })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .where(eq(permissionGrant.communityId, communityId));
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

// Every module a specific task currently grants, mapped to *every*
// cycle it grants that module for (docs/development-plan.md's Phase
// 68) — an array, not a single value, since a task can now hold the
// same module for more than one cycle simultaneously (see the
// "coexist as two separate rows" note on setPermissionGrant). Backs
// the task-detail/proposal-activation checkbox diffing for
// event_scheduling_owner/spatial_planning specifically: a checkbox's
// current state for the form's selected cycle is
// `(scopes[moduleKey] ?? []).includes(selectedCycleId)`, never a plain
// equality check, or a second concurrent cycle's own grant on the same
// task would go undetected. A flat Set (listModuleKeysGrantedByTask,
// above — left untouched, still exactly what the other seven modules
// need) can't represent this at all.
export async function listGrantedCycleScopesForTask(
  communityId: string,
  taskId: string,
): Promise<Partial<Record<PermissionModuleKey, (string | null)[]>>> {
  const rows = await db
    .select({ moduleKey: permissionGrant.moduleKey, cycleId: permissionGrant.cycleId })
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.taskId, taskId)));
  const result: Partial<Record<PermissionModuleKey, (string | null)[]>> = {};
  for (const r of rows) {
    const list = result[r.moduleKey] ?? [];
    list.push(r.cycleId);
    result[r.moduleKey] = list;
  }
  return result;
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

// Single-cardinality modules only — replaces whatever task currently
// grants this module *for this cycle* with a new one (or clears it,
// when taskId is null), matching the old single-pointer-column's exact
// "set this field" semantics, now scoped per cycle (docs/development-
// plan.md's Phase 68) rather than community-wide. `cycleId` defaults
// to null so every existing call site (the seven modules this phase
// doesn't touch) keeps its exact prior behavior — deleting only the
// community-wide grant, never touching a different cycle's row, since
// there's never been more than one row per module for those seven.
// Only event_scheduling_owner/spatial_planning ever pass a real
// cycleId, letting cycle A's owner and cycle B's owner coexist as two
// separate rows instead of the second write wiping out the first.
// Never call this for a multi-cardinality module
// (admin/branch_coordination/support) — it would silently drop every
// other task already granting it; use addPermissionGrant instead.
export async function setPermissionGrant(
  communityId: string,
  moduleKey: PermissionModuleKey,
  taskId: string | null,
  cycleId: string | null = null,
): Promise<void> {
  if (taskId) {
    await requireTaskInCommunity(communityId, taskId);
  }
  const cycleCondition = cycleId === null ? isNull(permissionGrant.cycleId) : eq(permissionGrant.cycleId, cycleId);
  await db
    .delete(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey), cycleCondition));
  if (taskId) {
    await db.insert(permissionGrant).values({ communityId, moduleKey, taskId, cycleId });
  }
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

export async function removePermissionGrant(
  communityId: string,
  moduleKey: PermissionModuleKey,
  taskId: string,
  cycleId: string | null = null,
): Promise<void> {
  const cycleCondition = cycleId === null ? isNull(permissionGrant.cycleId) : eq(permissionGrant.cycleId, cycleId);
  await db
    .delete(permissionGrant)
    .where(
      and(
        eq(permissionGrant.communityId, communityId),
        eq(permissionGrant.moduleKey, moduleKey),
        eq(permissionGrant.taskId, taskId),
        cycleCondition,
      ),
    );
}
