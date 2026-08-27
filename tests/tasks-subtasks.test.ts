import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { branch, community, member, task } from "@/db/schema";
import { claimTask, getParentTaskSummary, listSubtasks, splitSubtask } from "@/lib/tasks";
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
      title: "Build the deck",
      effort: "one_off",
      effortMagnitude: { duration: "multi_day" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("subtasks", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a current holder split off a subtask, inheriting branch/cycle/phase from the parent", async () => {
    const { community, branch: testBranch, alice } = await createFixtures();
    const parent = await insertTask(community.id, testBranch.id, alice.id);
    await claimTask(alice, parent.id);

    const sub = await splitSubtask(alice, parent.id, {
      title: "Sand the railing",
      description: "Just the railing, not the whole deck",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    expect(sub.parentTaskId).toBe(parent.id);
    expect(sub.branchId).toBe(parent.branchId);
    expect(sub.cycleId).toBe(parent.cycleId);
    expect(sub.phaseId).toBe(parent.phaseId);
    expect(sub.communityId).toBe(community.id);
    expect(sub.createdBy).toBe(alice.id);
    expect(sub.status).toBe("unclaimed");
  });

  it("allows overriding the branch on the new subtask", async () => {
    const { community, branch: testBranch, alice } = await createFixtures();
    const parent = await insertTask(community.id, testBranch.id, alice.id);
    await claimTask(alice, parent.id);

    const [otherBranch] = await db
      .insert(branch)
      .values({ communityId: community.id, name: "Wood" })
      .returning();

    const sub = await splitSubtask(alice, parent.id, {
      branchId: otherBranch.id,
      title: "Source lumber",
      effort: "one_off",
      effortMagnitude: { duration: "half_day" },
    });

    expect(sub.branchId).toBe(otherBranch.id);
  });

  it("rejects splitting off a subtask from someone who doesn't hold the task", async () => {
    const { community, branch: testBranch, alice, bob } = await createFixtures();
    const parent = await insertTask(community.id, testBranch.id, alice.id);
    await claimTask(alice, parent.id);

    await expect(
      splitSubtask(bob, parent.id, {
        title: "Sneaky subtask",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects splitting off a subtask from an unclaimed task (no current holder)", async () => {
    const { community, branch: testBranch, alice } = await createFixtures();
    const parent = await insertTask(community.id, testBranch.id, alice.id);

    await expect(
      splitSubtask(alice, parent.id, {
        title: "Too early",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows any current holder of a multi-slot task to split one off, not just its creator", async () => {
    const { community, branch: testBranch, alice, bob } = await createFixtures();
    const parent = await insertTask(community.id, testBranch.id, alice.id, { capacity: 2 });
    await claimTask(alice, parent.id);
    await claimTask(bob, parent.id);

    const sub = await splitSubtask(bob, parent.id, {
      title: "Bob's piece",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    expect(sub.parentTaskId).toBe(parent.id);
    expect(sub.createdBy).toBe(bob.id);
  });

  it("rejects splitting off a subtask from a task outside the actor's community", async () => {
    const { alice } = await createFixtures();

    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [otherBranch] = await db
      .insert(branch)
      .values({ communityId: otherCommunity.id, name: "Other Branch" })
      .returning();
    const [otherMember] = await db
      .insert(member)
      .values({ communityId: otherCommunity.id, name: "Stranger" })
      .returning();
    const otherTask = await insertTask(otherCommunity.id, otherBranch.id, otherMember.id);

    await expect(
      splitSubtask(alice, otherTask.id, {
        title: "Cross-community sneak",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("lists subtasks for a parent, and lets a child link back to its parent's summary", async () => {
    const { community, branch: testBranch, alice } = await createFixtures();
    const parent = await insertTask(community.id, testBranch.id, alice.id);
    await claimTask(alice, parent.id);

    const sub = await splitSubtask(alice, parent.id, {
      title: "Sand the railing",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    const subtasks = await listSubtasks(alice, parent.id);
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].id).toBe(sub.id);

    const parentSummary = await getParentTaskSummary(alice, parent.id);
    expect(parentSummary?.title).toBe(parent.title);
  });
});
