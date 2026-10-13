import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetEntry, cycle as cycleTable, member, task, taskAssignment } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  approveBudgetProposal,
  closeBudgetProposal,
  confirmEntry,
  getBudgetCycleForCycle,
  getBudgetMoney,
  getEventPlan,
  getScopeBalance,
  listBudgetEntries,
  listBudgetNeedsAction,
  settleEventBudget,
  markEntryReimbursed,
  recordEntry,
  rejectEntry,
  reverseEntry,
  submitBudgetProposal,
} from "@/lib/budget";
import { createCycle } from "@/lib/cycles";
import { setModuleOpen, setPermissionGrant } from "@/lib/permissions";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { actorFor, createFixtures, resetDatabase } from "./helpers";

async function insertOwnerTask(communityId: string, branchId: string, createdBy: string, cycleId: string | null = null) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      cycleId,
      title: "Budget owner",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
    })
    .returning();
  await setPermissionGrant(await actorFor(communityId), "budget", row.id);
  return row;
}

async function addMember(communityId: string, name: string) {
  const [row] = await db.insert(member).values({ communityId, name }).returning();
  return row;
}

const TODAY = new Date().toISOString().slice(0, 10);
const kettle = { title: "Kettle", lineItems: [{ label: "Kettle", amount: 100 }] };

// One event with its budget (Alice holds the event's grant), the community's own
// budget (Dave holds that), and Bob and Carol as ordinary members.
async function setUp() {
  const { alice, bob, branch } = await createFixtures();
  await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
  const carol = await addMember(alice.communityId, "Carol");
  const dave = await addMember(alice.communityId, "Dave");
  const event = await createCycle(alice, { source: "blank", name: "Reunion" });
  const budget = (await getBudgetCycleForCycle(alice, event.id))!;
  const eventOwnerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, event.id);
  await claimTask(alice, eventOwnerTask.id);
  await claimTask(dave, (await insertOwnerTask(alice.communityId, branch.id, dave.id, null)).id);
  return { alice, bob, carol, dave, branch, event, budget, eventOwnerTask };
}

const expense = (amount: number, extra: Record<string, unknown> = {}) => ({
  kind: "expense" as const,
  amount,
  description: "Tent pegs",
  occurredOn: TODAY,
  ...extra,
});

describe("Recording an entry", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores an expense as money out and income as money in, and sums confirmed entries into the balance", async () => {
    const { dave } = await setUp();
    await recordEntry(dave, null, { kind: "opening_balance", amount: 1000, description: "Brought forward", occurredOn: TODAY });
    const paid = await recordEntry(dave, null, expense(250));
    const income = await recordEntry(dave, null, { kind: "income", amount: 400, description: "Jumble sale", occurredOn: TODAY });

    expect(paid.amount).toBe(-250);
    expect(income.amount).toBe(400);
    expect(await getScopeBalance(dave, null)).toBe(1150);
    expect(await getBudgetMoney(dave, null)).toMatchObject({ balance: 1150, income: 400, spent: 250 });
  });

  it("is born confirmed for the holder, and pending for a member's own claim", async () => {
    const { alice, bob, budget } = await setUp();
    const direct = await recordEntry(alice, budget.id, expense(30));
    expect(direct).toMatchObject({ status: "confirmed", confirmedBy: alice.id, memberId: null });

    const claim = await recordEntry(bob, budget.id, expense(12, { description: "Gaffer tape" }));
    expect(claim).toMatchObject({ status: "pending", confirmedBy: null, memberId: bob.id, submittedBy: bob.id });
  });

  it("keeps a pending claim out of the balance until it is confirmed", async () => {
    const { alice, bob, budget } = await setUp();
    await recordEntry(alice, budget.id, { kind: "income", amount: 500, description: "Tickets", occurredOn: TODAY });
    const claim = await recordEntry(bob, budget.id, expense(40));
    expect(await getScopeBalance(alice, budget.id)).toBe(500);

    await confirmEntry(alice, claim.id);
    expect(await getScopeBalance(alice, budget.id)).toBe(460);
  });

  it("lets only a holder record income or an opening balance, and only a holder write in the community's budget", async () => {
    const { bob, budget } = await setUp();
    await expect(
      recordEntry(bob, budget.id, { kind: "income", amount: 10, description: "x", occurredOn: TODAY }),
    ).rejects.toThrow(ForbiddenError);
    await expect(recordEntry(bob, null, expense(10))).rejects.toThrow(ForbiddenError);
    await expect(
      recordEntry(bob, null, { kind: "opening_balance", amount: 10, description: "x", occurredOn: TODAY }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("makes a member's own claim about themselves, whoever it says it is for", async () => {
    const { bob, carol, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10, { memberId: carol.id }));
    expect(claim.memberId).toBe(bob.id);
  });

  it("lets the holder say whose pocket an expense came out of, within the community", async () => {
    const { alice, bob, budget } = await setUp();
    expect((await recordEntry(alice, budget.id, expense(10, { memberId: bob.id }))).memberId).toBe(bob.id);

    const { alice: stranger } = await createFixtures();
    await expect(recordEntry(alice, budget.id, expense(10, { memberId: stranger.id }))).rejects.toThrow(NotFoundError);
  });

  it("refuses a non-positive expense, a bad date, an empty description, and an event's opening balance", async () => {
    const { alice, dave, budget } = await setUp();
    await expect(recordEntry(alice, budget.id, expense(0))).rejects.toThrow(AppError);
    await expect(recordEntry(alice, budget.id, expense(-5))).rejects.toThrow(AppError);
    await expect(recordEntry(alice, budget.id, expense(5, { occurredOn: "2026-02-30" }))).rejects.toThrow();
    await expect(recordEntry(alice, budget.id, expense(5, { description: "  " }))).rejects.toThrow();
    await expect(
      recordEntry(alice, budget.id, { kind: "opening_balance", amount: 10, description: "x", occurredOn: TODAY }),
    ).rejects.toThrow(AppError);
    // A negative opening balance is a real thing (overdrawn), and allowed.
    expect((await recordEntry(dave, null, { kind: "opening_balance", amount: -80, description: "Overdrawn", occurredOn: TODAY })).amount).toBe(-80);
  });

  it("enters the opening balance once, in the code and in the database", async () => {
    const { alice, dave } = await setUp();
    await recordEntry(dave, null, { kind: "opening_balance", amount: 1000, description: "Brought forward", occurredOn: TODAY });
    await expect(
      recordEntry(dave, null, { kind: "opening_balance", amount: 5, description: "Again", occurredOn: TODAY }),
    ).rejects.toThrow(ConflictError);
    await expect(
      db.insert(budgetEntry).values({
        communityId: alice.communityId,
        kind: "opening_balance",
        amount: 5,
        status: "confirmed",
        submittedBy: dave.id,
        description: "Racing",
        occurredOn: TODAY,
      }),
    ).rejects.toThrow();
  });

  it("refuses while the module is off", async () => {
    const { alice, bob, budget } = await setUp();
    await updateCommunity(alice, { modulesEnabled: [] });
    await expect(recordEntry(bob, budget.id, expense(10))).rejects.toThrow(AppError);
  });

  it("refuses once the budget is finished or the event is closed", async () => {
    const { alice, bob, event, budget } = await setUp();
    await settleEventBudget(alice, budget.id);
    await expect(recordEntry(bob, budget.id, expense(10))).rejects.toThrow(ConflictError);

    const other = await createCycle(alice, { source: "blank", name: "Harvest", confirmed: true });
    const otherBudget = (await getBudgetCycleForCycle(alice, other.id))!;
    await db.update(cycleTable).set({ closedAt: new Date() }).where(eq(cycleTable.id, other.id));
    await expect(recordEntry(bob, otherBudget.id, expense(10))).rejects.toThrow(ConflictError);
    expect(event.id).not.toBe(other.id);
  });

  it("refuses an event's budget id from another community", async () => {
    const { budget } = await setUp();
    const { alice: stranger } = await createFixtures();
    await updateCommunity(stranger, { modulesEnabled: ["budget"] });
    await expect(recordEntry(stranger, budget.id, expense(10))).rejects.toThrow(NotFoundError);
  });
});

describe("Tying an expense to a proposal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("works for an approved proposal in the same budget, and shows planned against spent", async () => {
    const { alice, bob, budget } = await setUp();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await approveBudgetProposal(alice, p.id);
    await recordEntry(alice, budget.id, expense(30, { proposalId: p.id }));
    await recordEntry(alice, budget.id, expense(25, { proposalId: p.id, description: "More" }));
    await recordEntry(alice, budget.id, expense(7, { description: "Unplanned" }));

    const money = await getBudgetMoney(alice, budget.id);
    expect(money.proposals).toEqual([{ proposalId: p.id, approved: 100, spent: 55 }]);
    expect(money.spent).toBe(62);
  });

  it("refuses an open proposal, another budget's proposal, and anything but an expense", async () => {
    const { alice, bob, dave, budget } = await setUp();
    const open = await submitBudgetProposal(bob, budget.id, kettle);
    await expect(recordEntry(alice, budget.id, expense(10, { proposalId: open.id }))).rejects.toThrow(ConflictError);

    const community = await submitBudgetProposal(bob, null, kettle);
    await approveBudgetProposal(dave, community.id);
    await expect(recordEntry(alice, budget.id, expense(10, { proposalId: community.id }))).rejects.toThrow(AppError);

    await approveBudgetProposal(alice, open.id);
    await expect(
      recordEntry(alice, budget.id, { kind: "income", amount: 10, description: "x", occurredOn: TODAY, proposalId: open.id }),
    ).rejects.toThrow(AppError);
  });

  it("stops taking expenses once the proposal is closed, and releases what was left", async () => {
    const { alice, bob, dave } = await setUp();
    await recordEntry(dave, null, { kind: "opening_balance", amount: 1000, description: "Brought forward", occurredOn: TODAY });
    const p = await submitBudgetProposal(bob, null, kettle);
    await approveBudgetProposal(dave, p.id);
    await recordEntry(dave, null, expense(30, { proposalId: p.id }));

    // 100 approved, 30 spent: 70 is committed, so 970 - 70 = 900 is free.
    expect(await getBudgetMoney(bob, null)).toMatchObject({ balance: 970, committed: 70, available: 900 });

    await expect(closeBudgetProposal(bob, p.id)).rejects.toThrow(ForbiddenError);
    await expect(closeBudgetProposal(alice, p.id)).rejects.toThrow(ForbiddenError);
    expect((await closeBudgetProposal(dave, p.id)).status).toBe("closed");
    expect(await getBudgetMoney(bob, null)).toMatchObject({ balance: 970, committed: 0, available: 970 });
    await expect(recordEntry(dave, null, expense(10, { proposalId: p.id }))).rejects.toThrow(ConflictError);
    await expect(closeBudgetProposal(dave, p.id)).rejects.toThrow(ConflictError);
  });

  it("never lets an overspend commit less than nothing", async () => {
    const { dave, bob } = await setUp();
    const p = await submitBudgetProposal(bob, null, kettle);
    await approveBudgetProposal(dave, p.id);
    await recordEntry(dave, null, expense(130, { proposalId: p.id }));
    expect((await getBudgetMoney(dave, null)).committed).toBe(0);
  });
});

describe("A closed proposal and the plan", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("still counts toward an event's plan: closing only releases what was not spent", async () => {
    const { alice, bob, budget } = await setUp();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await approveBudgetProposal(alice, p.id);
    expect((await getEventPlan(alice, budget.id)).approvedTotal).toBe(100);

    await closeBudgetProposal(alice, p.id);
    expect((await getEventPlan(alice, budget.id)).approvedTotal).toBe(100);
  });
});

describe("Deciding a claim", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is the budget's holder's alone, and only for that budget", async () => {
    const { alice, bob, carol, dave, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10));
    await expect(confirmEntry(carol, claim.id)).rejects.toThrow(ForbiddenError);
    await expect(confirmEntry(bob, claim.id)).rejects.toThrow(ForbiddenError);
    // The community's owner does not decide an event's money, nor the reverse.
    await expect(confirmEntry(dave, claim.id)).rejects.toThrow(ForbiddenError);
    expect((await confirmEntry(alice, claim.id)).status).toBe("confirmed");
  });

  it("is refused to a member just because the module is open to everyone", async () => {
    const { alice, bob, carol, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10));
    await setModuleOpen(alice, "budget", true);
    await expect(confirmEntry(carol, claim.id)).rejects.toThrow(ForbiddenError);
    await expect(rejectEntry(carol, claim.id)).rejects.toThrow(ForbiddenError);
  });

  it("keeps a rejected entry, with its reason, out of every total", async () => {
    const { alice, bob, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10));
    const rejected = await rejectEntry(alice, claim.id, { note: "No receipt" });
    expect(rejected).toMatchObject({ status: "rejected", decisionNote: "No receipt", confirmedBy: alice.id });
    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 0, spent: 0 });
    expect((await listBudgetEntries(alice, budget.id)).entries).toHaveLength(1);
  });

  it("can be decided only once", async () => {
    const { alice, bob, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10));
    await confirmEntry(alice, claim.id);
    await expect(confirmEntry(alice, claim.id)).rejects.toThrow(ConflictError);
    await expect(rejectEntry(alice, claim.id)).rejects.toThrow(ConflictError);
  });

  it("is refused for an entry in another community", async () => {
    const { bob, budget, alice } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10));
    const { alice: stranger } = await createFixtures();
    await expect(confirmEntry(stranger, claim.id)).rejects.toThrow(NotFoundError);
    expect(alice.id).not.toBe(stranger.id);
  });

  it("will not let a budget be marked done while money is waiting", async () => {
    const { alice, bob, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10));
    await expect(settleEventBudget(alice, budget.id)).rejects.toThrow(/waiting/);
    await rejectEntry(alice, claim.id);
    expect((await settleEventBudget(alice, budget.id)).budget.status).toBe("confirmed");
  });
});

describe("Correcting an entry", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reverses it with an adjustment that nets every total out and leaves the original visible", async () => {
    const { alice, budget } = await setUp();
    const p = await submitBudgetProposal(alice, budget.id, kettle);
    await approveBudgetProposal(alice, p.id);
    await recordEntry(alice, budget.id, { kind: "income", amount: 500, description: "Tickets", occurredOn: TODAY });
    const wrong = await recordEntry(alice, budget.id, expense(80, { proposalId: p.id }));
    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 420, spent: 80 });

    const reversal = await reverseEntry(alice, wrong.id, { note: "Entered twice" });
    expect(reversal).toMatchObject({ kind: "adjustment", amount: 80, reversesEntryId: wrong.id, status: "confirmed", proposalId: p.id });

    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({
      balance: 500,
      spent: 0,
      proposals: [{ proposalId: p.id, approved: 100, spent: 0 }],
    });
    const { entries } = await listBudgetEntries(alice, budget.id);
    expect(entries.find((e) => e.entry.id === wrong.id)?.reversedBy).toBe(reversal.id);
    expect(entries.find((e) => e.entry.id === wrong.id)?.entry.status).toBe("confirmed");
  });

  it("is possible once, in the code and in the database", async () => {
    const { alice, budget } = await setUp();
    const wrong = await recordEntry(alice, budget.id, expense(80));
    await reverseEntry(alice, wrong.id, { note: "Mistake" });
    await expect(reverseEntry(alice, wrong.id, { note: "Again" })).rejects.toThrow(ConflictError);
    await expect(
      db.insert(budgetEntry).values({
        communityId: alice.communityId,
        cycleId: wrong.cycleId,
        kind: "adjustment",
        amount: 80,
        status: "confirmed",
        submittedBy: alice.id,
        description: "Racing reversal",
        occurredOn: TODAY,
        reversesEntryId: wrong.id,
      }),
    ).rejects.toThrow();
  });

  it("is refused for a pending entry, a reversal, the opening balance, and anyone but the holder", async () => {
    const { alice, bob, dave, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(10));
    await expect(reverseEntry(alice, claim.id, { note: "x" })).rejects.toThrow(ConflictError);

    const done = await recordEntry(alice, budget.id, expense(10));
    await expect(reverseEntry(bob, done.id, { note: "x" })).rejects.toThrow(ForbiddenError);
    const reversal = await reverseEntry(alice, done.id, { note: "x" });
    await expect(reverseEntry(alice, reversal.id, { note: "x" })).rejects.toThrow(ConflictError);

    const opening = await recordEntry(dave, null, { kind: "opening_balance", amount: 10, description: "Start", occurredOn: TODAY });
    await expect(reverseEntry(dave, opening.id, { note: "x" })).rejects.toThrow(ConflictError);
  });

  it("needs a reason", async () => {
    const { alice, budget } = await setUp();
    const wrong = await recordEntry(alice, budget.id, expense(80));
    await expect(reverseEntry(alice, wrong.id, { note: " " })).rejects.toThrow();
  });
});

describe("Reimbursing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("marks a confirmed out-of-pocket expense as paid back, once", async () => {
    const { alice, bob, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(40));
    await expect(markEntryReimbursed(alice, claim.id)).rejects.toThrow(ConflictError);

    await confirmEntry(alice, claim.id);
    await expect(markEntryReimbursed(bob, claim.id)).rejects.toThrow(ForbiddenError);
    expect((await markEntryReimbursed(alice, claim.id)).reimbursedAt).not.toBeNull();
    await expect(markEntryReimbursed(alice, claim.id)).rejects.toThrow(ConflictError);
  });

  it("does not apply to an expense paid from the budget", async () => {
    const { alice, budget } = await setUp();
    const direct = await recordEntry(alice, budget.id, expense(40));
    await expect(markEntryReimbursed(alice, direct.id)).rejects.toThrow(ConflictError);
  });
});

describe("Who sees what", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("shows the holder every entry, and a member only their own", async () => {
    const { alice, bob, carol, budget } = await setUp();
    await recordEntry(alice, budget.id, expense(30, { description: "Paid from the budget" }));
    await recordEntry(bob, budget.id, expense(12, { description: "Bob's tape" }));
    await recordEntry(carol, budget.id, expense(20, { description: "Carol's rope" }));

    const names = async (who: typeof alice) => (await listBudgetEntries(who, budget.id)).entries.map((e) => e.entry.description).sort();
    expect(await names(alice)).toEqual(["Bob's tape", "Carol's rope", "Paid from the budget"]);
    expect(await names(bob)).toEqual(["Bob's tape"]);
    expect(await names(carol)).toEqual(["Carol's rope"]);
    expect((await listBudgetEntries(bob, budget.id)).asHolder).toBe(false);
  });

  it("shows another member, and an Admin who isn't the holder, nothing", async () => {
    const { alice, bob, budget } = await setUp();
    await recordEntry(bob, budget.id, expense(12));
    const nobody = await addMember(alice.communityId, "Eve");
    expect((await listBudgetEntries(nobody, budget.id)).entries).toEqual([]);

    // The fixture community has no Admins grant, which makes every member an Admin.
    // Being one still reads no amounts.
    const { isAdmin } = await import("@/lib/settings/admins");
    expect(await isAdmin(nobody)).toBe(true);
    expect((await listBudgetEntries(nobody, budget.id)).entries).toEqual([]);
  });

  it("keeps an event's entries from the community's holder, and the community's from an event's", async () => {
    const { alice, bob, dave, budget } = await setUp();
    await recordEntry(bob, budget.id, expense(12));
    await recordEntry(dave, null, { kind: "opening_balance", amount: 1000, description: "Start", occurredOn: TODAY });

    expect((await listBudgetEntries(dave, budget.id)).entries).toEqual([]);
    expect((await listBudgetEntries(alice, null)).entries).toEqual([]);
    expect((await listBudgetEntries(dave, null)).entries).toHaveLength(1);
  });

  it("gives an open module's members no sight of anyone's entries", async () => {
    const { alice, bob, carol, budget } = await setUp();
    await recordEntry(bob, budget.id, expense(12));
    await setModuleOpen(alice, "budget", true);
    expect((await listBudgetEntries(carol, budget.id)).entries).toEqual([]);
  });

  it("shows every member the totals, and only the holder how many are waiting", async () => {
    const { alice, bob, carol, dave, budget } = await setUp();
    await recordEntry(alice, budget.id, { kind: "income", amount: 500, description: "Tickets", occurredOn: TODAY });
    await recordEntry(bob, budget.id, expense(12));
    await recordEntry(dave, null, { kind: "opening_balance", amount: 1000, description: "Start", occurredOn: TODAY });

    expect(await getBudgetMoney(carol, budget.id)).toMatchObject({ balance: 500, income: 500, pendingCount: null });
    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 500, pendingCount: 1 });
    // The community's balance is open to every member too.
    expect(await getScopeBalance(carol, null)).toBe(1000);
    expect((await getBudgetMoney(carol, null)).pendingCount).toBeNull();
  });

  it("shows a member what became of their own claim", async () => {
    const { alice, bob, budget } = await setUp();
    const a = await recordEntry(bob, budget.id, expense(12, { description: "Confirmed one" }));
    const b = await recordEntry(bob, budget.id, expense(20, { description: "Rejected one" }));
    await confirmEntry(alice, a.id);
    await rejectEntry(alice, b.id, { note: "Duplicate" });

    const seen = (await listBudgetEntries(bob, budget.id)).entries;
    expect(seen.map((e) => [e.entry.description, e.entry.status, e.entry.decisionNote]).sort()).toEqual([
      ["Confirmed one", "confirmed", null],
      ["Rejected one", "rejected", "Duplicate"],
    ]);
  });
});

describe("Money waiting for a decision, on the dashboard", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("asks the holder to confirm what is waiting, in each budget", async () => {
    const { alice, bob, budget } = await setUp();
    await recordEntry(bob, budget.id, expense(10));
    await recordEntry(bob, budget.id, expense(20));

    const mine = await listBudgetNeedsAction(alice);
    expect(mine.personal).toContainEqual({ scopeCycleId: budget.cycleId, title: "Reunion Budget", kind: "confirm_entries", count: 2 });
    expect(mine.shared).toEqual([]);
  });

  it("tells an Admin that money is waiting when nobody holds the budget, without giving them access", async () => {
    const { alice, bob, event, budget, eventOwnerTask } = await setUp();
    await recordEntry(bob, budget.id, expense(10));
    // The event's owner steps away: nobody holds this budget now.
    await db.delete(taskAssignment).where(eq(taskAssignment.taskId, eventOwnerTask.id));

    const asAdmin = await listBudgetNeedsAction(alice);
    expect(asAdmin.personal).toContainEqual({ scopeCycleId: event.id, title: "Reunion Budget", kind: "no_holder", count: 1 });
    // It names how many, never an amount, and gives no sight of the entry.
    expect((await listBudgetEntries(alice, budget.id)).entries).toEqual([]);
    await expect(confirmEntry(alice, (await db.select().from(budgetEntry))[0].id)).rejects.toThrow(ForbiddenError);
  });

  it("says nothing when nothing is waiting", async () => {
    const { alice, budget } = await setUp();
    await recordEntry(alice, budget.id, expense(10));
    const feed = await listBudgetNeedsAction(alice);
    expect(feed.personal.some((n) => n.kind !== "decide_proposals")).toBe(false);
  });
});
