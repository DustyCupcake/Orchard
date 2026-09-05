import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, phase, task, taskAssignment, taskMilestone } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import {
  confirmTaskMilestone,
  createTaskMilestone,
  deleteTaskMilestone,
  listMyTaskMilestones,
  listTaskMilestones,
  updateTaskMilestone,
} from "@/lib/tasks";
import { createCycle, getCycle, updateCycleSettings } from "@/lib/cycles";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

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
      title: "Order the seedlings",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

// A Cycle (2027-01-01..2027-12-31) with two phases: Procurement
// (2027-01-01..2027-01-31) and Build (2027-02-01..2027-04-01), plus an
// unclaimed task filed under Procurement.
async function setUp() {
  const fixtures = await createFixtures();
  const { alice, branch, community: testCommunity } = fixtures;
  await enableCycles(testCommunity.id);

  const cyc = await createCycle(alice, {
    source: "blank",
    name: "Season",
    startDate: "2027-01-01",
    endDate: "2027-12-31",
    phases: [
      { name: "Procurement", order: 0, startDate: "2027-01-01", endDate: "2027-01-31" },
      { name: "Build", order: 1, startDate: "2027-02-01", endDate: "2027-04-01" },
    ],
  });
  const [procurement, build] = await db.select().from(phase).where(eq(phase.cycleId, cyc.id)).orderBy(phase.order);

  const taskRow = await insertTask(testCommunity.id, branch.id, alice.id, {
    cycleId: cyc.id,
    phaseId: procurement.id,
  });

  return { ...fixtures, cyc, procurement, build, taskRow };
}

describe("resolving a milestone's date", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("absolute resolves to its exact date", async () => {
    const { alice, taskRow } = await setUp();
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Deposit due",
      date: { type: "absolute", date: "2027-01-15" },
    });
    expect(m.resolvedDate).toBe("2027-01-15");
    expect(m.status).toBe("confirmed");
  });

  it("cycle-anchored offset resolves against the task's own Cycle", async () => {
    const { alice, taskRow } = await setUp();
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Early bird",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 10 },
    });
    expect(m.resolvedDate).toBe("2027-01-11");
  });

  it("phase-anchored offset defaults to the task's own Phase", async () => {
    const { alice, taskRow } = await setUp();
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Confirm order",
      date: { type: "relative_offset", anchor: "phase_start", offsetDays: 5 },
    });
    expect(m.resolvedDate).toBe("2027-01-06"); // Procurement starts 2027-01-01
  });

  it("phase-anchored offset can point at a different Phase in the same Cycle", async () => {
    const { alice, taskRow, build } = await setUp();
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Related to Build's end",
      date: { type: "relative_offset", anchor: "phase_end", phaseId: build.id, offsetDays: -3 },
    });
    expect(m.resolvedDate).toBe("2027-03-29"); // Build ends 2027-04-01
  });

  it("rejects a Phase belonging to a different Cycle", async () => {
    const { alice, taskRow } = await setUp();
    const otherCycle = await createCycle(alice, {
      source: "blank",
      name: "Other Season",
      phases: [{ name: "Other phase", order: 0 }],
      confirmed: true,
    });
    const otherPhase = (await getCycle(alice, otherCycle.id)).phases[0];

    await expect(
      createTaskMilestone(alice, taskRow.id, {
        label: "Cross-cycle",
        date: { type: "relative_offset", anchor: "phase_start", phaseId: otherPhase.id, offsetDays: 0 },
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("percent resolves proportionally between the anchor's own two ends", async () => {
    const { alice, taskRow, build } = await setUp();
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Midpoint of Build",
      date: { type: "relative_percent", anchor: "phase_start", phaseId: build.id, percent: 50 },
    });
    // Build spans 2027-02-01..2027-04-01, a 59-day span; 50% ~ +30 days
    expect(m.resolvedDate).toBe("2027-03-03");
  });

  it("cycle-anchored milestone doesn't resolve on a task with no Cycle", async () => {
    const { alice, branch, community: testCommunity } = await setUp();
    const standaloneTask = await insertTask(testCommunity.id, branch.id, alice.id);
    const m = await createTaskMilestone(alice, standaloneTask.id, {
      label: "Someday",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 3 },
    });
    expect(m.resolvedDate).toBeNull();
  });

  it("phase-anchored milestone doesn't resolve when the task has no Phase and none was given", async () => {
    const { alice, branch, cyc } = await setUp();
    const taskNoPhase = await insertTask(cyc.communityId, branch.id, alice.id, { cycleId: cyc.id });
    const m = await createTaskMilestone(alice, taskNoPhase.id, {
      label: "Whenever the phase is",
      date: { type: "relative_offset", anchor: "phase_start", offsetDays: 1 },
    });
    expect(m.resolvedDate).toBeNull();
  });

  it("reverse-computes the offset from a dragged target date", async () => {
    const { alice, taskRow } = await setUp();
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Dragged",
      date: { type: "relative_offset", anchor: "cycle_start", targetDate: "2027-02-01" },
    });
    expect(m.offsetDays).toBe(31);
    expect(m.resolvedDate).toBe("2027-02-01");
  });

  it("rejects dragging to a date when the anchor isn't resolvable yet", async () => {
    const { alice, branch, community: testCommunity } = await setUp();
    const standaloneTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await expect(
      createTaskMilestone(alice, standaloneTask.id, {
        label: "Dragged nowhere",
        date: { type: "relative_offset", anchor: "cycle_start", targetDate: "2027-02-01" },
      }),
    ).rejects.toThrow(AppError);
  });
});

describe("confirmation follows ownership", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a holder's own add is confirmed immediately", async () => {
    const { alice, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Direct",
      date: { type: "absolute", date: "2027-01-10" },
    });
    expect(m.status).toBe("confirmed");
    expect(m.proposedBy).toBe(alice.id);
    expect(m.createdBy).toBe(alice.id);
  });

  it("an unclaimed task has no holder to gate against — confirmed immediately regardless of who adds it", async () => {
    const { bob, taskRow } = await setUp();
    const m = await createTaskMilestone(bob, taskRow.id, {
      label: "Anyone's add",
      date: { type: "absolute", date: "2027-01-10" },
    });
    expect(m.status).toBe("confirmed");
  });

  it("a non-holder's add on a claimed task lands pending", async () => {
    const { alice, bob, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const m = await createTaskMilestone(bob, taskRow.id, {
      label: "Suggested by Bob",
      date: { type: "absolute", date: "2027-01-10" },
    });
    expect(m.status).toBe("pending");
    expect(m.proposedBy).toBe(bob.id);
    expect(m.createdBy).toBe(bob.id);
  });

  it("a holder confirming reassigns createdBy but leaves proposedBy alone", async () => {
    const { alice, bob, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const pending = await createTaskMilestone(bob, taskRow.id, {
      label: "Suggested by Bob",
      date: { type: "absolute", date: "2027-01-10" },
    });

    const confirmed = await confirmTaskMilestone(alice, pending.id);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.proposedBy).toBe(bob.id);
    expect(confirmed.createdBy).toBe(alice.id);
  });

  it("rejecting a pending milestone just removes the row", async () => {
    const { alice, bob, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const pending = await createTaskMilestone(bob, taskRow.id, {
      label: "Suggested by Bob",
      date: { type: "absolute", date: "2027-01-10" },
    });

    await deleteTaskMilestone(alice, pending.id);
    const rows = await listTaskMilestones(alice, taskRow.id);
    expect(rows).toHaveLength(0);
  });

  it("confirming an already-confirmed milestone 409s", async () => {
    const { alice, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Direct",
      date: { type: "absolute", date: "2027-01-10" },
    });
    await expect(confirmTaskMilestone(alice, m.id)).rejects.toThrow(ConflictError);
  });

  it("a non-holder can't edit, remove, or confirm — even their own pending proposal", async () => {
    const { alice, bob, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const pending = await createTaskMilestone(bob, taskRow.id, {
      label: "Suggested by Bob",
      date: { type: "absolute", date: "2027-01-10" },
    });

    await expect(updateTaskMilestone(bob, pending.id, { label: "Edited" })).rejects.toThrow(ForbiddenError);
    await expect(deleteTaskMilestone(bob, pending.id)).rejects.toThrow(ForbiddenError);
    await expect(confirmTaskMilestone(bob, pending.id)).rejects.toThrow(ForbiddenError);
  });

  it("any co-holder on a multi-slot task can act directly, no rank", async () => {
    const { alice, bob, taskRow } = await setUp();
    await db.update(task).set({ capacity: 2 }).where(eq(task.id, taskRow.id));
    await claimTask(alice, taskRow.id);
    await claimTask(bob, taskRow.id);

    const m = await createTaskMilestone(bob, taskRow.id, {
      label: "Bob's own direct add",
      date: { type: "absolute", date: "2027-01-10" },
    });
    expect(m.status).toBe("confirmed");

    const edited = await updateTaskMilestone(alice, m.id, { label: "Edited by Alice" });
    expect(edited.label).toBe("Edited by Alice");
  });

  it("a holder edits their own milestone's date directly, no confirmation step", async () => {
    const { alice, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Direct",
      date: { type: "absolute", date: "2027-01-10" },
    });
    const updated = await updateTaskMilestone(alice, m.id, {
      date: { type: "absolute", date: "2027-01-20" },
    });
    expect(updated.resolvedDate).toBe("2027-01-20");
    expect(updated.status).toBe("confirmed");
  });

  it("404s across communities", async () => {
    const { taskRow } = await setUp();
    const { alice: stranger } = await createFixtures();
    await expect(
      createTaskMilestone(stranger, taskRow.id, { label: "x", date: { type: "absolute", date: "2027-01-01" } }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("the drift flag", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("surfaces once the Cycle's own dates move an offset milestone closer to the other end", async () => {
    const { alice, taskRow } = await setUp();
    const m = await createTaskMilestone(alice, taskRow.id, {
      label: "Near the start",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 4 },
    });

    const [before] = await listTaskMilestones(alice, taskRow.id);
    expect(before.id).toBe(m.id);
    expect(before.drifted).toBe(false);

    // Shrink the cycle so the fixed 4-day offset now sits much closer
    // to cycle_end than to the cycle_start it's actually anchored to.
    await updateCycleSettings(alice, taskRow.cycleId!, { endDate: "2027-01-06" });

    const [after] = await listTaskMilestones(alice, taskRow.id);
    expect(after.drifted).toBe(true);
  });

  it("percent mode is structurally immune to drift", async () => {
    const { alice, taskRow, build } = await setUp();
    await createTaskMilestone(alice, taskRow.id, {
      label: "Near the end, percent",
      date: { type: "relative_percent", anchor: "phase_start", phaseId: build.id, percent: 97 },
    });

    const [m] = await listTaskMilestones(alice, taskRow.id);
    expect(m.drifted).toBe(false);
  });
});

describe("carrying forward through a Cycle clone", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("carries a confirmed relative milestone's recipe, remapping a Phase reference onto the cloned Phase", async () => {
    const { alice, taskRow, build } = await setUp();
    await createTaskMilestone(alice, taskRow.id, {
      label: "Related to Build",
      date: { type: "relative_offset", anchor: "phase_end", phaseId: build.id, offsetDays: -3 },
    });
    await createTaskMilestone(alice, taskRow.id, {
      label: "Cycle-anchored",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 2 },
    });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "Next Season", confirmed: true });
    const clonedTasks = await db.select().from(task).where(eq(task.cycleId, cloned.id));
    expect(clonedTasks).toHaveLength(1);
    const clonedTaskId = clonedTasks[0].id;

    const clonedMilestones = await db.select().from(taskMilestone).where(eq(taskMilestone.taskId, clonedTaskId));
    expect(clonedMilestones).toHaveLength(2);

    const clonedPhaseAnchored = clonedMilestones.find((m) => m.anchorType === "phase_end")!;
    expect(clonedPhaseAnchored.offsetDays).toBe(-3);
    expect(clonedPhaseAnchored.status).toBe("confirmed");
    expect(clonedPhaseAnchored.phaseId).not.toBe(build.id); // remapped onto the new clone's own Build
    expect(clonedPhaseAnchored.phaseId).not.toBeNull();

    const clonedCycleAnchored = clonedMilestones.find((m) => m.anchorType === "cycle_start")!;
    expect(clonedCycleAnchored.offsetDays).toBe(2);
    expect(clonedCycleAnchored.phaseId).toBeNull();
  });

  it("drops an absolute milestone entirely on clone", async () => {
    const { alice, taskRow } = await setUp();
    await createTaskMilestone(alice, taskRow.id, {
      label: "Pinned to the real world",
      date: { type: "absolute", date: "2027-01-15" },
    });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "Next Season", confirmed: true });
    const clonedTasks = await db.select().from(task).where(eq(task.cycleId, cloned.id));
    const clonedMilestones = await db.select().from(taskMilestone).where(eq(taskMilestone.taskId, clonedTasks[0].id));
    expect(clonedMilestones).toHaveLength(0);
  });

  it("drops a still-pending milestone entirely on clone", async () => {
    const { alice, bob, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    await createTaskMilestone(bob, taskRow.id, {
      label: "Unreviewed",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 1 },
    });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "Next Season", confirmed: true });
    const clonedTasks = await db.select().from(task).where(eq(task.cycleId, cloned.id));
    const clonedMilestones = await db.select().from(taskMilestone).where(eq(taskMilestone.taskId, clonedTasks[0].id));
    expect(clonedMilestones).toHaveLength(0);
  });

});

// The Calendar view's own read layer (docs/development-plan.md's Phase
// 44 — "their own task milestones").
describe("listMyTaskMilestones", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only surfaces a confirmed milestone on a task the actor currently holds", async () => {
    const { alice, bob, taskRow } = await setUp();
    await claimTask(alice, taskRow.id);
    const confirmed = await createTaskMilestone(alice, taskRow.id, {
      label: "Order arrives",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 5 },
    });
    // Bob's own addition to a task Alice holds lands pending — shouldn't
    // surface for Alice, and Bob doesn't hold the task at all.
    await createTaskMilestone(bob, taskRow.id, {
      label: "Unreviewed",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 1 },
    });

    const mine = await listMyTaskMilestones(alice);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(confirmed.id);
    expect(mine[0].taskTitle).toBe(taskRow.title);
    expect(mine[0].resolvedDate).not.toBeNull();

    expect(await listMyTaskMilestones(bob)).toHaveLength(0);
  });

  it("excludes a milestone on a task the actor only shadows, or that's already done", async () => {
    const { alice, bob, taskRow, cyc, branch, community: testCommunity } = await setUp();
    await claimTask(alice, taskRow.id);
    await db.insert(taskMilestone).values({
      taskId: taskRow.id,
      label: "Shadow shouldn't see this",
      dateType: "relative",
      relativeMode: "offset",
      anchorType: "cycle_start",
      offsetDays: 1,
      status: "confirmed",
      proposedBy: alice.id,
      createdBy: alice.id,
    });
    await db.insert(taskAssignment).values({ taskId: taskRow.id, memberId: bob.id, isShadow: true });

    expect(await listMyTaskMilestones(bob)).toHaveLength(0);

    const [doneTask] = await db
      .insert(task)
      .values({
        communityId: testCommunity.id,
        branchId: branch.id,
        cycleId: cyc.id,
        title: "Already finished",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
        createdBy: alice.id,
        status: "done",
      })
      .returning();
    await db.insert(taskAssignment).values({ taskId: doneTask.id, memberId: alice.id, isShadow: false });
    await db.insert(taskMilestone).values({
      taskId: doneTask.id,
      label: "Stale",
      dateType: "relative",
      relativeMode: "offset",
      anchorType: "cycle_start",
      offsetDays: 1,
      status: "confirmed",
      proposedBy: alice.id,
      createdBy: alice.id,
    });

    expect(await listMyTaskMilestones(alice)).toHaveLength(1); // still just taskRow's own
  });
});
