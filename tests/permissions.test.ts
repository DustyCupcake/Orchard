import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { listGrantsWithTaskInfo, listModuleKeysGrantedByTask } from "@/lib/permissions";
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
      { moduleKey: "branch_coordination", taskId: t.id, title: "Coordinate stuff", branchId: branch.id },
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
