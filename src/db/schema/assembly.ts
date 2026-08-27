import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";

export const assemblyQuestionResponseTypeEnum = pgEnum("assembly_question_response_type", [
  "free_text",
  "single_choice",
  "multi_choice",
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
  responseType: assemblyQuestionResponseTypeEnum("response_type").notNull().default("free_text"),
  options: text("options").array().notNull().default([]),
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
