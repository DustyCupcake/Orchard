import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle, phase, task, taskDependency } from "@/db/schema";
import { recomputeAttentionLevels } from "@/lib/attention";
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
      title: "Some task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe("recomputeAttentionLevels", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("flags a stale unclaimed task and leaves a fresh one alone", async () => {
    const { branch, alice } = await createFixtures();
    const stale = await insertTask(alice.communityId, branch.id, alice.id, {
      createdAt: daysAgo(20),
    });
    const fresh = await insertTask(alice.communityId, branch.id, alice.id);

    const result = await recomputeAttentionLevels();
    expect(result.updated).toBe(1);

    const [staleRow] = await db.select().from(task).where(eq(task.id, stale.id));
    const [freshRow] = await db.select().from(task).where(eq(task.id, fresh.id));
    expect(staleRow.attentionLevel).toBe("hard");
    expect(freshRow.attentionLevel).toBe("ok");
  });

  it("is idempotent — a second run with nothing changed updates nothing", async () => {
    const { branch, alice } = await createFixtures();
    await insertTask(alice.communityId, branch.id, alice.id, { createdAt: daysAgo(20) });

    await recomputeAttentionLevels();
    const second = await recomputeAttentionLevels();
    expect(second.updated).toBe(0);
  });

  it("never flags a done task", async () => {
    const { branch, alice } = await createFixtures();
    const done = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "done",
      createdAt: daysAgo(90),
      statusChangedAt: daysAgo(90),
    });

    await recomputeAttentionLevels();
    const [row] = await db.select().from(task).where(eq(task.id, done.id));
    expect(row.attentionLevel).toBe("ok");
  });

  it("exempts a task blocked on an unfinished dependency, even if old", async () => {
    const { branch, alice } = await createFixtures();
    const prerequisite = await insertTask(alice.communityId, branch.id, alice.id);
    const blocked = await insertTask(alice.communityId, branch.id, alice.id, {
      createdAt: daysAgo(90),
    });
    await db.insert(taskDependency).values({
      taskId: blocked.id,
      dependsOnTaskId: prerequisite.id,
    });

    await recomputeAttentionLevels();
    const [blockedRow] = await db.select().from(task).where(eq(task.id, blocked.id));
    expect(blockedRow.attentionLevel).toBe("ok");

    // Finish the prerequisite — the dependent should now be eligible for
    // staleness on the very next tick, since it's been old the whole time.
    await db.update(task).set({ status: "done" }).where(eq(task.id, prerequisite.id));
    await recomputeAttentionLevels();
    const [unblockedRow] = await db.select().from(task).where(eq(task.id, blocked.id));
    expect(unblockedRow.attentionLevel).toBe("hard");
  });

  it("respects each community's own staleness thresholds", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await db
      .update(community)
      .set({ stalenessSoftDays: 30, stalenessHardDays: 60 })
      .where(eq(community.id, testCommunity.id));

    const notYetStale = await insertTask(alice.communityId, branch.id, alice.id, {
      createdAt: daysAgo(20), // would be "hard" under the default 7/14, but not under 30/60
    });

    await recomputeAttentionLevels();
    const [row] = await db.select().from(task).where(eq(task.id, notYetStale.id));
    expect(row.attentionLevel).toBe("ok");
  });

  it("flags a task whose phase deadline has passed, only when phases are enabled", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [testCycle] = await db
      .insert(cycle)
      .values({ communityId: testCommunity.id, name: "2026 Season" })
      .returning();
    const [pastPhase] = await db
      .insert(phase)
      .values({
        cycleId: testCycle.id,
        name: "Build",
        order: 1,
        endDate: daysAgo(1).toISOString().slice(0, 10),
      })
      .returning();
    const brandNewTask = await insertTask(alice.communityId, branch.id, alice.id, {
      cycleId: testCycle.id,
      phaseId: pastPhase.id,
    });

    // Phases off: the passed phase deadline shouldn't matter yet.
    await recomputeAttentionLevels();
    const [beforeEnabling] = await db.select().from(task).where(eq(task.id, brandNewTask.id));
    expect(beforeEnabling.attentionLevel).toBe("ok");

    await db
      .update(community)
      .set({ phasesEnabled: true })
      .where(eq(community.id, testCommunity.id));

    await recomputeAttentionLevels();
    const [afterEnabling] = await db.select().from(task).where(eq(task.id, brandNewTask.id));
    expect(afterEnabling.attentionLevel).toBe("hard");
  });
});
