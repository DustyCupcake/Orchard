import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { budgetEntry, cycle, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { getBudgetCycle } from "./cycles";
import { getBudgetMoney } from "./ledger";
import { holdsBudgetGrant } from "./owner";
import { getEventPlan } from "./plan";

type Member = typeof memberTable.$inferSelect;
type EntryRow = typeof budgetEntry.$inferSelect;

// Contributions (docs/plans/budget-funds-plan.md 3b, D8, D11). The plan sets the
// ask and recorded payments track it.
//
// A contribution is a ledger entry like any other (see ledger.ts) and belongs to
// the scope it was paid *for*: an event, where it counts against that event's
// ask and stays in its balance, or the community's own budget, as general
// support. It is never silently moved between them: the only thing that ever
// crosses is an event's net at settlement.
//
// Privacy is enforced here, in the read functions. What a budget has taken in,
// and what it asked for, are open to every member. *Who* paid and how much is not:
// it is the scope's real holder's, and each member's own to see. The fund's
// holder reads the community's contributions and not an event's; an event's
// holder reads that event's and not the community's.

// What an entry counts as once reversals are looked through: an adjustment that
// undoes a contribution is still, for the totals, part of what was paid in.
function effectiveKind(row: EntryRow, byId: Map<string, EntryRow>) {
  return row.reversesEntryId ? (byId.get(row.reversesEntryId)?.kind ?? row.kind) : row.kind;
}

export interface ContributionSummary {
  /** The ask the owner set, per person; null until they do, and always null for the community's own budget. */
  ask: number | null;
  /**
   * What the plan implies per person: what is still to be covered (the plan less
   * income already recorded) over the people it is spread across. A working
   * figure for the owner to set the ask against, not the ask itself. Null for
   * the community's own budget, and when there is nobody to spread it over.
   */
  suggestedAsk: number | null;
  /** How many people the plan is spread across: those coming, else every member. */
  expectedContributors: number | null;
  /** ask × expectedContributors: what the ask would bring in if everyone paid it. */
  askedInTotal: number | null;
  /** Confirmed contributions, net of anything reversed. Open to every member. */
  paidIn: number;
  /** How many people have paid something in. Open to every member. */
  contributorCount: number;
  /** The viewer's own contributions: counted, and waiting for the owner. */
  mine: { paid: number; waiting: number };
  /** Who paid what: the scope's real holder only; everyone else null. */
  members: { memberId: string; name: string; paid: number; waiting: number }[] | null;
}

// `budgetCycleId` is an event's budget, or null for the community's own.
export async function getContributionSummary(actor: Member, budgetCycleId: string | null): Promise<ContributionSummary> {
  requireModuleEnabled(await getCommunity(actor), "budget");
  const budget = budgetCycleId ? await getBudgetCycle(actor, budgetCycleId) : null;
  const cycleId = budget?.cycleId ?? null;
  const holder = await holdsBudgetGrant(actor, { cycleId });

  const inScope = await db
    .select()
    .from(budgetEntry)
    .where(
      and(
        eq(budgetEntry.communityId, actor.communityId),
        cycleId === null ? isNull(budgetEntry.cycleId) : eq(budgetEntry.cycleId, cycleId),
      ),
    );
  const byId = new Map(inScope.map((r) => [r.id, r] as const));
  const contributions = inScope.filter((r) => effectiveKind(r, byId) === "contribution" && r.memberId !== null);

  const paidBy = new Map<string, { paid: number; waiting: number }>();
  for (const r of contributions) {
    const cur = paidBy.get(r.memberId!) ?? { paid: 0, waiting: 0 };
    if (r.status === "confirmed") cur.paid += r.amount;
    else if (r.status === "pending") cur.waiting += r.amount;
    paidBy.set(r.memberId!, cur);
  }
  const paidIn = [...paidBy.values()].reduce((sum, v) => sum + v.paid, 0);
  const contributorCount = [...paidBy.values()].filter((v) => v.paid > 0).length;

  let members: ContributionSummary["members"] = null;
  if (holder) {
    const ids = [...paidBy.keys()];
    const names =
      ids.length === 0
        ? []
        : await db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, ids)).orderBy(asc(member.name));
    members = names.map((n) => ({ memberId: n.id, name: n.name, ...paidBy.get(n.id)! }));
  }

  let suggestedAsk: number | null = null;
  let expectedContributors: number | null = null;
  if (budget) {
    const plan = await getEventPlan(actor, budget.id);
    expectedContributors = plan.contributorCount;
    // Income recorded so far reduces what the members need to cover. There is no
    // "planned income" line to read, so what has actually come in stands in for
    // it; what is sought from the fund joins this in 3c. Never below zero.
    const income = (await getBudgetMoney(actor, budget.id)).income;
    suggestedAsk = plan.contributorCount > 0 ? Math.max(0, Math.ceil((plan.planTotal - income) / plan.contributorCount)) : null;
  }
  const ask = budget?.contributionPerMember ?? null;

  return {
    ask,
    suggestedAsk,
    expectedContributors,
    askedInTotal: ask !== null && expectedContributors !== null ? ask * expectedContributors : null,
    paidIn,
    contributorCount,
    mine: paidBy.get(actor.id) ?? { paid: 0, waiting: 0 },
    members,
  };
}

export interface MyContributionGroup {
  /** The event, or null for the community's own budget. */
  scopeCycleId: string | null;
  /** The event's name, or "Community budget". */
  title: string;
  /** Counted, net of anything reversed. */
  paid: number;
  /** Waiting for the budget's owner. */
  waiting: number;
  entries: { entry: EntryRow; reversedBy: string | null }[];
}

// Everything the actor has paid in, across events and the community's budget,
// grouped by what it was for: the one place the scopes meet for a member. It is
// their own data and nobody else's by construction — the query is "entries about
// me", whoever recorded them — so no caller can widen it. Rejected entries are
// kept, so a member can see what became of a payment.
export async function listMyContributions(actor: Member): Promise<MyContributionGroup[]> {
  requireModuleEnabled(await getCommunity(actor), "budget");
  const mine = await db
    .select()
    .from(budgetEntry)
    .where(and(eq(budgetEntry.communityId, actor.communityId), eq(budgetEntry.memberId, actor.id)))
    .orderBy(asc(budgetEntry.occurredOn), asc(budgetEntry.createdAt));
  const byId = new Map(mine.map((r) => [r.id, r] as const));
  const contributions = mine.filter((r) => effectiveKind(r, byId) === "contribution");
  if (contributions.length === 0) return [];

  const reversedBy = new Map(contributions.filter((r) => r.reversesEntryId).map((r) => [r.reversesEntryId!, r.id] as const));
  const cycleIds = [...new Set(contributions.map((r) => r.cycleId).filter((id): id is string => id !== null))];
  const names =
    cycleIds.length === 0
      ? []
      : await db.select({ id: cycle.id, name: cycle.name }).from(cycle).where(inArray(cycle.id, cycleIds));
  const nameOf = new Map(names.map((n) => [n.id, n.name] as const));

  const groups = new Map<string | null, MyContributionGroup>();
  for (const entry of contributions) {
    const g =
      groups.get(entry.cycleId) ??
      ({
        scopeCycleId: entry.cycleId,
        title: entry.cycleId === null ? "Community budget" : (nameOf.get(entry.cycleId) ?? "An event"),
        paid: 0,
        waiting: 0,
        entries: [],
      } satisfies MyContributionGroup);
    if (entry.status === "confirmed") g.paid += entry.amount;
    if (entry.status === "pending") g.waiting += entry.amount;
    g.entries.push({ entry, reversedBy: reversedBy.get(entry.id) ?? null });
    groups.set(entry.cycleId, g);
  }
  // Events first, newest activity last in each; the community's own budget at the end.
  return [...groups.values()].sort((a, b) => (a.scopeCycleId === null ? 1 : 0) - (b.scopeCycleId === null ? 1 : 0));
}
