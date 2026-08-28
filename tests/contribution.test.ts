import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, phase, task, taskAssignment } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import {
  getOwnContribution,
  getVisibleContribution,
  listVisibleContributors,
  updateContributionVisibility,
} from "@/lib/contribution";
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
