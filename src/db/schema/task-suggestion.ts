import { sql } from "drizzle-orm";
import { pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { member } from "./member";
import { task } from "./task";

// Why somebody was suggested for a task. The reason is the useful part of a suggestion: "Sam"
// tells a coordinator nothing, "Sam — invited them, and said yes after the interview" tells
// them whom to ask first and what to say.
export const taskSuggestionReasonEnum = pgEnum("task_suggestion_reason", [
  "said_yes", // reported yes on the person after the interview
  "invited", // sent the invitation the person came in on
  "supported", // vouched for the person
  "proposed", // named by whoever proposed the task
  "shadowed", // shadowed this task last time (an event's task carried into the next)
  "suggested", // named by somebody who simply thought they would fit
]);

// docs/plans/accompaniment-plan.md §3.4. Replaces `task.suggested_member_id`, which held one
// person and no reason. A task can have several people with a reason each, and the same person
// can have more than one (the inviter who also said yes), so the row is per reason; the person
// is what is shown, with their reasons together.
export const taskSuggestion = pgTable(
  "task_suggestion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    reason: taskSuggestionReasonEnum("reason").notNull(),
    // clock_timestamp(), not now(): now() is the start of the transaction, so people suggested
    // together would tie and "in the order they were first suggested" would be the order of their ids.
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    // The suggested person said "not me" about this one. Theirs alone: it hides the prompt from
    // their own dashboard and nothing else. Nothing is logged, nobody is told, and coordination
    // still sees the suggestion, because it is still a reasonable thing to ask them about.
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("task_suggestion_task_member_reason_unique").on(t.taskId, t.memberId, t.reason)],
);
