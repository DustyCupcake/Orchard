import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";
import { inputRound } from "./input-round";
import { textValidationEnum } from "./profile-question";

// The same six answer shapes ProfileQuestion and Form.fields use, from
// the same list in src/lib/field-shape.ts. This was its own three-value
// enum with its own zod schema, its own validator and its own inline
// renderer; a task question asking "when could you do this" or "how many
// hours" had no honest way to be expressed.
//
// What this system deliberately does NOT get from ProfileQuestion is its
// *status* model: no `required`, no deferral, no "prefer not to say", no
// due date, no per-cycle scoping. An input round is an opinion or an
// offer, and "not answering" is already a complete and legitimate
// response to it — there is nothing to defer and nothing to decline. The
// shape is shared; the semantics are genuinely different, and the
// separation is the point.
export const questionResponseTypeEnum = pgEnum("question_response_type", [
  "text",
  "single_choice",
  "multi_choice",
  "boolean",
  "date",
  "number",
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
  responseType: questionResponseTypeEnum("response_type").notNull().default("text"),
  // The field-shape flags, same set and same meaning as
  // ProfileQuestion's — read through field-shape.ts's toFieldShape, which
  // zeroes whichever don't apply to this row's responseType. Kept as real
  // columns to match the rest of this table and so a question's shape is
  // inspectable in SQL.
  //
  // `multiline` defaults true because `free_text` — which these were all
  // before — always rendered a textarea, and an input round answer is
  // usually a sentence.
  multiline: boolean("multiline").notNull().default(true),
  validation: textValidationEnum("validation").notNull().default("none"),
  allowOther: boolean("allow_other").notNull().default(false),
  min: integer("min"),
  max: integer("max"),
  step: integer("step"),
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
