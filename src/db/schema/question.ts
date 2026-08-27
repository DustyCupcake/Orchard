import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";
import { inputRound } from "./input-round";

export const questionResponseTypeEnum = pgEnum("question_response_type", [
  "free_text",
  "single_choice",
  "multi_choice",
]);

// "Anyone can pose a question, tied to a specific task, at any time" —
// see docs/spec.md's "Input rounds". Queues silently (roundId null)
// until the scheduler bundles it into an InputRound at the next
// community-wide cutoff. deadline/priority are display/sort hints
// only ("the point past which an answer stops being useful"), not
// enforced cutoffs of their own.
export const question = pgTable("question", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  askedBy: uuid("asked_by")
    .notNull()
    .references(() => member.id),
  text: text("text").notNull(),
  responseType: questionResponseTypeEnum("response_type").notNull().default("free_text"),
  // Only meaningful for single_choice/multi_choice.
  options: text("options").array().notNull().default([]),
  deadline: timestamp("deadline", { withTimezone: true }),
  priority: boolean("priority").notNull().default(false),
  roundId: uuid("round_id").references(() => inputRound.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Answering is always independently optional per question" — no
// required/deferred status the way ProfileAnswer has; a row's mere
// existence is the answer. Updated in place on re-submission (same
// "just the current answer" shape as ProfileAnswer), matching the
// low-stakes, single-sitting framing spec describes.
export const questionResponse = pgTable("question_response", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id")
    .notNull()
    .references(() => question.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  value: jsonb("value").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
});
