import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, task, taskDependency } from "@/db/schema";
import { claimTask, createTask, deleteTask, updateTask } from "@/lib/tasks";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
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
});
