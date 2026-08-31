import { date, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dateRelativeModeEnum, dateTypeEnum, phase } from "./phase";
import { task } from "./task";
import { member } from "./member";

// The 4-way anchor Task milestones (and, per spec, Freestanding events
// in Phase 42) need — a Phase's own boundary can only ever anchor to
// its Cycle (2-way, see phase.ts's cycleOffsetAnchorEnum), but a
// milestone's parent can be either a Phase or the task's own Cycle. See
// docs/spec.md's "Task milestones" and docs/development-plan.md's
// Phase 41.
export const milestoneAnchorTypeEnum = pgEnum("milestone_anchor_type", [
  "phase_start",
  "phase_end",
  "cycle_start",
  "cycle_end",
]);
export const taskMilestoneStatusEnum = pgEnum("task_milestone_status", ["confirmed", "pending"]);

// User-labeled dates on a task ("Deposit due," "Order arrives") — see
// docs/spec.md's "Task milestones." Reuses Phase 39's dateTypeEnum/
// dateRelativeModeEnum (absolute/relative, offset/percent) but not its
// cycleOffsetAnchorEnum, since a milestone's anchor can be a Phase
// boundary too.
//
// No cached/resolved-date column, unlike Phase's own start_date/
// end_date (a deliberate exception Phase 39 documents there) — nothing
// pre-existing reads a TaskMilestone date expecting a plain column, so
// this defaults back to this codebase's usual live-computed-on-read
// posture; see src/lib/task-milestones.ts's resolveMilestone.
//
// One deliberate deviation from spec's own literal field list: spec's
// data model also lists a `span_type` enum(single, between) column —
// but per spec's own prose ("Percent only means something for the
// between case... offset stays the only option outside the span"),
// span_type is fully determined by relative_mode (offset⟺single,
// percent⟺between) with no other combination ever valid, so it's
// omitted here as redundant rather than persisted as a second thing
// that could drift out of sync for no benefit — the same choice Phase
// 39 already made for Phase's own boundary shape (which never had a
// separate span-type field either).
export const taskMilestone = pgTable("task_milestone", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  label: text("label").notNull(),
  dateType: dateTypeEnum("date_type").notNull().default("absolute"),
  absoluteDate: date("absolute_date"),
  relativeMode: dateRelativeModeEnum("relative_mode"),
  anchorType: milestoneAnchorTypeEnum("anchor_type"),
  offsetDays: integer("offset_days"),
  percent: integer("percent"),
  // Set when anchorType is phase_start/phase_end and this milestone
  // points at a Phase other than the task's own (defaults to the
  // task's own phaseId when null) — see docs/spec.md: "should belong
  // to the same Cycle as the task's own," enforced at write time.
  phaseId: uuid("phase_id").references(() => phase.id),
  status: taskMilestoneStatusEnum("status").notNull().default("confirmed"),
  // Who originally proposed it — set once, never changes. May differ
  // from createdBy: a holder's own direct add sets both to themselves;
  // a non-holder's pending add sets proposedBy to the non-holder, and
  // createdBy is reassigned to the confirming holder once they act on
  // it, so createdBy always answers "which holder is answerable for
  // this confirmed milestone" while proposedBy stays a pure audit
  // trail of who first suggested it. Resolved reading of spec's own
  // "may differ from created_by if a holder later confirms someone
  // else's pending add" — see src/lib/task-milestones.ts.
  proposedBy: uuid("proposed_by")
    .notNull()
    .references(() => member.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
