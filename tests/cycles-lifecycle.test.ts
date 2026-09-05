import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetCycle, community, task, taskAssignment } from "@/db/schema";
import { closeCycle, createCycle } from "@/lib/cycles";
import { createBudgetCycle, markBudgetCycleDone } from "@/lib/budget";
import { claimTask } from "@/lib/tasks";
import { grantPermission, createFixtures, resetDatabase } from "./helpers";
import { ConfirmationRequiredError, ConflictError, ForbiddenError } from "@/lib/errors";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

async function insertTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  overrides: Partial<typeof task.$inferInsert> = {},
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Budget owner",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

function inOneWeek() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

// docs/development-plan.md's Phase 65 — "any current Admin can close
// an open cycle... never hard-blocks: the Admin can close anyway."
describe("closeCycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is Admin-gated", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    // Latch a real Admins gate so bob genuinely isn't one — otherwise
    // the pre-latch "any member" fallback would let this test pass for
    // the wrong reason.
    const adminsTask = await insertTask(testCommunity.id, branch.id, alice.id, { openness: "community_endorsed" });
    await grantPermission(testCommunity.id, "admin", adminsTask.id);
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db.update(community).set({ adminsEverClaimed: true }).where(eq(community.id, testCommunity.id));

    await expect(closeCycle(bob, cyc.id)).rejects.toThrow(ForbiddenError);
    const closed = await closeCycle(alice, cyc.id);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedBy).toBe(alice.id);
  });

  it("rejects a cycle from another community, and rejects closing an already-closed one", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const { alice: strangerAlice } = await createFixtures();
    await expect(closeCycle(strangerAlice, cyc.id)).rejects.toThrow("Cycle not found");

    await closeCycle(alice, cyc.id);
    await expect(closeCycle(alice, cyc.id)).rejects.toThrow(ConflictError);
  });

  it("warns (and is overridable) when Budget is enabled and the owner hasn't marked this cycle's budget done", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    await db.update(community).set({ modulesEnabled: ["budget"] }).where(eq(community.id, testCommunity.id));
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const ownerTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, ownerTask.id);
    const budgetCycleRow = await createBudgetCycle(alice, {
      title: "Season budget",
      cycleId: cyc.id,
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });

    await expect(closeCycle(alice, cyc.id)).rejects.toThrow(ConfirmationRequiredError);
    await expect(closeCycle(alice, cyc.id)).rejects.toThrow(/Season budget/);

    const closed = await closeCycle(alice, cyc.id, { overrideBudgetWarning: true });
    expect(closed.closedAt).not.toBeNull();

    // Once the owner's marked it done, no warning needed even without
    // an override.
    await db.update(budgetCycle).set({ status: "confirmed" }).where(eq(budgetCycle.id, budgetCycleRow.id));
    await markBudgetCycleDone(alice, budgetCycleRow.id);
    const cyc2 = await createCycle(alice, { source: "blank", name: "2028 Season" });
    const ownerTask2 = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, ownerTask2.id);
    const budgetCycle2 = await createBudgetCycle(alice, {
      title: "Next season budget",
      cycleId: cyc2.id,
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask2.id,
    });
    await db.update(budgetCycle).set({ status: "confirmed" }).where(eq(budgetCycle.id, budgetCycle2.id));
    await markBudgetCycleDone(alice, budgetCycle2.id);
    await expect(closeCycle(alice, cyc2.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });
  });

  it("never warns when Budget is disabled, or no BudgetCycle is tied to this specific cycle", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    // Budget disabled entirely.
    await expect(closeCycle(alice, cyc.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });

    // Budget enabled, but its one active cycle isn't tied to *this*
    // real Cycle (cycleId null, or tied to a different one).
    const { community: otherCommunity, branch: otherBranch, alice: otherAlice } = await createFixtures();
    await enableCycles(otherCommunity.id);
    await db.update(community).set({ modulesEnabled: ["budget"] }).where(eq(community.id, otherCommunity.id));
    const otherCycle = await createCycle(otherAlice, { source: "blank", name: "Untied cycle" });
    const ownerTask = await insertTask(otherCommunity.id, otherBranch.id, otherAlice.id);
    await createBudgetCycle(otherAlice, {
      title: "Untied budget",
      proposalDeadline: inOneWeek(),
      ownerTaskId: ownerTask.id,
    });

    await expect(closeCycle(otherAlice, otherCycle.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });
  });
});
