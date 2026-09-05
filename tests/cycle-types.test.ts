import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import {
  computeCycleTypeCount,
  createCycleType,
  createTier,
  deleteCycleType,
  getCycleTypeCountProgress,
  listCycleTypes,
  updateCycleType,
  updateTier,
} from "@/lib/settings";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

describe("CycleType CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates, lists, updates, and deletes a cycle type", async () => {
    const { alice } = await createFixtures();

    const created = await createCycleType(alice, { name: "Season" });
    expect(created.name).toBe("Season");
    expect(created.defaultSourceCycleId).toBeNull();

    expect((await listCycleTypes(alice)).map((c) => c.name)).toEqual(["Season"]);

    const updated = await updateCycleType(alice, created.id, { name: "Full Season" });
    expect(updated.name).toBe("Full Season");

    await deleteCycleType(alice, created.id);
    expect(await listCycleTypes(alice)).toHaveLength(0);
  });

  it("validates defaultSourceCycleId belongs to the same community", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const ownCycle = await createCycle(alice, { source: "blank", name: "2026 Season" });

    const { alice: stranger } = await createFixtures();
    await enableCycles(stranger.communityId);
    const strangerCycle = await createCycle(stranger, { source: "blank", name: "Elsewhere" });

    await expect(
      createCycleType(alice, { name: "Season", defaultSourceCycleId: strangerCycle.id }),
    ).rejects.toThrow(NotFoundError);

    const created = await createCycleType(alice, { name: "Season", defaultSourceCycleId: ownCycle.id });
    expect(created.defaultSourceCycleId).toBe(ownCycle.id);
  });

  it("blocks deleting a cycle type still referenced by a Cycle", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const type = await createCycleType(alice, { name: "Season" });
    await createCycle(alice, { source: "blank", name: "2026 Season", cycleTypeId: type.id });

    await expect(deleteCycleType(alice, type.id)).rejects.toThrow(ConflictError);
  });

  it("scopes everything to the actor's own community", async () => {
    const { alice } = await createFixtures();
    const { alice: stranger } = await createFixtures();
    const type = await createCycleType(alice, { name: "Season" });

    await expect(updateCycleType(stranger, type.id, { name: "Hijacked" })).rejects.toThrow(NotFoundError);
    await expect(deleteCycleType(stranger, type.id)).rejects.toThrow(NotFoundError);
  });
});

describe("Tagging a Cycle with a type at creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("tags a blank cycle with a type", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const type = await createCycleType(alice, { name: "Season" });

    const created = await createCycle(alice, { source: "blank", name: "2026 Season", cycleTypeId: type.id });
    expect(created.cycleTypeId).toBe(type.id);
  });

  it("tags a cloned cycle with a type independent of the source cycle's own type", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const season = await createCycleType(alice, { name: "Season" });
    const reunion = await createCycleType(alice, { name: "Reunion" });

    await createCycle(alice, { source: "blank", name: "2026 Season", cycleTypeId: season.id });
    const cloned = await createCycle(alice, {
      source: "clone_previous",
      name: "2027 Reunion",
      cycleTypeId: reunion.id,
      confirmed: true,
    });
    expect(cloned.cycleTypeId).toBe(reunion.id);
  });

  it("rejects an unknown cycleTypeId", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    await expect(
      createCycle(alice, { source: "blank", name: "2026 Season", cycleTypeId: crypto.randomUUID() }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("Tier cycle_type_count criterion validation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("accepts a valid cycleTypeId/minCount config", async () => {
    const { alice } = await createFixtures();
    const type = await createCycleType(alice, { name: "Season" });

    const created = await createTier(alice, {
      name: "Experienced",
      criterionType: "cycle_type_count",
      criterionConfig: { cycleTypeId: type.id, minCount: 2 },
    });
    expect(created.criterionType).toBe("cycle_type_count");
  });

  it("rejects a missing or malformed config", async () => {
    const { alice } = await createFixtures();

    await expect(
      createTier(alice, { name: "Experienced", criterionType: "cycle_type_count" }),
    ).rejects.toThrow(AppError);

    const type = await createCycleType(alice, { name: "Season" });
    await expect(
      createTier(alice, {
        name: "Experienced",
        criterionType: "cycle_type_count",
        criterionConfig: { cycleTypeId: type.id, minCount: -1 },
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects a cycleTypeId from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: stranger } = await createFixtures();
    const strangerType = await createCycleType(stranger, { name: "Season" });

    await expect(
      createTier(alice, {
        name: "Experienced",
        criterionType: "cycle_type_count",
        criterionConfig: { cycleTypeId: strangerType.id, minCount: 2 },
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("re-validates config on update against the tier's existing criterionType", async () => {
    const { alice } = await createFixtures();
    const type = await createCycleType(alice, { name: "Season" });
    const created = await createTier(alice, {
      name: "Experienced",
      criterionType: "cycle_type_count",
      criterionConfig: { cycleTypeId: type.id, minCount: 2 },
    });

    await expect(
      updateTier(alice, created.id, { criterionConfig: { cycleTypeId: type.id, minCount: 0 } }),
    ).rejects.toThrow(AppError);

    const updated = await updateTier(alice, created.id, {
      criterionConfig: { cycleTypeId: type.id, minCount: 3 },
    });
    expect((updated.criterionConfig as { minCount: number }).minCount).toBe(3);
  });

  it("leaves a manual tier's config untouched by criterion validation", async () => {
    const { alice } = await createFixtures();
    const created = await createTier(alice, { name: "Founder" });
    const updated = await updateTier(alice, created.id, { name: "Founding member" });
    expect(updated.name).toBe("Founding member");
  });
});

describe("computeCycleTypeCount", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("counts distinct Cycles of the given type with Participation 'coming', excluding other types and statuses", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const season = await createCycleType(alice, { name: "Season" });
    const reunion = await createCycleType(alice, { name: "Reunion" });

    const season1 = await createCycle(alice, { source: "blank", name: "S1", cycleTypeId: season.id });
    const season2 = await createCycle(alice, { source: "blank", name: "S2", cycleTypeId: season.id, confirmed: true });
    const reunion1 = await createCycle(alice, { source: "blank", name: "R1", cycleTypeId: reunion.id, confirmed: true });
    const untyped = await createCycle(alice, { source: "blank", name: "U1", confirmed: true });

    await declareParticipation(alice, season1.id, { status: "coming" });
    await declareParticipation(alice, season2.id, { status: "maybe" }); // doesn't count
    await declareParticipation(alice, reunion1.id, { status: "coming" }); // wrong type
    await declareParticipation(alice, untyped.id, { status: "coming" }); // no type at all

    expect(await computeCycleTypeCount(alice.id, season.id)).toBe(1);

    await declareParticipation(alice, season2.id, { status: "coming" });
    expect(await computeCycleTypeCount(alice.id, season.id)).toBe(2);

    expect(await computeCycleTypeCount(alice.id, reunion.id)).toBe(1);
  });
});

describe("syncComputedTiers, triggered from declareParticipation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("grants a cycle_type_count tier once the threshold is reached, and only that tier", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const season = await createCycleType(alice, { name: "Season" });
    const experienced = await createTier(alice, {
      name: "Experienced",
      criterionType: "cycle_type_count",
      criterionConfig: { cycleTypeId: season.id, minCount: 2 },
    });
    const manual = await createTier(alice, { name: "Founder" });
    await db.update(member).set({ tierIds: [manual.id] }).where(eq(member.id, alice.id));

    const season1 = await createCycle(alice, { source: "blank", name: "S1", cycleTypeId: season.id });
    const season2 = await createCycle(alice, { source: "blank", name: "S2", cycleTypeId: season.id, confirmed: true });

    await declareParticipation(alice, season1.id, { status: "coming" });
    let [row] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(row.tierIds.sort()).toEqual([manual.id].sort());

    await declareParticipation(alice, season2.id, { status: "coming" });
    [row] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(new Set(row.tierIds)).toEqual(new Set([manual.id, experienced.id]));
  });

  it("revokes a computed tier if the count later drops below threshold", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const season = await createCycleType(alice, { name: "Season" });
    const experienced = await createTier(alice, {
      name: "Experienced",
      criterionType: "cycle_type_count",
      criterionConfig: { cycleTypeId: season.id, minCount: 2 },
    });

    const season1 = await createCycle(alice, { source: "blank", name: "S1", cycleTypeId: season.id });
    const season2 = await createCycle(alice, { source: "blank", name: "S2", cycleTypeId: season.id, confirmed: true });
    await declareParticipation(alice, season1.id, { status: "coming" });
    await declareParticipation(alice, season2.id, { status: "coming" });

    let [row] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(row.tierIds).toContain(experienced.id);

    await declareParticipation(alice, season2.id, { status: "not_coming" });
    [row] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(row.tierIds).not.toContain(experienced.id);
  });

  it("does nothing when the community has no cycle_type_count tiers at all", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const cyc = await createCycle(alice, { source: "blank", name: "S1" });

    await expect(declareParticipation(alice, cyc.id, { status: "coming" })).resolves.toBeTruthy();
  });

  it("skips a tier whose config hasn't been (fully) set up yet, without crashing", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    // Created with no criterionConfig at all via a raw insert, bypassing
    // createTier's own validation — simulates a row that predates real
    // config, or a defensive edge case.
    const [misconfigured] = await db
      .insert((await import("@/db/schema")).tier)
      .values({ communityId: alice.communityId, name: "Broken", criterionType: "cycle_type_count", criterionConfig: {} })
      .returning();
    const cyc = await createCycle(alice, { source: "blank", name: "S1" });

    await declareParticipation(alice, cyc.id, { status: "coming" });
    const [row] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(row.tierIds).not.toContain(misconfigured.id);
  });
});

describe("getCycleTypeCountProgress", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reports live count/threshold/held status per cycle_type_count tier", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const season = await createCycleType(alice, { name: "Season" });
    await createTier(alice, {
      name: "Experienced",
      criterionType: "cycle_type_count",
      criterionConfig: { cycleTypeId: season.id, minCount: 2 },
    });

    const season1 = await createCycle(alice, { source: "blank", name: "S1", cycleTypeId: season.id });
    await declareParticipation(alice, season1.id, { status: "coming" });

    const progress = await getCycleTypeCountProgress(alice);
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ tierName: "Experienced", cycleTypeName: "Season", count: 1, minCount: 2, held: false });
  });

  it("is empty for a community with no cycle_type_count tiers", async () => {
    const { alice } = await createFixtures();
    expect(await getCycleTypeCountProgress(alice)).toEqual([]);
  });
});

