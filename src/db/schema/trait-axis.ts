import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";

// A registry, not hardcoded columns/enum — the exact set of axes (and
// their wording) is expected to change as real use shows what's actually
// useful, so adding/retiring one is a data change, not a migration.
// Scale convention: an integer -2..2 (5-point), read by both
// MemberAxisValue and TaskAxisValue. `optionLabels`, when set, renders
// as that many labeled radio options mapped 1:1 onto the 5 positions
// instead of a generic low/high slider — used for "autonomy," to
// preserve a community's own real onboarding-question wording rather
// than genericizing it into a bare low/high pair.
export const traitAxis = pgTable("trait_axis", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  key: text("key").notNull(),
  lowLabel: text("low_label").notNull(),
  highLabel: text("high_label").notNull(),
  optionLabels: text("option_labels").array().notNull().default([]),
  // Which axes surface during onboarding vs. only at /profile — kept
  // deliberately short at onboarding (3 axes) per the user's own call
  // that more than that is too much for one first-session screen; the
  // rest are still settable any time, same "nudge, never gate" posture
  // as the rest of onboarding.
  askAtOnboarding: boolean("ask_at_onboarding").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});
