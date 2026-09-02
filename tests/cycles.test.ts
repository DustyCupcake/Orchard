import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle, member, requirement, task, taskDependency, taskMilestone, tier } from "@/db/schema";
import { createCycle, getCycle, listCycles, previewClonePreviousCycle, updateCycleSettings } from "@/lib/cycles";
import { claimAsShadow, claimTask, createRequirement, createTaskMilestone } from "@/lib/tasks";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string, cycleInitiationTierId?: string) {
  await db
    .update(community)
    .set({ cyclesEnabled: true, cycleInitiationTierId: cycleInitiationTierId ?? null })
    .where(eq(community.id, communityId));
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

describe("cycle creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects creating a cycle when the Community hasn't turned cycles on", async () => {
    const { alice } = await createFixtures();
    await expect(createCycle(alice, { source: "blank", name: "2027 Season" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("creates a blank cycle, active immediately, with no automated round gating", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);

    const created = await createCycle(alice, { source: "blank", name: "2027 Season" });
    expect(created.status).toBe("active");
    expect(created.sourceType).toBe("blank");
    expect(created.startedBy).toBe(alice.id);
  });

  it("attaches phases defined at creation time", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);

    const created = await createCycle(alice, {
      source: "blank",
      name: "2027 Season",
      phases: [
        { name: "Procurement", order: 1 },
        { name: "Build", order: 2 },
      ],
    });

    const withPhases = await getCycle(alice, created.id);
    expect(withPhases.phases.map((p) => p.name)).toEqual(["Procurement", "Build"]);
    expect(withPhases.phases.every((p) => p.startDate === null)).toBe(true);
  });

  it("gates initiation on the configured Tier, when one is set", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    const [experienced] = await db
      .insert(tier)
      .values({ communityId: testCommunity.id, name: "Experienced" })
      .returning();
    await enableCycles(testCommunity.id, experienced.id);

    await expect(
      createCycle(alice, { source: "blank", name: "2027 Season" }),
    ).rejects.toThrow(ForbiddenError);

    await db.update(member).set({ tierIds: [experienced.id] }).where(eq(member.id, alice.id));
    const [eligibleAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    const created = await createCycle(eligibleAlice, { source: "blank", name: "2027 Season" });
    expect(created.name).toBe("2027 Season");
  });

  it("with no Tier configured, any member may initiate", async () => {
    const { community: testCommunity, bob } = await createFixtures();
    await enableCycles(testCommunity.id);

    const created = await createCycle(bob, { source: "blank", name: "2027 Season" });
    expect(created.startedBy).toBe(bob.id);
  });
});

describe("cloning the previous cycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("fails with no previous cycle to clone", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);

    await expect(
      createCycle(alice, { source: "clone_previous", name: "2027 Season" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("clones phases, tasks (reset to unclaimed), requirements, and in-set dependencies", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);

    const previous = await createCycle(alice, {
      source: "blank",
      name: "2026 Season",
      phases: [
        { name: "Procurement", order: 1 },
        { name: "Build", order: 2 },
      ],
    });
    const previousWithPhases = await getCycle(alice, previous.id);
    const buildPhase = previousWithPhases.phases.find((p) => p.name === "Build")!;

    const prerequisite = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: previous.id,
      title: "Set up the tool shed",
    });
    const gated = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: previous.id,
      phaseId: buildPhase.id,
      title: "Build the arbor",
      capacity: 3,
    });
    await createRequirement(alice, gated.id, {
      type: "custom",
      value: { flag: "power_tool_cert" },
    });
    await db.insert(taskDependency).values({
      taskId: gated.id,
      dependsOnTaskId: prerequisite.id,
    });

    // Standing task, not part of the cycle — its dependency shouldn't
    // be dragged along, and the task itself shouldn't be cloned.
    const standing = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Ongoing: check the mail",
    });
    await db.insert(taskDependency).values({
      taskId: gated.id,
      dependsOnTaskId: standing.id,
    });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season" });
    expect(cloned.sourceType).toBe("pack");

    const clonedWithPhases = await getCycle(alice, cloned.id);
    expect(clonedWithPhases.phases.map((p) => p.name)).toEqual(["Procurement", "Build"]);
    const clonedBuildPhase = clonedWithPhases.phases.find((p) => p.name === "Build")!;

    const clonedTasks = await db.select().from(task).where(eq(task.cycleId, cloned.id));
    expect(clonedTasks).toHaveLength(2);

    const clonedGated = clonedTasks.find((t) => t.title === "Build the arbor")!;
    expect(clonedGated.status).toBe("unclaimed");
    expect(clonedGated.clonedFromTaskId).toBe(gated.id);
    expect(clonedGated.capacity).toBe(3);
    expect(clonedGated.phaseId).toBe(clonedBuildPhase.id);

    const clonedPrerequisite = clonedTasks.find((t) => t.title === "Set up the tool shed")!;

    const clonedRequirements = await db
      .select()
      .from(requirement)
      .where(eq(requirement.taskId, clonedGated.id));
    expect(clonedRequirements).toHaveLength(1);
    expect((clonedRequirements[0].value as { flag: string }).flag).toBe("power_tool_cert");

    const clonedDeps = await db
      .select()
      .from(taskDependency)
      .where(eq(taskDependency.taskId, clonedGated.id));
    expect(clonedDeps).toHaveLength(1);
    expect(clonedDeps[0].dependsOnTaskId).toBe(clonedPrerequisite.id);

    // The original cycle's tasks are untouched.
    const originalGated = await db.select().from(task).where(eq(task.id, gated.id));
    expect(originalGated[0].cycleId).toBe(previous.id);
  });

  it("clones the most recently started cycle when several exist", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);

    const older = await createCycle(alice, { source: "blank", name: "2025 Season" });
    const newer = await createCycle(alice, { source: "blank", name: "2026 Season" });
    // startedAt is set to `new Date()` on creation, close enough in time
    // that relying on clock granularity alone would be flaky — pin the
    // order explicitly instead.
    await db
      .update(cycle)
      .set({ startedAt: new Date("2025-01-01T00:00:00Z") })
      .where(eq(cycle.id, older.id));
    await db
      .update(cycle)
      .set({ startedAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(cycle.id, newer.id));

    await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: older.id,
      title: "Only in the older cycle",
    });
    await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: newer.id,
      title: "Only in the newer cycle",
    });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season" });
    const clonedTasks = await db.select().from(task).where(eq(task.cycleId, cloned.id));
    expect(clonedTasks.map((t) => t.title)).toEqual(["Only in the newer cycle"]);

    // listCycles should reflect the same most-recent-first ordering.
    const all = await listCycles(alice);
    expect(all.map((c) => c.name)).toEqual(["2027 Season", "2026 Season", "2025 Season"]);
  });

  it("pre-fills suggestedMemberId from a filled shadow slot on the source task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);

    const previous = await createCycle(alice, { source: "blank", name: "2026 Season" });
    const shadowed = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: previous.id,
      title: "Water the trees",
    });
    const unshadowed = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: previous.id,
      title: "Prune the hedges",
    });
    await claimTask(alice, shadowed.id);
    await claimAsShadow(bob, shadowed.id);
    await claimTask(alice, unshadowed.id);

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season" });
    const clonedTasks = await db.select().from(task).where(eq(task.cycleId, cloned.id));

    const clonedShadowed = clonedTasks.find((t) => t.title === "Water the trees")!;
    expect(clonedShadowed.suggestedMemberId).toBe(bob.id);

    const clonedUnshadowed = clonedTasks.find((t) => t.title === "Prune the hedges")!;
    expect(clonedUnshadowed.suggestedMemberId).toBeNull();
  });

  it("picks the earliest shadow when a task had more than one", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    await enableCycles(testCommunity.id);

    const previous = await createCycle(alice, { source: "blank", name: "2026 Season" });
    const t = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: previous.id,
      capacity: 1,
    });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);
    await claimAsShadow(carol, t.id);

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season" });
    const [clonedTask] = await db.select().from(task).where(eq(task.cycleId, cloned.id));
    expect(clonedTask.suggestedMemberId).toBe(bob.id);
  });
});

// docs/development-plan.md's Phase 44 — the Pack import date preview,
// a pure non-mutating computation the Calendar view's "start a new
// cycle" flow calls before anything actually clones.
describe("previewClonePreviousCycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns null with no previous cycle to clone", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    expect(await previewClonePreviousCycle(alice, "2027-01-01", "2027-12-31")).toBeNull();
  });

  it("resolves phase and milestone dates against the hypothetical destination, matching what a real clone produces", async () => {
    const { alice, branch, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);

    const previous = await createCycle(alice, {
      source: "blank",
      name: "2026 Season",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      phases: [{ name: "Build", order: 0, startDate: "2026-02-01", endDate: "2026-03-01" }],
    });
    const withPhases = await getCycle(alice, previous.id);
    const build = withPhases.phases[0];

    const gated = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: previous.id,
      phaseId: build.id,
      title: "Build the arbor",
    });
    await db.insert(taskMilestone).values({
      taskId: gated.id,
      phaseId: build.id,
      label: "Halfway check-in",
      dateType: "relative",
      relativeMode: "offset",
      anchorType: "phase_start",
      offsetDays: 5,
      status: "confirmed",
      proposedBy: alice.id,
      createdBy: alice.id,
    });

    const preview = await previewClonePreviousCycle(alice, "2027-03-01", "2027-11-30");
    expect(preview?.sourceCycleName).toBe("2026 Season");
    expect(preview?.phases).toEqual([{ name: "Build", order: 0, start: "2027-04-01", end: "2027-04-29" }]);
    expect(preview?.milestones).toEqual([
      { taskTitle: "Build the arbor", label: "Halfway check-in", phaseName: "Build", date: "2027-04-06" },
    ]);

    // The preview promises to match what a real clone + a real
    // updateCycleSettings call actually produces — prove it.
    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season" });
    await updateCycleSettings(alice, cloned.id, { startDate: "2027-03-01", endDate: "2027-11-30" });
    const clonedWithPhases = await getCycle(alice, cloned.id);
    expect(clonedWithPhases.phases[0].startDate).toBe(preview?.phases[0].start);
    expect(clonedWithPhases.phases[0].endDate).toBe(preview?.phases[0].end);
  });

  it("drops an absolute or still-pending milestone from the preview, same as a real clone", async () => {
    const { alice, bob, branch, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    const previous = await createCycle(alice, { source: "blank", name: "2026 Season" });
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: previous.id });
    await claimTask(alice, t.id);

    await db.insert(taskMilestone).values({
      taskId: t.id,
      label: "Pinned",
      dateType: "absolute",
      absoluteDate: "2026-06-15",
      status: "confirmed",
      proposedBy: alice.id,
      createdBy: alice.id,
    });
    await createTaskMilestone(bob, t.id, {
      label: "Unreviewed",
      date: { type: "relative_offset", anchor: "cycle_start", offsetDays: 1 },
    });

    const preview = await previewClonePreviousCycle(alice, "2027-01-01", "2027-12-31");
    expect(preview?.milestones).toHaveLength(0);
  });
});
