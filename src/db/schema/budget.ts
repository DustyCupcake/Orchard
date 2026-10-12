import { sql } from "drizzle-orm";
import { integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";
import { phase } from "./phase";

// `voting` is retired: rounds, ranked voting and confirmation were replaced by
// always-open proposals that members back (docs/plans/budget-funds-plan.md
// Phase 2). The value stays in the enum because Postgres cannot drop one; the
// migration moved every row off it, and nothing writes it. What remains is
// `proposals_open` (an event's budget is open) and `confirmed` (it is finished:
// the owner marked it done, or it was confirmed under the old rules).
export const budgetCycleStatusEnum = pgEnum("budget_cycle_status", [
  "proposals_open",
  "voting",
  "confirmed",
]);

export const budgetProposalStatusEnum = pgEnum("budget_proposal_status", [
  "open",
  "approved",
  "declined",
  "withdrawn",
  "closed",
]);

// Collecting what's on the table before deciding what gets funded — see
// docs/spec.md's "Budget" and docs/plans/development-plan.md's Phase 26/27.
// An event's budget is the event's own: one is made with the event
// (src/lib/budget/cycles.ts's ensureEventBudget), and at most one
// unfinished row can exist per event. Rows with no `cycle_id` are the
// community's own, and are held to one unfinished row per community by
// createBudgetCycle. See docs/plans/budget-funds-plan.md.
export const budgetCycle = pgTable(
  "budget_cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    // Ties to a real Cycle when cycles are on — the same optional-
    // association pattern Task itself already uses.
    cycleId: uuid("cycle_id").references(() => cycle.id),
    title: text("title").notNull(),
    // Array of {label, amount} — the non-negotiable floor, entered by the
    // owner before proposals open. Amounts are whole-currency-unit
    // integers, no cents modeling — the same minimal-precision posture
    // Task.capacity/Effort magnitude already take elsewhere in this
    // codebase; a resolved interpretation, since spec names no currency
    // or precision requirement and this module never moves real money
    // itself (see Phase 27's Contributions: "still just a number shown
    // to that member, not a payment integration").
    fixedCosts: jsonb("fixed_costs").notNull().default([]),
    // Optional: blank means proposals stay open until the owner closes them. An event's
    // budget is made with the event, and there is no honest date to invent for it. See
    // docs/plans/budget-funds-plan.md D2.
    proposalDeadline: timestamp("proposal_deadline", { withTimezone: true }),
    status: budgetCycleStatusEnum("status").notNull().default("proposals_open"),
    // Budget authority is not stored on this row. A single-cardinality
    // `budget` PermissionGrant is configured under Settings → Access &
    // permissions, and its task's placement must match this row's
    // `cycleId` (including null === null) for its current holder to own
    // this budget cycle.
    // Set only on confirming (status -> `confirmed`) — see
    // src/lib/budget/voting.ts's confirmBudgetCycle. "A human selection
    // informed by, not bound to, the ranked order" (docs/spec.md's
    // Budget: Confirmation) — a plain jsonb array of proposal ids rather
    // than a join table, matching lineItems/fixedCosts' own "opaque list,
    // read only by whoever's looking" posture elsewhere in this schema.
    confirmedProposalIds: jsonb("confirmed_proposal_ids"),
    // Required whenever confirmedProposalIds deviates from the aggregate
    // ranked order for the same funded count — see
    // src/lib/budget/voting.ts's requiresConfirmationRationale.
    confirmationRationale: text("confirmation_rationale"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => member.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // A small, deliberate confirmation from the current owner (Phase
    // 65) — separate from `status` reaching `confirmed` above, since a
    // cycle can be closed even after the funded set is decided. Lets
    // closeCycle (src/lib/cycles/lifecycle.ts) skip its own warning. Set
    // only by src/lib/budget/voting.ts's markBudgetCycleDone.
    ownerMarkedDoneAt: timestamp("owner_marked_done_at", { withTimezone: true }),
  },
  (t) => [
    // One unfinished budget per event. A finished one stays as history, so an event's
    // earlier rounds are not a conflict; only a second *open* one is.
    uniqueIndex("budget_cycle_one_unfinished_per_event")
      .on(t.cycleId)
      .where(sql`${t.cycleId} is not null and ${t.status} <> 'confirmed'`),
  ],
);

// An itemized funding request — any member, at any time, in an event's budget
// or in the community's own (`cycle_id` null). Other members back it
// (budget_proposal_support) and the holder of its scope approves it, up to
// what its backers cover (docs/plans/budget-funds-plan.md D12). There are no
// rounds: `budget_cycle_id` names the event's budget row, or the old round a
// community proposal came from, and is null for a proposal made since.
export const budgetProposal = pgTable("budget_proposal", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // The scope: an event, or null for the community's own budget. Kept here
  // rather than read through the budget row because a community proposal has
  // no budget row any more.
  cycleId: uuid("cycle_id").references(() => cycle.id),
  budgetCycleId: uuid("budget_cycle_id").references(() => budgetCycle.id),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => member.id),
  title: text("title").notNull(),
  description: text("description"),
  // Array of {label, amount} — the itemized cost breakdown.
  lineItems: jsonb("line_items").notNull().default([]),
  // Sum of lineItems' amounts, recomputed server-side on every write —
  // stored alongside for cheap sorting/display rather than summing
  // jsonb on every read.
  totalAmount: integer("total_amount").notNull(),
  branchId: uuid("branch_id").references(() => branch.id),
  phaseId: uuid("phase_id").references(() => phase.id),
  status: budgetProposalStatusEnum("status").notNull().default("open"),
  // Set when the scope's holder approves or declines it.
  decidedBy: uuid("decided_by").references(() => member.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  // The holder's reasoning. Required on a decline; this is what replaced the
  // confirmation rationale a funded set used to need.
  decisionNote: text("decision_note"),
  // What was approved: at most the amount asked, and at most what the backers
  // cover. Null until approved.
  approvedAmount: integer("approved_amount"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

// "I support this", one per member per proposal, withdrawable — the same shape
// as interest in a programme proposal. The proposer is the first backer
// without a row of their own and cannot support their own proposal. Counts are
// public; who is behind them only to the proposer and the scope's holder (see
// src/lib/budget/proposals.ts).
export const budgetProposalSupport = pgTable(
  "budget_proposal_support",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => budgetProposal.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("budget_proposal_support_member_unique").on(t.proposalId, t.memberId)],
);

// "How much would you contribute?" — it used to be a field on the ranking
// ballot, which is gone. One replaceable figure per member per event budget,
// private to the member and the owner, with its total open to everyone
// (docs/plans/budget-funds-plan.md D16). It informs the plan as a whole and is
// not part of any one proposal.
export const budgetPledge = pgTable(
  "budget_pledge",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    budgetCycleId: uuid("budget_cycle_id")
      .notNull()
      .references(() => budgetCycle.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    // Whole currency units, like every amount in the module.
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("budget_pledge_member_unique").on(t.budgetCycleId, t.memberId)],
);

// RETIRED, kept readable as history: nothing writes this any more (ranked voting
// was replaced by backed proposals — see budgetProposalSupport). Its
// contribution signals were copied into budgetPledge by the migration.
//
// A member's full ranking of the cycle's proposals, plus an optional
// "how much would you contribute this year?" signal — one row per
// member per cycle, replaceable until voting closes (no DB-level
// unique constraint; enforced the same select-then-update-or-insert
// way Assemblies' own submitAssemblyResponse already does). No FK on
// the ids inside rankedProposalIds — validated at the application
// layer against the cycle's actual proposal set instead, the same
// posture jsonb id-lists already take elsewhere in this schema
// (Requirement.value's completed_task, budgetCycle.confirmedProposalIds
// above).
export const budgetVote = pgTable("budget_vote", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetCycleId: uuid("budget_cycle_id")
    .notNull()
    .references(() => budgetCycle.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  // Ordered array of proposal ids, most-preferred first — must be a
  // permutation of exactly the cycle's current proposal set (see
  // src/lib/budget/voting.ts's requireValidRanking).
  rankedProposalIds: jsonb("ranked_proposal_ids").notNull(),
  // Whole-currency-unit integer, same posture as fixedCosts/lineItems'
  // amounts — null means "no signal given," not zero.
  contributionSignal: integer("contribution_signal"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});
