import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";

// Join table: task_id depends on depends_on_task_id finishing first.
export const taskDependency = pgTable(
  "task_dependency",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => task.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);
