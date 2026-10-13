import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetCycle, budgetEntry, budgetProposal, cycle } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { getBudgetCycle } from "./cycles";
import { countPendingEntries, holdsBudgetGrant, isBudgetOwner, scopeHasHolder } from "./owner";
import { postTransfer } from "./transfers";

type Member = typeof memberTable.$inferSelect;

// Settlement replaces "mark done" (docs/plans/archive/budget-funds-plan.md D7): closing an
// event is when its books close. The budget is finished, whatever it holds is
// resolved, and the net result goes where it belongs:
//
//   a surplus     returns to the community's own budget, as one paired transfer;
//   an exact zero just closes the books;
//   a deficit     is not absorbed (D14). It opens a proposal for the overspend,
//                 which follows the same backing rule as any other request, and the
//                 event is settled except for that amount until the community has
//                 decided. Approving covers it (in full or in part); declining
//                 leaves it on the event's books as unrecovered, visible and with no
//                 further consequence. Either way, deciding closes the books.
//
// The event's own contributions and income reach the community's budget only here,
// as part of a surplus: they are never moved earlier (D11).

async function eventBalance(communityId: string, cycleId: string) {
  const rows = await db
    .select({ amount: budgetEntry.amount })
    .from(budgetEntry)
    .where(and(eq(budgetEntry.communityId, communityId), eq(budgetEntry.cycleId, cycleId), eq(budgetEntry.status, "confirmed")));
  return rows.reduce((sum, r) => sum + r.amount, 0);
}

async function openDeficit(communityId: string, eventCycleId: string) {
  const [row] = await db
    .select()
    .from(budgetProposal)
    .where(
      and(
        eq(budgetProposal.communityId, communityId),
        eq(budgetProposal.kind, "event_deficit"),
        eq(budgetProposal.status, "open"),
        eq(budgetProposal.eventCycleId, eventCycleId),
      ),
    );
  return row ?? null;
}

// Who may settle: the event budget's holder; once the event has closed, the
// community budget's holder too, since an event whose owner is gone must not
// strand its balance; and, for a budget that never recorded anything (nothing to
// move or confirm), whoever the Budget module makes an owner. The last keeps a
// community that runs Budget open, or one that never claimed the grant, able to
// close an event it never used the budget of; it can never touch money.
type SettlerRole = "holder" | "fund_holder" | "open_owner";

async function settlerRole(actor: Member, eventCycleId: string, eventClosed: boolean, ledgerEmpty: boolean): Promise<SettlerRole | null> {
  if (await holdsBudgetGrant(actor, { cycleId: eventCycleId })) return "holder";
  if (eventClosed && (await holdsBudgetGrant(actor, { cycleId: null }))) return "fund_holder";
  if (ledgerEmpty && (await isBudgetOwner(actor, { cycleId: eventCycleId }))) return "open_owner";
  return null;
}

export interface SettlementState {
  /** The books are closed. */
  settled: boolean;
  settledAt: Date | null;
  /** The budget has stopped taking proposals and entries: settlement has begun or finished. */
  finished: boolean;
  /** The sum of confirmed entries: what the event holds, or owes when negative. */
  balance: number;
  /** An overspend waiting on the community's decision: the event is settled except for this. */
  awaiting: { proposalId: string; amount: number } | null;
  /** What is still owed after the community decided: the overspend that was not covered. */
  unrecovered: number;
  /** Whether the viewer may settle it now. */
  canSettle: boolean;
}

export async function getSettlementState(actor: Member, budgetCycleId: string): Promise<SettlementState> {
  requireModuleEnabled(await getCommunity(actor), "budget");
  const budget = await getBudgetCycle(actor, budgetCycleId);
  if (budget.cycleId === null) throw new AppError("Only an event's budget is settled");
  const [eventRow] = await db.select({ closedAt: cycle.closedAt }).from(cycle).where(eq(cycle.id, budget.cycleId));
  const balance = await eventBalance(actor.communityId, budget.cycleId);
  const awaiting = await openDeficit(actor.communityId, budget.cycleId);
  const entries = await db.select({ id: budgetEntry.id }).from(budgetEntry).where(eq(budgetEntry.cycleId, budget.cycleId)).limit(1);
  const role = await settlerRole(actor, budget.cycleId, Boolean(eventRow?.closedAt), entries.length === 0);

  return {
    settled: budget.settledAt !== null,
    settledAt: budget.settledAt,
    finished: budget.status !== "proposals_open",
    balance,
    awaiting: awaiting ? { proposalId: awaiting.id, amount: awaiting.totalAmount } : null,
    unrecovered: budget.settledAt !== null && balance < 0 ? -balance : 0,
    canSettle: role !== null && budget.settledAt === null && awaiting === null,
  };
}

export async function settleEventBudget(actor: Member, budgetCycleId: string) {
  requireModuleEnabled(await getCommunity(actor), "budget");
  const budget = await getBudgetCycle(actor, budgetCycleId);
  if (budget.cycleId === null) {
    throw new AppError("Only an event's budget is settled");
  }
  const eventCycleId = budget.cycleId;
  const [eventRow] = await db.select({ name: cycle.name, closedAt: cycle.closedAt }).from(cycle).where(eq(cycle.id, eventCycleId));
  const eventName = eventRow?.name ?? "the event";

  if (budget.settledAt) {
    throw new ConflictError("This budget is already settled");
  }
  if (await openDeficit(actor.communityId, eventCycleId)) {
    throw new ConflictError("This budget is waiting for the community's decision on its overspend");
  }

  const anyEntries = await db.select({ id: budgetEntry.id }).from(budgetEntry).where(eq(budgetEntry.cycleId, eventCycleId)).limit(1);
  const role = await settlerRole(actor, eventCycleId, Boolean(eventRow?.closedAt), anyEntries.length === 0);
  if (!role) {
    throw new ForbiddenError("Only this budget's owner can settle it — or, once the event has closed, the community budget's");
  }

  // Money still waiting for a decision would be left unaccounted for. The owner
  // resolves it first. If the event has no owner left, the community's holder can
  // still close its books, and anything still waiting is rejected with a note, so
  // nothing is left dangling and the balance is not stranded.
  const waiting = await countPendingEntries(actor.communityId, eventCycleId);
  const orphaned = role === "fund_holder" && !(await scopeHasHolder(actor.communityId, eventCycleId));
  if (waiting > 0 && !orphaned) {
    throw new ConflictError(
      `${waiting} ${waiting === 1 ? "entry is" : "entries are"} still waiting for the budget's owner to confirm or reject — resolve ${waiting === 1 ? "it" : "them"} first`,
    );
  }

  const balance = await eventBalance(actor.communityId, eventCycleId);

  return db.transaction(async (tx) => {
    if (waiting > 0) {
      await tx
        .update(budgetEntry)
        .set({
          status: "rejected",
          confirmedBy: actor.id,
          confirmedAt: new Date(),
          decisionNote: "Not confirmed before the budget's books were closed.",
        })
        .where(and(eq(budgetEntry.cycleId, eventCycleId), eq(budgetEntry.status, "pending")));
    }

    let deficitProposal: typeof budgetProposal.$inferSelect | null = null;
    let settledAt: Date | null = null;

    if (balance > 0) {
      await postTransfer(tx, {
        communityId: actor.communityId,
        fromCycleId: eventCycleId,
        toCycleId: null,
        amount: balance,
        kind: "settlement",
        transferId: randomUUID(),
        actorId: actor.id,
        fromDescription: "Surplus returned to the community's budget",
        toDescription: `Surplus from ${eventName}`,
      });
      settledAt = new Date();
    } else if (balance === 0) {
      settledAt = new Date();
    } else {
      // An overspend is never absorbed (D14): the community decides whether to
      // cover it. The event is settled except for this, and stays so until then.
      [deficitProposal] = await tx
        .insert(budgetProposal)
        .values({
          communityId: actor.communityId,
          cycleId: null,
          budgetCycleId: null,
          kind: "event_deficit",
          eventCycleId,
          submittedBy: actor.id,
          title: `Covering ${eventName}'s overspend`,
          description: `${eventName} settled ${-balance} over what it took in. The event can't cover it, so this asks the community's budget to.`,
          lineItems: [{ label: `Overspend on ${eventName}`, amount: -balance }],
          totalAmount: -balance,
          planSnapshot: { balance, settledBy: actor.id, takenAt: new Date().toISOString() },
        })
        .returning();
    }

    const [updated] = await tx
      .update(budgetCycle)
      .set({ status: "confirmed", settledAt })
      .where(eq(budgetCycle.id, budgetCycleId))
      .returning();
    return { budget: updated, deficitProposal, surplusReturned: balance > 0 ? balance : 0 };
  });
}
