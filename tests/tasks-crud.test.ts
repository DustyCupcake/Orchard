import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, cycle, phase, task, taskDependency } from "@/db/schema";
import { claimTask, createTask, deleteTask, listDistinctTags, listTasks, updateTask } from "@/lib/tasks";
import { createCycle } from "@/lib/cycles";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";
import { listGrantingTaskIdsForScope } from "@/lib/permissions";

describe("task CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a task scoped to the actor's community", async () => {
    const { branch: testBranch, alice, community: testCommunity } = await createFixtures();

    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Water the trees",
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 2 },
    });

    expect(created.communityId).toBe(testCommunity.id);
    expect(created.createdBy).toBe(alice.id);
    expect(created.status).toBe("unclaimed");
    expect(created.capacity).toBe(1);
  });

  it("rejects creating a task against a branch from another community", async () => {
    const { alice } = await createFixtures();

    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [otherBranch] = await db
      .insert(branch)
      .values({ communityId: otherCommunity.id, name: "Other Branch" })
      .returning();

    await expect(
      createTask(alice, {
        branchId: otherBranch.id,
        title: "Sneaky task",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("updates editable fields without touching lifecycle state", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Water the trees",
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 2 },
    });

    const updated = await updateTask(alice, created.id, { title: "Water the fruit trees" });
    expect(updated.title).toBe("Water the fruit trees");
    expect(updated.status).toBe("unclaimed");
  });

  // Two cycles with phases + an unclaimed task filed under the first
  // cycle's Procurement phase — the fixture the phase/cycle invariant
  // tests below rest on.
  async function cycleStructure() {
    const { branch: testBranch, alice, community: testCommunity } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, testCommunity.id));

    const season = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      phases: [
        { name: "Procurement", order: 0, startDate: "2027-01-01", endDate: "2027-01-31" },
        { name: "Build", order: 1, startDate: "2027-02-01", endDate: "2027-04-01" },
      ],
    });
    const following = await createCycle(alice, {
      source: "blank",
      name: "Following",
      startDate: "2028-01-01",
      endDate: "2028-12-31",
      phases: [{ name: "Planting", order: 0, startDate: "2028-02-01", endDate: "2028-03-01" }],
      confirmed: true,
    });
    const [procurement] = await db.select().from(phase).where(eq(phase.cycleId, season.id)).orderBy(phase.order);
    const [planting] = await db.select().from(phase).where(eq(phase.cycleId, following.id)).orderBy(phase.order);

    const taskRow = await createTask(alice, {
      branchId: testBranch.id,
      title: "Grow the orchard",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      cycleId: season.id,
      phaseId: procurement.id,
    });
    return { alice, season, following, procurement, planting, taskRow };
  }

  it("drops a stale phase when a task moves into another cycle", async () => {
    const { alice, following, taskRow } = await cycleStructure();
    expect(taskRow.phaseId).not.toBeNull();

    const moved = await updateTask(alice, taskRow.id, { cycleId: following.id });
    expect(moved.cycleId).toBe(following.id);
    expect(moved.phaseId).toBeNull();
  });

  it("keeps a named phase that belongs to the destination cycle", async () => {
    const { alice, following, planting, taskRow } = await cycleStructure();

    const moved = await updateTask(alice, taskRow.id, { cycleId: following.id, phaseId: planting.id });
    expect(moved.cycleId).toBe(following.id);
    expect(moved.phaseId).toBe(planting.id);
  });

  it("clears the phase when the task's cycle is cleared", async () => {
    const { alice, taskRow } = await cycleStructure();

    const cleared = await updateTask(alice, taskRow.id, { cycleId: null });
    expect(cleared.cycleId).toBeNull();
    expect(cleared.phaseId).toBeNull();
  });

  it("deletes an unclaimed task created by the actor", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Throwaway task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    await deleteTask(alice, created.id);
    const [row] = await db.select().from(task).where(eq(task.id, created.id));
    expect(row).toBeUndefined();
  });

  it("rejects deleting a task created by someone else", async () => {
    const { branch: testBranch, alice, bob } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Alice's task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    await expect(deleteTask(bob, created.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects deleting a claimed task", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Held task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    await claimTask(alice, created.id);

    await expect(deleteTask(alice, created.id)).rejects.toThrow(ConflictError);
  });

  it("rejects deleting a task another task depends on", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const prerequisite = await createTask(alice, {
      branchId: testBranch.id,
      title: "Prerequisite",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    const dependent = await createTask(alice, {
      branchId: testBranch.id,
      title: "Dependent",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });
    await db.insert(taskDependency).values({
      taskId: dependent.id,
      dependsOnTaskId: prerequisite.id,
    });

    await expect(deleteTask(alice, prerequisite.id)).rejects.toThrow(ConflictError);
  });

  it("defaults capacity to uncapped for a community_endorsed task, unless overridden", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    const uncapped = await createTask(alice, {
      branchId: testBranch.id,
      title: "Admins",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      openness: "community_endorsed",
      endorsementThreshold: 3,
      browsePeriodEnd: future,
    });
    expect(uncapped.capacity).toBeNull();

    const capped = await createTask(alice, {
      branchId: testBranch.id,
      title: "Admins (capped)",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      openness: "community_endorsed",
      endorsementThreshold: 3,
      browsePeriodEnd: future,
      capacity: 5,
    });
    expect(capped.capacity).toBe(5);
  });

  it("rejects creating a community_endorsed task without a browsePeriodEnd or endorsementThreshold", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    await expect(
      createTask(alice, {
        branchId: testBranch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        openness: "community_endorsed",
        endorsementThreshold: 3,
        // no browsePeriodEnd
      }),
    ).rejects.toThrow(AppError);

    await expect(
      createTask(alice, {
        branchId: testBranch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        openness: "community_endorsed",
        browsePeriodEnd: future,
        // no endorsementThreshold
      }),
    ).rejects.toThrow(AppError);
  });

  it("accepts an endorsementThreshold of 0 as a deliberate choice, distinct from unset (Phase 62)", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Self-clearing task",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
      openness: "community_endorsed",
      endorsementThreshold: 0,
      browsePeriodEnd: future,
    });
    expect(created.endorsementThreshold).toBe(0);
  });

  it("rejects a negative endorsementThreshold", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const future = new Date(Date.now() + 86400000).toISOString();

    await expect(
      createTask(alice, {
        branchId: testBranch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        openness: "community_endorsed",
        endorsementThreshold: -1,
        browsePeriodEnd: future,
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects switching an existing task to community_endorsed without also setting the endorsement fields", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Ordinary task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    await expect(
      updateTask(alice, created.id, { openness: "community_endorsed" }),
    ).rejects.toThrow(AppError);
  });
});

describe("task placement validation and grant collision protection", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects creating a task with a cycle from another community", async () => {
    const { alice } = await createFixtures();
    const { community: otherCommunity } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, otherCommunity.id));
    const [otherBranch] = await db
      .insert(branch)
      .values({ communityId: otherCommunity.id, name: "Other Branch" })
      .returning();
    const [otherCycle] = await db
      .insert(cycle)
      .values({ communityId: otherCommunity.id, name: "Other Cycle" })
      .returning();

    await expect(
      createTask(alice, {
        branchId: otherBranch.id,
        cycleId: otherCycle.id,
        title: "Cross-community cycle",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects creating a task with a phase from another community's cycle", async () => {
    const { alice } = await createFixtures();
    const { community: otherCommunity } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, otherCommunity.id));
    const [otherBranch] = await db
      .insert(branch)
      .values({ communityId: otherCommunity.id, name: "Other Branch" })
      .returning();
    const [otherCycle] = await db
      .insert(cycle)
      .values({ communityId: otherCommunity.id, name: "Other Cycle" })
      .returning();
    const [otherPhase] = await db
      .insert(phase)
      .values({ cycleId: otherCycle.id, name: "Other Phase", order: 0 })
      .returning();

    await expect(
      createTask(alice, {
        branchId: otherBranch.id,
        cycleId: otherCycle.id,
        phaseId: otherPhase.id,
        title: "Cross-community phase",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects updating a task to a cycle from another community", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    const created = await createTask(alice, {
      branchId: testBranch.id,
      title: "Task to move",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    const { community: otherCommunity } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, otherCommunity.id));
    const [otherCycle] = await db
      .insert(cycle)
      .values({ communityId: otherCommunity.id, name: "Other Cycle" })
      .returning();

    await expect(
      updateTask(alice, created.id, { cycleId: otherCycle.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects updating a task to a phase not belonging to the resulting cycle", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, alice.communityId));
    const [cycleA] = await db
      .insert(cycle)
      .values({ communityId: alice.communityId, name: "Cycle A" })
      .returning();
    const [cycleB] = await db
      .insert(cycle)
      .values({ communityId: alice.communityId, name: "Cycle B" })
      .returning();
    const [phaseA] = await db
      .insert(phase)
      .values({ cycleId: cycleA.id, name: "Phase A", order: 0 })
      .returning();

    const created = await createTask(alice, {
      branchId: testBranch.id,
      cycleId: cycleA.id,
      phaseId: phaseA.id,
      title: "Task in A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    // Try to move to cycle B but keep phase from cycle A — phase is silently dropped
    const moved = await updateTask(alice, created.id, { cycleId: cycleB.id, phaseId: phaseA.id });
    expect(moved.cycleId).toBe(cycleB.id);
    expect(moved.phaseId).toBeNull();
  });

  it("rejects moving a Budget-granted task into an occupied Budget scope", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true, modulesEnabled: ["budget"] }).where(eq(community.id, alice.communityId));
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });

    // Task currently owns Budget in cycle A
    const budgetTaskA = await insertTask(alice.communityId, testBranch.id, alice.id, { cycleId: cycleA.id, title: "Budget owner A" });
    await grantPermission(alice.communityId, "budget", budgetTaskA.id);

    // Task in cycle B with Budget grant (different task)
    const budgetTaskB = await insertTask(alice.communityId, testBranch.id, alice.id, { cycleId: cycleB.id, title: "Budget owner B" });
    await grantPermission(alice.communityId, "budget", budgetTaskB.id);

    // Try to move budgetTaskA into cycle B (which already has a Budget owner)
    await expect(
      updateTask(alice, budgetTaskA.id, { cycleId: cycleB.id }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects moving a Budget-granted task into an occupied community/evergreen Budget scope", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true, modulesEnabled: ["budget"] }).where(eq(community.id, alice.communityId));

    // Community Budget owner
    const communityBudgetTask = await insertTask(alice.communityId, testBranch.id, alice.id, { title: "Community budget owner" });
    await grantPermission(alice.communityId, "budget", communityBudgetTask.id);

    // Task in cycle A with Budget grant
    const cycleA = await createCycle(alice, { source: "blank", name: "A", confirmed: true });
    const budgetTaskA = await insertTask(alice.communityId, testBranch.id, alice.id, { cycleId: cycleA.id, title: "Budget owner A" });
    await grantPermission(alice.communityId, "budget", budgetTaskA.id);

    // Try to move budgetTaskA to community scope (null) which already has a Budget owner
    await expect(
      updateTask(alice, budgetTaskA.id, { cycleId: null }),
    ).rejects.toThrow(ConflictError);
  });

  it("allows moving a granted task to an empty scope", async () => {
    const { alice, branch: testBranch } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true, modulesEnabled: ["budget"] }).where(eq(community.id, alice.communityId));
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });

    // Task in cycle A with Budget grant
    const budgetTaskA = await insertTask(alice.communityId, testBranch.id, alice.id, { cycleId: cycleA.id, title: "Budget owner A" });
    await grantPermission(alice.communityId, "budget", budgetTaskA.id);

    // Move to empty cycle B - should succeed
    const moved = await updateTask(alice, budgetTaskA.id, { cycleId: cycleB.id });
    expect(moved.cycleId).toBe(cycleB.id);

    // The grant should now apply to cycle B
    const grants = await listGrantingTaskIdsForScope(alice.communityId, "budget", cycleB.id);
    expect(grants).toEqual([budgetTaskA.id]);
    expect(await listGrantingTaskIdsForScope(alice.communityId, "budget", cycleA.id)).toEqual([]);
  });
});

describe("tag filtering (bulk task selection's clustering mechanism)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("filters listTasks by a tag in Task.tags", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    const tagged = await createTask(alice, {
      branchId: testBranch.id,
      title: "Pre-launch A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      tags: ["pre-launch"],
    });
    await createTask(alice, {
      branchId: testBranch.id,
      title: "Untagged",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
    });

    const filtered = await listTasks(alice, { tag: "pre-launch" });
    expect(filtered.map((t) => t.id)).toEqual([tagged.id]);
  });

  it("listDistinctTags returns every distinct tag in the community, deduplicated", async () => {
    const { branch: testBranch, alice } = await createFixtures();
    await createTask(alice, {
      branchId: testBranch.id,
      title: "A",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      tags: ["pre-launch", "fruit"],
    });
    await createTask(alice, {
      branchId: testBranch.id,
      title: "B",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      tags: ["pre-launch"],
    });

    expect(await listDistinctTags(alice)).toEqual(["fruit", "pre-launch"]);
  });
});

// Which rung of the approval ladder a permission-granting task sits on decides
// who can take the role, so `openness` is an authority field on those tasks
// rather than a cosmetic one. This was unguarded while the *cycle move* on the
// same task was guarded — and `PATCH /api/tasks/[id]` takes the whole
// updateTaskInput behind requireWriteMember, so any member could retune
// someone else's ladder.
//
// The Admin case was the sharp end of it. `requireAdmins` filters on
// `openness = 'community_endorsed'` and ignores placement, so moving an Admins
// task off that rung strips Admin from every current holder — who is then
// refused at the very screen that would fix it, and which no task-edit form
// exposes `openness` to undo. Demonstrated, then fixed.
describe("openness on a permission-granting task", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function makeAdminsTask(communityId: string, branchId: string, alice: { id: string }) {
    const t = await insertTask(communityId, branchId, alice.id, {
      title: "Admins",
      openness: "community_endorsed",
      // A community_endorsed task is only coherent with both a threshold and
      // a window to clear it in (requireEndorsementFields), so a fixture
      // that omits them isn't a real Admins task.
      endorsementThreshold: 2,
      browsePeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await grantPermission(communityId, "admin", t.id);
    return t;
  }

  // `requireAdmins` returns early for every member while `adminsEverClaimed`
  // is false — the guard against a fresh install locking itself out. Without
  // latching it, "only an admin may do this" tests nothing at all, because
  // everyone is an admin.
  async function latchAdmins(communityId: string) {
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, communityId));
  }

  it("refuses to move an Admins task off community-endorsed, even for an admin", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await makeAdminsTask(c.id, branch.id, alice);
    await latchAdmins(c.id);
    // The actor has to actually hold it, or requireAdmins refuses first and
    // the test would pass for the wrong reason.
    await claimTask(alice, t.id);

    await expect(updateTask(alice, t.id, { openness: "open" })).rejects.toThrow(
      /only a community-endorsed task can confer them/i,
    );
    await expect(updateTask(alice, t.id, { openness: "coordination_approved" })).rejects.toThrow(
      ConflictError,
    );

    // Untouched, so the grant still works.
    const [after] = await db.select().from(task).where(eq(task.id, t.id));
    expect(after.openness).toBe("community_endorsed");
  });

  it("refuses the openness change to a non-admin even for a harmless module", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { title: "Kitchen lead" });
    await grantPermission(c.id, "kitchen", t.id);
    await makeAdminsTask(c.id, branch.id, alice);
    await latchAdmins(c.id);

    // kitchen -> open would make the role instantly claimable by anyone.
    await expect(updateTask(bob, t.id, { openness: "open" })).rejects.toThrow(ForbiddenError);
    const [after] = await db.select().from(task).where(eq(task.id, t.id));
    expect(after.openness).toBe("request");
  });

  it("still lets an admin retune openness on a non-Admin grant", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { title: "Kitchen lead" });
    await grantPermission(c.id, "kitchen", t.id);
    const admins = await makeAdminsTask(c.id, branch.id, alice);
    await latchAdmins(c.id);
    await claimTask(alice, admins.id);

    const updated = await updateTask(alice, t.id, { openness: "coordination_approved" });
    expect(updated.openness).toBe("coordination_approved");
  });

  it("leaves openness on an ordinary task entirely alone", async () => {
    // The guard is scoped to tasks that actually grant something. A task
    // holding no grant mints no authority, so its openness is nobody else's
    // business and gating it would be a surprise.
    const { community: c, branch, alice, bob } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { title: "Water the trees" });

    const updated = await updateTask(bob, t.id, { openness: "open" });
    expect(updated.openness).toBe("open");
  });

  it("treats re-submitting the same openness as no change at all", async () => {
    // Every settings-style form resubmits its own fields, so an unchanged
    // openness must not trip the guard — the Admins task's own edit form
    // would otherwise be unable to save a title change.
    const { community: c, branch, alice } = await createFixtures();
    const t = await makeAdminsTask(c.id, branch.id, alice);
    await latchAdmins(c.id);
    await claimTask(alice, t.id);

    const updated = await updateTask(alice, t.id, {
      title: "Admins (renamed)",
      openness: "community_endorsed",
    });
    expect(updated.title).toBe("Admins (renamed)");
  });
});
