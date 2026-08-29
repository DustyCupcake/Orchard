import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";

// A second, private joining path alongside the ordinary open-door
// magic-link signup — see docs/spec.md's Recruitment: "Invite links."
// Always single-use (redeemedAt set = spent, no multi-use variant —
// spec's own explicit CampTool callout on why). Unlike magic_link_token
// /session, the raw value is stored in plaintext rather than hashed:
// those are login-flow bearer tokens meant to be single-glance-only,
// but this is closer to a shareable, revocable link a member may want
// to view or resend later (the `label` field only makes sense if the
// creator can still see which link is which) — a deliberately
// different tradeoff, not an oversight. Real FKs throughout (a fresh
// schema file, no circular-import reason to avoid them here) — the
// non-FK side of the Member↔CommunityInvite pair lives on
// member.joinedViaInviteId instead, since member.ts is the earlier,
// more-core file (same "the newer module file holds the real FK"
// convention Budget's ownerTaskId already established).
export const communityInvite = pgTable("community_invite", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  token: text("token").notNull().unique(),
  label: text("label"),
  inviterThinksGoodFit: boolean("inviter_thinks_good_fit").notNull().default(false),
  inviterKnowsPersonally: boolean("inviter_knows_personally").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedByMemberId: uuid("redeemed_by_member_id").references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
