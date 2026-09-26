import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { task } from "./task";

// Every one of these module keys used to be its own Community column
// (the nine originals — either a tag matched against a task's
// general-purpose Task.tags (admin/branch_coordination/support), or a
// single scalar task-id pointer (the other six)) — and the later
// cycle-shaped modules (backstop, shift_management) arrive as plain
// additions to the same table. Both shapes are replaced by this one
// table: a row is a real, explicit "this task grants this module"
// fact, never a string match against a field also used for ordinary
// board categorization (docs/development-plan.md's Phase 63 — the tag
// shape's real bug, not just an inconsistency, was that a task tagged
// "support" for unrelated logistics reasons could silently grant real
// View-as access).
//
// A grant row is deliberately bare — task + module only. The granted
// task's *scope* comes from where the task sits (`task.cycleId`, see
// docs/cycle-scope-remediation-plan.md §2.1): a cycle-placed task's
// authority covers that cycle's data only; a cycle-less task is the
// community/evergreen role. `permission_grant.cycleId` was retired in
// a single migration (D8) once task placement became the one scope
// read.
//
// The one dimension task placement *can't* express is whole-community
// coordination: `task.branchId` is NOT NULL, so every cycle-less task
// lands in exactly one branch, and a granted `branch_coordination`
// task can therefore only ever be branch-wide. Rather than reintroduce
// a second scope column on this table (the thing D8 just retired),
// community-wide coordination is its own module key
// (`community_coordination`) — one more capability in the same
// capability-per-module-key shape the whole table already uses. It is
// cycle_variant, not a community-only role: a grant placed in an event
// is that event's coordinator exactly as `branch_coordination` would be,
// and only the branch is dropped, so a community that does want
// per-branch coordinators and also a community-wide one can have both.
// See src/lib/coordination.ts, which resolves both keys as one family.
export const permissionGrantModuleEnum = pgEnum("permission_grant_module", [
  "admin",
  "branch_coordination",
  "community_coordination",
  "conflict_team",
  "feedback_review",
  "event_scheduling_owner",
  "recruitment",
  "spatial_planning",
  "announcements",
  "support",
  "backstop",
  "shift_management",
  "budget",
  "kitchen",
]);

// A plain new table, not a Community column — no circular-import
// workaround needed the way conflictTeamTaskId/etc. needed on
// Community (task.ts already imports community.ts; this file imports
// both freely with real FKs, since neither community.ts nor task.ts
// needs to import this file back).
export const permissionGrant = pgTable("permission_grant", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  moduleKey: permissionGrantModuleEnum("module_key").notNull(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  // Reserved, always null (meaning "grants the whole module") until a
  // future phase defines real finer-grained permission keys and teaches
  // specific enforcement checks to read them — see the "Beyond" note on
  // a subset-based permission model in docs/development-plan.md.
  permissionKey: text("permission_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
