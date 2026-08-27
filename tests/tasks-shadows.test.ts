import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member, task, taskAssignment } from "@/db/schema";
import {
  claimAsShadow,
  claimOrRequestToJoin,
  claimTask,
  createRequirement,
  finishTask,
  getUnmetRequirements,
  parkTask,
  releaseTask,
  setOutgoing,
} from "@/lib/tasks";
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
      title: "Tend the orchard",
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("claimAsShadow", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a member shadow a currently-held task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 1 });
    await claimTask(alice, t.id);

    const shadow = await claimAsShadow(bob, t.id);
    expect(shadow.isShadow).toBe(true);
    expect(shadow.memberId).toBe(bob.id);
  });

  it("rejects shadowing an unclaimed task — nobody to learn from yet", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    await expect(claimAsShadow(bob, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects shadowing a done task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { effort: "one_off", effortMagnitude: { duration: "few_hours" } });
    await claimTask(alice, t.id);
    await finishTask(alice, t.id);

    await expect(claimAsShadow(bob, t.id)).rejects.toThrow(ConflictError);
  });

  it("allows shadowing a waiting (parked) task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, t.id);
    await parkTask(alice, t.id, { nextCheckinAt: new Date(Date.now() + 86400000) });

    const shadow = await claimAsShadow(bob, t.id);
    expect(shadow.isShadow).toBe(true);
  });

  it("is exempt from individual_gate Requirements — that's the whole point of shadowing", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await claimTask(alice, t.id);
    await createRequirement(alice, t.id, { type: "custom", value: { flag: "power_tool_cert" } });

    // bob doesn't have the "power_tool_cert" tag — would fail a real claim.
    await expect(claimTask(bob, t.id)).rejects.toThrow(ForbiddenError);
    // but shadowing bypasses it entirely.
    const shadow = await claimAsShadow(bob, t.id);
    expect(shadow.isShadow).toBe(true);
  });

  it("doesn't count toward capacity — a shadow can join a task that's already full", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 1 });
    await claimTask(alice, t.id);

    // capacity is already 1/1 for real holders...
    await expect(claimTask(bob, t.id)).rejects.toThrow(ConflictError);
    // ...but a shadow slot is unaffected.
    const shadow = await claimAsShadow(carol, t.id);
    expect(shadow.isShadow).toBe(true);

    // and capacity is still correctly enforced for real claims afterward.
    await expect(claimTask(bob, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a duplicate shadow claim from the same member", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 1 });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);

    await expect(claimAsShadow(bob, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects shadowing a task the member already holds for real", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await claimTask(alice, t.id);

    await expect(claimAsShadow(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects claiming for real while already shadowing, with a clear message", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);

    await expect(claimTask(bob, t.id)).rejects.toThrow(/shadowing this task/);
  });
});

describe("shadow interaction with capacity/holder accounting", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reverts to unclaimed when the last real holder releases, even with a shadow still attached", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 1 });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);

    const afterRelease = await releaseTask(alice, t.id);
    expect(afterRelease.status).toBe("unclaimed");

    // the shadow's row is untouched.
    const [shadowRow] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(shadowRow).toBeDefined();
    expect(shadowRow.isShadow).toBe(true);
  });

  it("treats a shadow-only task as having no current holder for join-request routing", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { openness: "request" });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);
    await releaseTask(alice, t.id); // only the shadow remains attached

    const result = await claimOrRequestToJoin(carol, t.id);
    expect(result.status).toBe("claimed");
  });

  it("a shadow releasing themselves doesn't disturb the real holder or task status", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 1 });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);

    await releaseTask(bob, t.id);

    const [updated] = await db.select().from(task).where(eq(task.id, t.id));
    expect(updated.status).toBe("claimed");
    const [aliceRow] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, alice.id));
    expect(aliceRow).toBeDefined();
  });
});

describe("completed_task Requirement satisfied by shadowing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("counts a shadow, not just a real holder, toward a completed_task Requirement", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const referenced = await insertTask(testCommunity.id, branch.id, alice.id, {
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    await claimTask(alice, referenced.id);
    await claimAsShadow(bob, referenced.id); // bob only ever shadowed, never held
    await finishTask(alice, referenced.id);

    const gated = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Next task" });
    await createRequirement(alice, gated.id, {
      type: "completed_task",
      value: { taskId: referenced.id },
    });

    const unmet = await getUnmetRequirements(db, bob, gated.id);
    expect(unmet).toHaveLength(0);
  });
});

describe("setOutgoing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a real holder mark and unmark themselves as outgoing", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, t.id);

    const marked = await setOutgoing(alice, t.id, true);
    expect(marked.isOutgoing).toBe(true);

    const unmarked = await setOutgoing(alice, t.id, false);
    expect(unmarked.isOutgoing).toBe(false);
  });

  it("also works on a shadow's own assignment row", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);

    const updated = await setOutgoing(bob, t.id, true);
    expect(updated.isOutgoing).toBe(true);
    expect(updated.isShadow).toBe(true);
  });

  it("rejects a member who neither holds nor shadows the task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, t.id);

    await expect(setOutgoing(bob, t.id, true)).rejects.toThrow(ForbiddenError);
  });
});
