import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, task, taskAssignment } from "@/db/schema";
import {
  createBranch,
  createTier,
  deleteBranch,
  deleteTier,
  getCommunity,
  listBranches,
  listTiers,
  requireAdmins,
  updateBranch,
  updateCommunity,
  updateTier,
} from "@/lib/settings";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

describe("community settings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reads and narrowly updates the community", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    const fetched = await getCommunity(alice);
    expect(fetched.id).toBe(testCommunity.id);

    const updated = await updateCommunity(alice, {
      name: "Renamed Community",
      cyclesEnabled: true,
      phasesEnabled: true,
    });
    expect(updated.name).toBe("Renamed Community");
    expect(updated.cyclesEnabled).toBe(true);
    expect(updated.phasesEnabled).toBe(true);
  });

  it("accepts a same-community tier as the cycle-initiation gate", async () => {
    const { alice } = await createFixtures();
    const experienced = await createTier(alice, { name: "Experienced" });

    const updated = await updateCommunity(alice, { cycleInitiationTierId: experienced.id });
    expect(updated.cycleInitiationTierId).toBe(experienced.id);
  });

  it("rejects a cycle-initiation tier from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice } = await createFixtures();
    const strangerTier = await createTier(strangerAlice, { name: "Elsewhere" });

    await expect(
      updateCommunity(alice, { cycleInitiationTierId: strangerTier.id }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("branch settings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates, lists, and updates branches scoped to the community", async () => {
    const { alice } = await createFixtures();
    const created = await createBranch(alice, { name: "Wood", description: "Build stuff" });
    expect(created.name).toBe("Wood");

    const listed = await listBranches(alice);
    // "Fruit" comes from createFixtures, plus the new "Wood".
    expect(listed.map((b) => b.name).sort()).toEqual(["Fruit", "Wood"]);

    const updated = await updateBranch(alice, created.id, { description: "Build and repair" });
    expect(updated.description).toBe("Build and repair");
  });

  it("deletes an unused branch", async () => {
    const { alice } = await createFixtures();
    const created = await createBranch(alice, { name: "Wood" });
    await deleteBranch(alice, created.id);
    expect((await listBranches(alice)).map((b) => b.id)).not.toContain(created.id);
  });

  it("rejects deleting a branch that tasks still reference", async () => {
    const { branch, alice } = await createFixtures();
    await db.insert(task).values({
      communityId: alice.communityId,
      branchId: branch.id,
      title: "Something",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy: alice.id,
    });

    await expect(deleteBranch(alice, branch.id)).rejects.toThrow(ConflictError);
  });

  it("enforces tenant isolation", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice } = await createFixtures();
    const strangerBranch = await createBranch(strangerAlice, { name: "Elsewhere" });

    await expect(updateBranch(alice, strangerBranch.id, { name: "Hijacked" })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("tier settings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates, lists, and updates tiers, defaulting to manual criterion", async () => {
    const { alice } = await createFixtures();
    const created = await createTier(alice, { name: "Experienced" });
    expect(created.criterionType).toBe("manual");

    const listed = await listTiers(alice);
    expect(listed.map((t) => t.name)).toEqual(["Experienced"]);

    const updated = await updateTier(alice, created.id, { name: "Very Experienced" });
    expect(updated.name).toBe("Very Experienced");
  });

  it("deletes an unused tier", async () => {
    const { alice } = await createFixtures();
    const created = await createTier(alice, { name: "Experienced" });
    await deleteTier(alice, created.id);
    expect(await listTiers(alice)).toHaveLength(0);
  });

  it("rejects deleting a tier currently gating cycle initiation", async () => {
    const { alice } = await createFixtures();
    const created = await createTier(alice, { name: "Experienced" });
    await updateCommunity(alice, { cycleInitiationTierId: created.id });

    await expect(deleteTier(alice, created.id)).rejects.toThrow(ConflictError);
  });
});

describe("Admins gate (requireAdmins)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows any member before an Admins task has ever been claimed", async () => {
    const { alice, bob } = await createFixtures();
    await expect(requireAdmins(alice)).resolves.toBeUndefined();
    await expect(requireAdmins(bob)).resolves.toBeUndefined();
  });

  it("once claimed, allows only a current holder of the tagged community_endorsed task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const [adminsTask] = await db
      .insert(task)
      .values({
        communityId: testCommunity.id,
        branchId: branch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 1 },
        createdBy: alice.id,
        openness: "community_endorsed",
        tags: ["admin"],
        endorsementThreshold: 1,
        browsePeriodEnd: new Date(Date.now() + 3600000),
      })
      .returning();
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, testCommunity.id));

    await expect(requireAdmins(alice)).resolves.toBeUndefined();
    await expect(requireAdmins(bob)).rejects.toThrow(ForbiddenError);
  });

  it("doesn't recognize a task tagged differently from the community's adminsTag", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [adminsTask] = await db
      .insert(task)
      .values({
        communityId: testCommunity.id,
        branchId: branch.id,
        title: "Not quite Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 1 },
        createdBy: alice.id,
        openness: "community_endorsed",
        tags: ["something_else"],
        endorsementThreshold: 1,
        browsePeriodEnd: new Date(Date.now() + 3600000),
      })
      .returning();
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, testCommunity.id));

    await expect(requireAdmins(alice)).rejects.toThrow(ForbiddenError);
  });

  it("stays gated during a gap with no current Admins holder, once ever claimed", async () => {
    const { alice } = await createFixtures();
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, alice.communityId));

    await expect(requireAdmins(alice)).rejects.toThrow(ForbiddenError);
  });

  it("lets an Admins holder update the adminsTag itself through updateCommunity", async () => {
    const { alice } = await createFixtures();
    const updated = await updateCommunity(alice, { adminsTag: "leadership" });
    expect(updated.adminsTag).toBe("leadership");
  });
});
