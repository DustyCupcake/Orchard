import { boolean, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { admission } from "./admission";
import { community } from "./community";
import { communityInvite } from "./community-invite";
import { cycle } from "./cycle";
import { formResponse } from "./form";
import { member } from "./member";
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
// rather than deleted on deactivation. It is the person's own
// setting and never lapses by itself (docs/plans/admission-flow.md §7).
export const recruitmentSubscription = pgTable("recruitment_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id)
    .unique(),
  active: boolean("active").notNull().default(false),
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
//
// Keyed on the *arrival* (docs/plans/admission-flow.md §4): a report is about a person in the
// funnel, and a lane that asks only for a conversation has nobody's application to
// hang it on. `formResponseId` is the application when there is one.
export const evaluation = pgTable("evaluation", {
  id: uuid("id").primaryKey().defaultRandom(),
  formResponseId: uuid("form_response_id").references(() => formResponse.id),
  arrivalId: uuid("arrival_id").references(() => admission.id),
  evaluatorId: uuid("evaluator_id")
    .notNull()
    .references(() => member.id),
  recommendation: recruitmentRecommendationEnum("recommendation").notNull(),
  notes: text("notes"),
  filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("evaluation_arrival_evaluator_unique").on(t.arrivalId, t.evaluatorId)]);

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

// "Who are you sticking with" (docs/plans/archive/joining-admission-plan.md
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
  //
  // Nullable since pairing moved onto arrivals (docs/plans/admission-flow.md §2): a person
  // applying with somebody who made the link from their own page has no member behind
  // them, so the namer is `firstArrivalId`; this is the member who named or linked them
  // (an inviter naming members, or the team linking two arrivals by hand).
  requestedById: uuid("requested_by_id").references(() => member.id),
  // The namer's own side, when the namer is an applicant too (the
  // public-application lane's "who are you sticking with" answer).
  // The pair is between *arrivals* (§4): the first is the person who made the link, or
  // was named; the second is whoever arrived through it. An arrival needn't have an
  // application (a lane that asks only for a conversation), which is why this is no
  // longer keyed on form responses (kept below only until they are dropped).
  firstArrivalId: uuid("first_arrival_id").references(() => admission.id),
  secondArrivalId: uuid("second_arrival_id").references(() => admission.id),
  // Linked by hand by the recruitment/mediation team, so either of the two people may
  // confirm it; otherwise only the namer (the first arrival) can.
  linkedByTeam: boolean("linked_by_team").notNull().default(false),
  secondMemberId: uuid("second_member_id").references(() => member.id),
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
// the decision form (decision-policy.ts), which is where the
// defaultResolution comes from.
// accompanimentTaskId and convertedMemberId are idempotency markers — each
// side effect fires at most once per decision.
export const recruitmentDecision = pgTable("recruitment_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  // One decision per arrival; `formResponseId` is the application when there is one
  // (a lane that asks only for a conversation decides without it).
  formResponseId: uuid("form_response_id")
    .references(() => formResponse.id)
    .unique(),
  arrivalId: uuid("arrival_id")
    .references(() => admission.id)
    .unique(),
  ruleOutcome: recruitmentDecisionOutcomeEnum("rule_outcome").notNull(),
  defaultResolution: recruitmentDecisionLeaningEnum("default_resolution"),
  resolution: recruitmentDecisionResolutionEnum("resolution"),
  widerDiscussionDeadline: timestamp("wider_discussion_deadline", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  // Real FK — task.ts has no reason to import this file back.
  accompanimentTaskId: uuid("accompaniment_task_id").references(() => task.id),
  // docs/plans/development-plan.md's Phase 48: the real conversion step
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
});
