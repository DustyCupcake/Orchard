import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, task } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import {
  listGrantedCycleScopesForTask,
  listGrantingTaskIds,
  listGrantsWithTaskInfo,
  listModuleKeysGrantedByTask,
  removePermissionGrant,
  setPermissionGrant,
} from "@/lib/permissions";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

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
      title: "A task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

// Both functions here are what the settings panel's Access &
// permissions tab, the task detail view, and the proposal-activation
// screen all read to render — see docs/development-plan.md's Phase 64.
describe("listGrantsWithTaskInfo", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is empty when nothing has been granted yet", async () => {
    const { community: testCommunity } = await createFixtures();
    expect(await listGrantsWithTaskInfo(testCommunity.id)).toEqual([]);
  });

  it("returns every grant with the granting task's title and branchId", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Coordinate stuff" });
    await grantPermission(testCommunity.id, "branch_coordination", t.id);

    const grants = await listGrantsWithTaskInfo(testCommunity.id);
    expect(grants).toEqual([
      { moduleKey: "branch_coordination", taskId: t.id, title: "Coordinate stuff", branchId: branch.id, cycleId: null },
    ]);
  });

  it("is community-scoped — a stranger's grant never leaks in", async () => {
    const { community: testCommunity } = await createFixtures();
    const { community: strangerCommunity, branch: strangerBranch, alice: strangerAlice } = await createFixtures();
    const strangerTask = await insertTask(strangerCommunity.id, strangerBranch.id, strangerAlice.id);
    await grantPermission(strangerCommunity.id, "support", strangerTask.id);

    expect(await listGrantsWithTaskInfo(testCommunity.id)).toEqual([]);
  });
});

describe("listModuleKeysGrantedByTask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns the exact set of modules a task currently grants, empty when none", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    expect(await listModuleKeysGrantedByTask(testCommunity.id, t.id)).toEqual(new Set());

    await grantPermission(testCommunity.id, "admin", t.id);
    await grantPermission(testCommunity.id, "support", t.id);
    const otherTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "recruitment", otherTask.id);

    expect(await listModuleKeysGrantedByTask(testCommunity.id, t.id)).toEqual(new Set(["admin", "support"]));
    expect(await listModuleKeysGrantedByTask(testCommunity.id, otherTask.id)).toEqual(new Set(["recruitment"]));
  });
});

// docs/development-plan.md's Phase 68 — event_scheduling_owner/
// spatial_planning grants start carrying a real cycleId. Every change
// here is additive/backward-compatible for the other seven modules
// (already covered above); these cases exercise the new cycle
// dimension specifically.
describe("cycle-scoped grants (Phase 68)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("listGrantingTaskIds: omitted cycleId means every cycle; a real id or null filters to just that one", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const taskA = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Owns A" });
    const taskB = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Owns B" });
    await setPermissionGrant(testCommunity.id, "spatial_planning", taskA.id, cycleA.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", taskB.id, cycleB.id);

    expect((await listGrantingTaskIds(testCommunity.id, "spatial_planning")).sort()).toEqual(
      [taskA.id, taskB.id].sort(),
    );
    expect(await listGrantingTaskIds(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([taskA.id]);
    expect(await listGrantingTaskIds(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([taskB.id]);
    expect(await listGrantingTaskIds(testCommunity.id, "spatial_planning", null)).toEqual([]);
  });

  it("setPermissionGrant scoped to one cycle doesn't clobber another cycle's grant for the same module", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const taskA = await insertTask(testCommunity.id, branch.id, alice.id);
    const taskB = await insertTask(testCommunity.id, branch.id, alice.id);

    await setPermissionGrant(testCommunity.id, "event_scheduling_owner", taskA.id, cycleA.id);
    await setPermissionGrant(testCommunity.id, "event_scheduling_owner", taskB.id, cycleB.id);
    expect(await listGrantingTaskIds(testCommunity.id, "event_scheduling_owner", cycleA.id)).toEqual([taskA.id]);
    expect(await listGrantingTaskIds(testCommunity.id, "event_scheduling_owner", cycleB.id)).toEqual([taskB.id]);

    // Replacing cycle A's grant with a third task leaves cycle B's untouched.
    const taskC = await insertTask(testCommunity.id, branch.id, alice.id);
    await setPermissionGrant(testCommunity.id, "event_scheduling_owner", taskC.id, cycleA.id);
    expect(await listGrantingTaskIds(testCommunity.id, "event_scheduling_owner", cycleA.id)).toEqual([taskC.id]);
    expect(await listGrantingTaskIds(testCommunity.id, "event_scheduling_owner", cycleB.id)).toEqual([taskB.id]);
  });

  it("the same task can hold the same module for two different cycles at once", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    await setPermissionGrant(testCommunity.id, "spatial_planning", t.id, cycleA.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", t.id, cycleB.id);
    expect(await listGrantingTaskIds(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([t.id]);
    expect(await listGrantingTaskIds(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([t.id]);

    const scopes = await listGrantedCycleScopesForTask(testCommunity.id, t.id);
    expect(scopes.spatial_planning?.sort()).toEqual([cycleA.id, cycleB.id].sort());
  });

  it("removePermissionGrant with a cycleId only removes that cycle's row, defaulting to community-wide", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", t.id, cycleA.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", t.id, null);

    await removePermissionGrant(testCommunity.id, "spatial_planning", t.id, cycleA.id);
    expect(await listGrantingTaskIds(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([]);
    expect(await listGrantingTaskIds(testCommunity.id, "spatial_planning", null)).toEqual([t.id]);
  });

  it("listGrantedCycleScopesForTask maps every module this task grants to its cycle (or null for community-wide)", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", t.id, cycleA.id);
    await setPermissionGrant(testCommunity.id, "event_scheduling_owner", t.id, null);
    await grantPermission(testCommunity.id, "support", t.id);

    expect(await listGrantedCycleScopesForTask(testCommunity.id, t.id)).toEqual({
      spatial_planning: [cycleA.id],
      event_scheduling_owner: [null],
      support: [null],
    });
  });
});
