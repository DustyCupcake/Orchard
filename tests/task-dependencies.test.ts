import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { addTaskDependency, listTaskDependencies, removeTaskDependency } from "@/lib/tasks";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function insertTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  title: string,
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
    })
    .returning();
  return row;
}

describe("task dependency CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("adds and lists a dependency with the depended-on task's title/status", async () => {
    const { branch, alice } = await createFixtures();
    const a = await insertTask(alice.communityId, branch.id, alice.id, "Build the frame");
    const b = await insertTask(alice.communityId, branch.id, alice.id, "Order the lumber");

    await addTaskDependency(alice, a.id, b.id);

    const deps = await listTaskDependencies(alice, a.id);
    expect(deps).toEqual([{ dependsOnTaskId: b.id, title: "Order the lumber", status: "unclaimed" }]);
  });

  it("rejects a task depending on itself", async () => {
    const { branch, alice } = await createFixtures();
    const a = await insertTask(alice.communityId, branch.id, alice.id, "Solo task");

    await expect(addTaskDependency(alice, a.id, a.id)).rejects.toThrow(AppError);
  });

  it("rejects adding the same dependency twice", async () => {
    const { branch, alice } = await createFixtures();
    const a = await insertTask(alice.communityId, branch.id, alice.id, "A");
    const b = await insertTask(alice.communityId, branch.id, alice.id, "B");

    await addTaskDependency(alice, a.id, b.id);
    await expect(addTaskDependency(alice, a.id, b.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a direct circular dependency (A -> B, then B -> A)", async () => {
    const { branch, alice } = await createFixtures();
    const a = await insertTask(alice.communityId, branch.id, alice.id, "A");
    const b = await insertTask(alice.communityId, branch.id, alice.id, "B");

    await addTaskDependency(alice, a.id, b.id);
    await expect(addTaskDependency(alice, b.id, a.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a transitive circular dependency (A -> B -> C, then C -> A)", async () => {
    const { branch, alice } = await createFixtures();
    const a = await insertTask(alice.communityId, branch.id, alice.id, "A");
    const b = await insertTask(alice.communityId, branch.id, alice.id, "B");
    const c = await insertTask(alice.communityId, branch.id, alice.id, "C");

    await addTaskDependency(alice, a.id, b.id);
    await addTaskDependency(alice, b.id, c.id);
    await expect(addTaskDependency(alice, c.id, a.id)).rejects.toThrow(ConflictError);
  });

  it("enforces tenant isolation on both tasks", async () => {
    const { branch, alice } = await createFixtures();
    const { alice: strangerAlice, branch: strangerBranch } = await createFixtures();
    const mine = await insertTask(alice.communityId, branch.id, alice.id, "Mine");
    const theirs = await insertTask(
      strangerAlice.communityId,
      strangerBranch.id,
      strangerAlice.id,
      "Theirs",
    );

    await expect(addTaskDependency(alice, mine.id, theirs.id)).rejects.toThrow(NotFoundError);
  });

  it("removes a dependency, and rejects removing one that doesn't exist", async () => {
    const { branch, alice } = await createFixtures();
    const a = await insertTask(alice.communityId, branch.id, alice.id, "A");
    const b = await insertTask(alice.communityId, branch.id, alice.id, "B");

    await addTaskDependency(alice, a.id, b.id);
    await removeTaskDependency(alice, a.id, b.id);
    expect(await listTaskDependencies(alice, a.id)).toEqual([]);

    await expect(removeTaskDependency(alice, a.id, b.id)).rejects.toThrow(NotFoundError);
  });
});
