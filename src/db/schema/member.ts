import { boolean, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { community } from "./community";

// A Member belongs to exactly one Community. tierIds is a denormalized
// cache (computed for automatic criteria, hand-edited for manual ones) —
// not a real FK array, Postgres doesn't support those against another
// table's primary key.
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
  // Plain uuid, no `.references()` — community-invite.ts needs to
  // import member.ts for its own createdBy/redeemedByMemberId FKs, so
  // member.ts importing community-invite.ts back would cycle. Same
  // non-FK pattern (and same "the earlier, more-core file holds the
  // non-FK side") Community's own conflictTeamTaskId/etc. already
  // establish, applied the other direction since here Member is the
  // earlier file. Validated at the application layer — see
  // src/lib/recruitment/invites.ts's redeemCommunityInvite, the only
  // place this is ever set.
  joinedViaInviteId: uuid("joined_via_invite_id"),
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
  // Manual "pin this for me" nav overrides — module/nav-item keys (see
  // src/components/nav/nav-config.ts) a member chose to pin themselves,
  // on top of whatever auto-pins from task-holdership or the current
  // Phase's highlighted module (src/lib/nav.ts). Filtered against
  // current visibility at read time, so a key surviving here for a
  // module that's since been disabled or an item that's been renamed
  // just silently drops out rather than needing cleanup.
  pinnedModuleKeys: text("pinned_module_keys").array().notNull().default([]),
  // "Delivery respects each member's stated contact preference" —
  // docs/spec.md's Outbound communications, resolved for Phase 53 as
  // one flat opt-out rather than the per-category granularity spec
  // doesn't ask this phase to build. Distinct from Phase 46's
  // ContactMethod visibility, which controls who can *see* a contact
  // method, not whether the platform emails it — this gates delivery
  // itself, independent of any method's own visibility setting.
  emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(true),
});
