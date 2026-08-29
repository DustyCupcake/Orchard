import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, tier } from "@/db/schema";
import { createCycle, getCycle, updateCycleSettings } from "@/lib/cycles";
import { declareParticipation, getCycleParticipationSummary, getMyParticipation } from "@/lib/participation";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string, cycleInitiationTierId?: string) {
  await db
    .update(community)
    .set({ cyclesEnabled: true, cycleInitiationTierId: cycleInitiationTierId ?? null })
    .where(eq(community.id, communityId));
}

describe("declareParticipation / getMyParticipation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("defaults to 'unknown' with no note/dates before anyone declares", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const mine = await getMyParticipation(alice, cyc.id);
    expect(mine).toMatchObject({ status: "unknown", arrivalDate: null, departureDate: null, note: null });
  });

  it("declaring for the first time creates a row; declaring again upserts in place", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const first = await declareParticipation(alice, cyc.id, {
      status: "maybe",
      arrivalDate: "2027-06-01",
      departureDate: null,
      note: "Depends on work",
    });

    const second = await declareParticipation(alice, cyc.id, {
      status: "coming",
      arrivalDate: "2027-06-01",
      departureDate: "2027-06-10",
      note: null,
    });

    // Same row, updated in place — not a second row.
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("coming");
    expect(second.departureDate).toBe("2027-06-10");
    expect(second.note).toBeNull();

    const mine = await getMyParticipation(alice, cyc.id);
    expect(mine.status).toBe("coming");
  });

  it("declaring participation is scoped per member — doesn't affect another member's row", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    await declareParticipation(alice, cyc.id, { status: "coming" });

    const bobsView = await getMyParticipation(bob, cyc.id);
    expect(bobsView.status).toBe("unknown");
  });

  it("rejects declaring against a cycle from another community", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const { alice: strangerAlice } = await createFixtures();
    await expect(declareParticipation(strangerAlice, cyc.id, { status: "coming" })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("getCycleParticipationSummary", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("remaining capacity is null when the cycle has no capacity cap", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const summary = await getCycleParticipationSummary(alice, cyc.id);
    expect(summary.capacity).toBeNull();
    expect(summary.remainingCapacity).toBeNull();
  });

  it("counts only 'coming' Participation toward remaining capacity", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await updateCycleSettings(alice, cyc.id, { capacity: 5 });

    await declareParticipation(alice, cyc.id, { status: "coming" });
    await declareParticipation(bob, cyc.id, { status: "maybe" });

    const summary = await getCycleParticipationSummary(alice, cyc.id);
    expect(summary.comingCount).toBe(1);
    expect(summary.remainingCapacity).toBe(4);
  });

  it("remaining capacity goes negative when over capacity, rather than clamping or blocking", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "Tiny reunion" });
    await updateCycleSettings(alice, cyc.id, { capacity: 1 });

    await declareParticipation(alice, cyc.id, { status: "coming" });
    await declareParticipation(bob, cyc.id, { status: "coming" });

    const summary = await getCycleParticipationSummary(alice, cyc.id);
    expect(summary.comingCount).toBe(2);
    expect(summary.remainingCapacity).toBe(-1);
  });

  it("returning window is open before the close time and closed after, purely time-computed", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const future = new Date(Date.now() + 86400000).toISOString();
    await updateCycleSettings(alice, cyc.id, { returningWindowClosesAt: future });
    let summary = await getCycleParticipationSummary(alice, cyc.id);
    expect(summary.returningWindowOpen).toBe(true);

    const past = new Date(Date.now() - 86400000).toISOString();
    await updateCycleSettings(alice, cyc.id, { returningWindowClosesAt: past });
    summary = await getCycleParticipationSummary(alice, cyc.id);
    expect(summary.returningWindowOpen).toBe(false);
  });

  it("returning window state is null when the Community never set one", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const summary = await getCycleParticipationSummary(alice, cyc.id);
    expect(summary.returningWindowClosesAt).toBeNull();
    expect(summary.returningWindowOpen).toBeNull();
  });
});

describe("updateCycleSettings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("wires up capacity and returningWindowClosesAt, both unused since Phase 6", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    expect(cyc.capacity).toBeNull();
    expect(cyc.returningWindowClosesAt).toBeNull();

    const closesAt = new Date(Date.now() + 3600_000).toISOString();
    const updated = await updateCycleSettings(alice, cyc.id, { capacity: 40, returningWindowClosesAt: closesAt });
    expect(updated.capacity).toBe(40);
    expect(updated.returningWindowClosesAt?.toISOString()).toBe(closesAt);

    const refetched = await getCycle(alice, cyc.id);
    expect(refetched.capacity).toBe(40);
  });

  it("clearing returningWindowClosesAt back to null is a real, distinct update from omitting it", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await updateCycleSettings(alice, cyc.id, { returningWindowClosesAt: new Date().toISOString() });

    const cleared = await updateCycleSettings(alice, cyc.id, { returningWindowClosesAt: null });
    expect(cleared.returningWindowClosesAt).toBeNull();
  });

  it("uses the exact same initiation gate as starting a cycle — the configured Tier, when set", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    const [experienced] = await db
      .insert(tier)
      .values({ communityId: testCommunity.id, name: "Experienced" })
      .returning();
    await enableCycles(testCommunity.id, experienced.id);

    // Grant the tier to create the cycle...
    await db.update(member).set({ tierIds: [experienced.id] }).where(eq(member.id, alice.id));
    const [tieredAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    const created = await createCycle(tieredAlice, { source: "blank", name: "2027 Season" });

    // ...then take it away and confirm the *update* path re-checks
    // eligibility on its own, not just at creation time.
    await db.update(member).set({ tierIds: [] }).where(eq(member.id, alice.id));
    const [untieredAlice] = await db.select().from(member).where(eq(member.id, alice.id));

    await expect(updateCycleSettings(untieredAlice, created.id, { capacity: 10 })).rejects.toThrow(
      ForbiddenError,
    );

    await db.update(member).set({ tierIds: [experienced.id] }).where(eq(member.id, alice.id));
    const [reTieredAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    await expect(updateCycleSettings(reTieredAlice, created.id, { capacity: 10 })).resolves.toMatchObject({
      capacity: 10,
    });
  });

  it("rejects updating settings on a cycle from another community", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const { community: strangerCommunity, alice: strangerAlice } = await createFixtures();
    await enableCycles(strangerCommunity.id);

    await expect(updateCycleSettings(strangerAlice, cyc.id, { capacity: 10 })).rejects.toThrow(NotFoundError);
  });

  it("rejects when cycles aren't even enabled for the Community", async () => {
    const { alice } = await createFixtures();
    await expect(updateCycleSettings(alice, "00000000-0000-0000-0000-000000000000", { capacity: 10 })).rejects.toThrow(
      ConflictError,
    );
  });
});
