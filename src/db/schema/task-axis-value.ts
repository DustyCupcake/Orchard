import { integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { traitAxis } from "./trait-axis";

// A task's own position on one TraitAxis — set (optionally) by a
// proposer's "suggested" fields on /propose, reviewed/overridden at
// activation, same posture as suggestedTags/suggestedEffort on
// TaskProposal. Deliberately no row here for the "commitment
// preference" axis — its task-side value is derived live from the
// existing Task.effort enum instead, since duplicating what's already
// on every task would drift (see src/lib/onboarding.ts). A task with no
// row for a given axis simply doesn't contribute that axis to
// proximity matching — never blocks or excludes it.
export const taskAxisValue = pgTable(
  "task_axis_value",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id),
    axisId: uuid("axis_id")
      .notNull()
      .references(() => traitAxis.id),
    value: integer("value").notNull(),
  },
  (t) => [uniqueIndex("task_axis_value_task_axis_idx").on(t.taskId, t.axisId)],
);
