import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  branch as branchTable,
  community,
  cycle,
  member,
  phase,
  requirement,
  task,
  taskAssignment,
  taskMilestone,
  taskResource,
  taskWikiRevision,
} from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import {
  archiveTaskPack,
  commitPackImport,
  exportCycleAsTaskPack,
  exportTaskPackToFile,
  getTaskPack,
  importTaskPackFromFile,
  listTaskPacks,
  previewPackImportBranches,
  previewPackImportDates,
} from "@/lib/task-packs";
import { confirmPendingBranch, isAdmin, rejectPendingBranch } from "@/lib/settings";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

async function insertTask(
  communityId: string,
  branchId: string,
  cycleId: string,
  createdBy: string,
  overrides: Partial<typeof task.$inferInsert> = {},
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      cycleId,
      title: "Order the seedlings",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("exportCycleAsTaskPack", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects when the Community hasn't enabled cycles at all", async () => {
    const { alice } = await createFixtures();
    await expect(exportCycleAsTaskPack(alice, "00000000-0000-0000-0000-000000000000", { name: "Pack" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("exports the whole cycle's phases and tasks, with relative-only recipes and phaseRef mapping", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const newCycle = await createCycle(alice, { source: "blank", name: "2027 Season", startDate: "2027-06-01", endDate: "2027-06-10" });

    const [build] = await db
      .insert(phase)
      .values({ cycleId: newCycle.id, name: "Build", order: 0, startDateType: "absolute", startDate: "2027-06-01" })
      .returning();

    const t1 = await insertTask(testCommunity.id, branch.id, newCycle.id, alice.id, { title: "Order seedlings", phaseId: build.id });
    await db.insert(requirement).values({ taskId: t1.id, type: "custom", mode: "individual_gate", value: { flag: "kitchen_cert" } });
    await db.insert(taskWikiRevision).values({ taskId: t1.id, content: "Seed catalogue: ...", editedBy: alice.id });
    await db.insert(taskResource).values({ taskId: t1.id, addedBy: alice.id, label: "Catalogue", url: "https://example.com", tag: null });
    await db.insert(taskMilestone).values({
      taskId: t1.id,
      label: "Order deadline",
      dateType: "relative",
      relativeMode: "offset",
      anchorType: "phase_start",
      offsetDays: 3,
      phaseId: build.id,
      status: "confirmed",
      proposedBy: alice.id,
      createdBy: alice.id,
    });
    // A pending milestone must never carry into the pack.
    await db.insert(taskMilestone).values({
      taskId: t1.id,
      label: "Still pending",
      dateType: "relative",
      relativeMode: "offset",
      anchorType: "cycle_start",
      offsetDays: 1,
      status: "pending",
      proposedBy: alice.id,
      createdBy: alice.id,
    });

    const pack = await exportCycleAsTaskPack(alice, newCycle.id, { name: "Season pack", domainTags: ["burn"] });
    const loaded = await getTaskPack(alice, pack.id);

    expect(loaded.pack.name).toBe("Season pack");
    expect(loaded.pack.domainTags).toEqual(["burn"]);
    expect(loaded.phases).toHaveLength(1);
    expect(loaded.phases[0].name).toBe("Build");
    // Build's boundary was absolute (2027-06-01); export derives an
    // offset-from-cycle-start recipe rather than dropping it.
    expect(loaded.phases[0].startRelativeMode).toBe("offset");
    expect(loaded.phases[0].startOffsetAnchor).toBe("cycle_start");
    expect(loaded.phases[0].startOffsetDays).toBe(0);

    expect(loaded.items).toHaveLength(1);
    const item = loaded.items[0];
    expect(item.branchNameHint).toBe(branch.name);
    expect(item.phaseRef).toBe(build.order);
    expect(item.wikiSummarySeed).toBe("Seed catalogue: ...");
    expect(item.resources).toEqual([{ label: "Catalogue", url: "https://example.com", tag: null }]);
    expect(item.requirements).toEqual([{ type: "custom", mode: "individual_gate", value: { flag: "kitchen_cert" } }]);
    expect(item.milestones).toHaveLength(1); // the pending one was dropped
    const milestone = item.milestones as { label: string; phaseRef: number | null }[];
    expect(milestone[0].label).toBe("Order deadline");
    expect(milestone[0].phaseRef).toBe(build.order);
  });

  it("exports only the hand-picked task subset when taskIds is given", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const newCycle = await createCycle(alice, { source: "blank", name: "2027 Season" });
    const t1 = await insertTask(testCommunity.id, branch.id, newCycle.id, alice.id, { title: "Keep me" });
    await insertTask(testCommunity.id, branch.id, newCycle.id, alice.id, { title: "Drop me" });

    const pack = await exportCycleAsTaskPack(alice, newCycle.id, { name: "Subset pack", taskIds: [t1.id] });
    const loaded = await getTaskPack(alice, pack.id);
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0].title).toBe("Keep me");
  });

  it("rejects exporting a cycle from another community", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [otherCycle] = await db
      .insert(cycle)
      .values({ communityId: otherCommunity.id, name: "Not yours", status: "active", sourceType: "blank" })
      .returning();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, otherCommunity.id));

    await expect(exportCycleAsTaskPack(alice, otherCycle.id, { name: "Steal" })).rejects.toThrow(NotFoundError);
  });
});

describe("Task Pack file round-trip", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("uploading an exported file adopts it as a real pack scoped to the importing (possibly different) community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const newCycle = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await insertTask(testCommunity.id, branch.id, newCycle.id, alice.id, { title: "Order seedlings" });
    const pack = await exportCycleAsTaskPack(alice, newCycle.id, { name: "Season pack" });
    const file = await exportTaskPackToFile(alice, pack.id);

    const [otherCommunity] = await db.insert(community).values({ name: "Sister community" }).returning();
    const [bob] = await db.insert(member).values({ communityId: otherCommunity.id, name: "Bob" }).returning();

    const imported = await importTaskPackFromFile(bob, file);
    expect(imported.communityId).toBe(otherCommunity.id);
    expect(imported.id).not.toBe(pack.id);

    const loaded = await getTaskPack(bob, imported.id);
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0].title).toBe("Order seedlings");
  });

  it("rejects a file that isn't valid Task Pack JSON", async () => {
    const { alice } = await createFixtures();
    await expect(importTaskPackFromFile(alice, { not: "a pack" })).rejects.toThrow(AppError);
  });
});

describe("commitPackImport", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function makeSourcePack(name = "Season pack") {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const sourceCycle = await createCycle(alice, { source: "blank", name: "Source", startDate: "2027-06-01", endDate: "2027-06-10" });
    const [build] = await db
      .insert(phase)
      .values({ cycleId: sourceCycle.id, name: "Build", order: 0, startDateType: "absolute", startDate: "2027-06-01" })
      .returning();
    const t1 = await insertTask(testCommunity.id, branch.id, sourceCycle.id, alice.id, { title: "Order seedlings", phaseId: build.id });
    await db.insert(taskMilestone).values({
      taskId: t1.id,
      label: "Order deadline",
      dateType: "relative",
      relativeMode: "offset",
      anchorType: "phase_start",
      offsetDays: 2,
      phaseId: build.id,
      status: "confirmed",
      proposedBy: alice.id,
      createdBy: alice.id,
    });
    const pack = await exportCycleAsTaskPack(alice, sourceCycle.id, { name });
    return { testCommunity, branch, alice, pack };
  }

  it("creates a real cycle, phase, task, and milestone from the pack, resolving to an existing branch", async () => {
    const { testCommunity, branch, alice, pack } = await makeSourcePack();

    const newCycle = await commitPackImport(alice, {
      packId: pack.id,
      cycleName: "2028 Season",
      hintResolutions: { [branch.name]: { action: "use_existing", branchId: branch.id } },
    });

    expect(newCycle.sourceType).toBe("pack");
    expect(newCycle.sourcePackId).toBe(pack.id);
    expect(newCycle.communityId).toBe(testCommunity.id);

    const newPhases = await db.select().from(phase).where(eq(phase.cycleId, newCycle.id));
    expect(newPhases).toHaveLength(1);
    expect(newPhases[0].name).toBe("Build");

    const newTasks = await db.select().from(task).where(eq(task.cycleId, newCycle.id));
    expect(newTasks).toHaveLength(1);
    expect(newTasks[0].branchId).toBe(branch.id);
    expect(newTasks[0].phaseId).toBe(newPhases[0].id);
    expect(newTasks[0].createdBy).toBe(alice.id);

    const newMilestones = await db.select().from(taskMilestone).where(eq(taskMilestone.taskId, newTasks[0].id));
    expect(newMilestones).toHaveLength(1);
    expect(newMilestones[0].phaseId).toBe(newPhases[0].id);
  });

  it("creates a new, confirmed branch when the actor holds Admins", async () => {
    const { testCommunity, alice, pack } = await makeSourcePack();
    // No Admins task ever claimed -> isAdmin falls back to true (see
    // src/lib/settings/admins.ts's requireAdmins).
    expect(await isAdmin(alice)).toBe(true);

    const newCycle = await commitPackImport(alice, {
      packId: pack.id,
      cycleName: "2028 Season",
      hintResolutions: { Fruit: { action: "create_new" } },
    });

    const newTasks = await db.select().from(task).where(eq(task.cycleId, newCycle.id));
    const [newBranch] = await db.select().from(branchTable).where(eq(branchTable.id, newTasks[0].branchId));
    expect(newBranch.status).toBe("confirmed");
    expect(newBranch.communityId).toBe(testCommunity.id);
  });

  it("rejects when a hint has no resolution and no per-item override", async () => {
    const { alice, pack } = await makeSourcePack();
    await expect(
      commitPackImport(alice, { packId: pack.id, cycleName: "2028 Season", hintResolutions: {} }),
    ).rejects.toThrow(AppError);
  });

  it("lets a per-item override resolve a declined hint's task individually", async () => {
    const { branch, alice, pack } = await makeSourcePack();
    const [otherBranch] = await db.insert(branchTable).values({ communityId: branch.communityId, name: "Wood" }).returning();
    const loaded = await getTaskPack(alice, pack.id);
    const itemId = loaded.items[0].id;

    const newCycle = await commitPackImport(alice, {
      packId: pack.id,
      cycleName: "2028 Season",
      hintResolutions: {},
      itemBranchOverrides: { [itemId]: otherBranch.id },
    });

    const newTasks = await db.select().from(task).where(eq(task.cycleId, newCycle.id));
    expect(newTasks[0].branchId).toBe(otherBranch.id);
  });

  it("previewPackImportBranches suggests an exact case-insensitive match", async () => {
    const { branch, alice, pack } = await makeSourcePack();
    const suggestions = await previewPackImportBranches(alice, pack.id);
    expect(suggestions).toEqual([{ hint: branch.name, suggestedBranchId: branch.id, matchKind: "exact" }]);
  });

  // docs/development-plan.md's Phase 59 — the near-match suggestion
  // Phase 55's own review screen deliberately deferred ("Wood" vs.
  // "Woods" instead of forcing "create new" on anything short of an
  // exact name).
  describe("Phase 59: near-match branch suggestions", () => {
    it("suggests a similar existing branch when no exact match exists", async () => {
      const { testCommunity, alice, pack } = await makeSourcePack();
      // makeSourcePack's own task is on a branch named "Fruit" (see
      // createFixtures) — renaming it here so the hint ("Fruit") no
      // longer matches exactly, but a real "Fruits" branch is a
      // genuine near-match.
      await db.update(branchTable).set({ name: "Something else" }).where(eq(branchTable.communityId, testCommunity.id));
      const [similarBranch] = await db
        .insert(branchTable)
        .values({ communityId: testCommunity.id, name: "Fruits" })
        .returning();

      const suggestions = await previewPackImportBranches(alice, pack.id);
      expect(suggestions).toEqual([
        { hint: "Fruit", suggestedBranchId: similarBranch.id, matchKind: "similar" },
      ]);
    });

    it("suggests nothing when no existing branch comes close", async () => {
      const { testCommunity, alice, pack } = await makeSourcePack();
      await db.update(branchTable).set({ name: "Completely unrelated name" }).where(eq(branchTable.communityId, testCommunity.id));

      const suggestions = await previewPackImportBranches(alice, pack.id);
      expect(suggestions).toEqual([{ hint: "Fruit", suggestedBranchId: null, matchKind: "none" }]);
    });

    it("a near-match suggestion is still just a pre-fill — resolving to a different branch works fine", async () => {
      const { testCommunity, alice, pack } = await makeSourcePack();
      await db.update(branchTable).set({ name: "Something else" }).where(eq(branchTable.communityId, testCommunity.id));
      await db.insert(branchTable).values({ communityId: testCommunity.id, name: "Fruits" });
      const [chosenBranch] = await db
        .insert(branchTable)
        .values({ communityId: testCommunity.id, name: "Deliberately different pick" })
        .returning();

      const newCycle = await commitPackImport(alice, {
        packId: pack.id,
        cycleName: "2028 Season",
        hintResolutions: { Fruit: { action: "use_existing", branchId: chosenBranch.id } },
      });

      const newTasks = await db.select().from(task).where(eq(task.cycleId, newCycle.id));
      expect(newTasks[0].branchId).toBe(chosenBranch.id);
    });
  });

  it("previewPackImportDates resolves the same recipe commitPackImport would apply, without creating anything", async () => {
    const { alice, pack } = await makeSourcePack();
    const preview = await previewPackImportDates(alice, pack.id, "2028-07-01", "2028-07-10");
    expect(preview.phases[0].start).toBe("2028-07-01");
    expect(preview.milestones).toHaveLength(1);
    expect(preview.milestones[0].date).toBe("2028-07-03");

    // Confirmed nothing committed.
    const cyclesAfter = await db.select().from(cycle).where(eq(cycle.communityId, alice.communityId));
    expect(cyclesAfter).toHaveLength(1); // just the source cycle from makeSourcePack
  });
});

describe("pending branch review", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a non-Admins importer's new branch lands pending, confirming locks it in", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const sourceCycle = await createCycle(alice, { source: "blank", name: "Source" });
    await insertTask(testCommunity.id, branch.id, sourceCycle.id, alice.id, {});
    const pack = await exportCycleAsTaskPack(alice, sourceCycle.id, { name: "Pack" });

    // Give the community a real Admins-gating task, held by alice (a
    // direct assignment insert bypasses the full candidacy/endorsement
    // flow, the same test-only shortcut tests/coordination.test.ts's
    // own shadow-assignment setup already uses) but not bob — so
    // requireAdmins actually checks holdings instead of falling back
    // to "any member."
    const [adminsTask] = await db
      .insert(task)
      .values({
        communityId: testCommunity.id,
        branchId: branch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 1 },
        openness: "community_endorsed",
        createdBy: alice.id,
      })
      .returning();
    await grantPermission(testCommunity.id, "admin", adminsTask.id);
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db.update(community).set({ adminsEverClaimed: true }).where(eq(community.id, testCommunity.id));

    expect(await isAdmin(alice)).toBe(true);
    expect(await isAdmin(bob)).toBe(false);

    const newCycle = await commitPackImport(bob, {
      packId: pack.id,
      cycleName: "2028 Season",
      hintResolutions: { [branch.name]: { action: "create_new" } },
    });
    const newTasks = await db.select().from(task).where(eq(task.cycleId, newCycle.id));
    const [pendingBranch] = await db.select().from(branchTable).where(eq(branchTable.id, newTasks[0].branchId));
    expect(pendingBranch.status).toBe("pending");

    const confirmed = await confirmPendingBranch(alice, pendingBranch.id);
    expect(confirmed.status).toBe("confirmed");
  });

  it("rejecting re-points every affected task to the reassignment branch and removes the pending row", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [pending] = await db
      .insert(branchTable)
      .values({ communityId: testCommunity.id, name: "Pending one", status: "pending" })
      .returning();
    const [t] = await db
      .insert(task)
      .values({
        communityId: testCommunity.id,
        branchId: pending.id,
        title: "Orphaned by rejection",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
        createdBy: alice.id,
      })
      .returning();

    await rejectPendingBranch(alice, pending.id, branch.id);

    const [reassignedTask] = await db.select().from(task).where(eq(task.id, t.id));
    expect(reassignedTask.branchId).toBe(branch.id);
    const stillThere = await db.select().from(branchTable).where(eq(branchTable.id, pending.id));
    expect(stillThere).toHaveLength(0);
  });

  it("rejects confirming/rejecting a branch that isn't actually pending", async () => {
    const { branch, alice } = await createFixtures();
    await expect(confirmPendingBranch(alice, branch.id)).rejects.toThrow(ConflictError);
  });
});

describe("archiveTaskPack / listTaskPacks", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("archives without deleting, and excludes nothing from listTaskPacks (archived still listed, just flagged)", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const c = await createCycle(alice, { source: "blank", name: "Source" });
    await insertTask(testCommunity.id, branch.id, c.id, alice.id, {});
    const pack = await exportCycleAsTaskPack(alice, c.id, { name: "Pack" });

    const archived = await archiveTaskPack(alice, pack.id);
    expect(archived.archivedAt).not.toBeNull();

    const packs = await listTaskPacks(alice);
    expect(packs.map((p) => p.id)).toContain(pack.id);
  });
});
