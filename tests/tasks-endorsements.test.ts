import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, task, taskAssignment } from "@/db/schema";
import {
  createRequirement,
  endorseCandidacy,
  expressCandidacy,
  listCandidacies,
  listMyEndorsements,
  resolveBrowsePeriods,
  withdrawCandidacy,
} from "@/lib/tasks";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

const HOUR = 60 * 60 * 1000;

async function insertCommunityEndorsedTask(
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
      title: "Admins",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      openness: "community_endorsed",
      capacity: null,
      endorsementThreshold: 2,
      browsePeriodEnd: new Date(Date.now() + HOUR),
      ...overrides,
    })
    .returning();
  return row;
}

describe("expressCandidacy", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates an open candidacy during the browse window", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);

    const candidacy = await expressCandidacy(alice, t.id);
    expect(candidacy.status).toBe("open");
    expect(candidacy.memberId).toBe(alice.id);
  });

  it("rejects on a task that isn't community_endorsed", async () => {
    const { branch, alice } = await createFixtures();
    const [t] = await db
      .insert(task)
      .values({
        communityId: alice.communityId,
        branchId: branch.id,
        title: "Ordinary",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
        createdBy: alice.id,
      })
      .returning();

    await expect(expressCandidacy(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects once the browse window has closed", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      browsePeriodEnd: new Date(Date.now() - HOUR),
    });

    await expect(expressCandidacy(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a duplicate open candidacy from the same member", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);
    await expressCandidacy(alice, t.id);

    await expect(expressCandidacy(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a member who already holds the task", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: alice.id });

    await expect(expressCandidacy(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("still enforces Requirement gating on who can attempt a candidacy", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);
    await createRequirement(alice, t.id, { type: "custom", value: { flag: "trusted" } });

    await expect(expressCandidacy(alice, t.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("endorseCandidacy", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("adds an endorsement and stays open below the threshold", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 2,
    });
    const candidacy = await expressCandidacy(bob, t.id);

    const result = await endorseCandidacy(alice, t.id, candidacy.id);
    expect(result.status).toBe("open");
    expect(result.endorsementCount).toBe(1);
  });

  it("confirms the candidacy and claims the task once the threshold clears", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 2,
    });
    const candidacy = await expressCandidacy(bob, t.id);

    await endorseCandidacy(alice, t.id, candidacy.id);
    const result = await endorseCandidacy(carol, t.id, candidacy.id);

    expect(result.status).toBe("confirmed");
    expect(result.endorsementCount).toBe(2);

    const [assignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(assignment).toBeDefined();

    const [updatedTask] = await db.select().from(task).where(eq(task.id, t.id));
    expect(updatedTask.status).toBe("claimed");
  });

  it("latches Community.adminsEverClaimed once a tagged task's candidacy confirms", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 2,
      tags: ["admin"],
    });
    const candidacy = await expressCandidacy(bob, t.id);

    const [before] = await db.select().from(community).where(eq(community.id, testCommunity.id));
    expect(before.adminsEverClaimed).toBe(false);

    await endorseCandidacy(alice, t.id, candidacy.id);
    await endorseCandidacy(carol, t.id, candidacy.id);

    const [after] = await db.select().from(community).where(eq(community.id, testCommunity.id));
    expect(after.adminsEverClaimed).toBe(true);
  });

  it("does not latch adminsEverClaimed for a confirmed candidacy on an untagged task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 2,
      tags: ["something_else"],
    });
    const candidacy = await expressCandidacy(bob, t.id);

    await endorseCandidacy(alice, t.id, candidacy.id);
    await endorseCandidacy(carol, t.id, candidacy.id);

    const [after] = await db.select().from(community).where(eq(community.id, testCommunity.id));
    expect(after.adminsEverClaimed).toBe(false);
  });

  it("rejects self-endorsement", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);
    const candidacy = await expressCandidacy(bob, t.id);

    await expect(endorseCandidacy(bob, t.id, candidacy.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects a duplicate endorsement from the same member", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 3,
    });
    const candidacy = await expressCandidacy(bob, t.id);
    await endorseCandidacy(alice, t.id, candidacy.id);

    await expect(endorseCandidacy(alice, t.id, candidacy.id)).rejects.toThrow(ConflictError);
  });

  it("rejects endorsing once the browse window has closed", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      browsePeriodEnd: new Date(Date.now() + 100),
    });
    const candidacy = await expressCandidacy(bob, t.id);
    await new Promise((resolve) => setTimeout(resolve, 150));

    await expect(endorseCandidacy(alice, t.id, candidacy.id)).rejects.toThrow(ConflictError);
  });

  it("rejects endorsing a candidacy that's already resolved", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 1,
    });
    const candidacy = await expressCandidacy(bob, t.id);
    await endorseCandidacy(alice, t.id, candidacy.id); // confirms it (threshold 1)

    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    await expect(endorseCandidacy(carol, t.id, candidacy.id)).rejects.toThrow(ConflictError);
  });

  it("leaves a threshold-clearing candidacy open, not confirmed, when capacity is full", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 1,
      capacity: 1,
    });
    // fill the one slot first
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: alice.id });
    await db.update(task).set({ status: "claimed" }).where(eq(task.id, t.id));

    const candidacy = await expressCandidacy(bob, t.id);
    const result = await endorseCandidacy(carol, t.id, candidacy.id);

    expect(result.status).toBe("open");
    const [stillPending] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(stillPending).toBeUndefined();
  });
});

describe("eager confirmation on a zero (or otherwise already-met) threshold — Phase 62", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("confirms immediately and claims the task, no endorsement needed", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 0,
    });

    const candidacy = await expressCandidacy(bob, t.id);
    expect(candidacy.status).toBe("confirmed");

    const [assignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(assignment).toBeDefined();

    const [updatedTask] = await db.select().from(task).where(eq(task.id, t.id));
    expect(updatedTask.status).toBe("claimed");
  });

  it("still respects capacity — stays open if the task is already full", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 0,
      capacity: 1,
    });
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: alice.id });
    await db.update(task).set({ status: "claimed" }).where(eq(task.id, t.id));

    const candidacy = await expressCandidacy(bob, t.id);
    expect(candidacy.status).toBe("open");

    const [stillPending] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(stillPending).toBeUndefined();
  });

  it("latches Community.adminsEverClaimed immediately, same as a real endorsement clearing would", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 0,
      tags: ["admin"],
    });

    await expressCandidacy(bob, t.id);

    const [after] = await db.select().from(community).where(eq(community.id, testCommunity.id));
    expect(after.adminsEverClaimed).toBe(true);
  });

  it("a confirmed-at-creation candidacy is left alone by resolveBrowsePeriods, never marked failed", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 0,
      browsePeriodEnd: new Date(Date.now() + 100),
    });

    const candidacy = await expressCandidacy(bob, t.id);
    expect(candidacy.status).toBe("confirmed");
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await resolveBrowsePeriods();
    expect(result.failed).toBe(0);

    const candidacies = await listCandidacies(alice, t.id);
    expect(candidacies[0].status).toBe("confirmed");
  });
});

describe("withdrawCandidacy", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets the candidate withdraw their own open candidacy", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);
    const candidacy = await expressCandidacy(bob, t.id);

    await withdrawCandidacy(bob, t.id, candidacy.id);

    const candidacies = await listCandidacies(alice, t.id);
    expect(candidacies).toHaveLength(0);
  });

  it("rejects withdrawal by someone other than the candidate", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);
    const candidacy = await expressCandidacy(bob, t.id);

    await expect(withdrawCandidacy(alice, t.id, candidacy.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects withdrawing an already-resolved candidacy", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 1,
    });
    const candidacy = await expressCandidacy(bob, t.id);
    await endorseCandidacy(alice, t.id, candidacy.id);

    await expect(withdrawCandidacy(bob, t.id, candidacy.id)).rejects.toThrow(ConflictError);
  });

  it("rejects withdrawing a candidacy that doesn't exist", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id);

    await expect(
      withdrawCandidacy(alice, t.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("listCandidacies / listMyEndorsements", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reports accurate endorsement counts and per-member endorsement state", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 5,
    });
    const candidacy = await expressCandidacy(bob, t.id);
    await endorseCandidacy(alice, t.id, candidacy.id);

    const candidacies = await listCandidacies(alice, t.id);
    expect(candidacies).toHaveLength(1);
    expect(candidacies[0].endorsementCount).toBe(1);

    const mine = await listMyEndorsements(
      alice,
      candidacies.map((c) => c.id),
    );
    expect(mine.has(candidacy.id)).toBe(true);

    const bobsEndorsements = await listMyEndorsements(
      bob,
      candidacies.map((c) => c.id),
    );
    expect(bobsEndorsements.has(candidacy.id)).toBe(false);
  });
});

describe("resolveBrowsePeriods", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("fails an open candidacy whose task's browse window has closed", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      browsePeriodEnd: new Date(Date.now() + 100),
    });
    const candidacy = await expressCandidacy(bob, t.id);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await resolveBrowsePeriods();
    expect(result.failed).toBe(1);

    const candidacies = await listCandidacies(alice, t.id);
    expect(candidacies[0].id).toBe(candidacy.id);
    expect(candidacies[0].status).toBe("failed");
  });

  it("leaves a candidacy alone while its browse window is still open", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      browsePeriodEnd: new Date(Date.now() + HOUR),
    });
    const candidacy = await expressCandidacy(bob, t.id);

    const result = await resolveBrowsePeriods();
    expect(result.failed).toBe(0);

    const candidacies = await listCandidacies(alice, t.id);
    expect(candidacies[0].id).toBe(candidacy.id);
    expect(candidacies[0].status).toBe("open");
  });

  it("leaves an already-confirmed candidacy alone even after the window closes", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertCommunityEndorsedTask(testCommunity.id, branch.id, alice.id, {
      endorsementThreshold: 1,
      browsePeriodEnd: new Date(Date.now() + 100),
    });
    const candidacy = await expressCandidacy(bob, t.id);
    await endorseCandidacy(alice, t.id, candidacy.id);
    await new Promise((resolve) => setTimeout(resolve, 150));

    await resolveBrowsePeriods();

    const candidacies = await listCandidacies(alice, t.id);
    expect(candidacies[0].status).toBe("confirmed");
  });
});
