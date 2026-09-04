import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { task } from "@/db/schema";
import { claimOrRequestToJoin, claimTask, suggestMemberForTask } from "@/lib/tasks";
import { ConfirmationRequiredError, NotFoundError } from "@/lib/errors";
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

describe("self-assign confirmation check", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("requires confirmation when a branch coordination holder self-claims an unclaimed task", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id);
    await expect(claimOrRequestToJoin(alice, target.id)).rejects.toThrow(
      ConfirmationRequiredError,
    );
  });

  it("succeeds once confirmed: true is passed", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id);
    const result = await claimOrRequestToJoin(alice, target.id, { confirmed: true });
    expect(result.status).toBe("claimed");
  });

  it("requires confirmation for a flagged (non-ok attention) already-held task with room", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await claimTask(bob, target.id);
    await db.update(task).set({ attentionLevel: "hard" }).where(eq(task.id, target.id));

    await expect(claimOrRequestToJoin(alice, target.id)).rejects.toThrow(
      ConfirmationRequiredError,
    );
  });

  it("does not require confirmation for an ordinary member with no coordination authority", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const target = await insertTask(testCommunity.id, branch.id, alice.id);

    const result = await claimOrRequestToJoin(alice, target.id);
    expect(result.status).toBe("claimed");
  });

  it("does not require confirmation for a coordination holder claiming an ordinary, unflagged already-held task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      capacity: 2,
      openness: "open",
    });
    await claimTask(bob, target.id);

    // claimed, has room, attentionLevel is still "ok" — not unclaimed, not flagged.
    const result = await claimOrRequestToJoin(alice, target.id);
    expect(result.status).toBe("claimed");
  });
});

describe("suggestMemberForTask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("sets suggestedMemberId on the task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    const updated = await suggestMemberForTask(alice, t.id, bob.id);
    expect(updated.suggestedMemberId).toBe(bob.id);
  });

  it("rejects a suggested member from another community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const { bob: strangerBob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    await expect(suggestMemberForTask(alice, t.id, strangerBob.id)).rejects.toThrow(NotFoundError);
  });

  it("rejects an unknown task", async () => {
    const { alice, bob } = await createFixtures();
    await expect(
      suggestMemberForTask(alice, "00000000-0000-0000-0000-000000000000", bob.id),
    ).rejects.toThrow(NotFoundError);
  });
});
