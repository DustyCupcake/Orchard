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
});
