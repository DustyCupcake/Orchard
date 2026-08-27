import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { community } from "./community";
import { branch } from "./branch";
import { cycle } from "./cycle";
import { phase } from "./phase";
import { member } from "./member";

export const taskEffortEnum = pgEnum("task_effort", ["one_off", "ongoing", "owns_a_thing"]);
export const taskStatusEnum = pgEnum("task_status", ["unclaimed", "claimed", "waiting", "done"]);
export const taskOpennessEnum = pgEnum("task_openness", [
  "open",
  "request",
  "coordination_approved",
  "community_endorsed",
]);
export const taskAttentionLevelEnum = pgEnum("task_attention_level", [
  "ok",
  "soft",
  "hard",
  "escalated",
]);

// The atomic unit of work. See docs/spec.md's "Task" section for the full
// field-by-field rationale.
//
// Not yet included: source_poll_id / source_poll_role (→ SchedulingPoll) —
// Scheduling polls aren't built yet.
export const task = pgTable("task", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branch.id),
  cycleId: uuid("cycle_id").references(() => cycle.id),
  phaseId: uuid("phase_id").references(() => phase.id),
  parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => task.id),
  clonedFromTaskId: uuid("cloned_from_task_id").references((): AnyPgColumn => task.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").array().notNull().default([]),
  effort: taskEffortEnum("effort").notNull(),
  // Duration bucket for one_off (under_hour · few_hours · half_day ·
  // multi_day), hours/week for ongoing/owns_a_thing — either a flat number
  // or a per-phase map ({phase_id: hours}). See "Effort magnitude".
  effortMagnitude: jsonb("effort_magnitude").notNull(),
  status: taskStatusEnum("status").notNull().default("unclaimed"),
  capacity: integer("capacity").default(1),
  openness: taskOpennessEnum("openness").notNull().default("request"),
  endorsementThreshold: integer("endorsement_threshold"),
  browsePeriodEnd: timestamp("browse_period_end", { withTimezone: true }),
  critical: boolean("critical").notNull().default(false),
  nextCheckinAt: timestamp("next_checkin_at", { withTimezone: true }),
  waitingNote: text("waiting_note"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  suggestedMemberId: uuid("suggested_member_id").references(() => member.id),
  attentionLevel: taskAttentionLevelEnum("attention_level").notNull().default("ok"),
});
