import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { branch as branchTable, task } from "@/db/schema";
import { claimTask, deescalateTask, escalateTask, listEscalatedTasks } from "@/lib/tasks";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
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
      title: "Order the seedlings",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("listEscalatedTasks", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a member with no coordination authority anywhere in the community", async () => {
    const { alice } = await createFixtures();
    await expect(listEscalatedTasks(alice)).rejects.toThrow(ForbiddenError);
  });

  it("lists escalated tasks community-wide, not scoped to the coordinator's own branch", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: testCommunity.id, name: "Wood" })
      .returning();

    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const escalatedElsewhere = await insertTask(testCommunity.id, otherBranch.id, alice.id, {
      title: "Escalated in Wood",
      attentionLevel: "escalated",
    });
    const escalatedHere = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Escalated in Fruit",
      attentionLevel: "escalated",
    });
    await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Just soft-flagged",
      attentionLevel: "soft",
    });

    const escalated = await listEscalatedTasks(alice);
    expect(escalated.map((t) => t.id).sort()).toEqual(
      [escalatedElsewhere.id, escalatedHere.id].sort(),
    );
  });

  it("excludes escalated tasks from another community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const { community: otherCommunity, branch: otherBranch, alice: otherAlice } =
      await createFixtures();
    await insertTask(otherCommunity.id, otherBranch.id, otherAlice.id, {
      title: "Escalated elsewhere",
      attentionLevel: "escalated",
    });

    const escalated = await listEscalatedTasks(alice);
    expect(escalated).toHaveLength(0);
  });
});

describe("escalateTask / deescalateTask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a coordinator escalate any task in their community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Needs owner",
      attentionLevel: "ok",
    });

    const updated = await escalateTask(alice, target.id);
    expect(updated.attentionLevel).toBe("escalated");

    const listed = await listEscalatedTasks(alice);
    expect(listed.map((t) => t.id)).toContain(target.id);
  });

  it("lets a coordinator de-escalate a task", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Was escalated",
      attentionLevel: "escalated",
    });

    const updated = await deescalateTask(alice, target.id);
    expect(updated.attentionLevel).toBe("ok");

    const listed = await listEscalatedTasks(alice);
    expect(listed.map((t) => t.id)).not.toContain(target.id);
  });

  it("rejects escalation by a non-coordinator", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Needs owner",
    });

    await expect(escalateTask(bob, target.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a task in another community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const { community: otherCommunity, branch: otherBranch, alice: otherAlice } =
      await createFixtures();
    const otherTask = await insertTask(otherCommunity.id, otherBranch.id, otherAlice.id, {
      title: "Other task",
    });

    await expect(escalateTask(alice, otherTask.id)).rejects.toThrow(NotFoundError);
  });
});
