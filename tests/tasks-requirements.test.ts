import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, task, tier } from "@/db/schema";
import {
  claimTask,
  createRequirement,
  createRequirementInput,
  deleteRequirement,
  finishTask,
  listRequirements,
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

  it("always creates with mode individual_gate, regardless of what's asked for", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const created = await createRequirement(alice, t.id, {
      type: "custom",
      value: { flag: "kitchen_cert" },
    });
    expect(created.mode).toBe("individual_gate");
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
});
