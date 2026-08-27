import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { claimTask, createSignal, listSignals, resolveSignal } from "@/lib/tasks";
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

describe("task signals", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets any member create a signal, with no member reference stored", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    const created = await createSignal(alice, t.id, { kind: "worth_a_look" });
    expect(created.kind).toBe("worth_a_look");
    expect(Object.keys(created)).not.toContain("memberId");
  });

  it("is only visible to that branch's coordination holders", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
      title: "Coordination",
    });
    await claimTask(alice, coordTask.id);

    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await createSignal(bob, t.id, { kind: "stalled" });

    await expect(listSignals(bob, t.id)).rejects.toThrow(ForbiddenError);
    const signals = await listSignals(alice, t.id);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("stalled");
  });

  it("lets a coordination holder resolve an open signal", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
      title: "Coordination",
    });
    await claimTask(alice, coordTask.id);

    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    const signal = await createSignal(alice, t.id, { kind: "might_need_help" });

    const resolved = await resolveSignal(alice, t.id, signal.id);
    expect(resolved.resolvedAt).not.toBeNull();

    await expect(resolveSignal(alice, t.id, signal.id)).rejects.toThrow(NotFoundError);
  });
});
