import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, phase, tier } from "@/db/schema";
import { createCycle, getCycle, updateCycleSettings, updatePhaseBoundary } from "@/lib/cycles";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string, cycleInitiationTierId?: string) {
  await db
    .update(community)
    .set({ cyclesEnabled: true, cycleInitiationTierId: cycleInitiationTierId ?? null })
    .where(eq(community.id, communityId));
}

describe("Cycle dates", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("accepts optional start/end dates at creation", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "2027 Season",
      startDate: "2027-03-01",
      endDate: "2027-09-01",
    });
    expect(created.startDate).toBe("2027-03-01");
    expect(created.endDate).toBe("2027-09-01");
  });

  it("rejects an end date before its own start date", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    await expect(
      createCycle(alice, {
        source: "blank",
        name: "2027 Season",
        startDate: "2027-09-01",
        endDate: "2027-03-01",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects a direct cycle edit that would violate order", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "2027 Season",
      startDate: "2027-03-01",
      endDate: "2027-09-01",
    });
    await expect(updateCycleSettings(alice, created.id, { endDate: "2027-01-01" })).rejects.toThrow(ConflictError);
  });
});

describe("Phase boundaries at creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores absolute boundaries as authoritative dates", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: "2027-04-01" }],
    });
    const phaseRow = (await getCycle(alice, created.id)).phases[0];
    expect(phaseRow.startDateType).toBe("absolute");
    expect(phaseRow.startDate).toBe("2027-04-01");
    expect(phaseRow.startRelativeBasis).toBeNull();
  });

  it("infers a percent recipe for an in-range target", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-01-11",
      phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2027-01-06" } }],
    });
    const phaseRow = (await getCycle(alice, created.id)).phases[0];
    expect(phaseRow.startDateType).toBe("relative");
    expect(phaseRow.startRelativeBasis).toBe("between");
    expect(phaseRow.startRelativeValue).toBe(5000);
    expect(phaseRow.startDate).toBe("2027-01-06");
  });

  it("infers a start offset for a target before the cycle", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-06-01",
      phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2026-12-28" } }],
    });
    const phaseRow = (await getCycle(alice, created.id)).phases[0];
    expect(phaseRow.startRelativeBasis).toBe("start");
    expect(phaseRow.startRelativeValue).toBe(-4);
    expect(phaseRow.startDate).toBe("2026-12-28");
  });

  it("infers an end offset for a target after the cycle", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-06-01",
      phases: [{ name: "Build", order: 0, end: { type: "relative", date: "2027-06-08" } }],
    });
    const phaseRow = (await getCycle(alice, created.id)).phases[0];
    expect(phaseRow.endRelativeBasis).toBe("end");
    expect(phaseRow.endRelativeValue).toBe(7);
  });

  it("supports a relative boundary with only one parent date", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2027-01-31" } }],
    });
    const phaseRow = (await getCycle(alice, created.id)).phases[0];
    expect(phaseRow.startRelativeBasis).toBe("start");
    expect(phaseRow.startRelativeValue).toBe(30);
    expect(phaseRow.startDate).toBe("2027-01-31");
  });

  it("rejects a relative boundary when the cycle has no parent date", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    await expect(
      createCycle(alice, {
        source: "blank",
        name: "Season",
        phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2027-01-31" } }],
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects a phase whose end resolves before its own start", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    await expect(
      createCycle(alice, {
        source: "blank",
        name: "Season",
        phases: [{ name: "Build", order: 0, startDate: "2027-06-01", endDate: "2027-01-01" }],
      }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("Cycle dates moving cascades to Phase boundaries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("recomputes a between recipe without changing its value", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-01-21",
      phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2027-01-06" } }],
    });
    const before = (await getCycle(alice, created.id)).phases[0];
    expect(before.startRelativeValue).toBe(2500);

    await updateCycleSettings(alice, created.id, { endDate: "2027-02-10" });
    const after = (await getCycle(alice, created.id)).phases[0];
    expect(after.startDate).toBe("2027-01-11");
    expect(after.startRelativeValue).toBe(2500);
  });

  it("normalizes a one-sided start recipe when the cycle end is added", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2027-01-15" } }],
    });
    expect((await getCycle(alice, created.id)).phases[0].startRelativeBasis).toBe("start");

    await updateCycleSettings(alice, created.id, { endDate: "2027-01-31" });
    const normalized = (await getCycle(alice, created.id)).phases[0];
    expect(normalized.startRelativeBasis).toBe("between");
    expect(normalized.startRelativeValue).toBe(4667);
  });

  it("moves a one-sided start offset when the known start moves", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2027-01-31" } }],
    });
    await updateCycleSettings(alice, created.id, { startDate: "2027-02-01" });
    const moved = (await getCycle(alice, created.id)).phases[0];
    expect(moved.startDate).toBe("2027-03-03");
    expect(moved.startRelativeValue).toBe(30);
  });

  it("leaves an absolute Phase boundary untouched", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0, startDate: "2027-04-15" }],
    });
    await updateCycleSettings(alice, created.id, { startDate: "2027-02-01" });
    expect((await getCycle(alice, created.id)).phases[0].startDate).toBe("2027-04-15");
  });

  it("surfaces orderInvalid without rejecting a cascade that crosses a fixed boundary", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [
        {
          name: "Build",
          order: 0,
          start: { type: "relative", date: "2027-01-06" },
          endDate: "2027-01-15",
        },
      ],
    });
    expect((await getCycle(alice, created.id)).phases[0].flags.orderInvalid).toBe(false);
    await updateCycleSettings(alice, created.id, { startDate: "2027-01-20" });
    const after = await getCycle(alice, created.id);
    expect(after.phases[0].startDate).toBe("2027-01-25");
    expect(after.phases[0].flags.orderInvalid).toBe(true);
  });
});

describe("updatePhaseBoundary", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedPhase(alice: Awaited<ReturnType<typeof createFixtures>>["alice"]) {
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      phases: [{ name: "Build", order: 0 }],
    });
    const phaseRow = (await getCycle(alice, created.id)).phases[0];
    return { cycleId: created.id, phaseId: phaseRow.id };
  }

  it("infers and stores a relative recipe from the submitted date", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);
    const updated = await updatePhaseBoundary(alice, phaseId, {
      start: { type: "relative", date: "2027-02-01" },
    });
    expect(updated.startDate).toBe("2027-02-01");
    expect(updated.startRelativeBasis).toBe("between");
    expect(updated.startRelativeValue).toBe(852);
  });

  it("preserves the existing recipe when the date is submitted unchanged", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);
    const first = await updatePhaseBoundary(alice, phaseId, {
      start: { type: "relative", date: "2027-02-01" },
    });
    const second = await updatePhaseBoundary(alice, phaseId, {
      start: { type: "relative", date: "2027-02-01" },
    });
    expect(second.startRelativeBasis).toBe(first.startRelativeBasis);
    expect(second.startRelativeValue).toBe(first.startRelativeValue);
  });

  it("can switch a boundary back to absolute explicitly", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);
    await updatePhaseBoundary(alice, phaseId, { start: { type: "relative", date: "2027-02-01" } });
    const reverted = await updatePhaseBoundary(alice, phaseId, {
      start: { type: "absolute", date: "2027-05-05" },
    });
    expect(reverted.startDateType).toBe("absolute");
    expect(reverted.startDate).toBe("2027-05-05");
    expect(reverted.startRelativeBasis).toBeNull();
    expect(reverted.startRelativeValue).toBeNull();
  });

  it("leaves the untouched boundary alone", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);
    await updatePhaseBoundary(alice, phaseId, { start: { type: "absolute", date: "2027-03-01" } });
    const updated = await updatePhaseBoundary(alice, phaseId, { end: { type: "absolute", date: "2027-06-01" } });
    expect(updated.startDate).toBe("2027-03-01");
    expect(updated.endDate).toBe("2027-06-01");
  });

  it("rejects a direct edit that would put the end before the start", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);
    await updatePhaseBoundary(alice, phaseId, { end: { type: "absolute", date: "2027-06-01" } });
    await expect(
      updatePhaseBoundary(alice, phaseId, { start: { type: "absolute", date: "2027-07-01" } }),
    ).rejects.toThrow(AppError);
  });

  it("404s for a phase outside the actor's Community", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);
    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [stranger] = await db.insert(member).values({ communityId: otherCommunity.id, name: "Stranger" }).returning();
    await enableCycles(otherCommunity.id);
    await expect(updatePhaseBoundary(stranger, phaseId, {})).rejects.toThrow(NotFoundError);
  });

  it("gates edits on the same eligibility tier as starting a cycle", async () => {
    const { alice, bob } = await createFixtures();
    const [experienced] = await db.insert(tier).values({ communityId: alice.communityId, name: "Experienced" }).returning();
    await enableCycles(alice.communityId, experienced.id);
    await db.update(member).set({ tierIds: [experienced.id] }).where(eq(member.id, alice.id));
    const [eligibleAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    const created = await createCycle(eligibleAlice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0 }],
    });
    const phaseId = (await getCycle(eligibleAlice, created.id)).phases[0].id;
    await expect(
      updatePhaseBoundary(bob, phaseId, { start: { type: "absolute", date: "2027-02-01" } }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("Cloning carries the recipe, not the resolved date", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("carries a relative recipe forward with no cached date", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    await createCycle(alice, {
      source: "blank",
      name: "2026 Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      phases: [{ name: "Build", order: 0, start: { type: "relative", date: "2027-01-31" } }],
    });
    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const clonedPhases = await db.select().from(phase).where(eq(phase.cycleId, cloned.id));
    expect(clonedPhases[0].startDateType).toBe("relative");
    expect(clonedPhases[0].startRelativeBasis).toBe("between");
    expect(clonedPhases[0].startRelativeValue).toBe(824);
    expect(clonedPhases[0].startDate).toBeNull();
  });

  it("derives a canonical recipe from an absolute source boundary", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    await createCycle(alice, {
      source: "blank",
      name: "2026 Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      phases: [{ name: "Build", order: 0, startDate: "2027-01-31" }],
    });
    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const clonedPhases = await db.select().from(phase).where(eq(phase.cycleId, cloned.id));
    expect(clonedPhases[0].startDateType).toBe("relative");
    expect(clonedPhases[0].startRelativeBasis).toBe("between");
    expect(clonedPhases[0].startRelativeValue).toBe(824);
  });

  it("falls back to unset without a source start date", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    await createCycle(alice, {
      source: "blank",
      name: "2026 Season",
      phases: [{ name: "Build", order: 0, startDate: "2027-01-31" }],
    });
    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const clonedPhases = await db.select().from(phase).where(eq(phase.cycleId, cloned.id));
    expect(clonedPhases[0].startDateType).toBe("absolute");
    expect(clonedPhases[0].startDate).toBeNull();
  });
});
