import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetProposal, cycle } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { getContributionSummary } from "./contributions";
import { getBudgetCycle } from "./cycles";
import { getBudgetMoney } from "./ledger";
import { holdsBudgetGrant } from "./owner";
import { getEventPlan } from "./plan";
import { listBudgetProposalViews, requireEventTakingPart } from "./proposals";
import type { BudgetProposalView } from "./proposals";

type Member = typeof memberTable.$inferSelect;
type ProposalRow = typeof budgetProposal.$inferSelect;

// An event gets money from the community's own budget only through a proposal the
// community has backed (docs/plans/archive/budget-funds-plan.md D9). Without that, a
// community that lets anyone start an event would have a way round its backing
// rule: start an event, ask the holder for its shortfall, never gather support.
//
// The request is a full proposal and not a number: a snapshot of the plan, the ask
// it assumes, how many people that is spread across, the income already recorded,
// and the shortfall left for the community. It sits among the community budget's
// proposals, labelled with its event, and is backed by explicit supporters *and*
// the people coming to the event (see backersBesides in proposals.ts), so an event
// whose attendance covers the shortfall reaches the holder with nobody having to
// be asked, and one asking for a lot gathers the rest like any other proposal. On
// approval it moves money at once, as a paired transfer.

export interface AllocationOutlook {
  /** What the event still needs from the community budget: the plan less what members are asked for, income recorded, and what has been allocated. */
  shortfall: number;
  /** Approved allocations so far. */
  allocated: number;
  /** The plan the shortfall is worked out from. */
  planTotal: number;
  /** ask × the people it is spread across; null until an ask is set. */
  askedInTotal: number | null;
  /** Income recorded so far. */
  income: number;
  /** Whether the viewer can make a request right now, and if not, why. */
  canRequest: boolean;
  reason: string | null;
  /** The request waiting for backing and a decision, if there is one. */
  open: BudgetProposalView | null;
  /** The most recent one that was decided, so the owner can see what became of it. */
  latest: { status: ProposalRow["status"]; requested: number; approved: number | null; note: string | null } | null;
}

async function allocationsFor(eventCycleId: string) {
  return db
    .select()
    .from(budgetProposal)
    .where(and(eq(budgetProposal.kind, "event_allocation"), eq(budgetProposal.eventCycleId, eventCycleId)))
    .orderBy(desc(budgetProposal.submittedAt));
}

// What the event still needs from the community's budget. Everything it reads is
// open to every member (the plan, the ask, income, what has been allocated), so
// the figure itself is not private; making the request is the holder's.
async function shortfallFor(actor: Member, budgetCycleId: string) {
  const budget = await getBudgetCycle(actor, budgetCycleId);
  const plan = await getEventPlan(actor, budgetCycleId);
  const summary = await getContributionSummary(actor, budgetCycleId);
  const money = await getBudgetMoney(actor, budgetCycleId);
  const allocated = (await allocationsFor(budget.cycleId!))
    .filter((p) => p.status === "approved")
    .reduce((sum, p) => sum + (p.approvedAmount ?? 0), 0);
  const askedInTotal = summary.askedInTotal;
  const shortfall = askedInTotal === null ? 0 : Math.max(0, plan.planTotal - askedInTotal - money.income - allocated);
  return { budget, plan, summary, money, allocated, askedInTotal, shortfall };
}

export async function getAllocationOutlook(actor: Member, budgetCycleId: string): Promise<AllocationOutlook> {
  requireModuleEnabled(await getCommunity(actor), "budget");
  const { budget, plan, summary, money, allocated, askedInTotal, shortfall } = await shortfallFor(actor, budgetCycleId);
  if (budget.cycleId === null) {
    throw new AppError("Only an event's budget asks the community's budget for funding");
  }

  const holder = await holdsBudgetGrant(actor, { cycleId: budget.cycleId });
  const rows = await allocationsFor(budget.cycleId);
  const openRow = rows.find((r) => r.status === "open") ?? null;
  const open = openRow ? ((await listBudgetProposalViews(actor, null)).find((v) => v.proposal.id === openRow.id) ?? null) : null;
  const decided = rows.find((r) => r.status === "approved" || r.status === "declined") ?? null;

  let reason: string | null = null;
  if (!holder) reason = "Only the event budget's owner can ask the community's budget for funding.";
  else if (budget.status !== "proposals_open") reason = "This budget is finished.";
  else if (summary.ask === null) reason = "Set what each person is asked to contribute first — the request carries it.";
  else if (plan.approvedTotal <= 0) reason = "Approve what the event needs first — the request is for the plan's shortfall.";
  else if (open) reason = "A request is already waiting for backing and a decision.";
  else if (shortfall <= 0) reason = "Nothing is needed from the community's budget: what members are asked for and the income recorded cover the plan.";

  return {
    shortfall,
    allocated,
    planTotal: plan.planTotal,
    askedInTotal,
    income: money.income,
    canRequest: reason === null,
    reason,
    open,
    latest: decided
      ? { status: decided.status, requested: decided.totalAmount, approved: decided.approvedAmount, note: decided.decisionNote }
      : null,
  };
}

// The event's owner asks the community's budget for the shortfall. It needs an
// ask to be set and something approved to fund, and it asks only for what the
// ask, the income and any earlier allocation leave uncovered. A plan that later
// rises needs a new request, because approval covers what was shown; the next
// one asks only for the new gap.
export async function requestEventAllocation(actor: Member, budgetCycleId: string) {
  const outlook = await getAllocationOutlook(actor, budgetCycleId);
  const budget = await getBudgetCycle(actor, budgetCycleId);
  if (!(await holdsBudgetGrant(actor, { cycleId: budget.cycleId }))) {
    throw new ForbiddenError("Only the event budget's owner can ask the community's budget for funding");
  }
  await requireEventTakingPart(actor, budget);
  if (!outlook.canRequest) {
    throw new ConflictError(outlook.reason ?? "A request can't be made right now");
  }

  const { plan, summary, money, allocated, shortfall } = await shortfallFor(actor, budgetCycleId);
  const [eventRow] = await db.select({ name: cycle.name }).from(cycle).where(eq(cycle.id, budget.cycleId!));
  const eventName = eventRow?.name ?? "the event";

  const approved = await db
    .select({ id: budgetProposal.id, title: budgetProposal.title, approvedAmount: budgetProposal.approvedAmount })
    .from(budgetProposal)
    .where(and(eq(budgetProposal.cycleId, budget.cycleId!), eq(budgetProposal.status, "approved")));

  const [created] = await db
    .insert(budgetProposal)
    .values({
      communityId: actor.communityId,
      cycleId: null,
      budgetCycleId: null,
      kind: "event_allocation",
      eventCycleId: budget.cycleId,
      submittedBy: actor.id,
      title: `Funding for ${eventName}`,
      description:
        `The plan comes to ${plan.planTotal}. Members are asked for about ${summary.ask} each over ${summary.expectedContributors} ` +
        `${summary.expectedContributors === 1 ? "person" : "people"} (${summary.askedInTotal}), ${money.income} has come in as income` +
        `${allocated > 0 ? `, and ${allocated} has already been allocated` : ""}. That leaves ${shortfall} for the community's budget.`,
      lineItems: [{ label: `Shortfall for ${eventName}`, amount: shortfall }],
      totalAmount: shortfall,
      planSnapshot: {
        fixedTotal: plan.fixedTotal,
        approved: approved.map((p) => ({ proposalId: p.id, title: p.title, approvedAmount: p.approvedAmount })),
        planTotal: plan.planTotal,
        askPerMember: summary.ask,
        expectedContributors: summary.expectedContributors,
        askedInTotal: summary.askedInTotal,
        incomeRecorded: money.income,
        allocatedSoFar: allocated,
        shortfall,
        takenAt: new Date().toISOString(),
      },
      requestedContributionPerMember: summary.ask,
      expectedContributors: summary.expectedContributors,
    })
    .returning();
  return created;
}
