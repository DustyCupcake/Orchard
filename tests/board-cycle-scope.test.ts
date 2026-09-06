import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import { createTask, listTasks } from "@/lib/tasks";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

// docs/development-plan.md's Phase 67 — the board's own cycle-scope
// filter (listTasks's new `cycleScope` option), exercised directly
// rather than through the board page itself (no page.tsx in this repo
// has automated test coverage — see every prior phase's own note on
// that). Cycle-less tasks (a null Task.cycleId) always show unless
// explicitly hidden, regardless of which cycle(s) are in scope.
describe("listTasks cycleScope filter", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("in a single-cycle scope, includes that cycle's tasks and cycle-less tasks, excludes another cycle's", async () => {
    const { branch: testBranch, alice, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const inA = await createTask(alice, {
      branchId: testBranch.id,
      cycleId: cycleA.id,
      title: "In A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    const inB = await createTask(alice, {
      branchId: testBranch.id,
      cycleId: cycleB.id,
      title: "In B",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    const cycleless = await createTask(alice, {
      branchId: testBranch.id,
      title: "Evergreen",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    const result = await listTasks(alice, { cycleScope: { cycleIds: [cycleA.id] } });
    expect(result.map((t) => t.id).sort()).toEqual([cycleless.id, inA.id].sort());
    expect(result.map((t) => t.id)).not.toContain(inB.id);
  });

  it("in an aggregate scope covering 2 cycles, unions both plus cycle-less tasks", async () => {
    const { branch: testBranch, alice, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const cycleC = await createCycle(alice, { source: "blank", name: "C", confirmed: true });
    const inA = await createTask(alice, {
      branchId: testBranch.id,
      cycleId: cycleA.id,
      title: "In A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    const inB = await createTask(alice, {
      branchId: testBranch.id,
      cycleId: cycleB.id,
      title: "In B",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    const inC = await createTask(alice, {
      branchId: testBranch.id,
      cycleId: cycleC.id,
      title: "In C",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    const result = await listTasks(alice, { cycleScope: { cycleIds: [cycleA.id, cycleB.id] } });
    const ids = result.map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([inA.id, inB.id]));
    expect(ids).not.toContain(inC.id);
  });

  it("hideCycleless excludes cycle-less tasks even when they'd otherwise show", async () => {
    const { branch: testBranch, alice, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const inA = await createTask(alice, {
      branchId: testBranch.id,
      cycleId: cycleA.id,
      title: "In A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    await createTask(alice, {
      branchId: testBranch.id,
      title: "Evergreen",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    const result = await listTasks(alice, { cycleScope: { cycleIds: [cycleA.id], hideCycleless: true } });
    expect(result.map((t) => t.id)).toEqual([inA.id]);
  });

  it("an empty cycleIds list (nothing in scope) still shows cycle-less tasks, unless hidden", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const cycleless = await createTask(alice, {
      branchId: testBranch.id,
      title: "Evergreen",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    expect((await listTasks(alice, { cycleScope: { cycleIds: [] } })).map((t) => t.id)).toEqual([cycleless.id]);
    expect(
      await listTasks(alice, { cycleScope: { cycleIds: [], hideCycleless: true } }),
    ).toEqual([]);
  });
});
