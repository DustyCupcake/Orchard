import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";

// A simple timestamped thread on a task, open to anyone.
export const taskComment = pgTable("task_comment", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One evolving block per task. "Current" is just the most recent revision
// per task — no separate current-content field needed.
export const taskWikiRevision = pgTable("task_wiki_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  content: text("content").notNull(),
  editedBy: uuid("edited_by")
    .notNull()
    .references(() => member.id),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
});

// Links out to wherever the actual file/page already lives — no native
// file storage for task resources (see docs/architecture.md).
export const taskResource = pgTable("task_resource", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => member.id),
  label: text("label").notNull(),
  url: text("url").notNull(),
  tag: text("tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
