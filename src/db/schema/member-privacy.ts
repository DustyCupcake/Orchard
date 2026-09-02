import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { sensitiveFieldKeyEnum } from "./sensitive-field-access-rule";

// docs/spec.md's "Member contact & privacy" — core, not optional, unlike
// Sensitive data's opt-in module (Phase 22). See
// docs/development-plan.md's Phase 46.

export const contactMethodVisibilityEnum = pgEnum("contact_method_visibility", [
  "everyone",
  "task_or_group_mates",
  "emergency_only",
]);

// type is free text (email, phone, telegram, ...) per spec's own "e.g." —
// not worth a fixed enum for an open-ended, community-specific list.
export const contactMethod = pgTable("contact_method", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  type: text("type").notNull(),
  value: text("value").notNull(),
  visibility: contactMethodVisibilityEnum("visibility").notNull().default("everyone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Runs on GDPR Art. 6(1)(d) vital interests, deliberately outside the
// consent machinery below — no ConsentRecord/ConsentPurpose gates this,
// and none should. See docs/spec.md's "Member contact preferences &
// emergency access": choosing the emergency-only visibility tier is
// itself the informed act; this log plus its explanation is the
// accountability trail, the same role ConsentRecord plays elsewhere,
// just riding a different legal basis.
export const emergencyAccessLog = pgTable("emergency_access_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  activatedBy: uuid("activated_by")
    .notNull()
    .references(() => member.id),
  targetMemberId: uuid("target_member_id")
    .notNull()
    .references(() => member.id),
  explanation: text("explanation"),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per distinct purpose needing its own consent — ordinary,
// "necessary to participate" processing (task history, availability)
// gets no row here at all. gatesSensitiveField is a resolved addition
// beyond spec's own literal field list: an explicit admin-configured
// pointer from a purpose to the one Sensitive-data field (Phase 22) it
// gates, reusing the exact same enum and explicit-pointer pattern
// SensitiveFieldAccessRule already uses for task/tier unlocks, rather
// than a brittle key-string convention (spec's own key examples —
// sensitive_health, sensitive_dietary, ... — read as illustrative
// shape, not a fixed contract). Null for a purpose unrelated to
// Sensitive data (photo_publication, marketing_comms, ...). At most one
// purpose per community may gate a given field — enforced at the
// application layer in src/lib/consent.ts, not here.
export const consentPurpose = pgTable("consent_purpose", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  key: text("key").notNull(),
  label: text("label").notNull(),
  noticeVersion: integer("notice_version").notNull().default(1),
  noticeText: text("notice_text").notNull(),
  requiresExplicit: boolean("requires_explicit").notNull().default(false),
  gatesSensitiveField: sensitiveFieldKeyEnum("gates_sensitive_field"),
});

export const consentMethodEnum = pgEnum("consent_method", ["explicit_action", "form_submission"]);

// withdrawnAt = null -> currently active. A member can have several
// rows over time for the same purpose (grant -> withdraw -> re-grant),
// each its own row — never updated in place except to set withdrawnAt.
export const consentRecord = pgTable("consent_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  purposeId: uuid("purpose_id")
    .notNull()
    .references(() => consentPurpose.id),
  noticeVersion: integer("notice_version").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  method: consentMethodEnum("method").notNull(),
});
