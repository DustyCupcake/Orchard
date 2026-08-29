import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { communityInvite } from "./community-invite";
import { formResponse } from "./form";
import { member } from "./member";
import { schedulingPoll } from "./scheduling-poll";
import { task } from "./task";

export const recruitmentRecommendationEnum = pgEnum("recruitment_recommendation", [
  "proceed",
  "decline",
  "unsure",
]);

// "A standing opt-in (not a task claim) any qualifying member can
// activate for application alerts and the availability tool Phase
// 34's scheduling needs" — see docs/spec.md's Recruitment. One row per
// member, created on first activation and toggled in place afterward
// rather than deleted on deactivation, so
// consecutiveNoAvailabilityCount survives an activate/deactivate
// cycle. That counter is Phase 34's own to increment — its scheduling
// flow is what actually knows whether a subscriber gave availability;
// this phase only ever reads it back at 0.
export const recruitmentSubscription = pgTable("recruitment_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id)
    .unique(),
  active: boolean("active").notNull().default(false),
  consecutiveNoAvailabilityCount: integer("consecutive_no_availability_count").notNull().default(0),
});

// One row per evaluator, against the application FormResponse — "the
// evaluators" are resolved as whoever currently holds the recruitment
// task (src/lib/recruitment/access.ts's isRecruitmentTaskHolder), the
// same no-dedicated-relationship posture every other coordination role
// here already takes, not a separate assignment mechanism.
// Resubmittable in place (upserted per formResponseId+evaluatorId,
// no DB-level unique constraint), the same posture Assemblies'
// responses / Budget's votes already use — an evaluator changing
// their mind before a decision is reached is a real, low-stakes case.
export const evaluation = pgTable("evaluation", {
  id: uuid("id").primaryKey().defaultRandom(),
  formResponseId: uuid("form_response_id")
    .notNull()
    .references(() => formResponse.id),
  evaluatorId: uuid("evaluator_id")
    .notNull()
    .references(() => member.id),
  recommendation: recruitmentRecommendationEnum("recommendation").notNull(),
  notes: text("notes"),
  filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
});

// A resolved interpretation this phase needs to build for spec's own
// "when the applicant came through an invite link, its
// inviterThinksGoodFit/inviterKnowsPersonally checkboxes [are]
// additional same-mapping inputs" to mean anything: applying (this
// phase's public /apply) and redeeming an invite (Phase 32's public
// /invite/[token], which creates a Member immediately, no evaluation)
// are two independent doors, so a public applicant who was also
// separately given an invite link can optionally reference its token
// on their application (never consuming it — redemption is still the
// only thing that marks an invite spent) to have its checkboxes feed
// this phase's decision rules instead of skipping evaluation
// entirely. A small dedicated link table rather than a column on
// formResponse, which stays a fully generic, Recruitment-unaware Forms
// primitive — see docs/spec.md's Forms ("the mechanism doesn't care
// which [module uses it]"). Unique on formResponseId: one linked
// invite per application.
export const recruitmentApplicationInvite = pgTable("recruitment_application_invite", {
  id: uuid("id").primaryKey().defaultRandom(),
  formResponseId: uuid("form_response_id")
    .notNull()
    .references(() => formResponse.id)
    .unique(),
  communityInviteId: uuid("community_invite_id")
    .notNull()
    .references(() => communityInvite.id),
});

// "Subscribed members can raise an anonymous-to-the-community... but
// visible-to-the-evaluators objection" — see docs/spec.md's
// Recruitment. raisedBy is stored (never deleted, a real audit trail
// same as e.g. Conflict management keeps underneath its own visibility
// filtering) but deliberately never surfaced back out — see
// src/lib/recruitment/objections.ts's listObjections, which strips it
// before returning to evaluators. "Anonymous" reads as unqualified
// here, not just "hidden from the wider community" — the same posture
// the Anonymous task signal already takes ("a signal that can be
// traced back defeats its own purpose").
export const objection = pgTable("objection", {
  id: uuid("id").primaryKey().defaultRandom(),
  formResponseId: uuid("form_response_id")
    .notNull()
    .references(() => formResponse.id),
  raisedBy: uuid("raised_by")
    .notNull()
    .references(() => member.id),
  note: text("note").notNull(),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recruitmentDecisionOutcomeEnum = pgEnum("recruitment_decision_outcome", [
  "proceed",
  "wider_discussion",
  "decline",
]);
// A rule's own defaultResolution vocabulary (matches recruitmentDecisionRuleSchema
// in evaluations.ts) — deliberately distinct from
// recruitmentDecisionResolutionEnum below: this is what a rule *says*
// ("if unobjected, treat this as a proceed"), not the decision's final
// actioned state.
export const recruitmentDecisionLeaningEnum = pgEnum("recruitment_decision_leaning", [
  "proceed",
  "decline",
]);
export const recruitmentDecisionResolutionEnum = pgEnum("recruitment_decision_resolution", [
  "accepted",
  "declined",
]);

// The real, persisted trigger point Phase 33 deliberately didn't
// build — computeRecruitmentOutcome (evaluations.ts) stays live-
// computed and un-persisted for as long as a decision hasn't been
// reached, but the moment enough evaluators have filed, THIS phase
// needs a durable record to act on once (auto-schedule the intro
// call, open a wider-discussion window) and to protect against acting
// twice if an evaluator later revises their recommendation. One row
// per FormResponse, created once by
// src/lib/recruitment/decisions.ts's recordDecisionIfReached and
// never re-derived afterward.
//
// ruleOutcome is the raw decision-rules match, frozen at decidedAt.
// resolution is the final, actionable state: set immediately for
// proceed ("accepted") and decline ("declined"); starts null for
// wider_discussion and is set once the window resolves (auto, via
// defaultResolution, if no Objection arrives by
// widerDiscussionDeadline; manually by a recruitment-task holder
// otherwise — resolveWiderDiscussionManually, since spec describes an
// objection as sending the outcome to "a human call, not the timer,"
// without naming a mechanism for what that call actually does).
// defaultResolution/widerDiscussionDeadline are only ever set when
// ruleOutcome is wider_discussion — see
// src/lib/recruitment/evaluations.ts's requireValidDecisionRules for
// where a rule's own defaultResolution is validated.
// introCallPollId/accompanimentTaskId are idempotency markers — each
// side effect fires at most once per decision.
export const recruitmentDecision = pgTable("recruitment_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  formResponseId: uuid("form_response_id")
    .notNull()
    .references(() => formResponse.id)
    .unique(),
  ruleOutcome: recruitmentDecisionOutcomeEnum("rule_outcome").notNull(),
  defaultResolution: recruitmentDecisionLeaningEnum("default_resolution"),
  resolution: recruitmentDecisionResolutionEnum("resolution"),
  widerDiscussionDeadline: timestamp("wider_discussion_deadline", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  // Real FKs — neither scheduling-poll.ts nor task.ts has any reason
  // to import this file back.
  introCallPollId: uuid("intro_call_poll_id").references(() => schedulingPoll.id),
  // Plaintext, not hashed like magic-link/session tokens — corrected
  // from an initial "hash it like a login token" instinct: this app
  // has no outbound-email layer to deliver it automatically (unlike a
  // magic link, which the mailer sends directly), and a Form's fields
  // are opaque to the platform, so there's no reliable way to extract
  // the applicant's contact info to send it either. The only real
  // delivery path is a human (the evaluator) copying the link from
  // /applications and sending it themselves — the same "shareable,
  // resendable, human-relayed link" shape CommunityInvite's own token
  // already established, for the identical reason.
  introCallToken: text("intro_call_token").unique(),
  accompanimentTaskId: uuid("accompaniment_task_id").references(() => task.id),
});
