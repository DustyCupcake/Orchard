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
  // How long the conflict team has to acknowledge a new report before
  // it's shown as overdue — see docs/spec.md's Conflict management
  // Flow ("24h in the reference case, community-configurable").
  conflictAckWindowHours: integer("conflict_ack_window_hours").notNull().default(24),
  //
  // The Admins task isn't a dedicated Community → Task column, same as
  // branch coordination below — see `PermissionGrant`
  // (src/db/schema/permission-grant.ts, docs/development-plan.md's
  // Phase 63), which replaced both this and every other single-task/
  // tag-based access gate with one real table. adminsEverClaimed
  // latches true the first time any admin-module PermissionGrant's task
  // is actually claimed and never resets, even across a later gap with
  // no current holder — that's what keeps /settings gated shut rather
  // than quietly reopening to everyone whenever Admins happens to be
  // between holders.
  adminsEverClaimed: boolean("admins_ever_claimed").notNull().default(false),
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
  // Plain uuid, no `.references()` — form.ts needs to import
  // community.ts for its own communityId column, so community.ts
  // importing form.ts back would cycle. Validated at the application
  // layer instead — see src/lib/forms.ts. Null = no standing
  // post-cycle feedback form configured yet.
  postCycleFeedbackFormId: uuid("post_cycle_feedback_form_id"),
  // Same non-FK pointer pattern as postCycleFeedbackFormId — form.ts
  // needs to import community.ts, so community.ts importing form.ts
  // back would cycle. Deliberately *not* spec's own `form.purpose`
  // field: this codebase already has a working "which Form does X"
  // pointer convention, reused here rather than growing a second one.
  // Null = no application form configured yet — /apply says so.
  recruitmentApplicationFormId: uuid("recruitment_application_form_id"),
  // "However many evaluators the Community assigns (two, in the
  // reference case)" — see docs/spec.md's Recruitment. "The
  // evaluators" are resolved as whoever currently holds a task granting
  // the `recruitment` module (src/lib/recruitment/access.ts,
  // `PermissionGrant`), not a separate assignment mechanism — this is
  // just how many distinct evaluators have to file before a decision is
  // considered reached.
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
  // Per-community branding — see design_handoff_conventions/README.md's
  // "Data model changes needed". Hex strings (e.g. "#3a6cd9"), null
  // until a community sets its own; the design tokens fall back to the
  // README's own documented defaults (cobalt/plum) when null — see
  // src/app/layout.tsx. logoUrl is a plain hosted-image URL for now —
  // there's no upload/storage utility anywhere in this codebase yet, so
  // building one is explicitly deferred rather than guessed at here.
  accentPrimary: text("accent_primary"),
  accentSecondary: text("accent_secondary"),
  logoUrl: text("logo_url"),
  // OIDC second auth provider (docs/development-plan.md's Phase 57) —
  // "provider-pluggable, not one fixed method," alongside (never
  // replacing) magic-link. All three null = OIDC off, magic-link only.
  // The client secret deliberately lives in env (OIDC_CLIENT_SECRET),
  // never this row — it's a real credential, not configuration, same
  // "secret in env, everything else in the row" split SESSION_SECRET
  // already establishes for magic-link's own signing key.
  oidcIssuerUrl: text("oidc_issuer_url"),
  oidcClientId: text("oidc_client_id"),
  // "Account creation is role-gated, not automatic on a successful
  // login" — the exact role name (Zitadel project-role) a token must
  // carry before src/lib/oidc.ts resolves or creates a Member at all.
  oidcRequiredRole: text("oidc_required_role"),
});
