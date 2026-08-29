import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, phase, shiftOccurrence, task, taskAssignment } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import { createShiftSeries, generateShiftOccurrences, markShiftSignupCompleted, signUpForShift } from "@/lib/shifts";
import { updateCommunity } from "@/lib/settings";
import {
  getContributionCommunityAverage,
  getOwnContribution,
  getVisibleContribution,
  listVisibleContributors,
  updateContributionVisibility,
} from "@/lib/contribution";
import { declareParticipation } from "@/lib/participation";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
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
      title: "Water the trees",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

async function assign(taskId: string, memberId: string, isShadow = false) {
  await db.insert(taskAssignment).values({ taskId, memberId, isShadow });
}

const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const nextWeek = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const iso = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();

// Signing up requires a future occurrence; ages it into the past
// afterward, then self-reports completion — the same technique
// tests/shifts.test.ts uses for its own completion tests.
async function completeAShift(actor: Awaited<ReturnType<typeof createFixtures>>["alice"], branchId: string) {
  await updateCommunity(actor, { modulesEnabled: ["shifts"] });
  const series = await createShiftSeries(actor, {
    title: "Dish duty",
    defaultCapacity: 2,
    branchId,
  });
  const [occurrence] = await generateShiftOccurrences(actor, series.id, {
    mode: "explicit",
    slots: [{ startsAt: iso(24), endsAt: iso(25) }],
  });
  const signup = await signUpForShift(actor, occurrence.id);
  await db
    .update(shiftOccurrence)
    .set({ startsAt: new Date(iso(-2)), endsAt: new Date(iso(-1)) })
    .where(eq(shiftOccurrence.id, occurrence.id));
  await markShiftSignupCompleted(actor, signup.id);
  return { series, occurrence, signup };
}

describe("getOwnContribution: categorization", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("falls back to a single 'Overall' category for phase-less tasks", async () => {
    const { alice, branch } = await createFixtures();
    const claimed = await insertTask(alice.communityId, branch.id, alice.id, { status: "claimed" });
    const done = await insertTask(alice.communityId, branch.id, alice.id, { status: "done", title: "Done one" });
    await assign(claimed.id, alice.id);
    await assign(done.id, alice.id);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe("Overall");
    expect(categories[0].active.count).toBe(1);
    expect(categories[0].completed.count).toBe(1);
    expect(categories[0].future.count).toBe(0);
  });

  it("excludes shadow assignments entirely", async () => {
    const { alice, branch } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id, { status: "claimed" });
    await assign(t.id, alice.id, true);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(0);
  });

  it("buckets a task in a not-yet-started phase as future, regardless of status", async () => {
    const { alice, branch } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: nextWeek(), endDate: null }],
    });
    const [buildPhase] = await db.select().from(phase).where(eq(phase.cycleId, cyc.id));

    const t = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      phaseId: buildPhase.id,
      cycleId: cyc.id,
    });
    await assign(t.id, alice.id);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe("Build");
    expect(categories[0].future.count).toBe(1);
    expect(categories[0].active.count).toBe(0);
  });

  it("buckets a task in an already-started phase as active or completed", async () => {
    const { alice, branch } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: yesterday(), endDate: null }],
    });
    const [buildPhase] = await db.select().from(phase).where(eq(phase.cycleId, cyc.id));

    const active = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      phaseId: buildPhase.id,
    });
    const completed = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "done",
      phaseId: buildPhase.id,
      title: "Finished build task",
    });
    await assign(active.id, alice.id);
    await assign(completed.id, alice.id);

    const categories = await getOwnContribution(alice);
    expect(categories[0].active.count).toBe(1);
    expect(categories[0].completed.count).toBe(1);
    expect(categories[0].future.count).toBe(0);
  });

  it("done wins over a future-dated phase (data-integrity edge case)", async () => {
    const { alice, branch } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Wind-down", order: 0, startDate: nextWeek(), endDate: null }],
    });
    const [p] = await db.select().from(phase).where(eq(phase.cycleId, cyc.id));

    const t = await insertTask(alice.communityId, branch.id, alice.id, { status: "done", phaseId: p.id });
    await assign(t.id, alice.id);

    const categories = await getOwnContribution(alice);
    expect(categories[0].completed.count).toBe(1);
    expect(categories[0].future.count).toBe(0);
  });

  it("merges categories across cycles by phase name, not by phase id", async () => {
    const { alice, branch } = await createFixtures();
    await enableCycles(alice.communityId);

    const cyc1 = await createCycle(alice, {
      source: "blank",
      name: "Season 1",
      phases: [{ name: "Planning", order: 0, startDate: yesterday(), endDate: null }],
    });
    const [planning1] = await db.select().from(phase).where(eq(phase.cycleId, cyc1.id));

    const cyc2 = await createCycle(alice, {
      source: "blank",
      name: "Season 2",
      phases: [{ name: "Planning", order: 0, startDate: yesterday(), endDate: null }],
    });
    const [planning2] = await db.select().from(phase).where(eq(phase.cycleId, cyc2.id));

    const t1 = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      phaseId: planning1.id,
      title: "Season 1 planning task",
    });
    const t2 = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      phaseId: planning2.id,
      title: "Season 2 planning task",
    });
    await assign(t1.id, alice.id);
    await assign(t2.id, alice.id);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe("Planning");
    expect(categories[0].active.count).toBe(2);
  });

  it("sums hours_per_week for ongoing/owns_a_thing tasks, excludes one_off from the hours total", async () => {
    const { alice, branch } = await createFixtures();
    const ongoing = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 3 },
    });
    const oneOff = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      effort: "one_off",
      effortMagnitude: { duration: "half_day" },
      title: "One-off task",
    });
    await assign(ongoing.id, alice.id);
    await assign(oneOff.id, alice.id);

    const categories = await getOwnContribution(alice);
    expect(categories[0].active.count).toBe(2);
    expect(categories[0].active.hours).toBe(3);
  });
});

describe("contribution visibility", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is off by default and not listed", async () => {
    const { alice } = await createFixtures();
    expect(alice.contributionVisible).toBe(false);
    expect(await listVisibleContributors(alice)).toHaveLength(0);
  });

  it("toggling visible lists the member for others in the same community", async () => {
    const { alice, bob } = await createFixtures();
    await updateContributionVisibility(alice, { visible: true });

    const visible = await listVisibleContributors(bob);
    expect(visible.map((m) => m.id)).toEqual([alice.id]);
  });

  it("a member always sees their own breakdown, regardless of visibility", async () => {
    const { alice, branch } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id, { status: "claimed" });
    await assign(t.id, alice.id);

    const result = await getVisibleContribution(alice, alice.id);
    expect(result.memberName).toBe(alice.name);
    expect(result.categories).toHaveLength(1);
  });

  it("rejects viewing another member's breakdown when they haven't opted in", async () => {
    const { alice, bob } = await createFixtures();
    await expect(getVisibleContribution(alice, bob.id)).rejects.toThrow(ForbiddenError);
  });

  it("allows viewing once the target member opts in", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateContributionVisibility(bob, { visible: true });
    const t = await insertTask(bob.communityId, branch.id, bob.id, { status: "claimed" });
    await assign(t.id, bob.id);

    const result = await getVisibleContribution(alice, bob.id);
    expect(result.memberName).toBe("Bob");
    expect(result.categories[0].active.count).toBe(1);
  });

  it("rejects a member ID from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice } = await createFixtures();
    await updateContributionVisibility(strangerAlice, { visible: true });

    await expect(getVisibleContribution(alice, strangerAlice.id)).rejects.toThrow(NotFoundError);
  });
});

describe("shift completions (Phase 30)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("surfaces a completed shift under 'Overall', separate from the task counts", async () => {
    const { alice, branch } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id, { status: "claimed" });
    await assign(t.id, alice.id);
    const { series } = await completeAShift(alice, branch.id);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(1);
    const overall = categories[0];
    expect(overall.name).toBe("Overall");
    // The task assignment still counts as its own thing, untouched.
    expect(overall.active.count).toBe(1);
    // The shift completion is a separate entry, not folded into it.
    expect(overall.shiftCompletions.count).toBe(1);
    expect(overall.shiftCompletions.completions[0].seriesTitle).toBe(series.title);
  });

  it("creates an 'Overall' category purely for shift completions when there's no task assignment at all", async () => {
    const { alice, branch } = await createFixtures();
    await completeAShift(alice, branch.id);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe("Overall");
    expect(categories[0].active.count).toBe(0);
    expect(categories[0].shiftCompletions.count).toBe(1);
  });

  it("a signed-up-but-not-yet-completed shift doesn't count", async () => {
    const { alice, branch } = await createFixtures();
    await updateContributionVisibility(alice, { visible: false });
    await updateCommunity(alice, { modulesEnabled: ["shifts"] });
    const series = await createShiftSeries(alice, { title: "Dish duty", defaultCapacity: 2, branchId: branch.id });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(24), endsAt: iso(25) }],
    });
    await signUpForShift(alice, occurrence.id);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(0);
  });

  it("is community-scoped — a stranger's completed shift never leaks in", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice, branch: strangerBranch } = await createFixtures();
    await completeAShift(strangerAlice, strangerBranch.id);

    const categories = await getOwnContribution(alice);
    expect(categories).toHaveLength(0);
  });
});

describe("getContributionCommunityAverage (Phase 31)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is null with no current cycle at all", async () => {
    const { alice } = await createFixtures();
    expect(await getContributionCommunityAverage(alice)).toBeNull();
  });

  it("is null when nobody's declared 'coming' for the current cycle", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    await createCycle(alice, { source: "blank", name: "2027 Season" });

    expect(await getContributionCommunityAverage(alice)).toBeNull();
  });

  it("averages across every 'coming' member, including one with nothing in a given category", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await declareParticipation(alice, cyc.id, { status: "coming" });
    await declareParticipation(bob, cyc.id, { status: "coming" });

    // Only alice has an active task — bob contributes a real zero, not
    // an excluded denominator.
    const t = await insertTask(alice.communityId, branch.id, alice.id, { status: "claimed" });
    await assign(t.id, alice.id);

    const averages = await getContributionCommunityAverage(alice);
    expect(averages).toHaveLength(1);
    expect(averages![0].name).toBe("Overall");
    expect(averages![0].active.count).toBe(0.5);
  });

  it("excludes a 'maybe'/'not_coming' member from the average denominator", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await declareParticipation(alice, cyc.id, { status: "coming" });
    await declareParticipation(bob, cyc.id, { status: "not_coming" });

    const t = await insertTask(alice.communityId, branch.id, alice.id, { status: "claimed" });
    await assign(t.id, alice.id);

    const averages = await getContributionCommunityAverage(alice);
    expect(averages![0].active.count).toBe(1);
  });
});
