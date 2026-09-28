import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { communityInvite } from "./community-invite";
import { cycle } from "./cycle";
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

// The lifecycle of an objection under docs/joining-admission-plan.md
// §2.6. `standing` is where every objection starts and where an
// objection *lives*: it is never thrown out by the window's timer, and
// inaction never admits or excludes. The three terminal states are the
// three things that can actually happen to it — mediation cleared it,
// mediation let it stand (which refuses the admission), or the body
// exercised the overrule (the exception, and the only one that needs a
// threshold).
export const objectionResolutionEnum = pgEnum("objection_resolution", [
  "standing",
  "cleared",
  "upheld",
  "overruled",
  "withdrawn",
]);

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
//
// docs/joining-admission-plan.md §2.6/§4.3 tightens that from
// "anonymous to the community, visible to the evaluators" into a
// *shield at rest*: raisedBy is now readable only by the mediation
// body (holders of a task granted `recruitment_mediation`), never by
// the evaluators, and never by the person being objected to or the
// inviter. See src/lib/recruitment/mediation.ts for the resolver and
// objection_party_exclusion / objection_party_consent for the two ways
// the objector adjusts what the body may see.
//
// formResponseId became nullable so the *same* objection machinery
// covers both windows the plan unifies ("one discipline, applied to
// both consensus-lane arrivals and the existing evaluated-path wider-
// discussion", §2.6): inviteId is set for a consensus-lane arrival,
// which has no application behind it, and formResponseId for the
// evaluated path. Exactly one is set, enforced at the application
// layer — the same posture schedulingEntry's memberId/formResponseId
// pair takes in this schema. communityId is denormalized onto the row
// so the mediation queue can scope by community without a join through
// either subject.
export const objection = pgTable("objection", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  formResponseId: uuid("form_response_id").references(() => formResponse.id),
  inviteId: uuid("invite_id").references(() => communityInvite.id),
  raisedBy: uuid("raised_by")
    .notNull()
    .references(() => member.id),
  note: text("note").notNull(),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  resolution: objectionResolutionEnum("resolution").notNull().default("standing"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: uuid("resolved_by_id").references(() => member.id),
  resolutionNote: text("resolution_note"),
});

// "Who are you sticking with" (docs/joining-admission-plan.md
// §2.8/J9). Pairing is *fact only*: the platform records that A named B
// and never decides anything from it. The three shapes the plan names
// all land on this one row:
//   — the named person is a member      → secondMemberId, and the link
//     they got was the support view, so a pair here is an extra vouch;
//   — the named person is applying too  → secondResponseId is set once
//     they apply through the link, and the namer then gets the
//     accept-the-pairing link (same token) to confirm the person who
//     arrived is the person they meant;
//   — the recruitment/mediation team links them by hand → requestedBy
//     is the team member, and status starts at awaiting_accept.
// The token is the one pairing *and* accept link: opening it as the
// named person routes to the application (or the support view), and
// opening it as the namer offers accept/decline.
export const recruitmentPairStatusEnum = pgEnum("recruitment_pair_status", [
  "awaiting_applicant",
  "awaiting_accept",
  "accepted",
  "declined",
]);

export const recruitmentPair = pgTable("recruitment_pair", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  cycleId: uuid("cycle_id").references(() => cycle.id),
  token: text("token").notNull().unique(),
  // The person who named the other. Always a Member — even for a manual
  // link, where that member is the one who did the linking, because
  // there is no version of a pairing with nobody behind it.
  requestedById: uuid("requested_by_id")
    .notNull()
    .references(() => member.id),
  // The namer's own side, when the namer is an applicant too (the
  // public-application lane's "who are you sticking with" answer).
  firstResponseId: uuid("first_response_id").references(() => formResponse.id),
  secondMemberId: uuid("second_member_id").references(() => member.id),
  secondResponseId: uuid("second_response_id").references(() => formResponse.id),
  status: recruitmentPairStatusEnum("status").notNull().default("awaiting_applicant"),
  // §2.8 — the joint interview is opt-in, so "offered", "said yes" and
  // "said no" are three separate recorded facts rather than one
  // nullable flag: a community reading these later needs to be able to
  // tell a pair who was never asked from a pair who declined, and the
  // answerer's own refusal is a thing worth having on the record.
  sharedCallOfferedAt: timestamp("shared_call_offered_at", { withTimezone: true }),
  sharedCallAcceptedAt: timestamp("shared_call_accepted_at", { withTimezone: true }),
  sharedCallDeclinedAt: timestamp("shared_call_declined_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// J10's binding consent, for the path that has no invite row to record
// it on: a public applicant on a consensus lane has no redemption step,
// so the disclosure is read and ticked at the application itself. The
// invite's two consent steps stay on community_invite (the plan says so
// explicitly — "recorded on the invite row") because that row *is* the
// send; this table is the application-shaped twin, and the exact text
// is stored rather than a boolean so a later argument about what was
// agreed is answerable from the record.
export const recruitmentApplicationConsent = pgTable("recruitment_application_consent", {
  id: uuid("id").primaryKey().defaultRandom(),
  formResponseId: uuid("form_response_id")
    .notNull()
    .references(() => formResponse.id),
  disclosure: text("disclosure").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
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
  // docs/development-plan.md's Phase 48: the real conversion step
  // Phases 32-34 deliberately left un-mechanized (see this file's own
  // recruitmentDecision comment above, and decisions.ts's
  // maybeCreateAccompanimentTask, which used to have no Member row to
  // read referredByMemberId off at all). Set at most once, the same
  // idempotency-marker posture as accompanimentTaskId — a real
  // Member/MemberIdentity pair only ever gets created here when the
  // application Form's own fields are tagged isNameField/isEmailField
  // (see src/lib/forms.ts); an untagged form's decision simply never
  // gets this set, a real, visible limitation rather than a silent
  // failure (surfaced on the Accompaniment task's own description).
  convertedMemberId: uuid("converted_member_id").references(() => member.id),
  // Idempotency marker for src/lib/recruitment/subscriptions.ts's
  // updateRecruitmentSubscriptionLapses scheduled job — set once this
  // decision's intro-call poll has confirmed a slot and every
  // currently-active subscriber's consecutiveNoAvailabilityCount has
  // been updated for it, so a decision is never processed twice.
  subscriptionLapseProcessedAt: timestamp("subscription_lapse_processed_at", { withTimezone: true }),
});
