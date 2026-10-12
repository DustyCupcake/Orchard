import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetPledge, budgetProposal, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { getBudgetCycle, getBudgetCycleAttendeeCount, sumLineItems } from "./cycles";
import type { BudgetLineItem } from "./cycles";
import { holdsBudgetGrant } from "./owner";
import { requireEventTakingPart } from "./proposals";

type Member = typeof memberTable.$inferSelect;

// An event's plan is its fixed costs plus whatever has been approved
// (docs/plans/budget-funds-plan.md D15). There is no ranking and no funded set:
// what the event will cost is what has been decided, and the ask per member
// follows from that total.

export interface EventPlan {
  /** Fixed costs, counted against the current attendee count. */
  fixedTotal: number;
  /** The sum of everything approved so far, each at the amount it was approved for. */
  approvedTotal: number;
  /** fixedTotal + approvedTotal. */
  planTotal: number;
  /** Members declared "coming", or null when the budget isn't tied to an event. */
  attendeeCount: number | null;
  /** Who the plan is spread over: the attendees if there are any, otherwise every member. */
  contributorCount: number;
  /** planTotal over contributorCount, rounded up; null with nobody to spread it over. */
  perMember: number | null;
  /** Open proposals still waiting on a decision, and what they would add if approved in full. */
  pendingCount: number;
  pendingTotal: number;
}

export async function getEventPlan(actor: Member, budgetCycleId: string): Promise<EventPlan> {
  const budget = await getBudgetCycle(actor, budgetCycleId);
  if (budget.cycleId === null) {
    throw new AppError("A plan belongs to an event's budget");
  }
  const attendeeCount = await getBudgetCycleAttendeeCount(actor, budget);

  const fixedTotal = sumLineItems(budget.fixedCosts as BudgetLineItem[], attendeeCount);

  const [totals] = await db
    .select({
      approved: sql<number>`coalesce(sum(case when ${budgetProposal.status} = 'approved' then ${budgetProposal.approvedAmount} end), 0)::int`,
      pendingCount: sql<number>`count(*) filter (where ${budgetProposal.status} = 'open')::int`,
      pendingTotal: sql<number>`coalesce(sum(case when ${budgetProposal.status} = 'open' then ${budgetProposal.totalAmount} end), 0)::int`,
    })
    .from(budgetProposal)
    .where(and(eq(budgetProposal.communityId, actor.communityId), eq(budgetProposal.cycleId, budget.cycleId)));

  const [{ count: memberCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.communityId, actor.communityId));
  const contributorCount = attendeeCount && attendeeCount > 0 ? attendeeCount : memberCount;

  const planTotal = fixedTotal + totals.approved;
  return {
    fixedTotal,
    approvedTotal: totals.approved,
    planTotal,
    attendeeCount,
    contributorCount,
    perMember: contributorCount > 0 ? Math.ceil(planTotal / contributorCount) : null,
    pendingCount: totals.pendingCount,
    pendingTotal: totals.pendingTotal,
  };
}

// ---------------------------------------------------------------------------
// Pledges
// ---------------------------------------------------------------------------

export const setBudgetPledgeInput = z.object({
  // Whole currency units. Null withdraws the pledge; 0 is a real answer ("I can't this time").
  amount: z.number().int().nonnegative().nullable(),
});
export type SetBudgetPledgeInput = z.infer<typeof setBudgetPledgeInput>;

// "How much would you contribute?", one replaceable figure per member per
// event (D16). It informs the plan as a whole and is not part of any proposal.
export async function setBudgetPledge(actor: Member, budgetCycleId: string, input: SetBudgetPledgeInput) {
  requireModuleEnabled(await getCommunity(actor), "budget");
  // Re-checked here, not just in the schema, so a direct lib caller is held to
  // it too — the same defense-in-depth the rest of this module applies.
  if (input.amount !== null && (!Number.isInteger(input.amount) || input.amount < 0)) {
    throw new AppError("A pledge is a whole number, zero or more");
  }
  const budget = await getBudgetCycle(actor, budgetCycleId);
  if (budget.cycleId === null) {
    throw new AppError("Pledges belong to an event's budget");
  }
  await requireEventTakingPart(actor, budget);

  if (input.amount === null) {
    await db
      .delete(budgetPledge)
      .where(and(eq(budgetPledge.budgetCycleId, budgetCycleId), eq(budgetPledge.memberId, actor.id)));
    return null;
  }

  const [row] = await db
    .insert(budgetPledge)
    .values({ budgetCycleId, memberId: actor.id, amount: input.amount })
    .onConflictDoUpdate({
      target: [budgetPledge.budgetCycleId, budgetPledge.memberId],
      set: { amount: input.amount, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export interface BudgetPledges {
  /** What everyone has pledged. Open to every member. */
  total: number;
  /** How many members have pledged anything, including a pledge of 0. */
  count: number;
  /** The viewer's own pledge, or null. */
  mine: number | null;
  /** Who pledged what. Only a real holder of the budget grant gets this; everyone else null. */
  entries: { memberId: string; name: string; amount: number }[] | null;
}

// The total is open to every member and each amount is private to the member
// and the owner (D8). The rule lives here, so a page cannot show an amount by
// forgetting a check. Individual amounts are a real holder's, never the open
// module's "everyone is an owner" (D13): being able to propose is open, seeing
// what a neighbour offered to give is not.
export async function getBudgetPledges(actor: Member, budgetCycleId: string): Promise<BudgetPledges> {
  const budget = await getBudgetCycle(actor, budgetCycleId);
  const rows = await db
    .select({ memberId: budgetPledge.memberId, name: member.name, amount: budgetPledge.amount })
    .from(budgetPledge)
    .innerJoin(member, eq(member.id, budgetPledge.memberId))
    .where(eq(budgetPledge.budgetCycleId, budgetCycleId))
    .orderBy(asc(member.name));

  const holder = await holdsBudgetGrant(actor, budget);
  return {
    total: rows.reduce((sum, r) => sum + r.amount, 0),
    count: rows.length,
    mine: rows.find((r) => r.memberId === actor.id)?.amount ?? null,
    entries: holder ? rows : null,
  };
}
