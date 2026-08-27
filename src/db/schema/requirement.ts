import { jsonb, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";

export const requirementTypeEnum = pgEnum("requirement_type", [
  "tier",
  "language",
  "completed_task",
  "custom",
]);
export const requirementModeEnum = pgEnum("requirement_mode", [
  "individual_gate",
  "group_coverage",
  "soft_priority",
]);

// An eligibility predicate attached to a task. `value` shape depends on
// `type` — e.g. {"tier_id": "..."} or {"language": "nl"}. See "Requirement"
// in docs/spec.md for what each mode actually does.
export const requirement = pgTable("requirement", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  type: requirementTypeEnum("type").notNull(),
  mode: requirementModeEnum("mode").notNull().default("individual_gate"),
  value: jsonb("value").notNull(),
});
