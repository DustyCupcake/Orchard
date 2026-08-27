import { pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { community } from "./community";

// A Member belongs to exactly one Community. tierIds is a denormalized
// cache (computed for automatic criteria, hand-edited for manual ones) —
// not a real FK array, Postgres doesn't support those against another
// table's primary key.
//
// Not yet included: joined_via_invite_id (→ CommunityInvite) — Recruitment
// isn't built yet.
export const member = pgTable("member", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  name: text("name").notNull(),
  tags: text("tags").array().notNull().default([]),
  tierIds: uuid("tier_ids").array().notNull().default([]),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  referredByMemberId: uuid("referred_by_member_id").references((): AnyPgColumn => member.id),
});
