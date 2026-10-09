import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { task } from "./task";

// Every one of these module keys used to be its own Community column
// (the nine originals — either a tag matched against a task's
// general-purpose Task.tags (admin/branch_coordination/support), or a
// single scalar task-id pointer (the other six)) — and the later
// cycle-shaped modules (backstop, shift_management) arrive as plain
// additions to the same table. Both shapes are replaced by this one
// table: a row is a real, explicit "this task grants this module"
// fact, never a string match against a field also used for ordinary
// board categorization (docs/plans/development-plan.md's Phase 63 — the tag
// shape's real bug, not just an inconsistency, was that a task tagged
// "support" for unrelated logistics reasons could silently grant real
// View-as access).
//
// A grant row is deliberately bare — task + module only. The granted
// task's *scope* comes from where the task sits (`task.cycleId`, see
// docs/plans/archive/cycle-scope-remediation-plan.md §2.1): a cycle-placed task's
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
  "recruitment_mediation",
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
  // a subset-based permission model in docs/plans/development-plan.md.
  permissionKey: text("permission_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────── who held it, and for how long ───────────────────────
//
// The table above records authority as *configured* — which task grants which
// module — and says nothing about who actually held that task. It could not
// have said otherwise: `task_assignment` rows are deleted outright on release
// (src/lib/tasks/lifecycle.ts's releaseAssignmentInTx), taking claimedAt with
// them, so a holding period leaves no trace at all.
//
// That gap sits exactly where it hurts most. A claim is the moment authority
// is acquired, and for two of the three routes in src/lib/sensitive-data.ts's
// satisfiedRuleIds — `unlockedByTaskId` and `unlockedByGrantModuleKey` —
// holding the task *is* the access. D9 settled that opening a module does not
// unlock a restricted question (docs/plans/archive/open-permissions-plan.md §5, pinned by
// the named "D9" case in tests/open-permissions.test.ts), so the claim is the
// route rather than one route among several.
//
// **Audit only, never authority.** Capability keeps resolving through
// `task_assignment` joined to `permission_grant`, and must keep doing so.
// Resolving it from here instead would be the Phase 63 second-authority-path
// failure docs/plans/archive/open-permissions-plan.md §1 warns about — in a strictly worse
// position, because a stale row here would silently *grant or withhold* a
// capability rather than merely disagreeing with another copy of a fact.
//
// No FK on task_id, for the reason settings_change.entity_id has none: the log
// outlives its subject. deleteTask requires only that the task be unclaimed and
// its creator be the actor, so a task can have its grant stripped and then be
// deleted — an FK would either block that or take the record of a real holding
// down with it. taskTitle is the tombstone, the role entityLabel already plays.
export const permissionHolding = pgTable("permission_holding", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stored rather than derived through the member, following settings_change
  // rather than emergency_access_log / view_as_log: those are two-party rows
  // read through one side's own id, while the question an operator actually
  // asks here — who has been able to read restricted answers in *this*
  // community — is scoped by community, and the churn sweep is a
  // community-wide feed.
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // The FK is kept deliberately: an audit log whose actor can silently vanish
  // is a worse property than one that simply cannot be constructed. There is
  // no member-deletion path in this app (settings/history.ts's read side says
  // so), so the constraint costs nothing and buys that guarantee.
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  taskId: uuid("task_id").notNull(),
  taskTitle: text("task_title").notNull(),
  // Snapshotted, not joined. Grants move: one reassigned or removed mid-hold
  // would make a join-at-read-time log report that the holder had no authority
  // at all — the precise opposite of what happened, and wrong in the one
  // direction that matters.
  moduleKeys: permissionGrantModuleEnum("module_keys")
    .array()
    .notNull(),
  // Both timestamps default to now(), which is transaction_timestamp(), so
  // claimedAt agrees with the task_assignment row's own claimedAt by
  // construction rather than by two clocks happening to agree.
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  // Null means still held — the same meaning as view_as_log.endedAt, and
  // carrying the same caveat: true as far as this log knows, and never a
  // source of truth about who holds what.
  releasedAt: timestamp("released_at", { withTimezone: true }),
});
