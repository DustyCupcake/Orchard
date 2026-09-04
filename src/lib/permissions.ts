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
