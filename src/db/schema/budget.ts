import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";
import { phase } from "./phase";
import { task } from "./task";

export const budgetCycleStatusEnum = pgEnum("budget_cycle_status", [
  "proposals_open",
  "voting",
  "confirmed",
]);

// Collecting what's on the table before deciding what gets funded — see
// docs/spec.md's "Budget" and docs/development-plan.md's Phase 26/27.
// Only one active (non-`confirmed`) cycle per Community at a time for
// v1 — see src/lib/budget/cycles.ts's getCurrentBudgetCycle/
// createBudgetCycle.
export const budgetCycle = pgTable("budget_cycle", {
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
  proposalDeadline: timestamp("proposal_deadline", { withTimezone: true }).notNull(),
  status: budgetCycleStatusEnum("status").notNull().default("proposals_open"),
  // Whoever currently holds this task is "the budget owner" — the same
  // task-is-the-authority pattern conflictTeamTaskId/
  // feedbackReviewTaskId established on Community, just scoped per-
  // cycle here instead: a fresh schema file can import task.ts
  // directly with a real FK (no circular-import issue — task.ts has no
  // reason to ever import budget.ts back — same reasoning Phase 22's
  // SensitiveFieldAccessRule already relied on for its own task/tier
  // pointers).
  ownerTaskId: uuid("owner_task_id")
    .notNull()
    .references(() => task.id),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// An itemized funding request against a BudgetCycle — any member,
// before its deadline; editable by the submitter until then.
export const budgetProposal = pgTable("budget_proposal", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetCycleId: uuid("budget_cycle_id")
    .notNull()
    .references(() => budgetCycle.id),
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
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});
