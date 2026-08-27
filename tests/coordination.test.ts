import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch as branchTable, community, member, task, taskAssignment } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import {
  holdsTaskCoordinationSlot,
  isAuthorizedToWaive,
  isCoordinationHolder,
  listCoordinationBranchIds,
  requireCoordinationHolder,
} from "@/lib/coordination";
import { ForbiddenError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

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

  it("is true for a real holder of a task tagged with the community's coordinationTag", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
    });
    await claimTask(alice, t.id);

    expect(await isCoordinationHolder(alice, branch.id)).toBe(true);
  });

  it("respects a custom coordinationTag", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await db.update(community).set({ coordinationTag: "backstop" }).where(eq(community.id, testCommunity.id));
    const t = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"], // the old tag, no longer the configured one
    });
    await claimTask(alice, t.id);
    expect(await isCoordinationHolder(alice, branch.id)).toBe(false);

    const t2 = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["backstop"],
      title: "Backstop",
    });
    await claimTask(alice, t2.id);
    expect(await isCoordinationHolder(alice, branch.id)).toBe(true);
  });

  it("is false for a shadow of a coordination-tagged task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
      capacity: 2,
    });
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
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { tags: ["coordination"] });
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
      tags: ["coordination"],
      title: "Coordination",
    });
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

describe("listCoordinationBranchIds", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns every branch the actor currently coordinates, community-wide", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: testCommunity.id, name: "Wood" })
      .returning();

    const t1 = await insertTask(testCommunity.id, branch.id, alice.id, { tags: ["coordination"] });
    const t2 = await insertTask(testCommunity.id, otherBranch.id, alice.id, {
      tags: ["coordination"],
      title: "Wood coordination",
    });
    await claimTask(alice, t1.id);
    await claimTask(alice, t2.id);

    const branchIds = await listCoordinationBranchIds(alice);
    expect(branchIds).toEqual(new Set([branch.id, otherBranch.id]));
  });

  it("is empty for a member holding no coordination-tagged tasks", async () => {
    const { alice } = await createFixtures();
    expect((await listCoordinationBranchIds(alice)).size).toBe(0);
  });
});
