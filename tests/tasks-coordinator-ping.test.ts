import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { claimTask, listMyPings, listPings, pingCoordinator, resolvePing } from "@/lib/tasks";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
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
      title: "Water the trees",
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("pingCoordinator", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a current holder ping their coordinator, naming the requester", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, t.id);

    const created = await pingCoordinator(alice, t.id);
    expect(created.requestedBy).toBe(alice.id);
  });

  it("rejects a member who doesn't hold the task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, t.id);

    await expect(pingCoordinator(bob, t.id)).rejects.toThrow(ForbiddenError);
  });

  it("is visible to that branch's coordination holders, not just anyone", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
      title: "Coordination",
    });
    await claimTask(alice, coordTask.id);

    const t = await insertTask(testCommunity.id, branch.id, bob.id);
    await claimTask(bob, t.id);
    await pingCoordinator(bob, t.id);

    await expect(listPings(bob, t.id)).rejects.toThrow(ForbiddenError);
    const pings = await listPings(alice, t.id);
    expect(pings).toHaveLength(1);
    expect(pings[0].requestedBy).toBe(bob.id);
  });

  it("lets the requester see their own pending ping via listMyPings, without coordination access", async () => {
    const { community: testCommunity, branch, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, bob.id);
    await claimTask(bob, t.id);
    await pingCoordinator(bob, t.id);

    const mine = await listMyPings(bob, t.id);
    expect(mine).toHaveLength(1);
  });

  it("lets a coordination holder resolve an open ping", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
      title: "Coordination",
    });
    await claimTask(alice, coordTask.id);

    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, t.id);
    const ping = await pingCoordinator(alice, t.id);

    const resolved = await resolvePing(alice, t.id, ping.id);
    expect(resolved.resolvedAt).not.toBeNull();
    await expect(resolvePing(alice, t.id, ping.id)).rejects.toThrow(NotFoundError);
  });
});
