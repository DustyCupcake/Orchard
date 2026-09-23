import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, phase, task, taskDependency } from "@/db/schema";
import { claimTask, createTask, deleteTask, listDistinctTags, listTasks, updateTask } from "@/lib/tasks";
import { createCycle } from "@/lib/cycles";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

describe("task CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a task scoped to the actor's community", async () => {
    const { branch: testBranch, alice, community: testCommunity } = await createFixtures();

    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Water the trees",
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 2 },
    });

    expect(created.communityId).toBe(testCommunity.id);
    expect(created.createdBy).toBe(alice.id);
    expect(created.status).toBe("unclaimed");
    expect(created.capacity).toBe(1);
  });

  it("rejects creating a task against a branch from another community", async () => {
    const { alice } = await createFixtures();

    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [otherBranch] = await db
      .insert(branch)
      .values({ communityId: otherCommunity.id, name: "Other Branch" })
      .returning();

    await expect(
      createTask(alice, {
        branchId: otherBranch.id,
        title: "Sneaky task",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("updates editable fields without touching lifecycle state", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Water the trees",
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 2 },
    });

    const updated = await updateTask(alice, created.id, { title: "Water the fruit trees" });
    expect(updated.title).toBe("Water the fruit trees");
    expect(updated.status).toBe("unclaimed");
  });

  // Two cycles with phases + an unclaimed task filed under the first
  // cycle's Procurement phase — the fixture the phase/cycle invariant
  // tests below rest on.
  async function cycleStructure() {
    const { branch: testBranch, alice, community: testCommunity } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, testCommunity.id));

    const season = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      phases: [
        { name: "Procurement", order: 0, startDate: "2027-01-01", endDate: "2027-01-31" },
        { name: "Build", order: 1, startDate: "2027-02-01", endDate: "2027-04-01" },
      ],
    });
    const following = await createCycle(alice, {
      source: "blank",
      name: "Following",
      startDate: "2028-01-01",
      endDate: "2028-12-31",
      phases: [{ name: "Planting", order: 0, startDate: "2028-02-01", endDate: "2028-03-01" }],
      confirmed: true,
    });
    const [procurement] = await db.select().from(phase).where(eq(phase.cycleId, season.id)).orderBy(phase.order);
    const [planting] = await db.select().from(phase).where(eq(phase.cycleId, following.id)).orderBy(phase.order);

    const taskRow = await createTask(alice, {
      branchId: testBranch.id,
      title: "Grow the orchard",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      cycleId: season.id,
      phaseId: procurement.id,
    });
    return { alice, season, following, procurement, planting, taskRow };
  }

  it("drops a stale phase when a task moves into another cycle", async () => {
    const { alice, following, taskRow } = await cycleStructure();
    expect(taskRow.phaseId).not.toBeNull();

    const moved = await updateTask(alice, taskRow.id, { cycleId: following.id });
    expect(moved.cycleId).toBe(following.id);
    expect(moved.phaseId).toBeNull();
  });

  it("keeps a named phase that belongs to the destination cycle", async () => {
    const { alice, following, planting, taskRow } = await cycleStructure();

    const moved = await updateTask(alice, taskRow.id, { cycleId: following.id, phaseId: planting.id });
    expect(moved.cycleId).toBe(following.id);
    expect(moved.phaseId).toBe(planting.id);
  });

  it("clears the phase when the task's cycle is cleared", async () => {
    const { alice, taskRow } = await cycleStructure();

    const cleared = await updateTask(alice, taskRow.id, { cycleId: null });
    expect(cleared.cycleId).toBeNull();
    expect(cleared.phaseId).toBeNull();
  });

  it("deletes an unclaimed task created by the actor", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Throwaway task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    await deleteTask(alice, created.id);
    const [row] = await db.select().from(task).where(eq(task.id, created.id));
    expect(row).toBeUndefined();
  });

  it("rejects deleting a task created by someone else", async () => {
    const { branch: testBranch, alice, bob } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Alice's task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    await expect(deleteTask(bob, created.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects deleting a claimed task", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Held task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    await claimTask(alice, created.id);

    await expect(deleteTask(alice, created.id)).rejects.toThrow(ConflictError);
  });

  it("rejects deleting a task another task depends on", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const prerequisite = await createTask(alice, {
      branchId: testBranch.id,
      title: "Prerequisite",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    const dependent = await createTask(alice, {
      branchId: testBranch.id,
      title: "Dependent",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    await db.insert(taskDependency).values({
      taskId: dependent.id,
      dependsOnTaskId: prerequisite.id,
    });

    await expect(deleteTask(alice, prerequisite.id)).rejects.toThrow(ConflictError);
  });

  it("defaults capacity to uncapped for a community_endorsed task, unless overridden", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    const uncapped = await createTask(alice, {
      branchId: testBranch.id,
      title: "Admins",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      openness: "community_endorsed",
      endorsementThreshold: 3,
      browsePeriodEnd: future,
    });
    expect(uncapped.capacity).toBeNull();

    const capped = await createTask(alice, {
      branchId: testBranch.id,
      title: "Admins (capped)",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      openness: "community_endorsed",
      endorsementThreshold: 3,
      browsePeriodEnd: future,
      capacity: 5,
    });
    expect(capped.capacity).toBe(5);
  });

  it("rejects creating a community_endorsed task without a browsePeriodEnd or endorsementThreshold", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    await expect(
      createTask(alice, {
        branchId: testBranch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        openness: "community_endorsed",
        endorsementThreshold: 3,
        // no browsePeriodEnd
      }),
    ).rejects.toThrow(AppError);

    await expect(
      createTask(alice, {
        branchId: testBranch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        openness: "community_endorsed",
        browsePeriodEnd: future,
        // no endorsementThreshold
      }),
    ).rejects.toThrow(AppError);
  });

  it("accepts an endorsementThreshold of 0 as a deliberate choice, distinct from unset (Phase 62)", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Self-clearing task",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
      openness: "community_endorsed",
      endorsementThreshold: 0,
      browsePeriodEnd: future,
    });
    expect(created.endorsementThreshold).toBe(0);
  });

  it("rejects a negative endorsementThreshold", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    await expect(
      createTask(alice, {
        branchId: testBranch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        openness: "community_endorsed",
        endorsementThreshold: -1,
        browsePeriodEnd: future,
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects switching an existing task to community_endorsed without also setting the endorsement fields", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Ordinary task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    await expect(
      updateTask(alice, created.id, { openness: "community_endorsed" }),
    ).rejects.toThrow(AppError);
  });
});

describe("tag filtering (bulk task selection's clustering mechanism)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("filters listTasks by a tag in Task.tags", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const tagged = await createTask(alice, {
      branchId: testBranch.id,
      title: "Pre-launch A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      tags: ["pre-launch"],
    });
    await createTask(alice, {
      branchId: testBranch.id,
      title: "Untagged",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    const filtered = await listTasks(alice, { tag: "pre-launch" });
    expect(filtered.map((t) => t.id)).toEqual([tagged.id]);
  });

  it("listDistinctTags returns every distinct tag in the community, deduplicated", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    await createTask(alice, {
      branchId: testBranch.id,
      title: "A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      tags: ["pre-launch", "fruit"],
    });
    await createTask(alice, {
      branchId: testBranch.id,
      title: "B",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      tags: ["pre-launch"],
    });

    expect(await listDistinctTags(alice)).toEqual(["fruit", "pre-launch"]);
  });
});
