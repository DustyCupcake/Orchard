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

describe("Cycle start_date/end_date", () => {
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

  it("updateCycleSettings rejects a direct edit that would violate order", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);
    const created = await createCycle(alice, {
      source: "blank",
      name: "2027 Season",
      startDate: "2027-03-01",
      endDate: "2027-09-01",
    });

    await expect(
      updateCycleSettings(alice, created.id, { endDate: "2027-01-01" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("Phase boundaries at creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("resolves an absolute boundary via the flat shorthand", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: "2027-04-01" }],
    });
    const withPhases = await getCycle(alice, created.id);
    expect(withPhases.phases[0].startDateType).toBe("absolute");
    expect(withPhases.phases[0].startDate).toBe("2027-04-01");
  });

  it("resolves a relative offset boundary against the cycle's own dates", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      phases: [
        {
          name: "Build",
          order: 0,
          start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 30 },
        },
      ],
    });
    const withPhases = await getCycle(alice, created.id);
    expect(withPhases.phases[0].startDateType).toBe("relative");
    expect(withPhases.phases[0].startOffsetDays).toBe(30);
    expect(withPhases.phases[0].startDate).toBe("2027-01-31");
  });

  it("resolves a relative percent boundary against both cycle boundaries", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-01-11",
      phases: [{ name: "Build", order: 0, end: { type: "relative_percent", percent: 50 } }],
    });
    const withPhases = await getCycle(alice, created.id);
    expect(withPhases.phases[0].endDate).toBe("2027-01-06");
  });

  it("leaves a relative boundary unresolved (null) when the cycle has no dates yet", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [
        {
          name: "Build",
          order: 0,
          start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 30 },
        },
      ],
    });
    const withPhases = await getCycle(alice, created.id);
    expect(withPhases.phases[0].startDate).toBeNull();
    expect(withPhases.phases[0].startOffsetDays).toBe(30); // recipe stored regardless
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

describe("Cycle dates moving cascades to relative Phase boundaries", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("recomputes a relative boundary's cached date once the cycle's own dates are set", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [
        {
          name: "Build",
          order: 0,
          start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 30 },
        },
      ],
    });
    const before = await getCycle(alice, created.id);
    expect(before.phases[0].startDate).toBeNull();

    await updateCycleSettings(alice, created.id, { startDate: "2027-01-01" });

    const after = await getCycle(alice, created.id);
    expect(after.phases[0].startDate).toBe("2027-01-31");
  });

  it("tracks the anchor again when the cycle's dates move a second time, recipe unchanged", async () => {
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
          start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 30 },
        },
      ],
    });
    const initial = await getCycle(alice, created.id);
    expect(initial.phases[0].startDate).toBe("2027-01-31");

    await updateCycleSettings(alice, created.id, { startDate: "2027-02-01" });

    const moved = await getCycle(alice, created.id);
    expect(moved.phases[0].startDate).toBe("2027-03-03");
    expect(moved.phases[0].startOffsetDays).toBe(30);
  });

  it("leaves an absolute Phase boundary untouched when the cycle's own dates move", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0, startDate: "2027-04-15" }],
    });

    await updateCycleSettings(alice, created.id, { startDate: "2027-02-01" });

    const after = await getCycle(alice, created.id);
    expect(after.phases[0].startDate).toBe("2027-04-15");
  });

  it("surfaces orderInvalid as a live flag (not blocked) when a cascade drifts a pair into violation", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    // start is relative (cycle_start + 5d, initially before the fixed
    // end); end is a fixed absolute date. Starting the cycle later
    // pushes the relative start past the fixed end — nothing about
    // *this* edit (the cycle's own dates) was invalid on its own
    // terms, so it's not rejected; it just surfaces as a standing flag.
    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [
        {
          name: "Build",
          order: 0,
          start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 5 },
          endDate: "2027-01-15",
        },
      ],
    });
    const before = await getCycle(alice, created.id);
    expect(before.phases[0].startDate).toBe("2027-01-06");
    expect(before.phases[0].flags.orderInvalid).toBe(false);

    await updateCycleSettings(alice, created.id, { startDate: "2027-01-20" });

    const after = await getCycle(alice, created.id);
    expect(after.phases[0].startDate).toBe("2027-01-25");
    expect(after.phases[0].flags.orderInvalid).toBe(true);
  });

  it("surfaces the drift flag once the cycle's dates move an offset item closer to the other boundary", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    const created = await createCycle(alice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      endDate: "2027-01-31",
      phases: [
        {
          name: "Build",
          order: 0,
          start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 4 },
        },
      ],
    });
    const before = await getCycle(alice, created.id);
    expect(before.phases[0].flags.startDrifted).toBe(false);

    // Shrink the cycle so the fixed 4-day offset now lands much closer
    // to cycle_end than to the cycle_start it's actually anchored to.
    await updateCycleSettings(alice, created.id, { endDate: "2027-01-06" });

    const after = await getCycle(alice, created.id);
    expect(after.phases[0].flags.startDrifted).toBe(true);
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
    const withPhases = await getCycle(alice, created.id);
    return { cycleId: created.id, phaseId: withPhases.phases[0].id };
  }

  it("edits a boundary by typing a new offset directly", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);

    const updated = await updatePhaseBoundary(alice, phaseId, {
      start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 10 },
    });
    expect(updated.startDate).toBe("2027-01-11");
    expect(updated.startOffsetDays).toBe(10);
  });

  it("edits a boundary by dragging it to a target date, persisting the recomputed offset", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);

    const updated = await updatePhaseBoundary(alice, phaseId, {
      start: { type: "relative_offset", anchor: "cycle_start", targetDate: "2027-02-01" },
    });
    // Never a bare date — the offset is what's actually persisted.
    expect(updated.startOffsetDays).toBe(31);
    expect(updated.startDate).toBe("2027-02-01");
  });

  it("can switch a boundary back to absolute explicitly", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);

    await updatePhaseBoundary(alice, phaseId, {
      start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 10 },
    });
    const reverted = await updatePhaseBoundary(alice, phaseId, {
      start: { type: "absolute", date: "2027-05-05" },
    });
    expect(reverted.startDateType).toBe("absolute");
    expect(reverted.startDate).toBe("2027-05-05");
    expect(reverted.startOffsetDays).toBeNull();
  });

  it("leaves the untouched boundary alone", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);

    await updatePhaseBoundary(alice, phaseId, { start: { type: "absolute", date: "2027-03-01" } });
    const updated = await updatePhaseBoundary(alice, phaseId, {
      end: { type: "absolute", date: "2027-06-01" },
    });
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

  it("404s for a phase that doesn't belong to the actor's own Community", async () => {
    const { alice } = await createFixtures();
    const { phaseId } = await seedPhase(alice);

    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [stranger] = await db
      .insert(member)
      .values({ communityId: otherCommunity.id, name: "Stranger" })
      .returning();
    await enableCycles(otherCommunity.id);

    await expect(updatePhaseBoundary(stranger, phaseId, {})).rejects.toThrow(NotFoundError);
  });

  it("gates on the same cycle-initiation-eligibility Tier as starting a cycle", async () => {
    const { alice, bob } = await createFixtures();
    const [experienced] = await db
      .insert(tier)
      .values({ communityId: alice.communityId, name: "Experienced" })
      .returning();
    await enableCycles(alice.communityId, experienced.id);
    await db.update(member).set({ tierIds: [experienced.id] }).where(eq(member.id, alice.id));
    const [eligibleAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    const created = await createCycle(eligibleAlice, {
      source: "blank",
      name: "Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0 }],
    });
    const withPhases = await getCycle(eligibleAlice, created.id);
    const phaseId = withPhases.phases[0].id;

    await expect(
      updatePhaseBoundary(bob, phaseId, { start: { type: "absolute", date: "2027-02-01" } }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("Cloning carries the recipe, not the date", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("carries a relative boundary's recipe forward, cached date unresolved until the new cycle gets dates", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    await createCycle(alice, {
      source: "blank",
      name: "2026 Season",
      startDate: "2027-01-01",
      phases: [
        {
          name: "Build",
          order: 0,
          start: { type: "relative_offset", anchor: "cycle_start", offsetDays: 30 },
        },
      ],
    });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const clonedPhases = await db.select().from(phase).where(eq(phase.cycleId, cloned.id));
    expect(clonedPhases[0].startDateType).toBe("relative");
    expect(clonedPhases[0].startOffsetDays).toBe(30);
    expect(clonedPhases[0].startOffsetAnchor).toBe("cycle_start");
    expect(clonedPhases[0].startDate).toBeNull();
  });

  it("derives an offset recipe from an absolute boundary, against the source cycle's own start_date", async () => {
    const { alice } = await createFixtures();
    await enableCycles(alice.communityId);

    await createCycle(alice, {
      source: "blank",
      name: "2026 Season",
      startDate: "2027-01-01",
      phases: [{ name: "Build", order: 0, startDate: "2027-01-31" }],
    });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const clonedPhases = await db.select().from(phase).where(eq(phase.cycleId, cloned.id));
    expect(clonedPhases[0].startDateType).toBe("relative");
    expect(clonedPhases[0].startRelativeMode).toBe("offset");
    expect(clonedPhases[0].startOffsetAnchor).toBe("cycle_start");
    expect(clonedPhases[0].startOffsetDays).toBe(30);

    // And it resolves once the new cycle gets its own start date.
    await updateCycleSettings(alice, cloned.id, { startDate: "2028-02-01" });
    const after = await getCycle(alice, cloned.id);
    expect(after.phases[0].startDate).toBe("2028-03-02"); // 30 days after 2028-02-01, a leap year
  });

  it("falls back to fully unset when the source cycle had no start_date to derive from", async () => {
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
