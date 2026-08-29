import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { community } from "./community";
import { member } from "./member";
import { task } from "./task";

export const shiftSignupStatusEnum = pgEnum("shift_signup_status", [
  "signed_up",
  "completed",
  "no_show",
]);

// Recurring, never-"done" work distinct from a Task's one-shot claim/
// finish lifecycle — see docs/spec.md's "Shifts / rota" (a single
// sentence; the real design resolution lives in docs/development-
// plan.md's Phase 29). A series is its own standing thing, optionally
// (not necessarily) rotated off an existing Task — see spec's
// Coordination mechanics: "genuinely unloved tasks ... rotate it (it
// becomes a recurring shift)" — one of three explicit options for a
// task nobody wants, never a requirement for creating a series in the
// first place.
export const shiftSeries = pgTable("shift_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  branchId: uuid("branch_id").references(() => branch.id),
  title: text("title").notNull(),
  description: text("description"),
  defaultCapacity: integer("default_capacity").notNull(),
  // Real FK, not the non-FK pointer pattern Community's own task
  // pointers need — shift.ts is a fresh schema file task.ts has no
  // reason to ever import back, same reasoning Phase 22's
  // SensitiveFieldAccessRule and Phase 26's BudgetCycle.ownerTaskId
  // already relied on. Null = created directly, no originating task.
  sourceTaskId: uuid("source_task_id").references(() => task.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Retires a series without losing its history — past occurrences/
  // signups stay exactly as they were, it just stops accepting new
  // sign-ups and drops off the default browse view.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// Explicitly, batch-created rows — no live-evaluated recurrence-rule
// engine, the same posture Phase/Cycle already take over a derived
// schedule. See src/lib/shifts/occurrences.ts's generateShiftOccurrences
// for the two ways a batch gets produced (weekly pattern or an
// explicit datetime list).
export const shiftOccurrence = pgTable("shift_occurrence", {
  id: uuid("id").primaryKey().defaultRandom(),
  seriesId: uuid("series_id")
    .notNull()
    .references(() => shiftSeries.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  // Null = use the series' own defaultCapacity.
  capacity: integer("capacity"),
});

// "Any member can sign up for an occurrence up to its capacity (first-
// come ... no waitlist for v1); can withdraw before it starts." No DB-
// level unique constraint on (occurrenceId, memberId) — enforced by a
// pre-check in src/lib/shifts/signups.ts, the same check-then-insert
// posture most of this codebase's join-style tables already use.
// completed/no_show marking is Phase 30's own concern — this phase
// only ever writes/reads `signed_up`, but the full enum is part of
// Phase 29's own schema per the dev plan.
export const shiftSignup = pgTable("shift_signup", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurrenceId: uuid("occurrence_id")
    .notNull()
    .references(() => shiftOccurrence.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  status: shiftSignupStatusEnum("status").notNull().default("signed_up"),
  signedUpAt: timestamp("signed_up_at", { withTimezone: true }).notNull().defaultNow(),
});
