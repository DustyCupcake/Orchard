import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, task, taskAssignment } from "@/db/schema";
import {
  createBranch,
  createTier,
  deleteBranch,
  deleteTier,
  getCommunity,
  listBranches,
  listCycleTypes,
  listPendingBranches,
  listTiers,
  requireAdmins,
  updateBranch,
  updateCommunity,
  updateTier,
} from "@/lib/settings";
import { listCycles } from "@/lib/cycles";
import { listProfileQuestions } from "@/lib/profile-questions";
import { listTraitAxes } from "@/lib/trait-axes";
import { listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
import { listForms } from "@/lib/forms";
import { listConsentPurposes } from "@/lib/consent";
import { listTaskPacks } from "@/lib/task-packs";
import { listTasks } from "@/lib/tasks";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

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

  it("persists the Community date-display default without overwriting member overrides", async () => {
    const { alice, bob } = await createFixtures();
    expect((await getCommunity(alice)).defaultDateDisplayMode).toBe("exact");

    const updated = await updateCommunity(alice, { defaultDateDisplayMode: "period" });
    expect(updated.defaultDateDisplayMode).toBe("period");

    const [bobRow] = await db.select().from(member).where(eq(member.id, bob.id));
    expect(bobRow.dateDisplayMode).toBeNull();
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

describe("the settings read gate", () => {
  // Locks the community's Admins shut first. A fresh fixture has
  // adminsEverClaimed false, and requireAdmins lets *anyone* through in that
  // state as the bootstrap path — so without this, "a non-admin" would still
  // be an admin as far as the gate is concerned and the test would prove
  // nothing.
  async function adminGatedFixtures() {
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
        endorsementThreshold: 1,
        browsePeriodEnd: new Date(Date.now() + 3600000),
      })
      .returning();
    await grantPermission(testCommunity.id, "admin", adminsTask.id);
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, testCommunity.id));
    return { testCommunity, branch, alice, bob };
  }

  // The read gate moved from the read to the write, and the loaders had to
  // move with it: while a non-Admin never saw past the refusal banner, ten of
  // these were `authorized ? … : Promise.resolve([])`. Un-gating the page
  // without un-gating them would render a settings screen whose dropdowns and
  // lists are silently empty, so each of these has to actually resolve for a
  // member who holds nothing.
  it("every loader the settings page depends on resolves for a non-admin", async () => {
    const { alice, bob } = await adminGatedFixtures();
    await createTier(alice, { name: "Cohort" });
    await expect(requireAdmins(bob)).rejects.toThrow(ForbiddenError);

    const settled = await Promise.allSettled([
      getCommunity(bob),
      listBranches(bob),
      listTiers(bob),
      listCycleTypes(bob),
      listCycles(bob),
      listProfileQuestions(bob, { includeArchived: true }),
      listTraitAxes(bob, { includeArchived: true }),
      listSensitiveFieldAccessRules(bob),
      listForms(bob, { includeArchived: true }),
      listConsentPurposes(bob),
      listTaskPacks(bob),
      listTasks(bob),
    ]);

    const refused = settled
      .map((r) => (r.status === "rejected" ? String(r.reason?.message ?? r.reason) : null))
      .filter((m): m is string => m !== null);
    expect(refused).toEqual([]);
  });

  it("hands a non-admin the settings themselves, not an empty list", async () => {
    const { alice, bob } = await adminGatedFixtures();
    await createTier(alice, { name: "Cohort" });

    // The failure mode this guards is a loader that resolves to [] rather than
    // throwing: a green test either way, and a Branches tab showing nothing.
    expect((await listTiers(bob)).map((t) => t.name)).toEqual(["Cohort"]);
    expect((await listBranches(bob)).map((b) => b.name)).toEqual(["Fruit"]);
    expect((await getCommunity(bob)).id).toBe(bob.communityId);
  });

  it("still refuses the pending-branch queue, which stays an admin work queue", async () => {
    const { bob } = await adminGatedFixtures();
    // Not a privilege so much as a fact about the data: a pending branch is a
    // request from a member awaiting confirmation, so the list is a queue of
    // member requests rather than branch configuration. It is also the one
    // loader that would throw rather than return [], since it calls
    // requireAdmins itself.
    await expect(listPendingBranches(bob)).rejects.toThrow(ForbiddenError);
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

  it("once claimed, allows only a current holder of the community_endorsed task granted the admin module", async () => {
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
        endorsementThreshold: 1,
        browsePeriodEnd: new Date(Date.now() + 3600000),
      })
      .returning();
    await grantPermission(testCommunity.id, "admin", adminsTask.id);
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, testCommunity.id));

    await expect(requireAdmins(alice)).resolves.toBeUndefined();
    await expect(requireAdmins(bob)).rejects.toThrow(ForbiddenError);
  });

  it("is false for an ordinary task's own tags — granting is per-task now, not a tag match (Phase 63)", async () => {
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
});
