import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { member, task, taskDependency } from "@/db/schema";
import { claimTask, finishTask, parkTask, releaseTask, resumeTask } from "@/lib/tasks";
import { ConflictError, ForbiddenError } from "@/lib/errors";
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

describe("task lifecycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("walks the full lifecycle: unclaimed -> claimed -> waiting -> claimed -> done", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id);
    expect(t.status).toBe("unclaimed");

    const claimed = await claimTask(alice, t.id);
    expect(claimed.status).toBe("claimed");

    const waiting = await parkTask(alice, t.id, {
      nextCheckinAt: new Date(Date.now() + 86400000),
      waitingNote: "waiting on supplies",
    });
    expect(waiting.status).toBe("waiting");
    expect(waiting.waitingNote).toBe("waiting on supplies");

    const resumed = await resumeTask(alice, t.id);
    expect(resumed.status).toBe("claimed");
    expect(resumed.waitingNote).toBeNull();
    expect(resumed.nextCheckinAt).toBeNull();

    const done = await finishTask(alice, t.id);
    expect(done.status).toBe("done");
  });

  it("release from claimed returns the task to unclaimed", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id);

    await claimTask(alice, t.id);
    const released = await releaseTask(alice, t.id);
    expect(released.status).toBe("unclaimed");
  });

  it("release from waiting returns the task to unclaimed and clears the waiting fields", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id);

    await claimTask(alice, t.id);
    await parkTask(alice, t.id, { nextCheckinAt: new Date(Date.now() + 86400000) });
    const released = await releaseTask(alice, t.id);
    expect(released.status).toBe("unclaimed");
    expect(released.nextCheckinAt).toBeNull();
  });

  it("enforces capacity via TaskAssignment", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { capacity: 2 });

    await claimTask(alice, t.id);
    await claimTask(bob, t.id);

    const [carol] = await db
      .insert(member)
      .values({ communityId: community.id, name: "Carol" })
      .returning();

    await expect(claimTask(carol, t.id)).rejects.toThrow(ConflictError);
  });

  it("a null capacity is uncapped", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { capacity: null });

    await claimTask(alice, t.id);
    const claimed = await claimTask(bob, t.id);
    expect(claimed.status).toBe("claimed");
  });

  it("releasing one of several holders leaves the task claimed for the rest", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { capacity: 2 });

    await claimTask(alice, t.id);
    await claimTask(bob, t.id);

    const afterRelease = await releaseTask(alice, t.id);
    expect(afterRelease.status).toBe("claimed");
  });

  it("rejects claiming a task you already hold", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { capacity: 5 });

    await claimTask(alice, t.id);
    await expect(claimTask(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects claiming a done task", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id);

    await claimTask(alice, t.id);
    await finishTask(alice, t.id);
    await expect(claimTask(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects parking a task you don't hold", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id);

    await claimTask(alice, t.id);
    await expect(
      parkTask(bob, t.id, { nextCheckinAt: new Date(Date.now() + 86400000) }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects finishing a task with an open dependency, allows it once the dependency is done", async () => {
    const { community, branch, alice } = await createFixtures();
    const prerequisite = await insertTask(community.id, branch.id, alice.id, {
      title: "Buy the hose",
    });
    const dependent = await insertTask(community.id, branch.id, alice.id, {
      title: "Water the trees",
    });

    await db.insert(taskDependency).values({
      taskId: dependent.id,
      dependsOnTaskId: prerequisite.id,
    });

    await claimTask(alice, dependent.id);
    await expect(finishTask(alice, dependent.id)).rejects.toThrow(ConflictError);

    await claimTask(alice, prerequisite.id);
    await finishTask(alice, prerequisite.id);

    const done = await finishTask(alice, dependent.id);
    expect(done.status).toBe("done");
  });

  it("rejects claiming past capacity concurrently for the last slot", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { capacity: 1 });

    const results = await Promise.allSettled([claimTask(alice, t.id), claimTask(bob, t.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
