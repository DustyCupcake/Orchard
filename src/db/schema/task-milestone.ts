import { boolean, date, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { dateRelativeBasisEnum, dateTypeEnum, phase } from "./phase";
import { task } from "./task";
import { member } from "./member";

// A milestone's parent can be either a Phase or the task's own Cycle.
// The relative recipe itself carries start/end/between; this enum only
// identifies which kind of parent supplies that recipe's boundaries.
export const milestoneParentTypeEnum = pgEnum("milestone_parent_type", ["cycle", "phase"]);
export const taskMilestoneStatusEnum = pgEnum("task_milestone_status", ["confirmed", "pending"]);

// User-labeled dates on a task ("Deposit due," "Order arrives") — see
// docs/spec.md's "Task milestones." Reuses the canonical date recipe
// shared with Phase boundaries and Calendar events. Milestones remain
// live-computed on read; unlike Phase/Event dates there is no cached
// resolved column because no existing consumer needs one.
//
// `parentType` chooses the source of the two parent boundaries;
// `relativeBasis` then says whether the recipe is before the start,
// after the end, or between them. There is deliberately no separate
// start/end anchor for percent mode.
export const taskMilestone = pgTable("task_milestone", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  label: text("label").notNull(),
  dateType: dateTypeEnum("date_type").notNull().default("absolute"),
  absoluteDate: date("absolute_date"),
  relativeBasis: dateRelativeBasisEnum("relative_basis"),
  relativeValue: integer("relative_value"),
  parentType: milestoneParentTypeEnum("parent_type"),
  // Set when parentType = phase and this milestone points at a Phase
  // other than the task's own; null means the task's own Phase.
  phaseId: uuid("phase_id").references(() => phase.id),
  status: taskMilestoneStatusEnum("status").notNull().default("confirmed"),
  // "The" deadline for the schedule/by-phase board views (docs/spec.md's
  // Views: "sort by phase/deadline") — at most one true per task,
  // enforced by src/lib/tasks/milestones.ts auto-clearing any sibling
  // rather than a DB constraint, the same "flag one of several" shape
  // as TaskAssignment.isCoordinationSlot. Not a new parallel date field
  // on Task — deadlines stay inside the milestone system (confirmed/
  // pending, phase-anchored, relative-date resolution) rather than a
  // second concept that could drift out of sync.
  isDeadline: boolean("is_deadline").notNull().default(false),
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
