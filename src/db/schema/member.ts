import { boolean, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  // The fixed sensitive-field set from docs/spec.md's "Sensitive data"
  // — GDPR Art. 9-flavored fields, off by default (see
  // src/lib/modules.ts). Always visible/editable by the member
  // themselves regardless of any SensitiveFieldAccessRule; access to
  // *another* member's value is purpose-bound, gated at the query
  // layer in src/lib/sensitive-data.ts, not by hiding these columns.
  healthConditions: text("health_conditions"),
  allergies: text("allergies"),
  emergencyContact: text("emergency_contact"),
  orientation: text("orientation"),
  // Contribution tracking (docs/spec.md) — off by default, the same
  // private-by-default/explicit-opt-in pattern as the sensitive fields
  // above and contact-method visibility. Only gates *others'* view of
  // this member's breakdown; their own is always visible to themselves.
  contributionVisible: boolean("contribution_visible").notNull().default(false),
});
