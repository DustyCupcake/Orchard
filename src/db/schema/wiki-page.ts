import { boolean, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { community } from "./community";
import { branch } from "./branch";
import { member } from "./member";

// Freestanding knowledge that doesn't have a natural home on any single
// task — general reference, platform how-to, camp policy/lore, FAQs. See
// docs/spec.md's Documentation module — the one module that defaults on.
export const wikiPage = pgTable("wiki_page", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // Null = general — plenty of what belongs here (platform how-to) isn't
  // about any one branch.
  branchId: uuid("branch_id").references(() => branch.id),
  title: text("title").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // FAQ without a separate schema: true from creation until either a
  // real revision is written or the question is resolved as a duplicate
  // — see docs/spec.md's "FAQ, without a separate schema."
  questionPending: boolean("question_pending").notNull().default(false),
  // Resolving a pending question by pointing it at an existing page
  // instead of writing new content. Self-referencing, so needs the same
  // AnyPgColumn escape hatch task.ts's parentTaskId already uses.
  duplicateOfPageId: uuid("duplicate_of_page_id").references((): AnyPgColumn => wikiPage.id),
});

// One evolving block per page, the same shape as TaskWikiRevision —
// "current" is just the most recent revision per page, no separate
// current-content field needed.
export const wikiPageRevision = pgTable("wiki_page_revision", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id")
    .notNull()
    .references(() => wikiPage.id),
  content: text("content").notNull(),
  editedBy: uuid("edited_by")
    .notNull()
    .references(() => member.id),
  editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
});
