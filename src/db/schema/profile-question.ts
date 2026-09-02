import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { cycle } from "./cycle";

export const profileQuestionResponseTypeEnum = pgEnum("profile_question_response_type", [
  "free_text",
  "single_choice",
  "multi_choice",
  // See docs/development-plan.md's Phase 44 — its only real consumer is
  // an opt-in birthday surfaced as its own layer on /calendar, visible
  // per whatever visibility the answering member already controls for
  // any once-ever answer (i.e. only to themselves — no answer-sharing
  // mechanism exists for any responseType today).
  "date",
]);
export const profileQuestionScopeEnum = pgEnum("profile_question_scope", [
  "once_ever",
  "per_cycle",
  "phase",
]);

// A standing fact about a member that shouldn't be pinned to whichever
// flow happened to ask first — see docs/spec.md's "Profile questions".
// Community-wide standing structure, the same footing as Branch/Tier,
// so CRUD is Admins-gated at the settings action layer (see
// src/app/settings/actions.ts) rather than inside this table's own lib
// module, matching how Branch/Tier CRUD is gated.
//
// Not yet included: which surface(s) a question applies to (application,
// onboarding, ...) — those surfaces don't exist yet (see
// docs/development-plan.md's Phase 16 scope note), and guessing the
// shape of that field before a real consumer exists risks getting it
// wrong the same way building Forms/Profile questions standalone would
// have. `feedsCapacitySignal` below is this phase's one real, concrete
// surface instead.
export const profileQuestion = pgTable("profile_question", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  label: text("label").notNull(),
  responseType: profileQuestionResponseTypeEnum("response_type").notNull().default("free_text"),
  // Only meaningful for single_choice/multi_choice.
  options: text("options").array().notNull().default([]),
  scope: profileQuestionScopeEnum("scope").notNull().default("once_ever"),
  // Set only when scope = 'phase'. Matched case-insensitively against
  // the *current* cycle's actual Phase names (see
  // src/lib/profile-questions/capacity.ts) — the same "matched against
  // real names" pattern TaskPack's branch_name_hint uses, just without
  // an import-review screen since there's nothing to remap here. A
  // cycle with no phase by this name just doesn't surface the question.
  phaseNameHint: text("phase_name_hint"),
  required: boolean("required").notNull().default(false),
  // Opts a `scope = 'phase'` question into the Coordination view's
  // capacity-aware fitted asks + availability non-response list (see
  // docs/spec.md's Coordination mechanics). Generic rather than a
  // hardcoded "this is THE Availability question" flag, so a community
  // could in principle define more than one capacity-relevant question
  // across different phase names.
  feedsCapacitySignal: boolean("feeds_capacity_signal").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const profileAnswerStatusEnum = pgEnum("profile_answer_status", ["answered", "deferred"]);
// See docs/spec.md's "Availability and its own visibility setting" —
// deliberately lives on the answer, not a general settings page.
// Harmless/unused on an answer to a question that isn't
// feeds_capacity_signal.
export const capacityVisibilityEnum = pgEnum("capacity_visibility", ["flag_only", "open"]);

// One member's current answer to one ProfileQuestion — updated in
// place (no revision history; spec doesn't ask for one here the way
// task wiki notes get one). `cycleId` is set for per_cycle and phase
// scopes, null for once_ever ("it's just *the* current answer" — see
// spec). A `deferred` status satisfies a required question without a
// guessed or fabricated value.
export const profileAnswer = pgTable("profile_answer", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  questionId: uuid("question_id")
    .notNull()
    .references(() => profileQuestion.id),
  status: profileAnswerStatusEnum("status").notNull().default("answered"),
  value: jsonb("value"),
  capacityVisibility: capacityVisibilityEnum("capacity_visibility").notNull().default("flag_only"),
  cycleId: uuid("cycle_id").references(() => cycle.id),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
});
