import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, budgetCycle, cycle as cycleTable, member, task, taskAssignment } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { getCommunity, updateCommunity } from "@/lib/settings";
import {
  approveBudgetProposal,
  backingFor,
  declineBudgetProposal,
  ensureEventBudget,
  getBudgetCycleForCycle,
  getBudgetCycleForScope,
  getBudgetPledges,
  getBudgetProposal,
  getCurrentBudgetCycle,
  getEventPlan,
  isBudgetOwner,
  listActiveBudgetCycles,
  listBudgetProposalViews,
  markBudgetCycleDone,
  setBudgetPledge,
  setBudgetProposalSupport,
  submitBudgetProposal,
  updateBudgetCycle,
  updateBudgetProposal,
  withdrawBudgetProposal,
} from "@/lib/budget";
import { closeCycle, createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { removePermissionGrant, setModuleOpen, setPermissionGrant } from "@/lib/permissions";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { actorFor, createFixtures, resetDatabase } from "./helpers";

async function insertOwnerTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  cycleId: string | null = null,
) {
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

function inThePast() {
  return new Date(Date.now() - 1000);
}

function inOneWeek() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

// One event with its budget, Alice holding the event's budget grant, Bob and
// Carol as ordinary members.
async function setUpEvent() {
  const { alice, bob, branch: testBranch } = await createFixtures();
  await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
  const carol = await addMember(alice.communityId, "Carol");
  const event = await createCycle(alice, { source: "blank", name: "Reunion" });
  const budget = (await getBudgetCycleForCycle(alice, event.id))!;
  const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, event.id);
  await claimTask(alice, ownerTask.id);
  return { alice, bob, carol, branch: testBranch, event, budget };
}

// The community's own budget, Alice holding the community-wide budget grant.
async function setUpCommunityBudget() {
  const { alice, bob, branch: testBranch } = await createFixtures();
  await updateCommunity(alice, { modulesEnabled: ["budget"] });
  const carol = await addMember(alice.communityId, "Carol");
  const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, null);
  await claimTask(alice, ownerTask.id);
  return { alice, bob, carol, branch: testBranch };
}

const kettle = { title: "Kettle", lineItems: [{ label: "Kettle", amount: 30 }] };

describe("An event's budget is made with the event", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("exists as soon as the event does, titled after it and with no deadline", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Reunion" });

    const budget = await getBudgetCycleForCycle(alice, event.id);
    expect(budget?.title).toBe("Reunion Budget");
    expect(budget?.proposalDeadline).toBeNull();
    expect(budget?.status).toBe("proposals_open");
    expect(budget?.createdBy).toBe(alice.id);
  });

  it("gives two concurrent events a budget each", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const a = await createCycle(alice, { source: "blank", name: "Reunion" });
    const b = await createCycle(alice, { source: "blank", name: "Harvest", confirmed: true });

    const budgetA = await getBudgetCycleForCycle(alice, a.id);
    const budgetB = await getBudgetCycleForCycle(alice, b.id);
    expect(budgetA?.id).not.toBe(budgetB?.id);
    expect((await listActiveBudgetCycles(alice)).map((r) => r.id).sort()).toEqual([budgetA!.id, budgetB!.id].sort());
  });

  it("makes nothing while the module is off, and the first visit makes it once it is on", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Reunion" });
    expect(await getBudgetCycleForCycle(alice, event.id)).toBeNull();
    expect(await ensureEventBudget(alice, event.id)).toBeNull();

    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const made = await ensureEventBudget(alice, event.id);
    expect(made?.cycleId).toBe(event.id);
  });

  it("creates it exactly once however many first visits race", async () => {
    const { alice, bob } = await createFixtures();
    await updateCommunity(alice, { cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Reunion" });
    await updateCommunity(alice, { modulesEnabled: ["budget"] });

    const results = await Promise.all([
      ensureEventBudget(alice, event.id),
      ensureEventBudget(bob, event.id),
      ensureEventBudget(alice, event.id),
      ensureEventBudget(bob, event.id),
      ensureEventBudget(alice, event.id),
    ]);
    expect(new Set(results.map((r) => r!.id)).size).toBe(1);
    const rows = await db.select().from(budgetCycle).where(eq(budgetCycle.cycleId, event.id));
    expect(rows).toHaveLength(1);
  });

  it("does not backfill an event that was closed before it had a budget", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Reunion" });
    await db.update(cycleTable).set({ closedAt: new Date() }).where(eq(cycleTable.id, event.id));
    await updateCommunity(alice, { modulesEnabled: ["budget"] });

    expect(await ensureEventBudget(alice, event.id)).toBeNull();
  });

  it("refuses an event from another community", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Reunion" });
    const { alice: otherAlice } = await createFixtures();
    await updateCommunity(otherAlice, { modulesEnabled: ["budget"] });

    await expect(ensureEventBudget(otherAlice, event.id)).rejects.toThrow(NotFoundError);
  });

  it("holds an event to one unfinished budget in the database too", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Reunion" });

    await expect(
      db.insert(budgetCycle).values({
        communityId: alice.communityId,
        cycleId: event.id,
        title: "Racing duplicate",
        createdBy: alice.id,
      }),
    ).rejects.toThrow();
  });

  it("getCurrentBudgetCycle is null until one exists", async () => {
    const { alice } = await createFixtures();
    expect(await getCurrentBudgetCycle(alice)).toBeNull();
  });
});

describe("carrying fixed costs forward to a new event's budget", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("starts the first event's budget with no fixed costs", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const first = await createCycle(alice, { source: "blank", name: "First season" });

    expect((await getBudgetCycleForCycle(alice, first.id))?.fixedCosts).toEqual([]);
  });

  it("carries the previous event's fixed costs forward but never its owner authority", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const previousCycle = await createCycle(alice, { source: "blank", name: "Last season" });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, previousCycle.id);
    await claimTask(alice, ownerTask.id);
    const previous = (await getBudgetCycleForCycle(alice, previousCycle.id))!;
    await updateBudgetCycle(alice, previous.id, { fixedCosts: [{ label: "Site fee", amount: 2000 }] });
    expect(await isBudgetOwner(alice, previous)).toBe(true);

    // The previous event is still open, so starting another asks to be confirmed.
    const newCycle = await createCycle(alice, { source: "blank", name: "Next season", confirmed: true });
    const started = (await getBudgetCycleForCycle(alice, newCycle.id))!;
    expect(started.cycleId).toBe(newCycle.id);
    expect(started.title).toBe("Next season Budget");
    expect(started.fixedCosts).toEqual([{ label: "Site fee", amount: 2000 }]);
    expect(started.status).toBe("proposals_open");
    expect(await isBudgetOwner(alice, started)).toBe(false);
  });
});

describe("Finding a budget by scope", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("finds the budget tied to a specific event, ignoring other events'", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const a = await createCycle(alice, { source: "blank", name: "2027 Season", confirmed: true });
    const b = await createCycle(alice, { source: "blank", name: "2028 Season", confirmed: true });

    const found = await getBudgetCycleForCycle(alice, a.id);
    expect(found?.cycleId).toBe(a.id);
    expect((await getBudgetCycleForCycle(alice, b.id))?.id).not.toBe(found?.id);
    // The community's own budget is just its proposals: it has no row.
    expect(await getBudgetCycleForScope(alice, null)).toBeNull();
  });

  it("newest budget wins when an event has history as well", async () => {
    // An event has one budget now, but an earlier round for the same event can
    // exist as history, so the read path still has to pick the newest.
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const realCycle = await createCycle(alice, { source: "blank", name: "2027 Season" });
    const older = (await getBudgetCycleForCycle(alice, realCycle.id))!;
    await db.update(budgetCycle).set({ status: "confirmed" }).where(eq(budgetCycle.id, older.id));
    await new Promise((r) => setTimeout(r, 10));
    const [newer] = await db
      .insert(budgetCycle)
      .values({ communityId: alice.communityId, cycleId: realCycle.id, title: "Newer", createdBy: alice.id })
      .returning();

    expect((await getBudgetCycleForScope(alice, realCycle.id))?.id).toBe(newer.id);
  });
});

describe("Proposals in an event's budget", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("computes totalAmount from the line items and lists the proposal under its event", async () => {
    const { bob, event, budget } = await setUpEvent();
    const created = await submitBudgetProposal(bob, budget.id, {
      title: "Marquee hire",
      description: "Rain cover",
      lineItems: [
        { label: "Marquee", amount: 400 },
        { label: "Pegs", amount: 5, quantity: 10 },
      ],
    });
    expect(created.totalAmount).toBe(450);
    expect(created.status).toBe("open");
    expect(created.cycleId).toBe(event.id);
    expect(created.budgetCycleId).toBe(budget.id);

    const views = await listBudgetProposalViews(bob, event.id);
    expect(views.map((v) => v.proposal.id)).toEqual([created.id]);
  });

  it("refuses a proposal with no line items", async () => {
    const { bob, budget } = await setUpEvent();
    await expect(submitBudgetProposal(bob, budget.id, { title: "Nothing", lineItems: [] })).rejects.toThrow();
  });

  it("refuses a branch from another community", async () => {
    const { bob, budget } = await setUpEvent();
    const { branch: strangerBranch } = await createFixtures();
    await expect(submitBudgetProposal(bob, budget.id, { ...kettle, branchId: strangerBranch.id })).rejects.toThrow(NotFoundError);
  });

  it("stays open with no deadline, and stops new proposals after a set one passes", async () => {
    const { alice, bob, budget } = await setUpEvent();
    // No deadline: open.
    await submitBudgetProposal(bob, budget.id, kettle);

    await updateBudgetCycle(alice, budget.id, { proposalDeadline: inOneWeek().toISOString() });
    await submitBudgetProposal(bob, budget.id, kettle);

    await db.update(budgetCycle).set({ proposalDeadline: inThePast() }).where(eq(budgetCycle.id, budget.id));
    await expect(submitBudgetProposal(bob, budget.id, kettle)).rejects.toThrow(ConflictError);
  });

  it("lets a passed deadline still be backed and decided, since it stops only new proposals", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await db.update(budgetCycle).set({ proposalDeadline: inThePast() }).where(eq(budgetCycle.id, budget.id));

    await setBudgetProposalSupport(carol, p.id, true);
    expect((await approveBudgetProposal(alice, p.id)).status).toBe("approved");
  });

  it("refuses new proposals once the budget is marked done, and once the event is closed", async () => {
    const { alice, bob, budget } = await setUpEvent();
    await markBudgetCycleDone(alice, budget.id);
    await expect(submitBudgetProposal(bob, budget.id, kettle)).rejects.toThrow(ConflictError);

    const other = await createCycle(alice, { source: "blank", name: "Harvest", confirmed: true });
    const otherBudget = (await getBudgetCycleForCycle(alice, other.id))!;
    await closeCycle(alice, other.id, { overrideBudgetWarning: true });
    await expect(submitBudgetProposal(bob, otherBudget.id, kettle)).rejects.toThrow(ConflictError);
  });

  it("refuses while the module is off", async () => {
    const { alice, bob, budget } = await setUpEvent();
    await updateCommunity(alice, { modulesEnabled: [] });
    await expect(submitBudgetProposal(bob, budget.id, kettle)).rejects.toThrow(AppError);
  });

  it("refuses a legacy community round: the community's own budget has proposals, not rounds", async () => {
    const { alice, bob } = await setUpCommunityBudget();
    const [legacy] = await db
      .insert(budgetCycle)
      .values({ communityId: alice.communityId, title: "Old round", status: "confirmed", createdBy: alice.id })
      .returning();
    await expect(submitBudgetProposal(bob, legacy.id, kettle)).rejects.toThrow(ConflictError);
  });
});

describe("Proposals in the community's own budget", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("are made without any round, and belong to no event", async () => {
    const { bob } = await setUpCommunityBudget();
    const created = await submitBudgetProposal(bob, null, kettle);
    expect(created.cycleId).toBeNull();
    expect(created.budgetCycleId).toBeNull();
    expect(created.totalAmount).toBe(30);

    expect((await listBudgetProposalViews(bob, null)).map((v) => v.proposal.id)).toEqual([created.id]);
  });

  it("keep events' proposals out of the list, and the reverse", async () => {
    const { alice, bob, event, budget } = await setUpEvent();
    const inEvent = await submitBudgetProposal(bob, budget.id, kettle);
    const inCommunity = await submitBudgetProposal(bob, null, { ...kettle, title: "Community kettle" });

    expect((await listBudgetProposalViews(alice, event.id)).map((v) => v.proposal.id)).toEqual([inEvent.id]);
    expect((await listBudgetProposalViews(alice, null)).map((v) => v.proposal.id)).toEqual([inCommunity.id]);
  });

  it("refuse a per-attendee item, which would silently count as nothing", async () => {
    const { bob } = await setUpCommunityBudget();
    await expect(
      submitBudgetProposal(bob, null, { title: "Meals", lineItems: [{ label: "Meal", amount: 10, perAttendee: true }] }),
    ).rejects.toThrow(AppError);
  });

  it("refuse the module being off", async () => {
    const { alice, bob } = await setUpCommunityBudget();
    await updateCommunity(alice, { modulesEnabled: [] });
    await expect(submitBudgetProposal(bob, null, kettle)).rejects.toThrow(AppError);
  });
});

describe("Editing and withdrawing a proposal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets the submitter edit, recomputing the total", async () => {
    const { bob, budget } = await setUpEvent();
    const created = await submitBudgetProposal(bob, budget.id, kettle);
    const updated = await updateBudgetProposal(bob, created.id, {
      title: "Two kettles",
      lineItems: [{ label: "Kettle", amount: 30, quantity: 2 }],
    });
    expect(updated.title).toBe("Two kettles");
    expect(updated.totalAmount).toBe(60);
  });

  it("refuses an edit from anyone but the submitter, the owner included", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    const created = await submitBudgetProposal(bob, budget.id, kettle);
    await expect(updateBudgetProposal(carol, created.id, { title: "Hijack" })).rejects.toThrow(ForbiddenError);
    await expect(updateBudgetProposal(alice, created.id, { title: "Hijack" })).rejects.toThrow(ForbiddenError);
  });

  it("refuses an edit once the proposal is decided", async () => {
    const { alice, bob, budget } = await setUpEvent();
    const created = await submitBudgetProposal(bob, budget.id, kettle);
    await approveBudgetProposal(alice, created.id);
    await expect(updateBudgetProposal(bob, created.id, { title: "Too late" })).rejects.toThrow(ConflictError);
  });

  it("refuses to fetch or change a proposal from another community", async () => {
    const { bob, budget } = await setUpEvent();
    const created = await submitBudgetProposal(bob, budget.id, kettle);
    const { alice: stranger } = await createFixtures();
    await expect(getBudgetProposal(stranger, created.id)).rejects.toThrow(NotFoundError);
    await expect(approveBudgetProposal(stranger, created.id)).rejects.toThrow(NotFoundError);
  });

  it("lets the submitter withdraw while it is open, and nobody else", async () => {
    const { alice, bob, budget } = await setUpEvent();
    const created = await submitBudgetProposal(bob, budget.id, kettle);
    await expect(withdrawBudgetProposal(alice, created.id)).rejects.toThrow(ForbiddenError);

    expect((await withdrawBudgetProposal(bob, created.id)).status).toBe("withdrawn");
    await expect(withdrawBudgetProposal(bob, created.id)).rejects.toThrow(ConflictError);
    await expect(approveBudgetProposal(alice, created.id)).rejects.toThrow(ConflictError);
  });
});

describe("Backing", () => {
  it("counts the proposer as the first backer, and caps what can be approved at backers times the amount", () => {
    expect(backingFor({ totalAmount: 5 }, 0, 30)).toEqual({ backers: 1, perBacker: 30, backedUpTo: 30, approvable: 5 });
    // 90 asked: the proposer and two supporters cover it in full…
    expect(backingFor({ totalAmount: 90 }, 2, 30)).toMatchObject({ backers: 3, backedUpTo: 90, approvable: 90 });
    // …and with only one supporter it is backed for 60.
    expect(backingFor({ totalAmount: 90 }, 1, 30)).toMatchObject({ backers: 2, backedUpTo: 60, approvable: 60 });
  });

  it("asks for nothing when the setting is unset or zero", () => {
    expect(backingFor({ totalAmount: 500 }, 0, null)).toEqual({ backers: 1, perBacker: null, backedUpTo: null, approvable: 500 });
    expect(backingFor({ totalAmount: 500 }, 0, 0)).toMatchObject({ backedUpTo: null, approvable: 500 });
    expect(backingFor({ totalAmount: 500 }, 0, undefined)).toMatchObject({ backedUpTo: null, approvable: 500 });
  });
});

describe("Supporting a proposal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is one per member, and withdrawable", async () => {
    const { bob, carol, event, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);

    expect(await setBudgetProposalSupport(carol, p.id, true)).toBe(true);
    // Doing it twice is still one.
    await setBudgetProposalSupport(carol, p.id, true);
    expect((await listBudgetProposalViews(carol, event.id))[0]).toMatchObject({ supporterCount: 1, iSupport: true });

    expect(await setBudgetProposalSupport(carol, p.id, false)).toBe(false);
    expect((await listBudgetProposalViews(carol, event.id))[0]).toMatchObject({ supporterCount: 0, iSupport: false });
  });

  it("refuses the proposer backing their own, who is already behind it", async () => {
    const { bob, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await expect(setBudgetProposalSupport(bob, p.id, true)).rejects.toThrow(AppError);
  });

  it("is refused once the proposal is decided or withdrawn", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    const decided = await submitBudgetProposal(bob, budget.id, kettle);
    await approveBudgetProposal(alice, decided.id);
    await expect(setBudgetProposalSupport(carol, decided.id, true)).rejects.toThrow(ConflictError);

    const withdrawn = await submitBudgetProposal(bob, budget.id, kettle);
    await withdrawBudgetProposal(bob, withdrawn.id);
    await expect(setBudgetProposalSupport(carol, withdrawn.id, true)).rejects.toThrow(ConflictError);
  });

  it("is refused in a finished budget", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await markBudgetCycleDone(alice, budget.id);
    await expect(setBudgetProposalSupport(carol, p.id, true)).rejects.toThrow(ConflictError);
  });

  it("works in the community's own budget too", async () => {
    const { bob, carol } = await setUpCommunityBudget();
    const p = await submitBudgetProposal(bob, null, kettle);
    await setBudgetProposalSupport(carol, p.id, true);
    expect((await listBudgetProposalViews(carol, null))[0].supporterCount).toBe(1);
  });
});

describe("Who is behind a proposal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is counted for everyone, and named only to the proposer and the budget's owner", async () => {
    const { alice, bob, carol, event, budget } = await setUpEvent();
    const dave = await addMember(alice.communityId, "Dave");
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await setBudgetProposalSupport(carol, p.id, true);

    const seenBy = async (who: typeof alice) => (await listBudgetProposalViews(who, event.id))[0];
    expect(await seenBy(dave)).toMatchObject({ supporterCount: 1, supporters: null });
    // Not even another supporter sees who else is behind it.
    expect(await seenBy(carol)).toMatchObject({ supporterCount: 1, supporters: null });
    expect((await seenBy(bob)).supporters).toEqual(["Carol"]);
    expect((await seenBy(alice)).supporters).toEqual(["Carol"]);
  });
});

describe("Deciding a proposal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is the budget's owner's alone", async () => {
    const { bob, carol, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await expect(approveBudgetProposal(carol, p.id)).rejects.toThrow(ForbiddenError);
    await expect(approveBudgetProposal(bob, p.id)).rejects.toThrow(ForbiddenError);
    await expect(declineBudgetProposal(carol, p.id, { note: "No" })).rejects.toThrow(ForbiddenError);
  });

  it("needs the grant for that scope: an event's holder does not decide the community's", async () => {
    const { alice, bob } = await setUpEvent();
    const p = await submitBudgetProposal(bob, null, kettle);
    await expect(approveBudgetProposal(alice, p.id)).rejects.toThrow(ForbiddenError);
  });

  it("approves for everything asked when no backing is required", async () => {
    const { alice, bob, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, { title: "Marquee", lineItems: [{ label: "Marquee", amount: 400 }] });
    const approved = await approveBudgetProposal(alice, p.id, { note: "Go ahead" });
    expect(approved).toMatchObject({ status: "approved", approvedAmount: 400, decisionNote: "Go ahead", decidedBy: alice.id });
    expect(approved.decidedAt).not.toBeNull();
  });

  it("approves for less than was asked when the owner says so", async () => {
    const { alice, bob, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, { title: "Marquee", lineItems: [{ label: "Marquee", amount: 400 }] });
    expect((await approveBudgetProposal(alice, p.id, { amount: 250 })).approvedAmount).toBe(250);
  });

  it("refuses more than was asked, and a proposal already decided", async () => {
    const { alice, bob, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await expect(approveBudgetProposal(alice, p.id, { amount: 31 })).rejects.toThrow(AppError);
    await approveBudgetProposal(alice, p.id);
    await expect(approveBudgetProposal(alice, p.id)).rejects.toThrow(ConflictError);
    await expect(declineBudgetProposal(alice, p.id, { note: "Changed my mind" })).rejects.toThrow(ConflictError);
  });

  it("needs a note to decline, and keeps it", async () => {
    const { alice, bob, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await expect(declineBudgetProposal(alice, p.id, { note: "   " })).rejects.toThrow(AppError);

    const declined = await declineBudgetProposal(alice, p.id, { note: "We already own one" });
    expect(declined).toMatchObject({ status: "declined", decisionNote: "We already own one", approvedAmount: null });
  });

  it("is refused in a finished budget", async () => {
    const { alice, bob, budget } = await setUpEvent();
    const p = await submitBudgetProposal(bob, budget.id, kettle);
    await markBudgetCycleDone(alice, budget.id);
    await expect(approveBudgetProposal(alice, p.id)).rejects.toThrow(ConflictError);
  });

  it("is held to what the backers cover, on a direct call as well as on the page", async () => {
    const { alice, bob, carol, event, budget } = await setUpEvent();
    await updateCommunity(alice, { fundSupportPerBacker: 30 });
    const dave = await addMember(alice.communityId, "Dave");
    const p = await submitBudgetProposal(bob, budget.id, { title: "Tent", lineItems: [{ label: "Tent", amount: 90 }] });

    // Only the proposer is behind it: 30 is backed, so 31 is refused.
    expect((await listBudgetProposalViews(alice, event.id))[0].backing).toMatchObject({ backers: 1, backedUpTo: 30, approvable: 30 });
    await expect(approveBudgetProposal(alice, p.id, { amount: 31 })).rejects.toThrow(/backed/);
    // A second backer lifts it to 60, but not to the full 90.
    await setBudgetProposalSupport(carol, p.id, true);
    expect((await listBudgetProposalViews(alice, event.id))[0].backing.approvable).toBe(60);
    await expect(approveBudgetProposal(alice, p.id, { amount: 90 })).rejects.toThrow(AppError);

    // A third backer covers it in full, and approving with no amount means everything backed.
    await setBudgetProposalSupport(carol, p.id, false);
    await setBudgetProposalSupport(carol, p.id, true);
    await setBudgetProposalSupport(dave, p.id, true);
    expect((await approveBudgetProposal(alice, p.id)).approvedAmount).toBe(90);
  });

  it("defaults to what is backed, not to everything, when no amount is given", async () => {
    const { alice, bob, budget } = await setUpEvent();
    await updateCommunity(alice, { fundSupportPerBacker: 30 });
    const p = await submitBudgetProposal(bob, budget.id, { title: "Tent", lineItems: [{ label: "Tent", amount: 90 }] });
    expect((await approveBudgetProposal(alice, p.id)).approvedAmount).toBe(30);
  });

  it("goes straight to the owner when the proposer alone covers it", async () => {
    const { alice, bob, budget } = await setUpEvent();
    await updateCommunity(alice, { fundSupportPerBacker: 30 });
    const p = await submitBudgetProposal(bob, budget.id, { title: "Cable ties", lineItems: [{ label: "Ties", amount: 5 }] });
    expect((await approveBudgetProposal(alice, p.id)).approvedAmount).toBe(5);
  });

  it("can approve the backed part of a bigger ask", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    await updateCommunity(alice, { fundSupportPerBacker: 30 });
    const p = await submitBudgetProposal(bob, budget.id, { title: "Tent", lineItems: [{ label: "Tent", amount: 90 }] });
    await setBudgetProposalSupport(carol, p.id, true);
    expect((await approveBudgetProposal(alice, p.id)).approvedAmount).toBe(60);
  });

  it("asks for no backing at all when the setting is cleared", async () => {
    const { alice, bob, budget } = await setUpEvent();
    await updateCommunity(alice, { fundSupportPerBacker: 30 });
    await updateCommunity(alice, { fundSupportPerBacker: null });
    const p = await submitBudgetProposal(bob, budget.id, { title: "Tent", lineItems: [{ label: "Tent", amount: 900 }] });
    expect((await approveBudgetProposal(alice, p.id)).approvedAmount).toBe(900);
  });

  it("stores a setting of 0 as unset", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { fundSupportPerBacker: 40 });
    expect((await getCommunity(alice)).fundSupportPerBacker).toBe(40);
    await updateCommunity(alice, { fundSupportPerBacker: 0 });
    expect((await getCommunity(alice)).fundSupportPerBacker).toBeNull();
  });

  it("works the same way in the community's own budget", async () => {
    const { alice, bob, carol } = await setUpCommunityBudget();
    await updateCommunity(alice, { fundSupportPerBacker: 30 });
    const p = await submitBudgetProposal(bob, null, { title: "Marquee", lineItems: [{ label: "Marquee", amount: 60 }] });
    await expect(approveBudgetProposal(alice, p.id, { amount: 60 })).rejects.toThrow(AppError);
    await setBudgetProposalSupport(carol, p.id, true);
    expect((await approveBudgetProposal(alice, p.id)).approvedAmount).toBe(60);
  });
});

describe("An event's plan", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is its fixed costs plus what has been approved, at the amount approved", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Site fee", amount: 1000 }] });
    const marquee = await submitBudgetProposal(bob, budget.id, { title: "Marquee", lineItems: [{ label: "Marquee", amount: 400 }] });
    const tent = await submitBudgetProposal(bob, budget.id, { title: "Tent", lineItems: [{ label: "Tent", amount: 100 }] });
    await submitBudgetProposal(carol, budget.id, { title: "Lights", lineItems: [{ label: "Lights", amount: 50 }] });
    await submitBudgetProposal(carol, budget.id, { title: "Dropped", lineItems: [{ label: "X", amount: 70 }] });

    await approveBudgetProposal(alice, marquee.id, { amount: 300 });
    await declineBudgetProposal(alice, tent.id, { note: "Marquee covers it" });

    expect(await getEventPlan(alice, budget.id)).toMatchObject({
      fixedTotal: 1000,
      approvedTotal: 300,
      planTotal: 1300,
      pendingCount: 2,
      pendingTotal: 120,
    });
  });

  it("spreads over the people coming, or every member when nobody has said", async () => {
    const { alice, bob, event, budget } = await setUpEvent();
    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Site fee", amount: 900 }] });

    // Three members, nobody has declared: spread over all of them.
    expect(await getEventPlan(alice, budget.id)).toMatchObject({ contributorCount: 3, perMember: 300 });

    await declareParticipation(alice, event.id, { status: "coming" });
    await declareParticipation(bob, event.id, { status: "coming" });
    expect(await getEventPlan(alice, budget.id)).toMatchObject({ attendeeCount: 2, contributorCount: 2, perMember: 450 });
  });

  it("rounds the figure per member up", async () => {
    const { alice, budget } = await setUpEvent();
    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Site fee", amount: 100 }] });
    expect((await getEventPlan(alice, budget.id)).perMember).toBe(34);
  });

  it("scales a per-attendee fixed cost off the people coming, live", async () => {
    const { alice, bob, event, budget } = await setUpEvent();
    await declareParticipation(alice, event.id, { status: "coming" });
    const created = await submitBudgetProposal(bob, budget.id, {
      title: "Catering",
      lineItems: [{ label: "Meal", amount: 10, perAttendee: true }],
    });
    // Only Alice has declared "coming" so far.
    expect(created.totalAmount).toBe(10);

    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Meals", amount: 10, perAttendee: true }] });
    await declareParticipation(bob, event.id, { status: "coming" });
    expect((await getEventPlan(alice, budget.id)).fixedTotal).toBe(20);
  });

  it("belongs to an event's budget", async () => {
    const { alice } = await setUpCommunityBudget();
    const [legacy] = await db
      .insert(budgetCycle)
      .values({ communityId: alice.communityId, title: "Old round", status: "confirmed", createdBy: alice.id })
      .returning();
    await expect(getEventPlan(alice, legacy.id)).rejects.toThrow(AppError);
  });
});

describe("Pledges", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("are one replaceable figure per member, 0 included, and can be withdrawn", async () => {
    const { bob, budget } = await setUpEvent();
    await setBudgetPledge(bob, budget.id, { amount: 40 });
    await setBudgetPledge(bob, budget.id, { amount: 25 });
    expect(await getBudgetPledges(bob, budget.id)).toMatchObject({ total: 25, count: 1, mine: 25 });

    await setBudgetPledge(bob, budget.id, { amount: 0 });
    expect(await getBudgetPledges(bob, budget.id)).toMatchObject({ total: 0, count: 1, mine: 0 });

    await setBudgetPledge(bob, budget.id, { amount: null });
    expect(await getBudgetPledges(bob, budget.id)).toMatchObject({ total: 0, count: 0, mine: null });
  });

  it("show everyone the total, and only the owner and the member their own amounts", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    const dave = await addMember(alice.communityId, "Dave");
    await setBudgetPledge(bob, budget.id, { amount: 40 });
    await setBudgetPledge(carol, budget.id, { amount: 10 });

    expect(await getBudgetPledges(dave, budget.id)).toMatchObject({ total: 50, count: 2, mine: null, entries: null });
    expect(await getBudgetPledges(bob, budget.id)).toMatchObject({ total: 50, mine: 40, entries: null });
    expect((await getBudgetPledges(alice, budget.id)).entries).toEqual([
      { memberId: bob.id, name: "Bob", amount: 40 },
      { memberId: carol.id, name: "Carol", amount: 10 },
    ]);
  });

  it("never show amounts to a member just because the module is open to everyone", async () => {
    const { alice, bob, carol, budget } = await setUpEvent();
    await setBudgetPledge(bob, budget.id, { amount: 40 });
    await setModuleOpen(alice, "budget", true);

    expect(await isBudgetOwner(carol, budget)).toBe(true);
    expect((await getBudgetPledges(carol, budget.id)).entries).toBeNull();
  });

  it("refuse a negative figure, and a finished budget", async () => {
    const { alice, bob, budget } = await setUpEvent();
    await expect(setBudgetPledge(bob, budget.id, { amount: -5 })).rejects.toThrow();
    await markBudgetCycleDone(alice, budget.id);
    await expect(setBudgetPledge(bob, budget.id, { amount: 10 })).rejects.toThrow(ConflictError);
  });
});

describe("Budget owner authority", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("requires the granted task's current non-shadow holder", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Season" });
    const budget = (await getBudgetCycleForCycle(alice, event.id))!;
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, event.id);

    expect(await isBudgetOwner(alice, budget)).toBe(false);
    await claimTask(alice, ownerTask.id);
    expect(await isBudgetOwner(alice, budget)).toBe(true);

    // A shadow assignment is learning/observing the task, not holding
    // the authority that comes with it.
    await db.insert(taskAssignment).values({ taskId: ownerTask.id, memberId: bob.id, isShadow: true });
    expect(await isBudgetOwner(bob, budget)).toBe(false);
  });

  it("matches a community-wide grant only to the community's own scope", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
    await claimTask(alice, ownerTask.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "Season A", confirmed: true });
    const budgetA = (await getBudgetCycleForCycle(alice, cycleA.id))!;

    expect(await isBudgetOwner(alice, { cycleId: null })).toBe(true);
    expect(await isBudgetOwner(alice, budgetA)).toBe(false);
  });

  it("replaces one grant only within the same exact scope", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const cycleA = await createCycle(alice, { source: "blank", name: "Season A", confirmed: true });
    const cycleB = await createCycle(alice, { source: "blank", name: "Season B", confirmed: true });

    const oldOwner = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, cycleA.id);
    await claimTask(alice, oldOwner.id);
    const newOwner = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, cycleA.id);
    const otherScopeOwner = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, cycleB.id);
    await claimTask(alice, otherScopeOwner.id);

    const budgetA = (await getBudgetCycleForCycle(alice, cycleA.id))!;
    const budgetB = (await getBudgetCycleForCycle(alice, cycleB.id))!;
    expect(await isBudgetOwner(alice, budgetA)).toBe(false);
    expect(await isBudgetOwner(alice, budgetB)).toBe(true);

    await claimTask(alice, newOwner.id);
    expect(await isBudgetOwner(alice, budgetA)).toBe(true);
    expect(await isBudgetOwner(alice, budgetB)).toBe(true);
  });

  it("revokes authority when its grant is cleared", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"], cyclesEnabled: true });
    const event = await createCycle(alice, { source: "blank", name: "Season" });
    const budget = (await getBudgetCycleForCycle(alice, event.id))!;
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id, event.id);
    await claimTask(alice, ownerTask.id);
    expect(await isBudgetOwner(alice, budget)).toBe(true);

    await removePermissionGrant(alice, "budget", ownerTask.id);
    expect(await isBudgetOwner(alice, budget)).toBe(false);
  });
});

describe("Marking a budget done", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is the owner's alone", async () => {
    const { bob, budget } = await setUpEvent();
    await expect(markBudgetCycleDone(bob, budget.id)).rejects.toThrow(ForbiddenError);
  });

  it("needs no vote first, and finishes the budget", async () => {
    const { alice, budget } = await setUpEvent();
    const done = await markBudgetCycleDone(alice, budget.id);
    expect(done.ownerMarkedDoneAt).not.toBeNull();
    expect(done.status).toBe("confirmed");
    expect(await listActiveBudgetCycles(alice)).toEqual([]);
  });

  it("cannot be done twice", async () => {
    const { alice, budget } = await setUpEvent();
    await markBudgetCycleDone(alice, budget.id);
    await expect(markBudgetCycleDone(alice, budget.id)).rejects.toThrow(ConflictError);
  });

  it("can still be done for a budget confirmed under the old rules", async () => {
    const { alice, budget } = await setUpEvent();
    await db.update(budgetCycle).set({ status: "confirmed" }).where(eq(budgetCycle.id, budget.id));
    expect((await markBudgetCycleDone(alice, budget.id)).ownerMarkedDoneAt).not.toBeNull();
  });
});

describe("Editing a budget's details", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is the owner's, and only while the budget is open", async () => {
    const { alice, bob, budget } = await setUpEvent();
    await expect(updateBudgetCycle(bob, budget.id, { title: "Hijacked" })).rejects.toThrow(ForbiddenError);

    await markBudgetCycleDone(alice, budget.id);
    await expect(updateBudgetCycle(alice, budget.id, { title: "Too late" })).rejects.toThrow(ConflictError);
  });

  it("only touches fields actually sent, leaving the rest as-is", async () => {
    const { alice, budget } = await setUpEvent();
    await updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "Site fee", amount: 100 }] });

    const renamed = await updateBudgetCycle(alice, budget.id, { title: "Renamed budget" });
    expect(renamed.title).toBe("Renamed budget");
    expect(renamed.fixedCosts).toEqual([{ label: "Site fee", amount: 100 }]);

    const newDeadline = inOneWeek().toISOString();
    const dated = await updateBudgetCycle(alice, budget.id, { proposalDeadline: newDeadline });
    expect(dated.title).toBe("Renamed budget");
    expect(new Date(dated.proposalDeadline!).toISOString()).toBe(newDeadline);
  });

  it("clears the deadline when sent null, and leaves it alone when not sent", async () => {
    const { alice, budget } = await setUpEvent();
    await updateBudgetCycle(alice, budget.id, { proposalDeadline: inOneWeek().toISOString() });
    expect((await updateBudgetCycle(alice, budget.id, { title: "Still dated" })).proposalDeadline).not.toBeNull();
    expect((await updateBudgetCycle(alice, budget.id, { proposalDeadline: null })).proposalDeadline).toBeNull();
  });

  it("refuses a fixed cost naming a branch from another community", async () => {
    const { alice, budget } = await setUpEvent();
    const { branch: strangerBranch } = await createFixtures();
    await expect(
      updateBudgetCycle(alice, budget.id, { fixedCosts: [{ label: "X", amount: 10, branchId: strangerBranch.id }] }),
    ).rejects.toThrow(AppError);
  });
});

describe("Line items", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("multiplies the amount by a fixed quantity", async () => {
    const { bob, budget } = await setUpEvent();
    const created = await submitBudgetProposal(bob, budget.id, {
      title: "Tables",
      lineItems: [{ label: "Table", amount: 50, quantity: 8 }],
    });
    expect(created.totalAmount).toBe(400);
  });

  it("refuses an item that is both a fixed quantity and per-attendee", async () => {
    const { bob, budget } = await setUpEvent();
    await expect(
      submitBudgetProposal(bob, budget.id, {
        title: "Bad item",
        lineItems: [{ label: "X", amount: 10, quantity: 3, perAttendee: true }],
      }),
    ).rejects.toThrow();
  });

  it("stores a per-item branch, independent of the proposal's own", async () => {
    const { alice, bob, branch: fruit, budget } = await setUpEvent();
    const [veg] = await db.insert(branch).values({ communityId: alice.communityId, name: "Vegetables" }).returning();

    const created = await submitBudgetProposal(bob, budget.id, {
      title: "Shared gear",
      branchId: fruit.id,
      lineItems: [
        { label: "Shared tent", amount: 100 },
        { label: "Veg-only tools", amount: 40, branchId: veg.id },
      ],
    });
    expect((created.lineItems as { branchId?: string }[])[0].branchId).toBeUndefined();
    expect((created.lineItems as { branchId?: string }[])[1].branchId).toBe(veg.id);
  });

  it("refuses an item naming a branch from another community", async () => {
    const { bob, budget } = await setUpEvent();
    const { branch: strangerBranch } = await createFixtures();
    await expect(
      submitBudgetProposal(bob, budget.id, { title: "Bad", lineItems: [{ label: "X", amount: 10, branchId: strangerBranch.id }] }),
    ).rejects.toThrow(AppError);
  });
});
