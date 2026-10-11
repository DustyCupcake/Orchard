import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { tier } from "./tier";
import { dateDisplayModeEnum } from "./date-display";

export const membershipModelEnum = pgEnum("membership_model", ["cohort", "rolling", "fixed"]);
export const branchMembershipModelEnum = pgEnum("branch_membership_model", ["emergent", "explicit"]);

// How much of the mediation body has to agree before an objection can be
// overruled in favour of admitting someone anyway
// (docs/joining-admission-plan.md §2.6/J7). Declared here, next to the
// columns that use it, rather than in the recruitment module's own
// schema file: like every other settings-facing vocabulary in this file
// (membershipModelEnum, dateDisplayModeEnum) it is a *configuration*
// choice, and a db/schema file importing another module's file for it
// would be a dependency direction this schema has never taken.
// docs/admission-flow.md §2, "How reports decide": the small fixed form that
// replaced the ordered rules list. The values mirror decision-policy.ts, which a
// client component can import and this file cannot.
export const recruitmentInWhenEnum = pgEnum("recruitment_in_when", ["no_no_one_yes", "more_yes_than_no", "all_yes", "custom"]);
export const recruitmentAnyNoMeansEnum = pgEnum("recruitment_any_no_means", ["wider_discussion", "decline"]);
export const recruitmentDiscussionEndsEnum = pgEnum("recruitment_discussion_ends", ["admit", "decline"]);

export const objectionOverruleModeEnum = pgEnum("objection_overrule_mode", ["majority", "quorum"]);

// A single Community row per deployment. Everything else in the schema
// belongs to one — see docs/spec.md's "Community" section.
export const ssoJoinPolicyEnum = pgEnum("sso_join_policy", ["anyone_with_role", "admitted_only"]);
export const SSO_JOIN_POLICIES = ["anyone_with_role", "admitted_only"] as const;

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
  // Community-wide default for read-only date labels. A Member can
  // override this, or leave its own nullable override null to inherit it.
  defaultDateDisplayMode: dateDisplayModeEnum("default_date_display_mode").notNull().default("exact"),
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
  // Community-wide recruitment door toggles (docs/cycle-scope-remediation-
  // plan.md §4.3/D13): close the *general* cycle-less doors so a
  // community can run fully closed except for the cycles/periods it
  // opens (per-cycle doors live on the cycle itself). Default true — a
  // community that has never touched these keeps working exactly as
  // before.
  // Whether published community indicators may be read for a single
  // cycle's attendees rather than the whole community, and the floor
  // below which they may not.
  //
  // This exists because an event population is both *small* and
  // *identifiable*: you know exactly who is coming, so "1 of 8 · 13%" is
  // one person, whereas "1 of 40" is a rounding error. With indicators
  // deliberately never permission-gated, consent is what protects an
  // individual answer, and consent can't stop someone being the only
  // member in a category — so the remaining lever is a community-level
  // decision about when a population is big enough to break out at all.
  //
  // Defaults are chosen, not derived. Off, because a per-cycle view is a
  // new exposure surface and every comparable sharing switch in this
  // codebase opts in (`contributionVisible`, `cyclesEnabled`).
  //
  // The companion floor (a minimum headcount before an indicator may be
  // broken out for one event) was dropped in 0081. It guarded the case
  // where a small group could be identified by a breakdown, and with
  // publication restricted to public questions that case is gone: an
  // aggregate of answers everyone can already read, over a set of members
  // whose names are already on the participation list, says nothing the
  // reader couldn't assemble themselves. The one thing it still caught was
  // a *declined* answer in a small population — "1 of 3" identifies who
  // didn't say — and that residue is a consequence of counting declines
  // rather than of the floor, so removing the floor would have removed a
  // guard without removing the thing it guarded.
  cycleIndicatorsEnabled: boolean("cycle_indicators_enabled").notNull().default(false),
  recruitmentApplicationsOpen: boolean("recruitment_applications_open").notNull().default(true),
  recruitmentInvitesOpen: boolean("recruitment_invites_open").notNull().default(true),
  // The third door (docs/joining-admission-plan.md §2.3/J3/D13): the
  // interview stage, finally a door of its own instead of something
  // that either always ran (evaluated applications) or was skipped
  // wholesale (direct invites). A cycle with `interviewsOpen = false`
  // cannot have an intro call scheduled against it, whatever its lanes
  // say — and a community that closes the community-wide one closes
  // interviews everywhere. Default true: the stage exists today on the
  // evaluated path, so a community that touches nothing keeps it.
  recruitmentInterviewsOpen: boolean("recruitment_interviews_open").notNull().default(true),
  // How reports decide — one small policy for the whole community
  // (docs/admission-flow.md §2). How *many* reports a lane needs is the lane's
  // own; this says what a full set of them means.
  recruitmentInWhen: recruitmentInWhenEnum("recruitment_in_when").notNull().default("no_no_one_yes"),
  recruitmentCustomMinYes: integer("recruitment_custom_min_yes").notNull().default(1),
  recruitmentCustomMaxNo: integer("recruitment_custom_max_no").notNull().default(0),
  recruitmentAnyNoMeans: recruitmentAnyNoMeansEnum("recruitment_any_no_means").notNull().default("wider_discussion"),
  recruitmentDiscussionEnds: recruitmentDiscussionEndsEnum("recruitment_discussion_ends").notNull().default("decline"),
  recruitmentDeclineOutrightAt: integer("recruitment_decline_outright_at"),
  // How long every community-check window stays open (docs/admission-flow.md §5): a lane
  // that announces arrivals, and a decision that opens a wider discussion, are one
  // mechanism and share this. Stored with each window's deadline when it opens
  // (community_check.window_hours), so changing it never moves one already running.
  recruitmentWiderDiscussionHours: integer("recruitment_wider_discussion_hours").notNull().default(48),
  // §2.6/J7 — the overrule threshold. An objection is never thrown out
  // by a timer; mediation either clears it or it stands, and admitting
  // *anyway* is the documented exception. The community chooses how
  // much of the mediation body that takes: `majority` (the default —
  // more than half of the people who hold it right now) or a `quorum`
  // of a fixed size they name. Stored as a mode + a number rather than
  // one nullable integer so "majority" and "quorum of N" cannot be
  // confused with each other by a later reader.
  recruitmentObjectionOverrule: objectionOverruleModeEnum("recruitment_objection_overrule")
    .notNull()
    .default("majority"),
  recruitmentObjectionQuorum: integer("recruitment_objection_quorum").notNull().default(3),
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
  // Whether SSO is treated as the primary sign-in method once configured
  // (the three fields above alone don't decide this — a Community can
  // have OIDC fully working and still want magic-link shown as an equal
  // option, e.g. mid-transition). When true: /login redirects straight
  // to Zitadel instead of showing a form, and magic-link stops being
  // able to originate new accounts — it only resolves someone who
  // already has an oidc MemberIdentity (see findOrCreateMemberByEmail).
  // When false: unchanged from pre-OIDC behavior, both shown as equal
  // options. Meaningless while OIDC is unconfigured. Defaults true since
  // that's the behavior a Community configuring OIDC at all most likely
  // wants — flip it off for a softer transition.
  oidcPrimary: boolean("oidc_primary").notNull().default(true),
  // docs/admission-flow.md §6a — what "admitted" means to the provider. All three are
  // off (or today's behaviour) until a community turns them on, and meaningless while
  // single sign-on is unconfigured. The service token that makes the first two work is
  // an environment credential (ZITADEL_TOKEN), never a column.
  //   create on admit: admission creates the person at the provider (or finds them),
  //     sends their invite and grants the role, so "admitted" means they can sign in.
  //   revoke on leave: leaving or being removed takes the role back, so the provider
  //     and Orchard cannot disagree about who belongs.
  //   join policy: whether anyone carrying the role gets an account on first sign-in
  //     (today's behaviour) or only people admitted here — anyone else is held for an
  //     administrator instead.
  ssoCreateOnAdmit: boolean("sso_create_on_admit").notNull().default(false),
  ssoRevokeOnLeave: boolean("sso_revoke_on_leave").notNull().default(false),
  ssoJoinPolicy: ssoJoinPolicyEnum("sso_join_policy").notNull().default("anyone_with_role"),
  // When the /settings nudge offering to decide the community's settings
  // together through an Assembly was first shown. This is the nudge's own
  // clock anchor, not a community setting: the prompt is offered while
  // this is null and fewer than two weeks have passed since it was
  // stamped, and it never comes back once stamped — a community that
  // ignored it, or that ran one by hand, shouldn't be nagged forever.
  // The "or until the settings Assembly actually exists" half of that
  // rule needs no column here: it's read off assembly.templateKey, so
  // the truth stays with the Assembly rather than being mirrored.
  foundersAssemblyPromptedAt: timestamp("founders_assembly_prompted_at", { withTimezone: true }),
});
