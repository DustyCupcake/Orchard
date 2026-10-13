import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetEntry, budgetProposal, member, task, taskAssignment } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  approveBudgetProposal,
  closeBudgetProposal,
  confirmEntry,
  declineBudgetProposal,
  getAllocationOutlook,
  getBudgetCycleForCycle,
  getBudgetMoney,
  getSettlementState,
  listBudgetEntries,
  listBudgetNeedsAction,
  listBudgetProposalViews,
  recordEntry,
  requestEventAllocation,
  setBudgetProposalSupport,
  settleEventBudget,
  submitBudgetProposal,
  updateBudgetCycle,
  updateBudgetProposal,
  withdrawBudgetProposal,
} from "@/lib/budget";
import { closeCycle, createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { setModuleOpen, setPermissionGrant } from "@/lib/permissions";
import { AppError, ConfirmationRequiredError, ConflictError, ForbiddenError } from "@/lib/errors";
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

// One event (Alice holds its grant), the community's own budget (Dave holds it, with
// 1000 to start with), and Bob, Carol and Eve as ordinary members. Five members in all.
async function setUp(fundSupportPerBacker: number | null = null) {
  const { alice, bob, branch } = await createFixtures();
  await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true, fundSupportPerBacker });
  const carol = await addMember(alice.communityId, "Carol");
  const dave = await addMember(alice.communityId, "Dave");
  const eve = await addMember(alice.communityId, "Eve");
  const event = await createCycle(alice, { source: "blank", name: "Reunion" });
  const budget = (await getBudgetCycleForCycle(alice, event.id))!;
  const eventOwnerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, event.id);
  await claimTask(alice, eventOwnerTask.id);
  await claimTask(dave, (await insertOwnerTask(alice.communityId, branch.id, dave.id, null)).id);
  await recordEntry(dave, null, { kind: "opening_balance", amount: 1000, description: "Brought forward", occurredOn: TODAY });
  return { alice, bob, carol, dave, eve, branch, event, budget, eventOwnerTask };
}

// An event whose plan is 400 (one approved proposal) and whose ask is 10 a head. The
// backing rule is switched on afterwards, so the marquee itself is approved in full:
// what is under test is the request for funding, not the plan.
async function readyEvent(fundSupportPerBacker: number | null = null) {
  const ctx = await setUp(null);
  const p = await submitBudgetProposal(ctx.bob, ctx.budget.id, { title: "Marquee", lineItems: [{ label: "Marquee", amount: 400 }] });
  await approveBudgetProposal(ctx.alice, p.id);
  await updateBudgetCycle(ctx.alice, ctx.budget.id, { contributionPerMember: 10 });
  if (fundSupportPerBacker !== null) await updateCommunity(ctx.alice, { fundSupportPerBacker });
  return { ...ctx, marquee: p };
}

const expense = (amount: number, extra: Record<string, unknown> = {}) => ({
  kind: "expense" as const,
  amount,
  description: "Costs",
  occurredOn: TODAY,
  ...extra,
});
const income = (amount: number) => ({ kind: "income" as const, amount, description: "Tickets", occurredOn: TODAY });

const fundBalance = async (who: Parameters<typeof getBudgetMoney>[0]) => (await getBudgetMoney(who, null)).balance;

describe("What an event still needs from the community's budget", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is the plan less what members are asked for and the income recorded", async () => {
    const { alice, budget } = await readyEvent();
    // 400 plan, 10 × 5 people asked = 50, no income: 350 uncovered.
    expect(await getAllocationOutlook(alice, budget.id)).toMatchObject({ shortfall: 350, planTotal: 400, askedInTotal: 50, income: 0, allocated: 0, canRequest: true });

    await recordEntry(alice, budget.id, income(100));
    expect((await getAllocationOutlook(alice, budget.id)).shortfall).toBe(250);
  });

  it("explains why a request cannot be made yet", async () => {
    const { alice, bob, budget } = await setUp();
    // No ask, nothing approved.
    expect((await getAllocationOutlook(alice, budget.id)).reason).toMatch(/asked to contribute/);

    await updateBudgetCycle(alice, budget.id, { contributionPerMember: 10 });
    expect((await getAllocationOutlook(alice, budget.id)).reason).toMatch(/Approve what the event needs/);

    const p = await submitBudgetProposal(bob, budget.id, { title: "Tent", lineItems: [{ label: "Tent", amount: 30 }] });
    await approveBudgetProposal(alice, p.id);
    // 30 plan, 10 × 5 = 50 asked: nothing uncovered.
    expect((await getAllocationOutlook(alice, budget.id)).reason).toMatch(/Nothing is needed/);
    expect((await getAllocationOutlook(bob, budget.id)).reason).toMatch(/Only the event budget's owner/);
  });
});

describe("Asking the community's budget for funding", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("makes a proposal about the event that sits among the community's own, carrying a snapshot of the plan", async () => {
    const { alice, bob, dave, event, budget, marquee } = await readyEvent();
    await recordEntry(alice, budget.id, income(50));
    const req = await requestEventAllocation(alice, budget.id);

    expect(req).toMatchObject({
      kind: "event_allocation",
      cycleId: null,
      budgetCycleId: null,
      eventCycleId: event.id,
      submittedBy: alice.id,
      totalAmount: 300,
      requestedContributionPerMember: 10,
      expectedContributors: 5,
      status: "open",
      title: "Funding for Reunion",
    });
    expect(req.planSnapshot).toMatchObject({
      planTotal: 400,
      askPerMember: 10,
      expectedContributors: 5,
      askedInTotal: 50,
      incomeRecorded: 50,
      allocatedSoFar: 0,
      shortfall: 300,
      approved: [{ proposalId: marquee.id, title: "Marquee", approvedAmount: 400 }],
    });
    // It is the community's to decide, and the event's own list does not show it.
    const community = await listBudgetProposalViews(bob, null);
    expect(community.find((v) => v.proposal.id === req.id)).toMatchObject({ eventName: "Reunion" });
    expect((await listBudgetProposalViews(bob, event.id)).some((v) => v.proposal.id === req.id)).toBe(false);
    expect((await listBudgetNeedsAction(dave)).personal).toContainEqual(expect.objectContaining({ kind: "decide_proposals", scopeCycleId: null }));
  });

  it("is the event owner's alone, and one at a time", async () => {
    const { alice, bob, dave, budget } = await readyEvent();
    await expect(requestEventAllocation(bob, budget.id)).rejects.toThrow(ForbiddenError);
    await expect(requestEventAllocation(dave, budget.id)).rejects.toThrow(ForbiddenError);
    const req = await requestEventAllocation(alice, budget.id);
    await expect(requestEventAllocation(alice, budget.id)).rejects.toThrow(ConflictError);

    // Withdrawn, a new one can be made.
    await withdrawBudgetProposal(alice, req.id);
    expect((await requestEventAllocation(alice, budget.id)).id).not.toBe(req.id);
  });

  it("is refused for a finished budget, a closed event, and with the module off", async () => {
    const { alice, event, budget } = await readyEvent();
    await updateCommunity(alice, { modulesEnabled: [] });
    await expect(requestEventAllocation(alice, budget.id)).rejects.toThrow(AppError);
    await updateCommunity(alice, { modulesEnabled: ["budget"] });

    await closeCycle(alice, event.id, { overrideBudgetWarning: true });
    await expect(requestEventAllocation(alice, budget.id)).rejects.toThrow(ConflictError);
  });

  it("asks only for the new gap once something has been allocated, and cannot be edited", async () => {
    const { alice, bob, dave, budget } = await readyEvent();
    const first = await requestEventAllocation(alice, budget.id);
    await expect(updateBudgetProposal(alice, first.id, { title: "Tweaked" })).rejects.toThrow(ConflictError);
    await approveBudgetProposal(dave, first.id, { amount: 200 });

    // 200 was allocated; the plan grows by 100 more.
    const extra = await submitBudgetProposal(bob, budget.id, { title: "Lights", lineItems: [{ label: "Lights", amount: 100 }] });
    await approveBudgetProposal(alice, extra.id);
    const outlook = await getAllocationOutlook(alice, budget.id);
    expect(outlook).toMatchObject({ allocated: 200, planTotal: 500, shortfall: 250 });
    expect((await requestEventAllocation(alice, budget.id)).totalAmount).toBe(250);
  });
});

describe("Who is behind a funding request", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("counts the people coming to the event, so a well-attended event needs nobody asked", async () => {
    // 3 of 5 are coming, so the ask is spread over 3: 400 − 30 = 370 uncovered. At 100 a head
    // that needs 4 people: the requester and the three coming.
    const { alice, carol, dave, eve, event, budget } = await readyEvent(100);
    for (const m of [carol, dave, eve]) await declareParticipation(m, event.id, { status: "coming" });
    const req = await requestEventAllocation(alice, budget.id);
    expect(req.totalAmount).toBe(370);

    const view = (await listBudgetProposalViews(alice, null)).find((v) => v.proposal.id === req.id)!;
    expect(view).toMatchObject({ comingCount: 3, supporterCount: 0 });
    expect(view.backing).toMatchObject({ backers: 4, backedUpTo: 400, approvable: 370 });

    expect((await approveBudgetProposal(dave, req.id)).approvedAmount).toBe(370);
  });

  it("is short by exactly the right amount when attendance does not cover it, and explicit support makes up the rest", async () => {
    const { alice, bob, carol, dave, event, budget } = await readyEvent(100);
    await declareParticipation(carol, event.id, { status: "coming" });
    // Only Carol is coming: spread over her alone, 400 − 10 = 390 uncovered. Needs 4 backers.
    const req = await requestEventAllocation(alice, budget.id);
    expect(req.totalAmount).toBe(390);
    const first = (await listBudgetProposalViews(dave, null)).find((v) => v.proposal.id === req.id)!;
    expect(first.backing).toMatchObject({ backers: 2, backedUpTo: 200, approvable: 200 });
    await expect(approveBudgetProposal(dave, req.id, { amount: 201 })).rejects.toThrow(/backed/);

    await setBudgetProposalSupport(bob, req.id, true);
    await setBudgetProposalSupport(dave, req.id, true);
    const after = (await listBudgetProposalViews(dave, null)).find((v) => v.proposal.id === req.id)!;
    expect(after).toMatchObject({ comingCount: 1, supporterCount: 2 });
    expect(after.backing).toMatchObject({ backers: 4, approvable: 390 });
  });

  it("counts each person once: the requester and a supporter who is also coming", async () => {
    const { alice, bob, carol, event, budget } = await readyEvent(100);
    // Alice (the requester) and Carol are coming, and Carol also supports it explicitly.
    await declareParticipation(alice, event.id, { status: "coming" });
    await declareParticipation(carol, event.id, { status: "coming" });
    const req = await requestEventAllocation(alice, budget.id);
    await setBudgetProposalSupport(carol, req.id, true);
    await setBudgetProposalSupport(bob, req.id, true);

    const view = (await listBudgetProposalViews(alice, null)).find((v) => v.proposal.id === req.id)!;
    // The proposer once, Carol once (supporting, not also "coming"), and Bob.
    expect(view).toMatchObject({ supporterCount: 2, comingCount: 0 });
    expect(view.backing.backers).toBe(3);
  });

  it("is not undone when someone stops coming after it is approved", async () => {
    const { alice, carol, dave, eve, event, budget } = await readyEvent(100);
    for (const m of [carol, dave, eve]) await declareParticipation(m, event.id, { status: "coming" });
    const req = await requestEventAllocation(alice, budget.id);
    await approveBudgetProposal(dave, req.id);

    for (const m of [carol, dave, eve]) await declareParticipation(m, event.id, { status: "not_coming" });
    const [row] = await db.select().from(budgetProposal).where(eq(budgetProposal.id, req.id));
    expect(row.status).toBe("approved");
    expect((await getBudgetMoney(alice, budget.id)).balance).toBe(370);
  });

  it("is not a thing for an event's own spending proposals, where coming to the event backs nothing", async () => {
    const { bob, carol, event, budget } = await setUp(100);
    await declareParticipation(carol, event.id, { status: "coming" });
    const p = await submitBudgetProposal(bob, budget.id, { title: "Tent", lineItems: [{ label: "Tent", amount: 300 }] });
    const view = (await listBudgetProposalViews(bob, event.id)).find((v) => v.proposal.id === p.id)!;
    expect(view).toMatchObject({ comingCount: 0 });
    expect(view.backing.backers).toBe(1);
  });
});

describe("Approving a funding request moves the money", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("takes it from the community's budget and gives it to the event, as a pair that nets to zero", async () => {
    const { alice, bob, dave, event, budget } = await readyEvent();
    const req = await requestEventAllocation(alice, budget.id);
    expect(await fundBalance(bob)).toBe(1000);

    const approved = await approveBudgetProposal(dave, req.id, { note: "Go ahead" });
    expect(approved).toMatchObject({ status: "approved", approvedAmount: 350 });
    expect(await fundBalance(bob)).toBe(650);
    expect(await getBudgetMoney(bob, budget.id)).toMatchObject({ balance: 350, transfers: 350 });
    expect(await getBudgetMoney(bob, null)).toMatchObject({ balance: 650, transfers: -350 });

    const pair = await db.select().from(budgetEntry).where(eq(budgetEntry.kind, "allocation"));
    expect(pair).toHaveLength(2);
    expect(pair.map((e) => e.amount).sort((a, b) => a - b)).toEqual([-350, 350]);
    expect(new Set(pair.map((e) => e.transferId))).toEqual(new Set([req.id]));
    expect(pair.every((e) => e.status === "confirmed" && e.confirmedBy === dave.id)).toBe(true);
    expect(pair.find((e) => e.cycleId === event.id)!.amount).toBe(350);
    expect(pair.find((e) => e.cycleId === null)!.amount).toBe(-350);
  });

  it("can be for less than was asked, never more than is backed, and is the community holder's decision", async () => {
    const { alice, bob, dave, budget } = await readyEvent(100);
    const req = await requestEventAllocation(alice, budget.id);
    // Only the requester is behind a 350 request at 100 a head: 100 is backed.
    await expect(approveBudgetProposal(dave, req.id, { amount: 101 })).rejects.toThrow(/backed/);
    await expect(approveBudgetProposal(bob, req.id)).rejects.toThrow(ForbiddenError);
    await expect(approveBudgetProposal(alice, req.id)).rejects.toThrow(ForbiddenError);
    expect((await approveBudgetProposal(dave, req.id, { amount: 60 })).approvedAmount).toBe(60);
    expect(await fundBalance(bob)).toBe(940);
    expect((await getBudgetMoney(bob, budget.id)).balance).toBe(60);
  });

  it("moves nothing when it is declined, which needs a note", async () => {
    const { alice, bob, dave, budget } = await readyEvent();
    const req = await requestEventAllocation(alice, budget.id);
    await expect(declineBudgetProposal(dave, req.id, { note: " " })).rejects.toThrow(AppError);
    expect((await declineBudgetProposal(dave, req.id, { note: "Not this year" })).status).toBe("declined");
    expect(await fundBalance(bob)).toBe(1000);
    expect((await getBudgetMoney(bob, budget.id)).balance).toBe(0);
    expect((await getAllocationOutlook(alice, budget.id)).latest).toMatchObject({ status: "declined", note: "Not this year" });
  });

  it("goes through even when it leaves the community's budget overdrawn, as every check here does", async () => {
    const { alice, dave, budget } = await readyEvent();
    // Dave records money going out, leaving 100 free.
    await recordEntry(dave, null, expense(900));
    const req = await requestEventAllocation(alice, budget.id);
    await approveBudgetProposal(dave, req.id);
    expect(await fundBalance(dave)).toBe(-250);
  });

  it("is refused once the event has finished or closed, though declining still works", async () => {
    const { alice, dave, event, budget } = await readyEvent();
    const a = await requestEventAllocation(alice, budget.id);
    await closeCycle(alice, event.id, { overrideBudgetWarning: true });
    await expect(approveBudgetProposal(dave, a.id)).rejects.toThrow(ConflictError);
    expect((await declineBudgetProposal(dave, a.id, { note: "The event is over" })).status).toBe("declined");
    expect(await fundBalance(dave)).toBe(1000);
  });

  it("is never set aside as a commitment, a proposal to spend against, or something to close", async () => {
    const { alice, dave, budget } = await readyEvent();
    const req = await requestEventAllocation(alice, budget.id);
    await approveBudgetProposal(dave, req.id);

    expect(await getBudgetMoney(dave, null)).toMatchObject({ committed: 0, available: 650 });
    await expect(recordEntry(dave, null, expense(10, { proposalId: req.id }))).rejects.toThrow(AppError);
    await expect(closeBudgetProposal(dave, req.id)).rejects.toThrow(ConflictError);
  });

  it("keeps the event's side of the transfer from the community's holder and the community's from the event's", async () => {
    const { alice, dave, budget } = await readyEvent();
    const req = await requestEventAllocation(alice, budget.id);
    await approveBudgetProposal(dave, req.id);

    // The community's holder made the transfer, so the event's side of it is theirs to see,
    // and nothing else in the event is.
    await recordEntry(alice, budget.id, income(40));
    expect((await listBudgetEntries(dave, budget.id)).entries.map((e) => e.entry.amount)).toEqual([350]);
    expect((await listBudgetEntries(alice, budget.id)).entries.map((e) => e.entry.amount).sort((a, b) => a - b)).toEqual([40, 350]);
    expect((await listBudgetEntries(alice, null)).entries).toEqual([]);
    expect((await listBudgetEntries(dave, null)).entries.some((e) => e.entry.amount === -350)).toBe(true);
  });
});

describe("Settling an event's budget", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns a surplus to the community's budget as one pair, and closes the books", async () => {
    const { alice, bob, dave, budget } = await setUp();
    await recordEntry(alice, budget.id, { kind: "contribution", amount: 120, description: "", occurredOn: TODAY, memberId: bob.id });
    await recordEntry(alice, budget.id, income(80));
    await recordEntry(alice, budget.id, expense(50));
    // Contributions and income stay in the event until it settles.
    expect(await fundBalance(dave)).toBe(1000);
    expect((await getBudgetMoney(alice, budget.id)).balance).toBe(150);

    const { budget: settled, deficitProposal, surplusReturned } = await settleEventBudget(alice, budget.id);
    expect(deficitProposal).toBeNull();
    expect(surplusReturned).toBe(150);
    expect(settled).toMatchObject({ status: "confirmed" });
    expect(settled.settledAt).not.toBeNull();

    expect((await getBudgetMoney(alice, budget.id)).balance).toBe(0);
    expect(await fundBalance(dave)).toBe(1150);
    const pair = await db.select().from(budgetEntry).where(eq(budgetEntry.kind, "settlement"));
    expect(pair.map((e) => e.amount).sort((a, b) => a - b)).toEqual([-150, 150]);
    expect(new Set(pair.map((e) => e.transferId)).size).toBe(1);
    expect(pair.reduce((sum, e) => sum + e.amount, 0)).toBe(0);
    expect(await getSettlementState(alice, budget.id)).toMatchObject({ settled: true, balance: 0, unrecovered: 0 });
  });

  it("just closes the books when the balance is exactly zero", async () => {
    const { alice, budget } = await setUp();
    const { budget: settled } = await settleEventBudget(alice, budget.id);
    expect(settled.settledAt).not.toBeNull();
    expect(await db.select().from(budgetEntry).where(eq(budgetEntry.kind, "settlement"))).toEqual([]);
  });

  it("refuses while any entry is waiting, and once settled takes no more", async () => {
    const { alice, bob, budget } = await setUp();
    const claim = await recordEntry(bob, budget.id, expense(20));
    await expect(settleEventBudget(alice, budget.id)).rejects.toThrow(/waiting/);
    await confirmEntry(alice, claim.id);
    await recordEntry(alice, budget.id, income(100));
    await settleEventBudget(alice, budget.id);
    await expect(recordEntry(bob, budget.id, expense(5))).rejects.toThrow(ConflictError);
    await expect(settleEventBudget(alice, budget.id)).rejects.toThrow(ConflictError);
  });

  it("is the budget owner's, then the community owner's once the event has closed, and nobody else's", async () => {
    const { alice, bob, dave, event, budget } = await setUp();
    await recordEntry(alice, budget.id, income(100));
    await expect(settleEventBudget(bob, budget.id)).rejects.toThrow(ForbiddenError);
    await expect(settleEventBudget(dave, budget.id)).rejects.toThrow(ForbiddenError);

    await closeCycle(alice, event.id, { overrideBudgetWarning: true });
    expect(await getSettlementState(dave, budget.id)).toMatchObject({ canSettle: true });
    expect(await getSettlementState(bob, budget.id)).toMatchObject({ canSettle: false });
    await settleEventBudget(dave, budget.id);
    expect(await fundBalance(dave)).toBe(1100);
  });

  it("lets the community owner close the books of an event whose owner has gone, rejecting what was left waiting with a note", async () => {
    const { alice, bob, dave, event, budget, eventOwnerTask } = await setUp();
    await recordEntry(alice, budget.id, income(100));
    const claim = await recordEntry(bob, budget.id, expense(20));
    await db.delete(taskAssignment).where(eq(taskAssignment.taskId, eventOwnerTask.id));
    await closeCycle(alice, event.id, { overrideBudgetWarning: true });

    await settleEventBudget(dave, budget.id);
    const [row] = await db.select().from(budgetEntry).where(eq(budgetEntry.id, claim.id));
    expect(row).toMatchObject({ status: "rejected", decisionNote: "Not confirmed before the budget's books were closed." });
    expect(await fundBalance(dave)).toBe(1100);
  });

  it("lets a budget that never recorded anything be settled by whoever the module makes an owner, but never one with money in it", async () => {
    const { alice, bob, carol, budget } = await setUp();
    await setModuleOpen(alice, "budget", true);
    expect((await settleEventBudget(bob, budget.id)).budget.settledAt).not.toBeNull();

    const other = await createCycle(alice, { source: "blank", name: "Harvest", confirmed: true });
    const otherBudget = (await getBudgetCycleForCycle(alice, other.id))!;
    await recordEntry(carol, otherBudget.id, expense(10));
    await expect(settleEventBudget(bob, otherBudget.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("An event that overspent", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function overspent(fundSupportPerBacker: number | null = null) {
    const ctx = await setUp(fundSupportPerBacker);
    await recordEntry(ctx.alice, ctx.budget.id, income(100));
    await recordEntry(ctx.alice, ctx.budget.id, expense(220));
    const result = await settleEventBudget(ctx.alice, ctx.budget.id);
    return { ...ctx, ...result };
  }

  it("is not absorbed: it opens a proposal for the overspend and leaves the books open", async () => {
    const { alice, bob, dave, event, budget, deficitProposal } = await overspent();
    expect(deficitProposal).toMatchObject({
      kind: "event_deficit",
      eventCycleId: event.id,
      cycleId: null,
      totalAmount: 120,
      status: "open",
      submittedBy: alice.id,
      title: "Covering Reunion's overspend",
    });
    expect(deficitProposal!.planSnapshot).toMatchObject({ balance: -120 });

    const state = await getSettlementState(alice, budget.id);
    expect(state).toMatchObject({ settled: false, finished: true, balance: -120, awaiting: { amount: 120 }, unrecovered: 0, canSettle: false });
    expect(await fundBalance(bob)).toBe(1000);
    await expect(settleEventBudget(alice, budget.id)).rejects.toThrow(/waiting for the community/);
    expect((await listBudgetNeedsAction(dave)).personal).toContainEqual(expect.objectContaining({ kind: "decide_proposals", count: 1 }));
  });

  it("is covered by approving it: the money moves, the event comes back to zero, and the books close", async () => {
    const { alice, bob, dave, budget, deficitProposal } = await overspent();
    await approveBudgetProposal(dave, deficitProposal!.id, { note: "Fair enough" });

    expect(await fundBalance(bob)).toBe(880);
    expect((await getBudgetMoney(alice, budget.id)).balance).toBe(0);
    const state = await getSettlementState(alice, budget.id);
    expect(state).toMatchObject({ settled: true, awaiting: null, unrecovered: 0 });
    const covering = await db.select().from(budgetEntry).where(eq(budgetEntry.transferId, deficitProposal!.id));
    expect(covering.map((e) => e.amount).sort((a, b) => a - b)).toEqual([-120, 120]);
    expect(covering.every((e) => e.kind === "settlement")).toBe(true);
  });

  it("is covered in part: the rest stays visible as unrecovered, and the books still close", async () => {
    const { alice, bob, dave, budget, deficitProposal } = await overspent();
    await approveBudgetProposal(dave, deficitProposal!.id, { amount: 80 });

    expect(await fundBalance(bob)).toBe(920);
    expect((await getBudgetMoney(alice, budget.id)).balance).toBe(-40);
    expect(await getSettlementState(alice, budget.id)).toMatchObject({ settled: true, unrecovered: 40 });
  });

  it("is not forgiven or hidden when declined: it stays on the books, with no further consequence", async () => {
    const { alice, bob, dave, event, budget, deficitProposal } = await overspent();
    await declineBudgetProposal(dave, deficitProposal!.id, { note: "The event should cover itself" });

    expect(await fundBalance(bob)).toBe(1000);
    expect((await getBudgetMoney(alice, budget.id)).balance).toBe(-120);
    expect(await getSettlementState(alice, budget.id)).toMatchObject({ settled: true, unrecovered: 120, canSettle: false });
    // Closing the event no longer warns.
    await expect(closeCycle(alice, event.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });
  });

  it("follows the same backing rule as any other request, counting the people coming", async () => {
    const { alice, carol, dave, eve, event, deficitProposal } = await overspent(30);
    // 120 at 30 a head needs 4 people; only the requester is behind it.
    const alone = (await listBudgetProposalViews(alice, null)).find((v) => v.proposal.id === deficitProposal!.id)!;
    expect(alone.backing).toMatchObject({ backers: 1, backedUpTo: 30, approvable: 30 });
    await expect(approveBudgetProposal(dave, deficitProposal!.id, { amount: 120 })).rejects.toThrow(/backed/);

    for (const m of [carol, dave, eve]) await declareParticipation(m, event.id, { status: "coming" });
    expect((await approveBudgetProposal(dave, deficitProposal!.id)).approvedAmount).toBe(120);
  });

  it("can be withdrawn by whoever settled it, leaving the budget to settle again", async () => {
    const { alice, budget, deficitProposal } = await overspent();
    await withdrawBudgetProposal(alice, deficitProposal!.id);
    expect(await getSettlementState(alice, budget.id)).toMatchObject({ settled: false, awaiting: null, canSettle: true });

    const again = await settleEventBudget(alice, budget.id);
    expect(again.deficitProposal!.id).not.toBe(deficitProposal!.id);
  });

  it("is not something to close, edit or tie an expense to", async () => {
    const { alice, dave, deficitProposal } = await overspent();
    await expect(updateBudgetProposal(alice, deficitProposal!.id, { title: "x" })).rejects.toThrow(ConflictError);
    await approveBudgetProposal(dave, deficitProposal!.id);
    await expect(closeBudgetProposal(dave, deficitProposal!.id)).rejects.toThrow(ConflictError);
    await expect(recordEntry(dave, null, expense(5, { proposalId: deficitProposal!.id }))).rejects.toThrow(AppError);
  });
});

describe("Closing an event with an unsettled budget", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("warns, naming what the budget still holds or owes, and never blocks", async () => {
    const { alice, event, budget } = await setUp();
    await recordEntry(alice, budget.id, income(100));
    await expect(closeCycle(alice, event.id)).rejects.toThrow(ConfirmationRequiredError);
    await expect(closeCycle(alice, event.id)).rejects.toThrow(/hasn't been settled yet and still holds 100/);

    await recordEntry(alice, budget.id, expense(250));
    await expect(closeCycle(alice, event.id)).rejects.toThrow(/overspent by 150/);
    expect((await closeCycle(alice, event.id, { overrideBudgetWarning: true })).closedAt).not.toBeNull();
  });

  it("stops warning once the books are closed", async () => {
    const { alice, event, budget } = await setUp();
    await recordEntry(alice, budget.id, income(100));
    await settleEventBudget(alice, budget.id);
    await expect(closeCycle(alice, event.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });
  });

  it("keeps warning while an overspend is waiting on the community", async () => {
    const { alice, event, budget } = await setUp();
    await recordEntry(alice, budget.id, expense(50));
    await settleEventBudget(alice, budget.id);
    await expect(closeCycle(alice, event.id)).rejects.toThrow(/hasn't been settled yet and is overspent by 50/);
  });
});

describe("Asking to settle a closed event, on the dashboard", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("asks the event's owner, and stops once it is settled", async () => {
    const { alice, bob, event, budget } = await setUp();
    await recordEntry(alice, budget.id, income(100));
    await closeCycle(alice, event.id, { overrideBudgetWarning: true });

    expect((await listBudgetNeedsAction(alice)).personal).toContainEqual({ scopeCycleId: event.id, title: "Reunion Budget", kind: "settle_budget", count: 1 });
    expect((await listBudgetNeedsAction(bob)).personal.some((n) => n.kind === "settle_budget")).toBe(false);

    await settleEventBudget(alice, budget.id);
    expect((await listBudgetNeedsAction(alice)).personal.some((n) => n.kind === "settle_budget")).toBe(false);
  });

  it("asks the community's owner instead when the event has no owner left", async () => {
    const { alice, dave, event, budget, eventOwnerTask } = await setUp();
    await recordEntry(alice, budget.id, income(100));
    await closeCycle(alice, event.id, { overrideBudgetWarning: true });
    expect((await listBudgetNeedsAction(dave)).personal.some((n) => n.kind === "settle_budget")).toBe(false);

    await db.delete(taskAssignment).where(eq(taskAssignment.taskId, eventOwnerTask.id));
    expect((await listBudgetNeedsAction(dave)).personal).toContainEqual(expect.objectContaining({ kind: "settle_budget", scopeCycleId: event.id }));
  });

  it("does not ask again while an overspend is waiting on the community's decision", async () => {
    const { alice, event, budget } = await setUp();
    await recordEntry(alice, budget.id, expense(50));
    await closeCycle(alice, event.id, { overrideBudgetWarning: true });
    await settleEventBudget(alice, budget.id);
    expect((await listBudgetNeedsAction(alice)).personal.some((n) => n.kind === "settle_budget")).toBe(false);
  });
});

describe("Money across the two scopes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("nets to zero across the community when an allocation and a settlement are both paired", async () => {
    const { alice, bob, dave, budget } = await readyEvent();
    const req = await requestEventAllocation(alice, budget.id);
    await approveBudgetProposal(dave, req.id);
    await recordEntry(alice, budget.id, income(500));
    await recordEntry(alice, budget.id, expense(600));
    await settleEventBudget(alice, budget.id);

    // The event started with 350 and 500 came in, 600 went out: 250 returns.
    expect(await fundBalance(bob)).toBe(1000 - 350 + 250);
    const moved = (await db.select().from(budgetEntry)).filter((e) => e.kind === "allocation" || e.kind === "settlement");
    expect(moved).toHaveLength(4);
    expect(moved.reduce((sum, e) => sum + e.amount, 0)).toBe(0);
  });
});
