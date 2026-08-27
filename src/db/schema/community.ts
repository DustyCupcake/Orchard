import { boolean, integer, pgEnum, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  // conflict_team_task_id (→ Task) is deliberately left out for now — it
  // would create a Community ↔ Task circular import for a field that's
  // only meaningful once the conflict-management module is built.
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
  inputRoundIntervalDays: integer("input_round_interval_days").notNull().default(7),
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
});
