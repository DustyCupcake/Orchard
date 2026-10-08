import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { profileQuestion } from "./profile-question";

// docs/spec.md's "Member contact & privacy" — core, not optional, unlike
// Sensitive data's opt-in module (Phase 22). See
// docs/plans/development-plan.md's Phase 46.

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
  // The one address the platform sends *this member's own* email to —
  // announcements, targeted messages, task nominations, backstop alerts.
  //
  // Until this existed, every one of those read `memberIdentity.loginEmail`
  // instead, which no member could see or change: /profile offered a
  // contact-method form, and nothing anywhere ever sent mail to what came
  // out of it. So a second email was decorative and the address actually
  // in use was invisible. At most one primary per member, enforced in
  // src/lib/contact-methods.ts (clear-then-set in one transaction) rather
  // than by a partial unique index, because "at most one" is an
  // application rule about *which* row moves and this table's other
  // invariants already live there.
  //
  // Deliberately independent of `visibility`. Visibility is about who else
  // may *read* the row; this is about who the platform *writes* to. The
  // seeded primary row is emergency-only precisely because those are
  // orthogonal — a member's delivery address need not be on their public
  // profile, and most will not want it there.
  isPrimary: boolean("is_primary").notNull().default(false),
  // Set by clicking a link mailed to `value`, and **cleared whenever
  // `value` changes** — verification is a fact about an address, so editing
  // the address is what invalidates it. Required before a row can be
  // primary, which is the only thing this gate is protecting: without it,
  // pointing delivery at an address you don't control would be a way to
  // aim the community's mail at a stranger.
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
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
// gets no row here at all. gatesQuestionId is an explicit
// admin-configured pointer from a purpose to the one sensitive question
// it gates, reusing the same explicit-pointer pattern
// SensitiveFieldAccessRule uses for task/tier unlocks rather than a
// brittle key-string convention (spec's own key examples —
// sensitive_health, sensitive_dietary, ... — read as illustrative
// shape, not a fixed contract). Null for a purpose unrelated to
// sensitive data (photo_publication, marketing_comms, ...). At most one
// purpose per community may gate a given question — enforced at the
// application layer in src/lib/consent.ts, not here.
//
// This table used to have a gatesSensitiveField half pointing at the
// four fixed member columns, which were dropped in 0080. ConsentRecord
// rows are untouched by that: a purpose is a purpose whatever it gates,
// so the pointer moved rather than the consent.
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
  gatesQuestionId: uuid("gates_question_id").references(() => profileQuestion.id),
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
