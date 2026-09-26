import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { textValidationEnum } from "./profile-question";

// The same six answer shapes as ProfileQuestion, Form.fields and task
// questions, from the same list in src/lib/field-shape.ts. This is the
// third copy of a three-value enum this codebase had, each with its own
// zod schema, its own validator and its own inline renderer.
//
// As with task questions, an Assembly question gets the shared *shape*
// and none of ProfileQuestion's *status* model: no required, no deferral,
// no decline, no due date. An agenda item is a position someone takes;
// abstaining by not answering is already complete.
//
// One consequence worth naming: a choice item with the escape hatch on
// can collect a free-text answer, which the tally can't attribute to an
// option. The tally therefore counts those explicitly as "wrote their
// own answer" rather than dropping them, so the bars still sum to the
// total — see assemblies/[id]/page.tsx.
export const assemblyQuestionResponseTypeEnum = pgEnum("assembly_question_response_type", [
  "text",
  "single_choice",
  "multi_choice",
  "boolean",
  "date",
  "number",
]);

// "Propose → agenda → notice → vote → close" — see docs/spec.md's
// "Assemblies". Phase is always computed from now vs. these three
// timestamps (see src/lib/assemblies/phase.ts), never stored as its
// own column — same "don't keep a second number in sync by hand"
// principle Recruitment's computed pipeline status uses. Every
// duration is fixed at proposal time ("every duration is set per
// Assembly, not fixed per Community") and never edited afterward.
export const assembly = pgTable("assembly", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  proposedBy: uuid("proposed_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  agendaEndsAt: timestamp("agenda_ends_at", { withTimezone: true }).notNull(),
  noticeEndsAt: timestamp("notice_ends_at", { withTimezone: true }).notNull(),
  votingEndsAt: timestamp("voting_ends_at", { withTimezone: true }).notNull(),
  // Which built-in shape this Assembly was proposed from, null when it
  // was written from scratch. "founding_settings" is the only value
  // today (src/lib/assemblies/founding-settings.ts) and is deliberately
  // a free-text key rather than a pgEnum: the whole point of a template
  // is that adding another one later shouldn't cost a migration, and
  // nothing here needs the DB to enforce the set. Read in exactly two
  // places — the /settings nudge, which stops once one of these exists
  // (see community.foundersAssemblyPromptedAt), and the Assembly's own
  // page, which shows the settings-mapping guide alongside each item's
  // tally once results are in.
  templateKey: text("template_key"),
});

// Agenda items — "reuses the same Question/QuestionResponse shape
// Input rounds already uses ... inside a different container" (spec).
// A separate table rather than literally the same `question` row:
// ProfileQuestion (Phase 16) and Question (Phase 17) already stayed
// separate tables despite an almost identical shape, and an
// Assembly's lifecycle (its own agenda/notice/voting timestamps, not
// a bundled InputRound) is different enough to earn its own table
// rather than nullable dual-parent columns bolted onto `question`.
export const assemblyQuestion = pgTable("assembly_question", {
  id: uuid("id").primaryKey().defaultRandom(),
  assemblyId: uuid("assembly_id")
    .notNull()
    .references(() => assembly.id),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => member.id),
  text: text("text").notNull(),
  responseType: assemblyQuestionResponseTypeEnum("response_type").notNull().default("text"),
  // The shared field-shape flags — see the enum's own comment above.
  multiline: boolean("multiline").notNull().default(true),
  validation: textValidationEnum("validation").notNull().default("none"),
  allowOther: boolean("allow_other").notNull().default(false),
  min: integer("min"),
  max: integer("max"),
  step: integer("step"),
  options: text("options").array().notNull().default([]),
  // "Which setting does this answer become?" — only ever set on items
  // seeded from a template (assembly.templateKey), and only ever
  // *displayed*: Assemblies stay advisory, so nothing reads this to
  // write a setting back. It's what makes an advisory result actually
  // actionable though — the closed-phase read view prints each tally
  // next to the settings screen this answer applies to, so whoever
  // holds Admins knows what to change by hand rather than having to
  // work out which question was about which field. Null on every
  // hand-written agenda item.
  settingsMapping: text("settings_mapping"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assemblyResponse = pgTable("assembly_response", {
  id: uuid("id").primaryKey().defaultRandom(),
  assemblyQuestionId: uuid("assembly_question_id")
    .notNull()
    .references(() => assemblyQuestion.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  value: jsonb("value").notNull(),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
});
