import { boolean, integer, pgEnum, pgTable, text, timestamp, index, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { community, communityInvite, formResponse, member } from "./index.js";

// docs/admission-flow.md §5 — One community check
//
// Replaces both:
//   - communityInvite.consensusState + consensusDeadline (invite check)
//   - recruitmentDecision.widerDiscussionDeadline (wider discussion)
//
// A single check window per arrival. Opens either at entry (lane verification=community_check)
// or after evaluation (decision rules return wider_discussion).
//
// The check:
// - Has a deadline (community-wide window hours)
// - Tracks standing concerns (objections)
// - Timer only signals duty; NEVER auto-resolves
// - Mediation outcomes applied by funnel
// - "Ask for more" can add application/interview to path
//
// Concerns (objections) are unified — same table for invite and application checks.
// Each check can have multiple concerns. The check resolves when ALL concerns are resolved.

export const communityCheckKind = pgEnum("community_check_kind", [
  "entry",        // opened at entry (lane verification=community_check)
  "evaluation",   // opened after evaluation (decision rules = wider_discussion)
]);
export const COMMUNITY_CHECK_KINDS = ["entry", "evaluation"] as const;
export type CommunityCheckKind = (typeof COMMUNITY_CHECK_KINDS)[number];

export const communityCheckStatus = pgEnum("community_check_status", [
  "open",         // window is running, no standing concern
  "concerned",    // at least one standing concern
  "cleared",      // all concerns cleared
  "upheld",       // at least one concern upheld (check fails)
  "overruled",    // at least one concern overruled (check passes despite concern)
]);
export const COMMUNITY_CHECK_STATUSES = ["open", "concerned", "cleared", "upheld", "overruled"] as const;
export type CommunityCheckStatus = (typeof COMMUNITY_CHECK_STATUSES)[number];

export const communityCheckConcernResolution = pgEnum("community_check_concern_resolution", [
  "standing",     // concern raised, awaiting mediation
  "cleared",      // mediation resolved the concern
  "upheld",       // mediation concluded concern is valid
  "overruled",    // body overruled the concern
  "withdrawn",    // raiser withdrew the concern
]);

export const communityCheck = pgTable(
  "community_check",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    // The arrival this check belongs to (FK added in migration 0092)
    arrivalId: uuid("arrival_id").notNull(),
    // The kind of check
    kind: communityCheckKind("kind").notNull(),
    // Community-wide window hours (reuses community.recruitmentWiderDiscussionHours)
    windowHours: integer("window_hours").notNull(),
    // Deadline for the check window
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    // Current status
    status: communityCheckStatus("status").notNull().default("open"),
    // How many standing concerns
    standingConcernCount: integer("standing_concern_count").notNull().default(0),
    // Timer-only fields — timer only signals duty, NEVER auto-resolves
    timerSignaledAt: timestamp("timer_signaled_at", { withTimezone: true }),
    // Resolution fields
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id"),
    resolutionNote: text("resolution_note"),
    // "Ask for more" - mediation can add application/interview to path
    askForMoreApplication: boolean("ask_for_more_application").notNull().default(false),
    askForMoreInterview: boolean("ask_for_more_interview").notNull().default(false),
    // Who asked for more
    askedForMoreById: uuid("asked_for_more_by_id"),
    askedForMoreAt: timestamp("asked_for_more_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One check per arrival (the arrival is the funnel unit)
    uniqueIndex("community_check_arrival_unique").on(t.arrivalId),
  ],
);

// Concerns (objections) within a community check
// Unified for both invite and application checks
export const communityCheckConcern = pgTable(
  "community_check_concern",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    checkId: uuid("check_id")
      .notNull()
      .references(() => communityCheck.id),
    // Who raised the concern
    raisedById: uuid("raised_by_id")
      .notNull()
      .references(() => member.id),
    // The concern text
    note: text("note").notNull(),
    // Current resolution
    resolution: communityCheckConcernResolution("resolution").notNull().default("standing"),
    // Resolution details
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id"),
    resolutionNote: text("resolution_note"),
    // Overrule support (for overruled concerns)
    overruleSupporterCount: integer("overrule_supporter_count").notNull().default(0),
    // Shield tables (same as objection system)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("community_check_concern_check_id_idx").on(t.checkId),
    index("community_check_concern_raised_by_idx").on(t.raisedById),
  ],
);

// Shield tables (copied from objection system for consistency)
export const communityCheckConcernExclusion = pgTable(
  "community_check_concern_exclusion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    concernId: uuid("concern_id")
      .notNull()
      .references(() => communityCheckConcern.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    addedById: uuid("added_by_id")
      .notNull()
      .references(() => member.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("community_check_concern_exclusion_concern_member_unique").on(t.concernId, t.memberId),
  ],
);

export const communityCheckConcernConsent = pgTable(
  "community_check_concern_consent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    concernId: uuid("concern_id")
      .notNull()
      .references(() => communityCheckConcern.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => [
    uniqueIndex("community_check_concern_consent_concern_member_unique").on(t.concernId, t.memberId),
  ],
);

export const communityCheckOverruleSupport = pgTable(
  "community_check_overrule_support",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    concernId: uuid("concern_id")
      .notNull()
      .references(() => communityCheckConcern.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    note: text("note").notNull(),
    supportedAt: timestamp("supported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("community_check_overrule_support_concern_member_unique").on(t.concernId, t.memberId),
  ],
);