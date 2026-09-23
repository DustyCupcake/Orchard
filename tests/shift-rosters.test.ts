import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, shiftOccurrence, shiftSeries, taskAssignment } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import { updateCommunity } from "@/lib/settings";
import {
  confirmShiftProposal,
  createShiftSeries,
  generateShiftOccurrences,
  getCycleShiftRoster,
  isShiftManagerForScope,
  listPendingShiftProposals,
  listShiftManagerScopesForMember,
  listUpcomingShiftOccurrences,
  openCycleShiftSignups,
  resolveShiftManager,
  setShiftSeriesScope,
  signUpForShift,
} from "@/lib/shifts";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantShiftManagementTo, resetDatabase } from "./helpers";

// D9–D11 (docs/cycle-scope-remediation-plan.md §2.6/§4.8/§5.6): cycle-
// scoped shift rosters — placement as the scope declaration,
// grant-based management (D10), and the collecting window / one-way
// open act / proposal-confirmation flow (D11).

describe("Roster placement & the collecting window (D11)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpCycle(manager = "alice") {
    const fixtures = await createFixtures();
    const { alice, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Harvest" });
    if (manager === "alice") {
      await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);
    }
    return { ...fixtures, cycleRow, testBranch };
  }

  it("any member can place a series in a collecting cycle — it lands confirmed and opens with the batch", async () => {
    const { bob, cycleRow } = await setUpCycle("alice");
    const series = await createShiftSeries(bob, { title: "Dish duty", defaultCapacity: 2, cycleId: cycleRow.id });

    expect(series.cycleId).toBe(cycleRow.id);
    expect(series.confirmedAt).not.toBeNull();
  });

  it("a collecting roster is visible-but-closed: browse lists it while sign-ups reject, until the open act", async () => {
    const { alice, bob, cycleRow } = await setUpCycle("alice");
    const series = await createShiftSeries(bob, { title: "Dish duty", defaultCapacity: 2, cycleId: cycleRow.id });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600_000).toISOString() }],
    });

    // Visible on the browse surface, but explicitly not open.
    const upcoming = await listUpcomingShiftOccurrences(bob);
    expect(upcoming.map((u) => u.occurrence.id)).toContain(occurrence.id);
    expect(upcoming.find((u) => u.occurrence.id === occurrence.id)!.signupsOpen).toBe(false);

    await expect(signUpForShift(bob, occurrence.id)).rejects.toThrow(ConflictError);

    // The one-way open act flips the whole roster.
    await openCycleShiftSignups(alice, cycleRow.id);
    await expect(signUpForShift(bob, occurrence.id)).resolves.toBeDefined();
  });

  it("openCycleShiftSignups is manager-only, and the act is one-way", async () => {
    const { alice, bob, cycleRow } = await setUpCycle("alice");
    await expect(openCycleShiftSignups(bob, cycleRow.id)).rejects.toThrow(ForbiddenError);

    await openCycleShiftSignups(alice, cycleRow.id);
    await expect(openCycleShiftSignups(alice, cycleRow.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects opening sign-ups for an unknown cycle", async () => {
    const { alice } = await setUpCycle("alice");
    await expect(openCycleShiftSignups(alice, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
  });
});

describe("Proposals (D11) — placement after the open act", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpOpenedCycle() {
    const fixtures = await createFixtures();
    const { alice, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Harvest" });
    await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);
    await openCycleShiftSignups(alice, cycleRow.id);
    return { ...fixtures, cycleRow };
  }

  it("a placement into an opened roster lands as an unconfirmed proposal, hidden from browse and not claimable", async () => {
    const { alice, bob, cycleRow } = await setUpOpenedCycle();
    const series = await createShiftSeries(bob, { title: "Late dish duty", defaultCapacity: 2, cycleId: cycleRow.id });
    expect(series.confirmedAt).toBeNull();

    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600_000).toISOString() }],
    });

    // Hidden from the general browse surface entirely.
    const upcoming = await listUpcomingShiftOccurrences(bob);
    expect(upcoming.map((u) => u.occurrence.id)).not.toContain(occurrence.id);

    await expect(signUpForShift(bob, occurrence.id)).rejects.toThrow(ConflictError);
  });

  it("confirmShiftProposal is the cycle manager's act and opens the series up", async () => {
    const { alice, bob, cycleRow } = await setUpOpenedCycle();
    const series = await createShiftSeries(bob, { title: "Late dish duty", defaultCapacity: 2, cycleId: cycleRow.id });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600_000).toISOString() }],
    });

    await expect(confirmShiftProposal(bob, series.id)).rejects.toThrow(ForbiddenError);
    const confirmed = await confirmShiftProposal(alice, series.id);
    expect(confirmed.confirmedAt).not.toBeNull();

    const upcoming = await listUpcomingShiftOccurrences(bob);
    expect(upcoming.map((u) => u.occurrence.id)).toContain(occurrence.id);
    await expect(signUpForShift(bob, occurrence.id)).resolves.toBeDefined();
  });

  it("confirmShiftProposal rejects a series that isn't a pending proposal", async () => {
    const { alice, bob, cycleRow } = await setUpOpenedCycle();
    const series = await createShiftSeries(bob, { title: "Late dish duty", defaultCapacity: 2, cycleId: cycleRow.id });
    await confirmShiftProposal(alice, series.id);
    await expect(confirmShiftProposal(alice, series.id)).rejects.toThrow(ForbiddenError);
  });

  it("listPendingShiftProposals only surfaces scopes the actor manages", async () => {
    const { alice, bob, cycleRow } = await setUpOpenedCycle();
    const series = await createShiftSeries(bob, { title: "Late dish duty", defaultCapacity: 2, cycleId: cycleRow.id });

    // bob manages nothing — no surface, even though he placed it.
    expect(await listPendingShiftProposals(bob)).toEqual([]);
    const forAlice = await listPendingShiftProposals(alice);
    expect(forAlice.map((p) => p.series.id)).toEqual([series.id]);
  });
});

describe("Standing series are manager-added (D10)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creating a standing series requires the standing shift_management holder", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    await expect(createShiftSeries(alice, { title: "Dish duty", defaultCapacity: 2 })).rejects.toThrow(ForbiddenError);
  });

  it("setShiftSeriesScope re-places a series only when the actor manages the destination scope", async () => {
    const fixtures = await createFixtures();
    const { alice, bob, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Harvest" });
    // alice manages both the standing scope and the cycle's scope.
    await grantShiftManagementTo(alice, testBranch.id);
    await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);

    const series = await createShiftSeries(alice, { title: "Dish duty", defaultCapacity: 2 });
    expect(series.cycleId).toBeNull();

    await expect(setShiftSeriesScope(bob, series.id, cycleRow.id)).rejects.toThrow(ForbiddenError);

    // A manager's own placement is confirmed immediately, even into an
    // already-opened roster.
    await openCycleShiftSignups(alice, cycleRow.id);
    const placed = await setShiftSeriesScope(alice, series.id, cycleRow.id);
    expect(placed.cycleId).toBe(cycleRow.id);
    expect(placed.confirmedAt).not.toBeNull();

    // And back out to standing again.
    const demoted = await setShiftSeriesScope(alice, series.id, null);
    expect(demoted.cycleId).toBeNull();
    expect(demoted.confirmedAt).not.toBeNull();
  });
});

describe("Scope resolution (D10)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("resolves distinct holders for the standing and per-cycle scopes", async () => {
    const fixtures = await createFixtures();
    const { alice, bob, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Harvest" });

    // alice: standing manager. bob: this cycle's manager.
    await grantShiftManagementTo(alice, testBranch.id);
    await grantShiftManagementTo(bob, testBranch.id, cycleRow.id);

    expect((await resolveShiftManager(alice.communityId, null))!.id).toBe(alice.id);
    expect((await resolveShiftManager(alice.communityId, cycleRow.id))!.id).toBe(bob.id);

    expect(await isShiftManagerForScope(alice, null)).toBe(true);
    expect(await isShiftManagerForScope(alice, cycleRow.id)).toBe(false);
    expect(await isShiftManagerForScope(bob, cycleRow.id)).toBe(true);

    const aliceScopes = await listShiftManagerScopesForMember(alice);
    expect(aliceScopes).toEqual([null]);
    const bobScopes = await listShiftManagerScopesForMember(bob);
    expect(bobScopes).toEqual([cycleRow.id]);
  });

  it("a shadow holder is not the manager — access follows the real holder", async () => {
    const fixtures = await createFixtures();
    const { alice, bob, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    const grantTask = await grantShiftManagementTo(alice, testBranch.id);

    await db
      .insert(taskAssignment)
      .values({ taskId: grantTask.id, memberId: bob.id, isShadow: true });
    expect(await isShiftManagerForScope(bob, null)).toBe(false);
    expect(await isShiftManagerForScope(alice, null)).toBe(true);
  });
});

describe("getCycleShiftRoster (§5.6)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("assembles manager, window state, series and fill counts for the cycle view", async () => {
    const fixtures = await createFixtures();
    const { alice, bob, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Harvest" });
    await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);

    const series = await createShiftSeries(bob, { title: "Dish duty", defaultCapacity: 2, cycleId: cycleRow.id });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(), endsAt: new Date(Date.now() + 50 * 3600_000).toISOString() }],
    });
    await openCycleShiftSignups(alice, cycleRow.id);
    await signUpForShift(bob, occurrence.id);

    const roster = await getCycleShiftRoster(bob, cycleRow.id);
    expect(roster.manager!.id).toBe(alice.id);
    expect(roster.isManager).toBe(false);
    expect(roster.signupsOpened).toBe(true);
    expect(roster.series).toHaveLength(1);
    expect(roster.series[0].confirmedAt).not.toBeNull();
    expect(roster.series[0].occurrences[0].signupCount).toBe(1);
    expect(roster.series[0].occurrences[0].capacity).toBe(2);

    const aliceView = await getCycleShiftRoster(alice, cycleRow.id);
    expect(aliceView.isManager).toBe(true);
  });
});

describe("Clone carries the roster (§4.8/D9)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const SRC_START = "2026-09-07";
  const SRC_END = "2026-10-07";
  const DST_START = "2026-10-05";
  const DST_END = "2026-11-05";

  async function setUpClonableCycle() {
    const fixtures = await createFixtures();
    const { alice, bob, branch: testBranch } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
    const cycleRow = await createCycle(alice, {
      source: "blank",
      name: "Harvest",
      startDate: SRC_START,
      endDate: SRC_END,
    });
    await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);

    // Confirmed series with one occurrence at a fixed anchored time.
    const confirmed = await createShiftSeries(bob, {
      title: "Dish duty",
      defaultCapacity: 2,
      cycleId: cycleRow.id,
    });
    await generateShiftOccurrences(alice, confirmed.id, {
      mode: "explicit",
      slots: [{ startsAt: "2026-09-10T14:00:00.000Z", endsAt: "2026-09-10T15:00:00.000Z" }],
    });

    // Open the roster, then place a proposal.
    await openCycleShiftSignups(alice, cycleRow.id);
    const proposal = await createShiftSeries(bob, {
      title: "Late dish duty",
      defaultCapacity: 2,
      cycleId: cycleRow.id,
    });
    expect(proposal.confirmedAt).toBeNull();

    return { ...fixtures, cycleRow, confirmed, proposal };
  }

  it("copies the roster into the new cycle, re-deriving occurrence timestamps against its dates", async () => {
    const { alice } = await setUpClonableCycle();

    const newCycle = await createCycle(alice, {
      source: "clone_previous",
      name: "Winter",
      startDate: DST_START,
      endDate: DST_END,
      confirmed: true,
    });

    const clonedSeries = await db.select().from(shiftSeries).where(eq(shiftSeries.cycleId, newCycle.id));
    expect(clonedSeries.map((s) => s.title).sort()).toEqual(["Dish duty", "Late dish duty"]);

    // Confirmed stays confirmed; the proposal carries as a proposal.
    const clonedConfirmed = clonedSeries.find((s) => s.title === "Dish duty")!;
    const clonedProposal = clonedSeries.find((s) => s.title === "Late dish duty")!;
    expect(clonedConfirmed.confirmedAt).not.toBeNull();
    expect(clonedProposal.confirmedAt).toBeNull();

    // The occurrence re-derived via the relative recipe: 2026-09-10 is 3
    // days into the source window, so it lands 3 days into the dest.
    const clonedOccurrences = await db
      .select()
      .from(shiftOccurrence)
      .where(eq(shiftOccurrence.seriesId, clonedConfirmed.id));
    expect(clonedOccurrences).toHaveLength(1);
    expect(clonedOccurrences[0].startsAt.toISOString()).toBe("2026-10-08T14:00:00.000Z");
    expect(clonedOccurrences[0].endsAt.toISOString()).toBe("2026-10-08T15:00:00.000Z");

    // The clone's roster starts back in a collecting window, whatever
    // the source cycle's own state was.
    const [clonedCycle] = await db.select().from(cycle).where(eq(cycle.id, newCycle.id));
    expect(clonedCycle.shiftSignupsOpenedAt).toBeNull();
  });

  it("defers occurrence materialization when the target cycle has no dates", async () => {
    const { alice } = await setUpClonableCycle();

    const newCycle = await createCycle(alice, { source: "clone_previous", name: "Winter", confirmed: true });
    const clonedSeries = await db.select().from(shiftSeries).where(eq(shiftSeries.cycleId, newCycle.id));
    expect(clonedSeries).toHaveLength(2); // the roster still carries...

    const occurrenceCount = await db
      .select({ id: shiftOccurrence.id })
      .from(shiftOccurrence)
      .innerJoin(shiftSeries, eq(shiftOccurrence.seriesId, shiftSeries.id))
      .where(eq(shiftSeries.cycleId, newCycle.id));
    expect(occurrenceCount).toHaveLength(0); // ...but occurrences are deferred
  });
});