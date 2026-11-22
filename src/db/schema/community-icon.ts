import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { bytea } from "./bytea";

// The app icons generated from one uploaded PNG — the browser tab, the phone
// home screen, and the install prompt each want a different size, and none of
// them can be resized at read time without putting an image pipeline on every
// request. So upload generates the whole set once and this table stores it.
//
// A row per variant rather than one row of columns: the set is not fixed
// forever (a browser invents a new home-screen size every few years), and a
// row makes adding one a code change rather than a migration.
//
// `variant` is one of COMMUNITY_ICON_VARIANTS in src/lib/community-icon.ts —
// the library owns the vocabulary, this table only stores what it names.
export const communityIcon = pgTable(
  "community_icon",
  {
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(),
    bytes: bytea("bytes").notNull(),
    contentType: text("content_type").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.communityId, table.variant] })],
);
