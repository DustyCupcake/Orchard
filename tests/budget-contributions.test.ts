import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cycle as cycleTable, member, task } from "@/db/schema";
import { eq } from "drizzle-orm";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  approveBudgetProposal,
  confirmEntry,
  getBudgetCycleForCycle,
  getBudgetMoney,
  getContributionSummary,
  listBudgetEntries,
  listBudgetNeedsAction,
  listMyContributions,
  settleEventBudget,
  recordEntry,
  rejectEntry,
  reverseEntry,
  submitBudgetProposal,
  updateBudgetCycle,
} from "@/lib/budget";
import { createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
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

// One event (Alice holds its grant), the community's own budget (Dave holds it),
// and Bob, Carol and Eve as ordinary members.
async function setUp() {
  const { alice, bob, branch } = await createFixtures();
  await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
  const carol = await addMember(alice.communityId, "Carol");
  const dave = await addMember(alice.communityId, "Dave");
  const eve = await addMember(alice.communityId, "Eve");
  const event = await createCycle(alice, { source: "blank", name: "Reunion" });
  const budget = (await getBudgetCycleForCycle(alice, event.id))!;
  await claimTask(alice, (await insertOwnerTask(alice.communityId, branch.id, alice.id, event.id)).id);
  await claimTask(dave, (await insertOwnerTask(alice.communityId, branch.id, dave.id, null)).id);
  return { alice, bob, carol, dave, eve, branch, event, budget };
}

const contribution = (amount: number, extra: Record<string, unknown> = {}) => ({
  kind: "contribution" as const,
  amount,
  description: "",
  occurredOn: TODAY,
  ...extra,
});

describe("Recording a contribution", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is a member's own payment into an event, pending until the owner confirms it", async () => {
    const { bob, budget } = await setUp();
    const entry = await recordEntry(bob, budget.id, contribution(40, { receiptNote: "Bank transfer, 12 Oct" }));
    expect(entry).toMatchObject({
      kind: "contribution",
      amount: 40,
      status: "pending",
      memberId: bob.id,
      submittedBy: bob.id,
      description: "Contribution",
      receiptNote: "Bank transfer, 12 Oct",
      cycleId: budget.cycleId,
    });
  });

  it("can be made to the community's own budget by any member too", async () => {
    const { bob } = await setUp();
    const entry = await recordEntry(bob, null, contribution(15));
    expect(entry).toMatchObject({ kind: "contribution", status: "pending", memberId: bob.id, cycleId: null });
  });

  it("is always about the member recording it, whoever the form names", async () => {
    const { bob, carol, budget } = await setUp();
    expect((await recordEntry(bob, budget.id, contribution(10, { memberId: carol.id }))).memberId).toBe(bob.id);
  });

  it("is born confirmed when the owner records it, and must say who paid", async () => {
    const { alice, bob, budget } = await setUp();
    const entry = await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id, description: "Paid in cash" }));
    expect(entry).toMatchObject({ status: "confirmed", memberId: bob.id, submittedBy: alice.id, confirmedBy: alice.id, description: "Paid in cash" });

    await expect(recordEntry(alice, budget.id, contribution(40))).rejects.toThrow(/who paid/);
    const { alice: stranger } = await createFixtures();
    await expect(recordEntry(alice, budget.id, contribution(40, { memberId: stranger.id }))).rejects.toThrow(NotFoundError);
  });

  it("is refused when not positive", async () => {
    const { bob, budget } = await setUp();
    await expect(recordEntry(bob, budget.id, contribution(0))).rejects.toThrow(AppError);
    await expect(recordEntry(bob, budget.id, contribution(-5))).rejects.toThrow(AppError);
  });

  it("does not let a member record anything else in the community's budget, nor income in an event", async () => {
    const { bob, budget } = await setUp();
    await expect(recordEntry(bob, null, { kind: "expense", amount: 5, description: "x", occurredOn: TODAY })).rejects.toThrow(ForbiddenError);
    await expect(recordEntry(bob, null, { kind: "income", amount: 5, description: "x", occurredOn: TODAY })).rejects.toThrow(ForbiddenError);
    await expect(recordEntry(bob, budget.id, { kind: "income", amount: 5, description: "x", occurredOn: TODAY })).rejects.toThrow(ForbiddenError);
  });

  it("is not tied to a proposal", async () => {
    const { alice, bob, budget } = await setUp();
    const p = await submitBudgetProposal(bob, budget.id, { title: "Kettle", lineItems: [{ label: "Kettle", amount: 30 }] });
    await approveBudgetProposal(alice, p.id);
    await expect(recordEntry(bob, budget.id, contribution(10, { proposalId: p.id }))).rejects.toThrow(AppError);
  });

  it("is refused for a finished budget, a closed event, and with the module off", async () => {
    const { alice, bob, budget } = await setUp();
    const other = await createCycle(alice, { source: "blank", name: "Harvest", confirmed: true });
    const otherBudget = (await getBudgetCycleForCycle(alice, other.id))!;
    await db.update(cycleTable).set({ closedAt: new Date() }).where(eq(cycleTable.id, other.id));
    await expect(recordEntry(bob, otherBudget.id, contribution(10))).rejects.toThrow(ConflictError);

    await settleEventBudget(alice, budget.id);
    await expect(recordEntry(bob, budget.id, contribution(10))).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { modulesEnabled: [] });
    await expect(recordEntry(bob, null, contribution(10))).rejects.toThrow(AppError);
  });

  it("may be made to an event by someone who is not coming to it", async () => {
    const { alice, bob, event, budget } = await setUp();
    await declareParticipation(alice, event.id, { status: "coming" });
    expect((await recordEntry(bob, budget.id, contribution(20))).status).toBe("pending");
  });
});

describe("What a contribution does to the totals", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("counts toward the balance and paid-in only once confirmed, and not at all when rejected", async () => {
    const { alice, bob, carol, budget } = await setUp();
    const a = await recordEntry(bob, budget.id, contribution(40));
    const b = await recordEntry(carol, budget.id, contribution(25));
    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 0, contributed: 0, pendingCount: 2 });
    expect((await getContributionSummary(alice, budget.id)).paidIn).toBe(0);

    await confirmEntry(alice, a.id);
    await rejectEntry(alice, b.id, { note: "Not received" });
    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 40, contributed: 40, income: 0 });
    expect(await getContributionSummary(alice, budget.id)).toMatchObject({ paidIn: 40, contributorCount: 1 });
  });

  it("keeps an event's contributions in the event and the community's in the community", async () => {
    const { alice, bob, dave, budget } = await setUp();
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await recordEntry(dave, null, contribution(15, { memberId: bob.id }));

    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 40, contributed: 40 });
    expect(await getBudgetMoney(dave, null)).toMatchObject({ balance: 15, contributed: 15 });
  });

  it("is a separate figure from income, and both add to the balance", async () => {
    const { alice, bob, budget } = await setUp();
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await recordEntry(alice, budget.id, { kind: "income", amount: 100, description: "Tickets", occurredOn: TODAY });
    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 140, income: 100, contributed: 40 });
  });

  it("nets out when reversed, for the totals and for the member", async () => {
    const { alice, bob, budget } = await setUp();
    const entry = await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await reverseEntry(alice, entry.id, { note: "Paid the wrong event" });

    expect(await getBudgetMoney(alice, budget.id)).toMatchObject({ balance: 0, contributed: 0 });
    expect(await getContributionSummary(alice, budget.id)).toMatchObject({ paidIn: 0, contributorCount: 0 });
    expect((await getContributionSummary(bob, budget.id)).mine).toEqual({ paid: 0, waiting: 0 });
  });
});

describe("The ask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is set by the owner while the budget is open, cleared with null, and starts unset", async () => {
    const { alice, bob, budget } = await setUp();
    expect((await getContributionSummary(bob, budget.id)).ask).toBeNull();

    await updateBudgetCycle(alice, budget.id, { contributionPerMember: 40 });
    expect((await getContributionSummary(bob, budget.id)).ask).toBe(40);

    await updateBudgetCycle(alice, budget.id, { title: "Renamed" });
    expect((await getContributionSummary(bob, budget.id)).ask).toBe(40);

    await updateBudgetCycle(alice, budget.id, { contributionPerMember: null });
    expect((await getContributionSummary(bob, budget.id)).ask).toBeNull();
  });

  it("is the owner's alone, never negative, and frozen once the budget is done", async () => {
    const { alice, bob, budget } = await setUp();
    await expect(updateBudgetCycle(bob, budget.id, { contributionPerMember: 40 })).rejects.toThrow(ForbiddenError);
    await expect(updateBudgetCycle(alice, budget.id, { contributionPerMember: 40.5 } as never)).rejects.toThrow();
    await settleEventBudget(alice, budget.id);
    await expect(updateBudgetCycle(alice, budget.id, { contributionPerMember: 40 })).rejects.toThrow(ConflictError);
  });

  it("is what asking everyone expected would bring in", async () => {
    const { alice, event, budget } = await setUp();
    await updateBudgetCycle(alice, budget.id, { contributionPerMember: 40 });
    // Five members, nobody has said they are coming: spread over all of them.
    expect(await getContributionSummary(alice, budget.id)).toMatchObject({ ask: 40, expectedContributors: 5, askedInTotal: 200 });

    await declareParticipation(alice, event.id, { status: "coming" });
    expect(await getContributionSummary(alice, budget.id)).toMatchObject({ expectedContributors: 1, askedInTotal: 40 });
  });
});

describe("The suggested ask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is the plan over the people it is spread across", async () => {
    const { alice, budget } = await setUp();
    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Site fee", amount: 1000 }] });
    expect((await getContributionSummary(alice, budget.id)).suggestedAsk).toBe(200);
  });

  it("spreads over the people coming once anyone has said so, and rounds up", async () => {
    const { alice, bob, carol, event, budget } = await setUp();
    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Site fee", amount: 1000 }] });
    await declareParticipation(alice, event.id, { status: "coming" });
    await declareParticipation(bob, event.id, { status: "coming" });
    expect((await getContributionSummary(alice, budget.id)).suggestedAsk).toBe(500);

    // 1000 over 3 people coming, rounded up.
    await declareParticipation(carol, event.id, { status: "coming" });
    expect((await getContributionSummary(alice, budget.id)).suggestedAsk).toBe(334);
  });

  it("falls by what has come in as income, and never below zero", async () => {
    const { alice, budget } = await setUp();
    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Site fee", amount: 1000 }] });
    await recordEntry(alice, budget.id, { kind: "income", amount: 500, description: "Tickets", occurredOn: TODAY });
    expect((await getContributionSummary(alice, budget.id)).suggestedAsk).toBe(100);

    await recordEntry(alice, budget.id, { kind: "income", amount: 800, description: "Sponsor", occurredOn: TODAY });
    expect((await getContributionSummary(alice, budget.id)).suggestedAsk).toBe(0);
  });

  it("counts approved proposals in the plan", async () => {
    const { alice, bob, budget } = await setUp();
    const p = await submitBudgetProposal(bob, budget.id, { title: "Marquee", lineItems: [{ label: "Marquee", amount: 400 }] });
    await approveBudgetProposal(alice, p.id);
    expect((await getContributionSummary(alice, budget.id)).suggestedAsk).toBe(80);
  });

  it("is not a thing for the community's own budget, which has no ask", async () => {
    const { bob } = await setUp();
    expect(await getContributionSummary(bob, null)).toMatchObject({ ask: null, suggestedAsk: null, expectedContributors: null, askedInTotal: null });
  });
});

describe("Who sees what a member paid", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("shows everyone the total and how many have paid, and names only to the owner", async () => {
    const { alice, bob, carol, eve, budget } = await setUp();
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await recordEntry(alice, budget.id, contribution(25, { memberId: carol.id }));
    await recordEntry(carol, budget.id, contribution(10));

    expect(await getContributionSummary(eve, budget.id)).toMatchObject({ paidIn: 65, contributorCount: 2, mine: { paid: 0, waiting: 0 }, members: null });
    expect((await getContributionSummary(alice, budget.id)).members).toEqual([
      { memberId: bob.id, name: "Bob", paid: 40, waiting: 0 },
      { memberId: carol.id, name: "Carol", paid: 25, waiting: 10 },
    ]);
  });

  it("shows a member their own payments, counted and waiting, and no one else's", async () => {
    const { alice, bob, carol, budget } = await setUp();
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await recordEntry(bob, budget.id, contribution(15));
    await recordEntry(alice, budget.id, contribution(25, { memberId: carol.id }));

    const asBob = await getContributionSummary(bob, budget.id);
    expect(asBob.mine).toEqual({ paid: 40, waiting: 15 });
    expect(asBob.members).toBeNull();
    const entries = (await listBudgetEntries(bob, budget.id)).entries.map((e) => e.entry.amount).sort();
    expect(entries).toEqual([15, 40]);
  });

  it("keeps an event's payments from the community's holder, and the community's from an event's", async () => {
    const { alice, bob, dave, budget } = await setUp();
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await recordEntry(dave, null, contribution(15, { memberId: bob.id }));

    expect((await getContributionSummary(dave, budget.id)).members).toBeNull();
    expect((await listBudgetEntries(dave, budget.id)).entries).toEqual([]);
    expect((await getContributionSummary(alice, null)).members).toBeNull();
    expect((await listBudgetEntries(alice, null)).entries).toEqual([]);
    // The totals stay open to both.
    expect((await getContributionSummary(dave, budget.id)).paidIn).toBe(40);
    expect((await getContributionSummary(alice, null)).paidIn).toBe(15);
    expect((await getContributionSummary(dave, null)).members).toEqual([{ memberId: bob.id, name: "Bob", paid: 15, waiting: 0 }]);
  });

  it("gives an open module's members, and an Admin who is not the holder, no names", async () => {
    const { alice, bob, carol, budget } = await setUp();
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await setModuleOpen(alice, "budget", true);

    expect((await getContributionSummary(carol, budget.id)).members).toBeNull();
    expect((await listBudgetEntries(carol, budget.id)).entries).toEqual([]);
  });

  it("asks the owner to confirm a waiting contribution, like any other entry", async () => {
    const { alice, bob, budget } = await setUp();
    await recordEntry(bob, budget.id, contribution(40));
    expect((await listBudgetNeedsAction(alice)).personal).toContainEqual({
      scopeCycleId: budget.cycleId,
      title: "Reunion Budget",
      kind: "confirm_entries",
      count: 1,
    });
  });
});

describe("My contributions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gathers what a member has paid across events and the community's budget, grouped by what it was for", async () => {
    const { alice, bob, dave, budget } = await setUp();
    const other = await createCycle(alice, { source: "blank", name: "Harvest", confirmed: true });
    const otherBudget = (await getBudgetCycleForCycle(alice, other.id))!;
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await recordEntry(bob, budget.id, contribution(10));
    await recordEntry(bob, otherBudget.id, contribution(20));
    await recordEntry(dave, null, contribution(15, { memberId: bob.id }));

    const groups = await listMyContributions(bob);
    expect(groups.map((g) => [g.title, g.paid, g.waiting])).toEqual([
      ["Reunion", 40, 10],
      ["Harvest", 0, 20],
      ["Community budget", 15, 0],
    ]);
    expect(groups.find((g) => g.title === "Reunion")!.entries).toHaveLength(2);
  });

  it("holds only the member's own, whoever recorded it, and nobody else's", async () => {
    const { alice, bob, carol, budget } = await setUp();
    await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await recordEntry(alice, budget.id, contribution(99, { memberId: carol.id }));

    const bobs = await listMyContributions(bob);
    expect(bobs.flatMap((g) => g.entries.map((e) => e.entry.amount))).toEqual([40]);
    expect((await listMyContributions(carol)).flatMap((g) => g.entries.map((e) => e.entry.amount))).toEqual([99]);
  });

  it("keeps a rejected payment, so a member can see what became of it, out of what is paid", async () => {
    const { alice, bob, budget } = await setUp();
    const entry = await recordEntry(bob, budget.id, contribution(40));
    await rejectEntry(alice, entry.id, { note: "Not received" });

    const [group] = await listMyContributions(bob);
    expect(group).toMatchObject({ paid: 0, waiting: 0 });
    expect(group.entries[0].entry).toMatchObject({ status: "rejected", decisionNote: "Not received" });
  });

  it("shows a reversed payment netting out, with the original and its reversal both listed", async () => {
    const { alice, bob, budget } = await setUp();
    const entry = await recordEntry(alice, budget.id, contribution(40, { memberId: bob.id }));
    await reverseEntry(alice, entry.id, { note: "Wrong event" });

    const [group] = await listMyContributions(bob);
    expect(group.paid).toBe(0);
    expect(group.entries).toHaveLength(2);
    expect(group.entries.find((e) => e.entry.id === entry.id)?.reversedBy).not.toBeNull();
  });

  it("is empty for someone who has paid nothing, and never lists an expense", async () => {
    const { alice, bob, carol, budget } = await setUp();
    expect(await listMyContributions(carol)).toEqual([]);
    await recordEntry(bob, budget.id, { kind: "expense", amount: 12, description: "Tape", occurredOn: TODAY });
    await recordEntry(alice, budget.id, { kind: "expense", amount: 5, description: "Pegs", occurredOn: TODAY, memberId: bob.id });
    expect(await listMyContributions(bob)).toEqual([]);
  });

  it("refuses while the module is off", async () => {
    const { alice, bob } = await setUp();
    await updateCommunity(alice, { modulesEnabled: [] });
    await expect(listMyContributions(bob)).rejects.toThrow(AppError);
  });
});
