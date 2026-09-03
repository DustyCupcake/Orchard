import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { tier } from "./tier";

export const membershipModelEnum = pgEnum("membership_model", ["cohort", "rolling", "fixed"]);
export const branchMembershipModelEnum = pgEnum("branch_membership_model", ["emergent", "explicit"]);

// A single Community row per deployment. Everything else in the schema
// belongs to one — see docs/spec.md's "Community" section.
export const community = pgTable("community", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  membershipModel: membershipModelEnum("membership_model").notNull().default("rolling"),
  branchMembershipModel: branchMembershipModelEnum("branch_membership_model")
    .notNull()
    .default("emergent"),
  cyclesEnabled: boolean("cycles_enabled").notNull().default(false),
  cycleInitiationTierId: uuid("cycle_initiation_tier_id").references(
    (): AnyPgColumn => tier.id,
  ),
  phasesEnabled: boolean("phases_enabled").notNull().default(false),
  onsiteModeEnabled: boolean("onsite_mode_enabled").notNull().default(false),
  // Plain uuid, no `.references()` call — pointing this at Task would
  // create a Community ↔ Task circular import (task.ts already imports
  // community.ts). Validated at the application layer instead (task
  // exists, same community) — see src/lib/conflict.ts, and the same
  // non-FK approach Requirement.value's completed_task reference
  // already uses for the identical problem. Null = the conflict-
  // management module is off for this Community; no separate flag.
  conflictTeamTaskId: uuid("conflict_team_task_id"),
  // How long the conflict team has to acknowledge a new report before
  // it's shown as overdue — see docs/spec.md's Conflict management
  // Flow ("24h in the reference case, community-configurable").
  conflictAckWindowHours: integer("conflict_ack_window_hours").notNull().default(24),
  //
  // The Admins task isn't a dedicated Community → Task column for the
  // same circular-import reason — it's identified the same way Phase 15
  // plans to identify a branch's coordination task(s): whichever task(s)
  // carry this tag and are `community_endorsed` (see
  // src/lib/settings/admins.ts). adminsEverClaimed latches true the
  // first time any such task is actually claimed and never resets, even
  // across a later gap with no current holder — that's what keeps
  // /settings gated shut rather than quietly reopening to everyone
  // whenever Admins happens to be between holders.
  adminsTag: text("admins_tag").notNull().default("admin"),
  adminsEverClaimed: boolean("admins_ever_claimed").notNull().default(false),
  // "Whoever does branch coordination for branch X" = the current
  // TaskAssignment holders, unioned across every task where
  // branch_id = X and tags contains this tag — see
  // docs/development-plan.md's Phase 15 ("Who 'does branch
  // coordination' (resolved)") and src/lib/coordination.ts. Same
  // no-dedicated-relationship reasoning as adminsTag just above.
  coordinationTag: text("coordination_tag").notNull().default("coordination"),
  inputRoundIntervalDays: integer("input_round_interval_days").notNull().default(7),
  // The next scheduled Input-round cutoff — an explicit, scheduler-
  // managed clock rather than derived from Community/round history, so
  // the cadence stays fixed (always N days apart) regardless of
  // whether any given cutoff actually had questions queued to bundle.
  // Null until the input-rounds job first runs for this Community, at
  // which point it lazily anchors to "now + interval" — see
  // src/lib/input-rounds/scheduler.ts.
  nextInputRoundCutoffAt: timestamp("next_input_round_cutoff_at", { withTimezone: true }),
  defaultCallHasAgenda: boolean("default_call_has_agenda").notNull().default(false),
  defaultCallNeedsSummary: boolean("default_call_needs_summary").notNull().default(false),
  defaultCallRequireRead: boolean("default_call_require_read").notNull().default(false),
  // e.g. ["sensitive_data","shifts","budget", ...] — see ModuleState in the
  // spec for the richer off/testing/on state; that table isn't built yet,
  // this is just the flat list of what's turned on at all.
  modulesEnabled: text("modules_enabled").array().notNull().default([]),
  // Staleness thresholds for the attention-level job (see docs/spec.md's
  // "Attention level is computed from three simultaneous triggers" —
  // "thresholds configurable per Community"). Also doubles as the grace
  // period for an overdue Waiting check-in, rather than adding a third
  // near-identical column for that.
  stalenessSoftDays: integer("staleness_soft_days").notNull().default(7),
  stalenessHardDays: integer("staleness_hard_days").notNull().default(14),
  // Plain uuid, no `.references()` — same non-FK pattern
  // conflictTeamTaskId already uses above, for the identical circular-
  // import reason (form.ts needs to import community.ts for its own
  // communityId column, so community.ts importing form.ts back would
  // cycle). Validated at the application layer instead — see
  // src/lib/forms.ts. Null = no standing post-cycle feedback form
  // configured yet.
  postCycleFeedbackFormId: uuid("post_cycle_feedback_form_id"),
  // Whichever task reviews feedback responses — same "the task is the
  // authority" pattern conflictTeamTaskId established, same non-FK
  // reasoning (task.ts already imports community.ts).
  feedbackReviewTaskId: uuid("feedback_review_task_id"),
  // Whichever task reviews Event scheduling proposals — same "the task
  // is the authority" pattern and same non-FK reasoning as
  // feedbackReviewTaskId/conflictTeamTaskId above. Null = no owner
  // designated yet (proposals can still be submitted, but nobody can
  // review/confirm/publish until this is set).
  eventSchedulingOwnerTaskId: uuid("event_scheduling_owner_task_id"),
  // "Whoever currently holds it is 'a recruitment-facing task' holder
  // throughout this whole batch (Phases 32-35), not a dedicated role" —
  // same "the task is the authority" pattern and same non-FK reasoning
  // as feedbackReviewTaskId/eventSchedulingOwnerTaskId above. Null = no
  // holder designated yet — invite links and inquiries still work, but
  // nobody sees the inquiry inbox until this is set.
  recruitmentTaskId: uuid("recruitment_task_id"),
  // Same non-FK pointer pattern as postCycleFeedbackFormId — form.ts
  // needs to import community.ts, so community.ts importing form.ts
  // back would cycle. Deliberately *not* spec's own `form.purpose`
  // field: this codebase already has a working "which Form does X"
  // pointer convention, reused here rather than growing a second one.
  // Null = no application form configured yet — /apply says so.
  recruitmentApplicationFormId: uuid("recruitment_application_form_id"),
  // "However many evaluators the Community assigns (two, in the
  // reference case)" — see docs/spec.md's Recruitment. "The
  // evaluators" are resolved as whoever currently holds
  // recruitmentTaskId (src/lib/recruitment/access.ts), not a separate
  // assignment mechanism — this is just how many distinct evaluators
  // have to file before a decision is considered reached.
  recruitmentEvaluatorCount: integer("recruitment_evaluator_count").notNull().default(2),
  // The recommendation→outcome mapping, community-configured per spec
  // ("Peach Please's specific matrix becomes one configuration of
  // this, not the only shape it can take"). Resolved shape (spec names
  // none): RecruitmentDecisionRule[] — {conditions, outcome}, evaluated
  // top-to-bottom, first match wins. See
  // src/lib/recruitment/evaluations.ts for the concrete type and
  // src/lib/settings/community.ts's requireValidDecisionRules for the
  // "must end in an unconditional fallback rule, if non-empty"
  // invariant. Empty array = not configured yet — no decision can be
  // computed until a Community sets at least a fallback rule.
  recruitmentDecisionRules: jsonb("recruitment_decision_rules").notNull().default([]),
  // Phase 34's own counter to maintain (its scheduling flow is what
  // actually knows whether a subscriber gave availability) — this
  // phase only defines the threshold field and the subscription
  // structure it lapses against, per spec's "auto-lapses after N
  // consecutive applications with no availability given."
  recruitmentSubscriptionLapseThreshold: integer("recruitment_subscription_lapse_threshold")
    .notNull()
    .default(3),
  // How long a wider-discussion window stays open before auto-
  // resolving with no objection — see docs/spec.md's Recruitment
  // ("Wider discussion window") and docs/development-plan.md's Phase
  // 34. Purely time-computed against RecruitmentDecision.
  // widerDiscussionDeadline, the same no-scheduler-job-for-the-status-
  // itself pattern Phase 31's returning-priority window and Assemblies'
  // computeAssemblyPhase already establish; a real scheduled job still
  // performs the actual auto-resolution once due (creating an
  // Accompaniment task is a real side effect, not just a status read)
  // — see src/lib/recruitment/decisions.ts's resolveWiderDiscussionWindows.
  recruitmentWiderDiscussionHours: integer("recruitment_wider_discussion_hours").notNull().default(48),
  // "A written starting point for the hardest message in the flow" —
  // surfaced to whoever's about to send an actual decline, never sent
  // automatically. A single field for v1, per spec's own framing.
  recruitmentRejectionTemplate: text("recruitment_rejection_template"),
  // Whichever task reviews pending Placement changes and directly edits
  // Zones/unowned Placements — same "the task is the authority" pattern
  // and same non-FK reasoning as eventSchedulingOwnerTaskId/
  // recruitmentTaskId above (task.ts already imports community.ts).
  // Resolved as a single pointer, not a tag like adminsTag/
  // coordinationTag: spec.md's "or any task tagged for it, if there are
  // several co-holders" describes a multi-slot task's holders sharing
  // the load (the same framing the Conflict team gets), not a request
  // for a second tag mechanism — this follows the dominant "one task
  // pointer" pattern already established four times over rather than
  // inventing a new one. Null = nobody can edit Zones or review pending
  // Placement changes yet — see src/lib/spatial-planning.
  spatialPlanningTaskId: uuid("spatial_planning_task_id"),
  // "Reply within [N days]" — see docs/spec.md's Task assignment
  // notification and docs/development-plan.md's Phase 51. Same
  // community-configurable-threshold pattern as conflictAckWindowHours/
  // recruitmentWiderDiscussionHours above.
  taskNominationResponseDays: integer("task_nomination_response_days").notNull().default(3),
  // "One is just noted, a couple becomes a soft flag... three or more
  // surfaces as a pattern" — see docs/spec.md's Response tracking and
  // docs/development-plan.md's Phase 52. "Noted" itself needs no
  // threshold of its own — it's just 1 up to (not including)
  // engagementSoftFlagThreshold; see src/lib/engagement.ts's
  // computeEngagementPattern.
  engagementSoftFlagThreshold: integer("engagement_soft_flag_threshold").notNull().default(2),
  engagementPatternThreshold: integer("engagement_pattern_threshold").notNull().default(3),
  // How long a published, require_read CallSummary waits before a
  // non-reader logs an engagement event — spec names no number here
  // (unlike taskNominationResponseDays/conflictAckWindowHours, which
  // quote a reference value directly), so this is a resolved default
  // rather than a literal spec quote.
  callSummaryReadWindowDays: integer("call_summary_read_window_days").notNull().default(3),
});
