import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, task } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import {
  listGrantingTaskIds,
  listGrantingTaskIdsForScope,
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

// docs/cycle-scope-remediation-plan.md — a grant's scope comes from
// the granting task's own placement (`task.cycleId`), not a cycle
// column on the grant row (retired in migration D8). task.cycleId =
// NULL is the community/evergreen role; = C covers cycle C only, and a
// task grants exactly one scope (its own).
describe("placement-derived scopes (cycle-scope remediation)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("listGrantingTaskIds returns every grant; listGrantingTaskIdsForScope filters by the granting task's placement", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const taskA = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id, title: "Owns A" });
    const taskB = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleB.id, title: "Owns B" });
    const communityTask = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Owns community" });
    await setPermissionGrant(testCommunity.id, "spatial_planning", taskA.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", taskB.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", communityTask.id);

    expect((await listGrantingTaskIds(testCommunity.id, "spatial_planning")).sort()).toEqual(
      [taskA.id, taskB.id, communityTask.id].sort(),
    );
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([taskA.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([taskB.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", null)).toEqual([communityTask.id]);
  });

  it("setPermissionGrant replaces only the sibling grant in the granted task's own scope, never a different cycle's", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const taskA = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    const taskB = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleB.id });

    await setPermissionGrant(testCommunity.id, "event_scheduling_owner", taskA.id);
    await setPermissionGrant(testCommunity.id, "event_scheduling_owner", taskB.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleA.id)).toEqual([taskA.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleB.id)).toEqual([taskB.id]);

    // Replacing cycle A's grant with a third task placed in A leaves B's untouched.
    const taskC = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    await setPermissionGrant(testCommunity.id, "event_scheduling_owner", taskC.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleA.id)).toEqual([taskC.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleB.id)).toEqual([taskB.id]);
  });

  it("one task, one scope: a task's grant follows wherever it sits", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });

    await setPermissionGrant(testCommunity.id, "spatial_planning", t.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([t.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", null)).toEqual([]);

    // Rearranging the task's placement moves its grant's scope with it —
    // the direct migration of the old "same task, two cycles" stacking
    // (a task now grants exactly the one scope it sits in, §2.1/D2).
    await db.update(task).set({ cycleId: cycleB.id }).where(eq(task.id, t.id));
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([t.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([]);
  });

  it("removePermissionGrant drops the task's own grant row, regardless of scope", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleTask = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    const communityTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", cycleTask.id);
    await setPermissionGrant(testCommunity.id, "spatial_planning", communityTask.id);

    await removePermissionGrant(testCommunity.id, "spatial_planning", cycleTask.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", null)).toEqual([communityTask.id]);
  });

  it("listGrantsWithTaskInfo reports each granting task's placement as its scope", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleTask = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id, title: "Owns A" });
    const communityTask = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Owns community" });
    await setPermissionGrant(testCommunity.id, "spatial_planning", cycleTask.id);
    await setPermissionGrant(testCommunity.id, "branch_coordination", communityTask.id);

    const grants = await listGrantsWithTaskInfo(testCommunity.id);
    // The cycle's auto-created Backstop task (docs/cycle-scope-
    // remediation-plan.md §4.7) carries a `backstop` grant scoped to
    // cycleA too — listed right alongside the hand-granted modules.
    const [backstopRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.cycleId, cycleA.id), eq(task.title, "Backstop")));
    expect(grants).toEqual(
      expect.arrayContaining([
        { moduleKey: "spatial_planning", taskId: cycleTask.id, title: "Owns A", branchId: branch.id, cycleId: cycleA.id },
        {
          moduleKey: "branch_coordination",
          taskId: communityTask.id,
          title: "Owns community",
          branchId: branch.id,
          cycleId: null,
        },
        {
          moduleKey: "backstop",
          taskId: backstopRow.id,
          title: "Backstop",
          branchId: branch.id,
          cycleId: cycleA.id,
        },
      ]),
    );
    expect(grants).toHaveLength(3);
  });
});
