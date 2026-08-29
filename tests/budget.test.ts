import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetCycle, task } from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import {
  createBudgetCycle,
  getBudgetCycle,
  getBudgetProposal,
  getCurrentBudgetCycle,
  listBudgetProposals,
  submitBudgetProposal,
  updateBudgetProposal,
} from "@/lib/budget";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function insertOwnerTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Budget owner",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
    })
    .returning();
  return row;
}

function inOneWeek() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function inThePast() {
  return new Date(Date.now() - 1000).toISOString();
}

describe("BudgetCycle creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects while the module is off", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
    await expect(
      createBudgetCycle(alice, {
        title: "Season budget",
        proposalDeadline: inOneWeek(),
        ownerTaskId: ownerTask.id,
      }),
    ).rejects.toThrow(AppError);
  });

  it("creates a cycle with fixed costs once the module is on", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);

    const created = await createBudgetCycle(alice, {
      title: "Season budget",
      fixedCosts: [{ label: "Site fee", amount: 2000 }],
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });
    expect(created.title).toBe("Season budget");
    expect(created.status).toBe("proposals_open");
    expect(created.fixedCosts).toEqual([{ label: "Site fee", amount: 2000 }]);

    const current = await getCurrentBudgetCycle(alice);
    expect(current?.id).toBe(created.id);
  });

  it("rejects an owner task from another community", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const { alice: strangerAlice, branch: strangerBranch } = await createFixtures();
    const strangerTask = await insertOwnerTask(strangerAlice.communityId, strangerBranch.id, strangerAlice.id);

    await expect(
      createBudgetCycle(alice, {
        title: "Season budget",
        proposalDeadline: inOneWeek(),
        ownerTaskId: strangerTask.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects starting a second cycle while one is still active", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);

    await createBudgetCycle(alice, {
      title: "First",
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });

    await expect(
      createBudgetCycle(alice, {
        title: "Second",
        proposalDeadline: inOneWeek(),
        ownerTaskId: ownerTask.id,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("getCurrentBudgetCycle is null until one exists", async () => {
    const { alice } = await createFixtures();
    expect(await getCurrentBudgetCycle(alice)).toBeNull();
  });
});

describe("BudgetProposal submission", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpOpenCycle() {
    const fixtures = await createFixtures();
    const { alice, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
    const cycle = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });
    return { ...fixtures, cycle };
  }

  it("computes totalAmount from lineItems and lists it", async () => {
    const { bob, cycle } = await setUpOpenCycle();

    const created = await submitBudgetProposal(bob, cycle.id, {
      title: "Portable toilets",
      lineItems: [
        { label: "Units", amount: 450 },
        { label: "Servicing", amount: 100 },
      ],
    });
    expect(created.totalAmount).toBe(550);
    expect(created.submittedBy).toBe(bob.id);

    const proposals = await listBudgetProposals(bob, cycle.id);
    expect(proposals.map((p) => p.id)).toEqual([created.id]);
  });

  it("tags a proposal to a branch, validated against the actor's community", async () => {
    const { bob, cycle, branch: testBranch } = await setUpOpenCycle();
    const created = await submitBudgetProposal(bob, cycle.id, {
      title: "Signage",
      lineItems: [{ label: "Boards", amount: 120 }],
      branchId: testBranch.id,
    });
    expect(created.branchId).toBe(testBranch.id);

    const { alice: strangerAlice } = await createFixtures();
    await expect(
      submitBudgetProposal(strangerAlice, cycle.id, {
        title: "Foreign branch",
        lineItems: [{ label: "X", amount: 1 }],
        branchId: testBranch.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects once the proposal deadline has passed", async () => {
    const fixtures = await createFixtures();
    const { alice, bob, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
    const cycle = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });
    // Backdate the deadline directly — createBudgetCycle itself won't
    // accept a past deadline as input, but a cycle can age past its own
    // deadline in the ordinary course of things.
    await db
      .update(budgetCycle)
      .set({ proposalDeadline: new Date(inThePast()) })
      .where(eq(budgetCycle.id, cycle.id));

    await expect(
      submitBudgetProposal(bob, cycle.id, {
        title: "Too late",
        lineItems: [{ label: "X", amount: 1 }],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a proposal with no line items", async () => {
    const { bob, cycle } = await setUpOpenCycle();
    await expect(
      submitBudgetProposal(bob, cycle.id, { title: "Empty", lineItems: [] }),
    ).rejects.toThrow();
  });
});

describe("BudgetProposal editing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets the submitter edit and recomputes totalAmount", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
    const cycle = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });
    const proposal = await submitBudgetProposal(bob, cycle.id, {
      title: "Original",
      lineItems: [{ label: "X", amount: 100 }],
    });

    const updated = await updateBudgetProposal(bob, proposal.id, {
      title: "Renamed",
      lineItems: [{ label: "X", amount: 100 }, { label: "Y", amount: 50 }],
    });
    expect(updated.title).toBe("Renamed");
    expect(updated.totalAmount).toBe(150);
  });

  it("rejects an edit from anyone but the submitter", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
    const cycle = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });
    const proposal = await submitBudgetProposal(bob, cycle.id, {
      title: "Original",
      lineItems: [{ label: "X", amount: 100 }],
    });

    await expect(
      updateBudgetProposal(alice, proposal.id, { title: "Hijacked" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects fetching or editing a proposal from another community", async () => {
    const { alice, bob, branch: testBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, testBranch.id, alice.id);
    const cycle = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });
    const proposal = await submitBudgetProposal(bob, cycle.id, {
      title: "Original",
      lineItems: [{ label: "X", amount: 100 }],
    });

    const { alice: strangerAlice } = await createFixtures();
    await expect(getBudgetProposal(strangerAlice, proposal.id)).rejects.toThrow(NotFoundError);
    await expect(getBudgetCycle(strangerAlice, cycle.id)).rejects.toThrow(NotFoundError);
  });
});
