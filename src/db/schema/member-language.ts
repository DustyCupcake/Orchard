import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { member } from "./member";

export const memberLanguageLevelEnum = pgEnum("member_language_level", [
  "basic",
  "conversational",
  "fluent",
  "native",
]);

// Repeatable (a member can speak several languages), which is exactly why
// this isn't a ProfileQuestion answer — that mechanism holds one current
// value per question, not a variable-length list. `language` is free
// text, same posture as tags — not worth a closed list for an open-ended,
// community-specific set of languages.
export const memberLanguage = pgTable("member_language", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  language: text("language").notNull(),
  level: memberLanguageLevelEnum("level").notNull().default("conversational"),
});
