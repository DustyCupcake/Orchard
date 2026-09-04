import { and, eq } from "drizzle-orm";
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

// Which task(s) currently grant this module for a Community — the one
// thing every one of the nine old fields/tags actually meant, and the
// one thing every enforcement check below reads instead of a Community
// column or a Task.tags match now. cycleId stays unfiltered (and
// always null in every row today) — see permission-grant.ts's own
// comment on why that column exists but isn't used yet.
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
// grants this module with a new one (or clears it, when taskId is
// null), matching the old single-pointer-column's exact "set this
// field" semantics. Never call this for a multi-cardinality module
// (admin/branch_coordination/support) — it would silently drop every
// other task already granting it; use addPermissionGrant instead.
export async function setPermissionGrant(
  communityId: string,
  moduleKey: PermissionModuleKey,
  taskId: string | null,
): Promise<void> {
  if (taskId) {
    await requireTaskInCommunity(communityId, taskId);
  }
  await db
    .delete(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey)));
  if (taskId) {
    await db.insert(permissionGrant).values({ communityId, moduleKey, taskId });
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
