import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { budgetCycle, community, task, taskAssignment } from "@/db/schema";
import { closeCycle, createCycle } from "@/lib/cycles";
import { createBudgetCycle, getBudgetCycleForCycle, markBudgetCycleDone } from "@/lib/budget";
import { claimTask } from "@/lib/tasks";
import { grantPermission, createFixtures, resetDatabase } from "./helpers";
import { setPermissionGrant } from "@/lib/permissions";
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

// docs/plans/development-plan.md's Phase 65 — "any current Admin can close
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
    await expect(closeCycle(strangerAlice, cyc.id)).rejects.toThrow("Event not found");

    await closeCycle(alice, cyc.id);
    await expect(closeCycle(alice, cyc.id)).rejects.toThrow(ConflictError);
  });

  it("warns (and is overridable) when Budget is enabled and the owner hasn't marked this cycle's budget done", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    await db.update(community).set({ modulesEnabled: ["budget"] }).where(eq(community.id, testCommunity.id));
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const ownerTask = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cyc.id });
    await setPermissionGrant(alice, "budget", ownerTask.id);
    await claimTask(alice, ownerTask.id);
    // The event's budget was made with it, so there is always one to wrap up.
    const budgetCycleRow = (await getBudgetCycleForCycle(alice, cyc.id))!;

    await expect(closeCycle(alice, cyc.id)).rejects.toThrow(ConfirmationRequiredError);
    await expect(closeCycle(alice, cyc.id)).rejects.toThrow(/2027 Season Budget/);

    const closed = await closeCycle(alice, cyc.id, { overrideBudgetWarning: true });
    expect(closed.closedAt).not.toBeNull();

    // Once the owner's marked it done, no warning needed even without
    // an override.
    await db.update(budgetCycle).set({ status: "confirmed" }).where(eq(budgetCycle.id, budgetCycleRow.id));
    await markBudgetCycleDone(alice, budgetCycleRow.id);
    const cyc2 = await createCycle(alice, { source: "blank", name: "2028 Season" });
    const ownerTask2 = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cyc2.id });
    await setPermissionGrant(alice, "budget", ownerTask2.id);
    await claimTask(alice, ownerTask2.id);
    const budgetCycle2 = (await getBudgetCycleForCycle(alice, cyc2.id))!;
    await db.update(budgetCycle).set({ status: "confirmed" }).where(eq(budgetCycle.id, budgetCycle2.id));
    await markBudgetCycleDone(alice, budgetCycle2.id);
    await expect(closeCycle(alice, cyc2.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });
  });

  it("never warns when Budget is disabled, or the event has no budget of its own", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    // Budget disabled entirely.
    await expect(closeCycle(alice, cyc.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });

    // Budget enabled, but this event has none: it predates the module and
    // nobody has opened its Budget page, so there is nothing to wrap up. A
    // community's own budget (cycleId null) and another event's don't count.
    const { community: otherCommunity, alice: otherAlice } = await createFixtures();
    await enableCycles(otherCommunity.id);
    const otherCycle = await createCycle(otherAlice, { source: "blank", name: "Early cycle" });
    await db.update(community).set({ modulesEnabled: ["budget"] }).where(eq(community.id, otherCommunity.id));
    await createBudgetCycle(otherAlice, {
      title: "Community budget",
      proposalDeadline: inOneWeek(),
    });

    await expect(closeCycle(otherAlice, otherCycle.id)).resolves.toMatchObject({ closedAt: expect.any(Date) });
  });
});
