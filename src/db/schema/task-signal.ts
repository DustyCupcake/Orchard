import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";

export const taskSignalKindEnum = pgEnum("task_signal_kind", [
  "stalled",
  "might_need_help",
  "something_feels_off",
  "worth_a_look",
]);

// A lightweight, closed-choice-only flag — see docs/spec.md's
// "Anonymous task signal". Not in spec's own Data model section (that
// section predates Coordination mechanics being scoped into a real
// phase), so this shape is this phase's own design: deliberately no
// member_id at all, not even hidden from the UI — "a signal that can
// be traced back defeats its own purpose," per spec, so there's
// nothing here to trace back to in the first place.
export const taskSignal = pgTable("task_signal", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  kind: taskSignalKindEnum("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
