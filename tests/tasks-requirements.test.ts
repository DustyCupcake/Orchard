import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, task, taskAssignment, tier } from "@/db/schema";
import {
  claimTask,
  computeRequirementFitScore,
  createRequirement,
  createRequirementInput,
  deleteRequirement,
  finishTask,
  getGroupCoverageStatus,
  listRequirements,
  listTasksWithAssignments,
  updateRequirement,
} from "@/lib/tasks";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
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
      title: "Restricted task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("requirement CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects an input that doesn't provide the value the type needs", () => {
    const result = createRequirementInput.safeParse({ type: "tier", value: {} });
    expect(result.success).toBe(false);
  });

  it("defaults to individual_gate when no mode is given", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const created = await createRequirement(alice, t.id, {
      type: "custom",
      value: { flag: "kitchen_cert" },
    });
    expect(created.mode).toBe("individual_gate");
  });

  it("honors an explicit group_coverage or soft_priority mode (Phase 50)", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const coverage = await createRequirement(alice, t.id, {
      type: "language",
      mode: "group_coverage",
      value: { language: "nl" },
    });
    expect(coverage.mode).toBe("group_coverage");

    const soft = await createRequirement(alice, t.id, {
      type: "custom",
      mode: "soft_priority",
      value: { flag: "own_van" },
    });
    expect(soft.mode).toBe("soft_priority");
  });

  it("lists, updates, and deletes requirements scoped to the task", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const created = await createRequirement(alice, t.id, {
      type: "custom",
      value: { flag: "kitchen_cert" },
    });

    const listed = await listRequirements(alice, t.id);
    expect(listed).toHaveLength(1);

    const updated = await updateRequirement(alice, t.id, created.id, {
      value: { flag: "food_handler_cert" },
    });
    expect((updated.value as { flag: string }).flag).toBe("food_handler_cert");

    await deleteRequirement(alice, t.id, created.id);
    expect(await listRequirements(alice, t.id)).toHaveLength(0);
  });

  it("rejects operating on a requirement from a task outside the actor's community", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [otherMember] = await db
      .insert(member)
      .values({ communityId: otherCommunity.id, name: "Mallory" })
      .returning();

    await expect(
      createRequirement(otherMember, t.id, { type: "custom", value: { flag: "x" } }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("claim eligibility", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a task with no requirements is claimable by anyone", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const claimed = await claimTask(alice, t.id);
    expect(claimed.status).toBe("claimed");
  });

  it("blocks claiming when the member lacks the required tier, allows it once they have it", async () => {
    const { community, branch, alice } = await createFixtures();
    const [experienced] = await db
      .insert(tier)
      .values({ communityId: community.id, name: "Experienced" })
      .returning();

    const t = await insertTask(community.id, branch.id, alice.id);
    await createRequirement(alice, t.id, { type: "tier", value: { tierId: experienced.id } });

    await expect(claimTask(alice, t.id)).rejects.toThrow(ForbiddenError);

    await db.update(member).set({ tierIds: [experienced.id] }).where(eq(member.id, alice.id));
    const [refreshedAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    const claimed = await claimTask(refreshedAlice, t.id);
    expect(claimed.status).toBe("claimed");
  });

  it("blocks claiming when the member lacks a required language tag", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id);
    await createRequirement(alice, t.id, { type: "language", value: { language: "nl" } });

    await expect(claimTask(alice, t.id)).rejects.toThrow(ForbiddenError);

    await db.update(member).set({ tags: ["nl"] }).where(eq(member.id, alice.id));
    const [refreshedAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    const claimed = await claimTask(refreshedAlice, t.id);
    expect(claimed.status).toBe("claimed");
  });

  it("blocks claiming when the member lacks a custom flag", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id);
    await createRequirement(alice, t.id, { type: "custom", value: { flag: "kitchen_cert" } });

    await expect(claimTask(alice, t.id)).rejects.toThrow(ForbiddenError);

    await db.update(member).set({ tags: ["kitchen_cert"] }).where(eq(member.id, alice.id));
    const [refreshedAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    const claimed = await claimTask(refreshedAlice, t.id);
    expect(claimed.status).toBe("claimed");
  });

  it("a completed_task requirement is satisfied only once the referenced task is actually done", async () => {
    const { community, branch, alice } = await createFixtures();
    const prerequisite = await insertTask(community.id, branch.id, alice.id, {
      title: "Learn to use the kiln",
    });
    const gated = await insertTask(community.id, branch.id, alice.id, {
      title: "Fire the kiln solo",
    });
    await createRequirement(alice, gated.id, {
      type: "completed_task",
      value: { taskId: prerequisite.id },
    });

    await expect(claimTask(alice, gated.id)).rejects.toThrow(ForbiddenError);

    await claimTask(alice, prerequisite.id);
    await expect(claimTask(alice, gated.id)).rejects.toThrow(ForbiddenError);

    await finishTask(alice, prerequisite.id);
    const claimed = await claimTask(alice, gated.id);
    expect(claimed.status).toBe("claimed");
  });

  it("requires every requirement to be met, not just one of several", async () => {
    const { community, branch, alice } = await createFixtures();
    const [experienced] = await db
      .insert(tier)
      .values({ communityId: community.id, name: "Experienced" })
      .returning();
    const t = await insertTask(community.id, branch.id, alice.id);
    await createRequirement(alice, t.id, { type: "tier", value: { tierId: experienced.id } });
    await createRequirement(alice, t.id, { type: "language", value: { language: "nl" } });

    // Only the language tag, tier still missing.
    await db.update(member).set({ tags: ["nl"] }).where(eq(member.id, alice.id));
    const [partiallyEligible] = await db.select().from(member).where(eq(member.id, alice.id));
    await expect(claimTask(partiallyEligible, t.id)).rejects.toThrow(ForbiddenError);

    await db
      .update(member)
      .set({ tierIds: [experienced.id] })
      .where(eq(member.id, alice.id));
    const [fullyEligible] = await db.select().from(member).where(eq(member.id, alice.id));
    const claimed = await claimTask(fullyEligible, t.id);
    expect(claimed.status).toBe("claimed");
  });

  it("capacity is still enforced alongside requirements", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { capacity: 1 });

    await claimTask(alice, t.id);
    await expect(claimTask(bob, t.id)).rejects.toThrow(ConflictError);
  });

  it("never blocks a claim for group_coverage or soft_priority, unlike individual_gate", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { capacity: 3 });
    await createRequirement(alice, t.id, { type: "language", mode: "group_coverage", value: { language: "nl" } });
    await createRequirement(alice, t.id, { type: "custom", mode: "soft_priority", value: { flag: "own_van" } });

    // Alice satisfies neither — a real individual_gate requirement
    // with the same shape would reject this exact claim (see the
    // "blocks claiming when the member lacks a required language tag"
    // test above); these two modes must not.
    const claimed = await claimTask(alice, t.id);
    expect(claimed.status).toBe("claimed");
  });
});

// docs/development-plan.md's Phase 50: group_coverage's live "covered /
// not yet covered" status line, computed off current real (non-shadow)
// holders only.
describe("getGroupCoverageStatus", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is unmet with no holders, unmet with a holder who doesn't satisfy it, covered once a real holder does", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    const req = await createRequirement(alice, t.id, {
      type: "language",
      mode: "group_coverage",
      value: { language: "nl" },
    });

    expect((await getGroupCoverageStatus(db, t.id, [req])).get(req.id)).toBe(false);

    await claimTask(alice, t.id);
    expect((await getGroupCoverageStatus(db, t.id, [req])).get(req.id)).toBe(false);

    await db.update(member).set({ tags: ["nl"] }).where(eq(member.id, bob.id));
    const [dutchBob] = await db.select().from(member).where(eq(member.id, bob.id));
    await claimTask(dutchBob, t.id);
    expect((await getGroupCoverageStatus(db, t.id, [req])).get(req.id)).toBe(true);
  });

  it("doesn't count a shadow claim toward coverage", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    const req = await createRequirement(alice, t.id, {
      type: "language",
      mode: "group_coverage",
      value: { language: "nl" },
    });
    await db.update(member).set({ tags: ["nl"] }).where(eq(member.id, bob.id));
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: bob.id, isShadow: true });

    expect((await getGroupCoverageStatus(db, t.id, [req])).get(req.id)).toBe(false);
  });
});

// docs/development-plan.md's Phase 50: the "requirements that fit you"
// sort dimension.
describe("computeRequirementFitScore", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("boosts an individual_gate requirement only when satisfied, weighted by 1/eligible-pool-size", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    const req = await createRequirement(alice, t.id, { type: "language", value: { language: "nl" } });

    // Nobody satisfies it yet.
    expect(await computeRequirementFitScore(db, alice, [req], new Map())).toBe(0);

    // Alice alone satisfies it — pool of 1, full boost.
    await db.update(member).set({ tags: ["nl"] }).where(eq(member.id, alice.id));
    const [dutchAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(await computeRequirementFitScore(db, dutchAlice, [req], new Map())).toBe(1);

    // Bob also satisfies it now — pool of 2, halved boost for each.
    await db.update(member).set({ tags: ["nl"] }).where(eq(member.id, bob.id));
    const [dutchAlice2] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(await computeRequirementFitScore(db, dutchAlice2, [req], new Map())).toBe(0.5);
  });

  it("boosts a group_coverage requirement only while unmet and the actor would satisfy it", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    const req = await createRequirement(alice, t.id, {
      type: "language",
      mode: "group_coverage",
      value: { language: "nl" },
    });
    await db.update(member).set({ tags: ["nl"] }).where(eq(member.id, alice.id));
    const [dutchAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    // Unmet, and she'd satisfy it — boosts.
    expect(await computeRequirementFitScore(db, dutchAlice, [req], new Map([[req.id, false]]))).toBe(1);
    // Already covered by someone else — stops pulling on her.
    expect(await computeRequirementFitScore(db, dutchAlice, [req], new Map([[req.id, true]]))).toBe(0);
    // Unmet, but she herself doesn't satisfy it — no boost either.
    expect(await computeRequirementFitScore(db, alice, [req], new Map([[req.id, false]]))).toBe(0);
  });

  it("gives soft_priority a flat boost whenever satisfied, never gated by coverage", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    const req = await createRequirement(alice, t.id, {
      type: "custom",
      mode: "soft_priority",
      value: { flag: "own_van" },
    });

    expect(await computeRequirementFitScore(db, alice, [req], new Map())).toBe(0);

    await db.update(member).set({ tags: ["own_van"] }).where(eq(member.id, alice.id));
    const [vanAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(await computeRequirementFitScore(db, vanAlice, [req], new Map())).toBe(1);
  });
});

describe("listTasksWithAssignments: sortByFit", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reorders toward the actor's best-fitting task only when sortByFit is requested", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const plainTask = await insertTask(testCommunity.id, branch.id, alice.id, { title: "A — plain task" });
    const fittingTask = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Z — fits alice" });
    await createRequirement(alice, fittingTask.id, {
      type: "custom",
      mode: "soft_priority",
      value: { flag: "own_van" },
    });
    await db.update(member).set({ tags: ["own_van"] }).where(eq(member.id, alice.id));
    const [vanAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    // Default order: plain alphabetical (A before Z), untouched by fit.
    const unsorted = await listTasksWithAssignments(vanAlice, { branchId: branch.id });
    expect(unsorted.map((t) => t.id)).toEqual([plainTask.id, fittingTask.id]);
    expect(unsorted.every((t) => t.fitScore === 0)).toBe(true);

    // Opted in: the fitting task moves to the top despite the alphabet.
    const sorted = await listTasksWithAssignments(vanAlice, { branchId: branch.id, sortByFit: true });
    expect(sorted.map((t) => t.id)).toEqual([fittingTask.id, plainTask.id]);
  });
});
