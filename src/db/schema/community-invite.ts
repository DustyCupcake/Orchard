import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";

export const inviteConsensusStateEnum = pgEnum("invite_consensus_state", [
  "not_required",
  "awaiting_consent",
  "announced",
  "admitted",
  "withheld",
]);

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
// convention the Budget module already established).
export const communityInvite = pgTable("community_invite", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  token: text("token").notNull().unique(),
  // §4.3/8d — the cycle this invite is for (null = a general community
  // invite). An invite's *lane* is fixed at creation by the inviter's
  // marks below (docs/joining-admission-plan.md §2.1); its redemption
  // resolves through `joining_lane` — the community's rule for that
  // lane, with per-cycle overrides falling back to community-wide.
  cycleId: uuid("cycle_id").references(() => cycle.id),
  label: text("label"),
  inviterThinksGoodFit: boolean("inviter_thinks_good_fit").notNull().default(false),
  inviterKnowsPersonally: boolean("inviter_knows_personally").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedByMemberId: uuid("redeemed_by_member_id").references(() => member.id),
  // docs/joining-admission-plan.md §2.6/J10 — a consensus lane needs
  // two consent steps, and both live here rather than in a side table
  // because this row *is* the send. The awareness tick is the inviter's
  // own assertion that they have told the invitee what is coming
  // ("awareness, never proxy consent" — it is not, and cannot be, the
  // invitee's agreement); the binding consent is the invitee's own
  // checkbox at redemption, with the exact disclosure text they read
  // stored alongside it. Without both, the arrival never becomes
  // visible to anyone: see consensusState below.
  awarenessConfirmedAt: timestamp("awareness_confirmed_at", { withTimezone: true }),
  awarenessConfirmedBy: uuid("awareness_confirmed_by").references(() => member.id),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  consentDisclosure: text("consent_disclosure"),
  // The community-check window's own state, for an invite whose lane
  // resolved to `consensus`. `awaiting_consent` is the pre-redemption
  // hold; `announced` means the Member exists and the arrival is
  // visible for objection until consensusDeadline; `admitted` /
  // `withheld` are the two terminal outcomes, and only ever set by
  // src/lib/recruitment/mediation.ts — the window's timer alone can
  // only ever move `announced` → `admitted`, and only when nobody
  // objected at all.
  consensusState: inviteConsensusStateEnum("consensus_state").notNull().default("not_required"),
  consensusDeadline: timestamp("consensus_deadline", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
