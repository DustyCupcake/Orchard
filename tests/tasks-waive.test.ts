import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import { claimTask, createRequirement, waiveAndClaim } from "@/lib/tasks";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
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
      title: "Restricted task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("waiveAndClaim", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a branch coordination holder waive a Requirement and claim for someone else", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await createRequirement(alice, target.id, { type: "custom", value: { flag: "cert" } });

    // bob doesn't have the "cert" tag — a real claim would fail.
    await expect(claimTask(bob, target.id)).rejects.toThrow(ForbiddenError);

    const updated = await waiveAndClaim(alice, target.id, {
      memberId: bob.id,
      reason: "nobody certified was willing, waiving for now",
    });
    expect(updated.status).toBe("claimed");

    const [assignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(assignment.gateWaivedBy).toBe(alice.id);
    expect(assignment.gateWaivedReason).toBe("nobody certified was willing, waiving for now");
  });

  it("lets the task's own coordination-slot holder waive, without branch coordination", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();

    const target = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 3 });
    await claimTask(alice, target.id);
    await createRequirement(alice, target.id, { type: "custom", value: { flag: "cert" } });
    await db
      .update(taskAssignment)
      .set({ isCoordinationSlot: true })
      .where(eq(taskAssignment.memberId, alice.id));

    const updated = await waiveAndClaim(alice, target.id, { memberId: bob.id, reason: "trusted" });
    expect(updated.status).toBe("claimed");
  });

  it("rejects a member with no coordination authority at all", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const target = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await createRequirement(alice, target.id, { type: "custom", value: { flag: "cert" } });

    await expect(
      waiveAndClaim(bob, target.id, { memberId: bob.id, reason: "self-waive, nice try" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("still enforces capacity even under a waiver", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 1 });
    await claimTask(alice, target.id); // fills the one slot
    await createRequirement(alice, target.id, { type: "custom", value: { flag: "cert" } });

    await expect(
      waiveAndClaim(alice, target.id, { memberId: bob.id, reason: "trying anyway" }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects an unknown task or member", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);
    const target = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });

    await expect(
      waiveAndClaim(alice, "00000000-0000-0000-0000-000000000000", {
        memberId: bob.id,
        reason: "x",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      waiveAndClaim(alice, target.id, {
        memberId: "00000000-0000-0000-0000-000000000000",
        reason: "x",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
