import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { communityInvite } from "./community-invite";
import { formResponse } from "./form";
import { member } from "./member";

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
