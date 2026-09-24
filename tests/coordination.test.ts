import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch as branchTable, community, member, task, taskAssignment } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { createCycle } from "@/lib/cycles";
import {
  holdsTaskCoordinationSlot,
  isAuthorizedToWaive,
  isCoordinationHolder,
  listCoordinationScopeIds,
  requireCoordinationHolder,
} from "@/lib/coordination";
import { ForbiddenError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

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
      title: "Branch coordination",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("isCoordinationHolder", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is false for anyone before they hold a coordination-tagged task", async () => {
    const { alice, branch } = await createFixtures();
    expect(await isCoordinationHolder(alice, branch.id)).toBe(false);
  });

  it("is true for a real holder of a task granted the branch_coordination module", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "branch_coordination", t.id);
    await claimTask(alice, t.id);

    expect(await isCoordinationHolder(alice, branch.id)).toBe(true);
  });

  it("is false for an ordinary task's own tags — granting is per-task now, not a tag match (Phase 63)", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
    });
    await claimTask(alice, t.id);

    expect(await isCoordinationHolder(alice, branch.id)).toBe(false);
  });

  it("is false for a shadow of a branch_coordination-granted task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await grantPermission(testCommunity.id, "branch_coordination", t.id);
    await claimTask(alice, t.id);
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: bob.id, isShadow: true });

    expect(await isCoordinationHolder(bob, branch.id)).toBe(false);
  });

  it("is scoped to the branch by default, but branchId=null checks community-wide", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: testCommunity.id, name: "Wood" })
      .returning();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "branch_coordination", t.id);
    await claimTask(alice, t.id);

    expect(await isCoordinationHolder(alice, otherBranch.id)).toBe(false);
    expect(await isCoordinationHolder(alice, null)).toBe(true);
  });

  it("requireCoordinationHolder throws ForbiddenError when not authorized", async () => {
    const { alice, branch } = await createFixtures();
    await expect(requireCoordinationHolder(alice, branch.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("holdsTaskCoordinationSlot / isAuthorizedToWaive", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is true only for the holder whose assignment carries is_coordination_slot", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await claimTask(alice, t.id);
    await claimTask(bob, t.id);
    await db
      .update(taskAssignment)
      .set({ isCoordinationSlot: true })
      .where(eq(taskAssignment.memberId, alice.id));

    expect(await holdsTaskCoordinationSlot(alice, t.id)).toBe(true);
    expect(await holdsTaskCoordinationSlot(bob, t.id)).toBe(false);
  });

  it("isAuthorizedToWaive is true via either branch coordination or the task's own coordination slot", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();

    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Ordinary task",
      capacity: 2,
    });
    await claimTask(bob, target.id);
    await db
      .update(taskAssignment)
      .set({ isCoordinationSlot: true })
      .where(eq(taskAssignment.memberId, bob.id));

    // alice: authorized via branch coordination, not via the target task's slot
    expect(await isAuthorizedToWaive(alice, branch.id, target.id)).toBe(true);
    // bob: authorized via the target task's own coordination slot, not branch coordination
    expect(await isAuthorizedToWaive(bob, branch.id, target.id)).toBe(true);
    // carol: neither
    expect(await isAuthorizedToWaive(carol, branch.id, target.id)).toBe(false);
  });
});

describe("listCoordinationScopeIds (§5.3)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns every branch the actor coordinates cycle-less — column semantics", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: testCommunity.id, name: "Wood" })
      .returning();

    const t1 = await insertTask(testCommunity.id, branch.id, alice.id);
    const t2 = await insertTask(testCommunity.id, otherBranch.id, alice.id, {
      title: "Wood coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", t1.id);
    await grantPermission(testCommunity.id, "branch_coordination", t2.id);
    await claimTask(alice, t1.id);
    await claimTask(alice, t2.id);

    const { branchIds, cycleIds } = await listCoordinationScopeIds(alice);
    expect(branchIds).toEqual(new Set([branch.id, otherBranch.id]));
    expect(cycleIds.size).toBe(0);
  });

  it("returns the actor's cycle row for a coordination task placed in a cycle", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, testCommunity.id));
    const cycleA = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    await grantPermission(testCommunity.id, "branch_coordination", t.id);
    await claimTask(alice, t.id);

    // Column semantics: a cycle-placed task never lights up its branch
    // column (cycle-less only, §2.1) — the cycle row is where it lands.
    const { branchIds, cycleIds } = await listCoordinationScopeIds(alice);
    expect(branchIds.size).toBe(0);
    expect(cycleIds).toEqual(new Set([cycleA.id]));
  });

  it("combines both dimensions across cycle-less and cycle-placed grants", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, testCommunity.id));
    const cycleA = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const cycleless = await insertTask(testCommunity.id, branch.id, alice.id);
    const cycleTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: cycleA.id,
    });
    await grantPermission(testCommunity.id, "branch_coordination", cycleless.id);
    await grantPermission(testCommunity.id, "branch_coordination", cycleTask.id);
    await claimTask(alice, cycleless.id);
    await claimTask(alice, cycleTask.id);

    const { branchIds, cycleIds } = await listCoordinationScopeIds(alice);
    expect(branchIds).toEqual(new Set([branch.id]));
    expect(cycleIds).toEqual(new Set([cycleA.id]));
  });

  it("is empty for a member holding no coordination-tagged tasks", async () => {
    const { alice } = await createFixtures();
    const { branchIds, cycleIds } = await listCoordinationScopeIds(alice);
    expect(branchIds.size).toBe(0);
    expect(cycleIds.size).toBe(0);
  });
});
