import { boolean, date, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { community } from "./community";
import { formResponse } from "./form";
import { member } from "./member";

export const pollResolutionModeEnum = pgEnum("poll_resolution_mode", [
  "must_overlap",
  "max_attendance",
]);

// "When can enough of the right people actually meet" — see
// docs/spec.md's "Scheduling polls". Every poll picks a real Branch
// (a resolved interpretation: spec allows a poll with no branch at
// all, falling back to the Community's own call defaults, but
// Task.branch_id is NOT NULL and every poll spins up two real tasks —
// see call.ts — so a community that wants a home for non-branch calls
// defines one, e.g. "General", rather than this schema growing a
// nullable-branch special case that would ripple into Task's own
// invariant everywhere else).
export const schedulingPoll = pgTable("scheduling_poll", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branch.id),
  title: text("title").notNull(),
  organizedBy: uuid("organized_by")
    .notNull()
    .references(() => member.id),
  resolutionMode: pollResolutionModeEnum("resolution_mode").notNull(),
  // Only meaningful for must_overlap.
  requiredParticipantIds: uuid("required_participant_ids").array().notNull().default([]),
  // Only meaningful for max_attendance — "don't confirm below N people".
  minAttendance: integer("min_attendance"),
  // The grid's day range — a resolved interpretation, not spelled out
  // in spec: the daily window itself is fixed community-wide (see
  // src/lib/scheduling-polls/grid.ts) rather than configurable per
  // poll, to keep the grid a bounded, renderable size.
  rangeStart: date("range_start").notNull(),
  rangeEnd: date("range_end").notNull(),
  // Pre-filled from the Branch's own default, falling back to the
  // Community's, at creation time — see src/lib/scheduling-polls/crud.ts.
  hasAgenda: boolean("has_agenda").notNull().default(false),
  needsSummary: boolean("needs_summary").notNull().default(false),
  requireRead: boolean("require_read").notNull().default(false),
  confirmedSlotStart: timestamp("confirmed_slot_start", { withTimezone: true }),
  confirmedSlotEnd: timestamp("confirmed_slot_end", { withTimezone: true }),
  confirmedBy: uuid("confirmed_by").references(() => member.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One member's blind submission — "the organizer (or anyone checking
// in on it) only sees the aggregate overlap, not individual raw
// submissions, until a slot is confirmed" (spec). availableSlots is a
// flat array of ISO slot-start timestamps, one per painted grid cell
// (see src/lib/scheduling-polls/grid.ts for the fixed cell size) —
// jsonb rather than a real timestamptz[] column, matching this
// codebase's established preference for jsonb over native arrays for
// anything shaped like "a flexible bag of values" (Requirement.value,
// Task.effort_magnitude, ProfileAnswer.value, ...).
// Nullable as of Phase 34 — a poll's participant can now also be a
// not-yet-a-Member Recruitment applicant, tracked by their own
// FormResponse instead ("required participant for the applicant's
// side means their own token-linked availability submission, not a
// memberId," docs/development-plan.md's Phase 34). Exactly one of
// memberId/formResponseId is set per row, enforced at the application
// layer, not a DB constraint — same posture FormResponse.submittedBy's
// own "null only when..." invariant already takes. Existing
// member-only polls are unaffected: formResponseId is simply always
// null there.
export const schedulingEntry = pgTable("scheduling_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  pollId: uuid("poll_id")
    .notNull()
    .references(() => schedulingPoll.id),
  memberId: uuid("member_id").references(() => member.id),
  formResponseId: uuid("form_response_id").references(() => formResponse.id),
  availableSlots: jsonb("available_slots").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
