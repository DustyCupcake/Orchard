import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/db";
import { cycle as cycleTable, meal, menuPlan, shiftOccurrence, shiftSeries, shiftSignup as shiftSignupTable, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  archiveShiftSeries,
  createShiftSeries,
  deleteShiftOccurrence,
  deleteShiftSeries,
  effectiveCapacity,
  generateShiftOccurrences,
  getShiftOccurrence,
  instantFromShiftInput,
  isForeignKeyViolation,
  isShiftCoordinator,
  listMySignups,
  listOccurrencesForSeries,
  listShiftSeries,
  listSignupsForOccurrence,
  listUpcomingShiftOccurrences,
  markShiftSignupCompleted,
  markShiftSignupNoShow,
  openCycleShiftSignups,
  rotateTaskIntoShift,
  signUpForShift,
  unarchiveShiftSeries,
  updateShiftOccurrence,
  updateShiftSeries,
  updateShiftSeriesInput,
  withdrawFromShift,
} from "@/lib/shifts";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createCycle } from "@/lib/cycles";
import { createFixtures, grantShiftManagementTo, resetDatabase } from "./helpers";

async function insertTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Kitchen coordination",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 4 },
      createdBy,
    })
    .returning();
  return row;
}

function iso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

async function setUpModule() {
  const fixtures = await createFixtures();
  const { alice, branch: testBranch } = fixtures;
  await updateCommunity(alice, { modulesEnabled: ["shifts"], cyclesEnabled: true });
  // D10 — creating a standing series is the standing scope's
  // shift_management holder's act, so make alice that holder for all the
  // existing standing-series tests.
  await grantShiftManagementTo(alice, testBranch.id);
  return fixtures;
}

async function createSeries(actor: Awaited<ReturnType<typeof createFixtures>>["alice"], overrides: Partial<Parameters<typeof createShiftSeries>[1]> = {}) {
  return createShiftSeries(actor, {
    title: "Dish duty",
    defaultCapacity: 2,
    ...overrides,
  });
}

describe("ShiftSeries creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects while the module is off", async () => {
    const { alice } = await createFixtures();
    await expect(createShiftSeries(alice, { title: "Dish duty", defaultCapacity: 2 })).rejects.toThrow(
      AppError,
    );
  });

  it("creates a series once the module is on", async () => {
    const { alice } = await setUpModule();
    const created = await createSeries(alice);
    expect(created.title).toBe("Dish duty");
    expect(created.defaultCapacity).toBe(2);
    expect(created.archivedAt).toBeNull();

    const listed = await listShiftSeries(alice);
    expect(listed.map((s) => s.id)).toEqual([created.id]);
  });

  it("stores a series' tags, normalised, and starts with none", async () => {
    const { alice } = await setUpModule();
    expect((await createSeries(alice)).tags).toEqual([]);
    const tagged = await createSeries(alice, { title: "Cleanup", tags: [" Cooking ", "tidying", "COOKING", ""] });
    expect(tagged.tags).toEqual(["cooking", "tidying"]);
  });

  it("rejects a branch or source task from another community", async () => {
    const { alice } = await setUpModule();
    const { alice: strangerAlice, branch: strangerBranch } = await createFixtures();
    const strangerTask = await insertTask(strangerAlice.communityId, strangerBranch.id, strangerAlice.id);

    await expect(createSeries(alice, { branchId: strangerBranch.id })).rejects.toThrow(NotFoundError);
    await expect(createSeries(alice, { sourceTaskId: strangerTask.id })).rejects.toThrow(NotFoundError);
  });
});

describe("Coordinator authority (D10 — grant-based)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("the scope's shift_management holder coordinates a standing series — creatorship alone grants nothing", async () => {
    const { alice, bob } = await setUpModule();
    const series = await createSeries(alice);
    expect(await isShiftCoordinator(alice, series)).toBe(true);
    expect(await isShiftCoordinator(bob, series)).toBe(false);
  });

  it("a cycle-placed series is scoped to its cycle's manager, not the standing one", async () => {
    const { alice, bob, branch: testBranch } = await setUpModule();
    const cycleRow = await createCycle(alice, { source: "blank", name: "Roster cycle" });

    // Any member can place a series into a still-collecting cycle.
    const series = await createSeries(bob, { cycleId: cycleRow.id });
    expect(series.confirmedAt).not.toBeNull();

    // The standing manager isn't this cycle's manager...
    expect(await isShiftCoordinator(alice, series)).toBe(false);
    // ...and neither is the creator who placed it.
    expect(await isShiftCoordinator(bob, series)).toBe(false);

    // Grant bob the cycle's own shift_management scope — now he is.
    await grantShiftManagementTo(bob, testBranch.id, cycleRow.id);
    expect(await isShiftCoordinator(bob, series)).toBe(true);
  });

  it("archiving and unarchiving are manager-only", async () => {
    const { alice, bob } = await setUpModule();
    const series = await createSeries(alice);

    await expect(archiveShiftSeries(bob, series.id)).rejects.toThrow(ForbiddenError);
    const archived = await archiveShiftSeries(alice, series.id);
    expect(archived.archivedAt).not.toBeNull();

    await expect(unarchiveShiftSeries(bob, series.id)).rejects.toThrow(ForbiddenError);
    const unarchived = await unarchiveShiftSeries(alice, series.id);
    expect(unarchived.archivedAt).toBeNull();
  });
});

describe("Occurrence generation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is coordinator-only", async () => {
    const { alice, bob } = await setUpModule();
    const series = await createSeries(alice);
    await expect(
      generateShiftOccurrences(bob, series.id, {
        mode: "explicit",
        slots: [{ startsAt: iso(24), endsAt: iso(25) }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("explicit mode creates exactly the given slots", async () => {
    const { alice } = await setUpModule();
    const series = await createSeries(alice);
    const created = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [
        { startsAt: iso(24), endsAt: iso(25) },
        { startsAt: iso(48), endsAt: iso(49) },
      ],
    });
    expect(created).toHaveLength(2);

    const occurrences = await listOccurrencesForSeries(alice, series.id);
    expect(occurrences).toHaveLength(2);
  });

  it("weekly mode only generates the specified days of week within range", async () => {
    const { alice } = await setUpModule();
    const series = await createSeries(alice);
    // A fixed, known week: 2026-09-07 is a Monday.
    const created = await generateShiftOccurrences(alice, series.id, {
      mode: "weekly",
      startDate: "2026-09-07",
      endDate: "2026-09-20",
      daysOfWeek: [1, 3], // Monday, Wednesday
      startTime: "09:00",
      durationMinutes: 60,
    });
    // Two weeks, Mon+Wed each -> 4 occurrences.
    expect(created).toHaveLength(4);
    const days = created.map((o) => new Date(o.startsAt).getUTCDay()).sort();
    expect(days).toEqual([1, 1, 3, 3]);
    expect(new Date(created[0].startsAt).getUTCHours()).toBe(9);
    expect(new Date(created[0].endsAt).getTime() - new Date(created[0].startsAt).getTime()).toBe(
      60 * 60 * 1000,
    );
  });

  // A weekly shift is a wall-clock at the venue, so the same 09:00 is a
  // different instant either side of a clock change.
  it("weekly mode reads startTime on the venue's clock and holds it across a clock change", async () => {
    const { alice } = await setUpModule();
    await updateCommunity(alice, { timeZone: "Europe/Madrid" });
    const series = await createSeries(alice);
    // 2026-10-24 and 2026-10-31 are Saturdays either side of the clocks
    // going back on 2026-10-25 (CEST, UTC+2, to CET, UTC+1).
    const created = await generateShiftOccurrences(alice, series.id, {
      mode: "weekly",
      startDate: "2026-10-24",
      endDate: "2026-10-31",
      daysOfWeek: [6],
      startTime: "09:00",
      durationMinutes: 60,
    });
    expect(created.map((o) => new Date(o.startsAt).toISOString()).sort()).toEqual([
      "2026-10-24T07:00:00.000Z", // 09:00 CEST
      "2026-10-31T08:00:00.000Z", // 09:00 CET
    ]);
  });

  it("weekly mode uses the event's own zone over the community's", async () => {
    const { alice, branch: testBranch } = await setUpModule();
    await updateCommunity(alice, { timeZone: "Europe/Madrid" });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Abroad" });
    await db.update(cycleTable).set({ timeZone: "Asia/Tokyo" }).where(eq(cycleTable.id, cycleRow.id));
    const series = await createSeries(alice, { cycleId: cycleRow.id });
    await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);
    const [created] = await generateShiftOccurrences(alice, series.id, {
      mode: "weekly",
      startDate: "2026-10-24",
      endDate: "2026-10-24",
      daysOfWeek: [6],
      startTime: "09:00",
      durationMinutes: 60,
    });
    // 09:00 in Tokyo (UTC+9), not Madrid.
    expect(new Date(created.startsAt).toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });

  it("rejects a startDate after endDate", async () => {
    const { alice } = await setUpModule();
    const series = await createSeries(alice);
    await expect(
      generateShiftOccurrences(alice, series.id, {
        mode: "weekly",
        startDate: "2026-09-20",
        endDate: "2026-09-07",
        daysOfWeek: [1],
        startTime: "09:00",
        durationMinutes: 60,
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects a call that would create too many occurrences", async () => {
    const { alice } = await setUpModule();
    const series = await createSeries(alice);
    await expect(
      generateShiftOccurrences(alice, series.id, {
        mode: "weekly",
        startDate: "2026-01-01",
        endDate: "2027-06-01",
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "09:00",
        durationMinutes: 60,
      }),
    ).rejects.toThrow(AppError);
  });
});

describe("Sign up / withdraw", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpOccurrence(capacity = 2) {
    const fixtures = await setUpModule();
    const { alice } = fixtures;
    const series = await createSeries(alice, { defaultCapacity: capacity });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(24), endsAt: iso(25) }],
    });
    return { ...fixtures, series, occurrence };
  }

  it("signs up and appears in listMySignups", async () => {
    const { bob, occurrence } = await setUpOccurrence();
    const signup = await signUpForShift(bob, occurrence.id);
    expect(signup.memberId).toBe(bob.id);
    expect(signup.status).toBe("signed_up");

    const mine = await listMySignups(bob);
    expect(mine.map((s) => s.id)).toEqual([signup.id]);
  });

  it("rejects a duplicate signup", async () => {
    const { bob, occurrence } = await setUpOccurrence();
    await signUpForShift(bob, occurrence.id);
    await expect(signUpForShift(bob, occurrence.id)).rejects.toThrow(ConflictError);
  });

  it("rejects once the occurrence is at capacity", async () => {
    const { alice, bob, occurrence } = await setUpOccurrence(1);
    await signUpForShift(bob, occurrence.id);
    await expect(signUpForShift(alice, occurrence.id)).rejects.toThrow(ConflictError);
  });

  it("occurrence capacity overrides the series default", async () => {
    const { series, occurrence } = await setUpOccurrence(5);
    expect(effectiveCapacity(occurrence, series)).toBe(5);
    expect(effectiveCapacity({ ...occurrence, capacity: 1 }, series)).toBe(1);
  });

  it("rejects signing up for an archived series", async () => {
    const { alice, bob, series, occurrence } = await setUpOccurrence();
    await archiveShiftSeries(alice, series.id);
    await expect(signUpForShift(bob, occurrence.id)).rejects.toThrow(ConflictError);
  });

  it("rejects signing up once the occurrence has started", async () => {
    const { alice, bob, series } = await setUpOccurrence();
    const [pastOccurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(-2), endsAt: iso(-1) }],
    });
    await expect(signUpForShift(bob, pastOccurrence.id)).rejects.toThrow(ConflictError);
  });

  it("withdraws and frees the slot", async () => {
    const { alice, bob, occurrence } = await setUpOccurrence(1);
    await signUpForShift(bob, occurrence.id);
    await withdrawFromShift(bob, occurrence.id);

    expect(await listMySignups(bob)).toHaveLength(0);
    // Slot freed — alice can now sign up.
    await expect(signUpForShift(alice, occurrence.id)).resolves.toBeDefined();
  });

  it("rejects withdrawing a signup that doesn't exist", async () => {
    const { bob, occurrence } = await setUpOccurrence();
    await expect(withdrawFromShift(bob, occurrence.id)).rejects.toThrow(NotFoundError);
  });

  it("appears in the general upcoming-occurrences listing", async () => {
    const { bob, occurrence } = await setUpOccurrence();
    const upcoming = await listUpcomingShiftOccurrences(bob);
    expect(upcoming.map((u) => u.occurrence.id)).toContain(occurrence.id);
  });

  it("excludes occurrences from archived series", async () => {
    const { alice, bob, series, occurrence } = await setUpOccurrence();
    await archiveShiftSeries(alice, series.id);
    const upcoming = await listUpcomingShiftOccurrences(bob);
    expect(upcoming.map((u) => u.occurrence.id)).not.toContain(occurrence.id);
  });

  it("listSignupsForOccurrence is coordinator-only", async () => {
    const { alice, bob, occurrence } = await setUpOccurrence();
    await signUpForShift(bob, occurrence.id);

    await expect(listSignupsForOccurrence(bob, occurrence.id)).rejects.toThrow(ForbiddenError);
    const roster = await listSignupsForOccurrence(alice, occurrence.id);
    expect(roster.map((s) => s.memberId)).toEqual([bob.id]);
  });

  it("getShiftOccurrence is community-scoped", async () => {
    const { occurrence } = await setUpOccurrence();
    const { bob: strangerBob } = await createFixtures();
    await expect(getShiftOccurrence(strangerBob, occurrence.id)).rejects.toThrow(NotFoundError);
  });
});

// Signing up (and so occurrence.startsAt) always has to be in the
// future, so every completion/no-show test signs up normally first,
// then ages the occurrence into the past directly — the same technique
// Budget's own tests use for a deadline that's aged past ("a cycle can
// age past its own deadline in the ordinary course of things").
describe("Completion / no-show marking", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpEndedSignup() {
    const fixtures = await setUpModule();
    const { alice, bob } = fixtures;
    const series = await createSeries(alice);
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(24), endsAt: iso(25) }],
    });
    const signup = await signUpForShift(bob, occurrence.id);
    await db
      .update(shiftOccurrence)
      .set({ startsAt: new Date(iso(-2)), endsAt: new Date(iso(-1)) })
      .where(eq(shiftOccurrence.id, occurrence.id));
    return { ...fixtures, series, occurrence, signup };
  }

  it("rejects marking completed before the occurrence has ended", async () => {
    const { alice, bob } = await setUpModule();
    const series = await createSeries(alice);
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(24), endsAt: iso(25) }],
    });
    const signup = await signUpForShift(bob, occurrence.id);
    await expect(markShiftSignupCompleted(bob, signup.id)).rejects.toThrow(ConflictError);
  });

  it("only the signed-up member can mark their own completion", async () => {
    const { alice, signup } = await setUpEndedSignup();
    await expect(markShiftSignupCompleted(alice, signup.id)).rejects.toThrow(ForbiddenError);
  });

  it("marks completed once the occurrence has ended", async () => {
    const { bob, signup } = await setUpEndedSignup();
    const updated = await markShiftSignupCompleted(bob, signup.id);
    expect(updated.status).toBe("completed");
  });

  it("rejects marking an already-resolved signup again", async () => {
    const { bob, signup } = await setUpEndedSignup();
    await markShiftSignupCompleted(bob, signup.id);
    await expect(markShiftSignupCompleted(bob, signup.id)).rejects.toThrow(ConflictError);
  });

  it("no-show marking is coordinator-only", async () => {
    const { bob, signup } = await setUpEndedSignup();
    await expect(markShiftSignupNoShow(bob, signup.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects marking no-show before the occurrence has ended", async () => {
    const { alice, bob } = await setUpModule();
    const series = await createSeries(alice);
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(24), endsAt: iso(25) }],
    });
    const signup = await signUpForShift(bob, occurrence.id);
    await expect(markShiftSignupNoShow(alice, signup.id)).rejects.toThrow(ConflictError);
  });

  it("coordinator marks no-show once the occurrence has ended", async () => {
    const { alice, signup } = await setUpEndedSignup();
    const updated = await markShiftSignupNoShow(alice, signup.id);
    expect(updated.status).toBe("no_show");
  });
});

describe("Rotate a task into a shift", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is only available to the standing scope's shift manager", async () => {
    const { alice, bob, branch: testBranch } = await setUpModule();
    const sourceTask = await insertTask(alice.communityId, testBranch.id, alice.id);
    await expect(rotateTaskIntoShift(bob, sourceTask.id)).rejects.toThrow(ForbiddenError);
  });

  it("creates a series pre-filled from the task, leaving the task untouched", async () => {
    const { alice, branch: testBranch } = await setUpModule();
    const sourceTask = await insertTask(alice.communityId, testBranch.id, alice.id);
    await claimTask(alice, sourceTask.id);

    const series = await rotateTaskIntoShift(alice, sourceTask.id);
    expect(series.title).toBe(sourceTask.title);
    expect(series.branchId).toBe(sourceTask.branchId);
    expect(series.sourceTaskId).toBe(sourceTask.id);
    expect(series.createdBy).toBe(alice.id);

    const stillThere = await db.select().from(task).where(eq(task.id, sourceTask.id));
    expect(stillThere[0].status).toBe("claimed");
  });

  it("defaults capacity to 1 when the task has none", async () => {
    const { alice, branch: testBranch } = await setUpModule();
    const [openTask] = await db
      .insert(task)
      .values({
        communityId: alice.communityId,
        branchId: testBranch.id,
        title: "Uncapped community task",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 1 },
        createdBy: alice.id,
        openness: "community_endorsed",
        capacity: null,
      })
      .returning();
    await claimTask(alice, openTask.id);

    const series = await rotateTaskIntoShift(alice, openTask.id);
    expect(series.defaultCapacity).toBe(1);
  });
});

describe("Editing a series", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is manager-only and changes title, description, branch and default", async () => {
    const { alice, bob, branch: testBranch } = await setUpModule();
    const series = await createSeries(alice);

    await expect(updateShiftSeries(bob, series.id, { title: "Mine now" })).rejects.toThrow(ForbiddenError);

    const updated = await updateShiftSeries(alice, series.id, {
      title: "Washing up",
      description: "Bring gloves",
      branchId: testBranch.id,
      defaultCapacity: 4,
    });
    expect(updated).toMatchObject({ title: "Washing up", description: "Bring gloves", branchId: testBranch.id, defaultCapacity: 4 });
  });

  it("changes tags (normalised), clears them, and leaves them alone when not given", async () => {
    const { alice } = await setUpModule();
    const series = await createSeries(alice, { tags: ["cooking"] });

    expect((await updateShiftSeries(alice, series.id, { title: "Renamed" })).tags).toEqual(["cooking"]);
    expect((await updateShiftSeries(alice, series.id, { tags: ["Tidying", "tidying", "Groceries"] })).tags).toEqual([
      "tidying",
      "groceries",
    ]);
    expect((await updateShiftSeries(alice, series.id, { tags: [] })).tags).toEqual([]);
  });

  it("reaches the upcoming list with the series' tags", async () => {
    const { alice } = await setUpModule();
    const series = await createSeries(alice, { tags: ["cooking"] });
    await generateShiftOccurrences(alice, series.id, {
      mode: "weekly",
      startDate: "2099-03-02",
      endDate: "2099-03-09",
      daysOfWeek: [2],
      startTime: "18:00",
      durationMinutes: 120,
    });
    const upcoming = await listUpcomingShiftOccurrences(alice);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.every((u) => u.series.tags.join() === "cooking")).toBe(true);
  });

  it("rejects a branch from another community", async () => {
    const { alice } = await setUpModule();
    const other = await createFixtures();
    const series = await createSeries(alice);
    await expect(updateShiftSeries(alice, series.id, { branchId: other.branch.id })).rejects.toThrow(NotFoundError);
  });

  it("a new default reaches shifts that follow it, never a shift with its own number", async () => {
    const { alice, series, occurrences } = await seriesWithTwoShifts();
    await updateShiftOccurrence(alice, occurrences[1].id, slotOf(occurrences[1], 5));

    const updated = await updateShiftSeries(alice, series.id, { defaultCapacity: 3 });
    const [followsDefault, overridden] = await Promise.all(occurrences.map((o) => getShiftOccurrence(alice, o.id)));
    expect(effectiveCapacity(followsDefault.occurrence, updated)).toBe(3);
    expect(effectiveCapacity(overridden.occurrence, updated)).toBe(5);
  });

  it("refuses a default below the sign-ups on a shift that follows it", async () => {
    const { alice, bob, series, occurrences } = await seriesWithTwoShifts();
    await signUpForShift(alice, occurrences[0].id);
    await signUpForShift(bob, occurrences[0].id);

    await expect(updateShiftSeries(alice, series.id, { defaultCapacity: 1 })).rejects.toThrow(ConflictError);
  });

  it("a shift with its own number doesn't block lowering the default", async () => {
    const { alice, bob, series, occurrences } = await seriesWithTwoShifts();
    await updateShiftOccurrence(alice, occurrences[0].id, slotOf(occurrences[0], 2));
    await signUpForShift(alice, occurrences[0].id);
    await signUpForShift(bob, occurrences[0].id);

    const updated = await updateShiftSeries(alice, series.id, { defaultCapacity: 1 });
    expect(updated.defaultCapacity).toBe(1);
  });
});

describe("Editing a single shift", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is manager-only", async () => {
    const { bob, occurrences } = await seriesWithTwoShifts();
    await expect(updateShiftOccurrence(bob, occurrences[0].id, slotOf(occurrences[0], 1))).rejects.toThrow(ForbiddenError);
  });

  it("moves the times and sets, then clears, its own capacity", async () => {
    const { alice, series, occurrences } = await seriesWithTwoShifts();
    const startsAt = iso(48);
    const moved = await updateShiftOccurrence(alice, occurrences[0].id, { startsAt, endsAt: iso(50), capacity: 7 });
    expect(moved.startsAt.toISOString()).toBe(startsAt);
    expect(effectiveCapacity(moved, series)).toBe(7);

    const reset = await updateShiftOccurrence(alice, occurrences[0].id, slotOf(moved, null));
    expect(reset.capacity).toBeNull();
    expect(effectiveCapacity(reset, series)).toBe(series.defaultCapacity);
  });

  it("allows moving a shift people signed up for", async () => {
    const { alice, bob, occurrences } = await seriesWithTwoShifts();
    await signUpForShift(bob, occurrences[0].id);
    const startsAt = iso(30);
    const moved = await updateShiftOccurrence(alice, occurrences[0].id, { startsAt, endsAt: iso(31), capacity: null });
    expect(moved.startsAt.toISOString()).toBe(startsAt);
  });

  it("refuses an end before the start, and fewer than one person", async () => {
    const { alice, occurrences } = await seriesWithTwoShifts();
    await expect(
      updateShiftOccurrence(alice, occurrences[0].id, { startsAt: iso(30), endsAt: iso(29), capacity: null }),
    ).rejects.toThrow("The end must be after the start");
    await expect(updateShiftOccurrence(alice, occurrences[0].id, slotOf(occurrences[0], 0))).rejects.toThrow(ZodError);
  });

  it("changes only what it's given", async () => {
    const { alice, occurrences } = await seriesWithTwoShifts();
    const updated = await updateShiftOccurrence(alice, occurrences[0].id, { capacity: 4 });
    expect(updated.capacity).toBe(4);
    expect(updated.startsAt).toEqual(occurrences[0].startsAt);
    expect(updated.endsAt).toEqual(occurrences[0].endsAt);
  });

  it("refuses editing a shift that has ended", async () => {
    const { alice, series } = await seriesWithTwoShifts();
    const [past] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(-3), endsAt: iso(-2) }],
    });
    await expect(updateShiftOccurrence(alice, past.id, { capacity: 5 })).rejects.toThrow(ConflictError);
  });

  it("refuses moving a shift into the past, but allows other edits on one that has started", async () => {
    const { alice, series, occurrences } = await seriesWithTwoShifts();
    await expect(
      updateShiftOccurrence(alice, occurrences[0].id, { startsAt: iso(-2), endsAt: iso(1) }),
    ).rejects.toThrow("A shift can't be moved into the past");

    const [running] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(-1), endsAt: iso(1) }],
    });
    const updated = await updateShiftOccurrence(alice, running.id, { endsAt: iso(2) });
    expect(updated.startsAt).toEqual(running.startsAt);
  });

  it("refuses ending a running shift in the past, which would lock it", async () => {
    const { alice, series } = await seriesWithTwoShifts();
    const [running] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(-2), endsAt: iso(1) }],
    });
    await expect(updateShiftOccurrence(alice, running.id, { endsAt: iso(-1) })).rejects.toThrow(
      "A shift can't be set to end in the past",
    );
  });

  it("refuses a capacity below the people already signed up", async () => {
    const { alice, bob, occurrences } = await seriesWithTwoShifts();
    await signUpForShift(alice, occurrences[0].id);
    await signUpForShift(bob, occurrences[0].id);
    await expect(updateShiftOccurrence(alice, occurrences[0].id, slotOf(occurrences[0], 1))).rejects.toThrow(ConflictError);
  });
});

describe("Deleting before sign-ups open", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function collectingRoster() {
    const fixtures = await setUpModule();
    const { alice, branch: testBranch } = fixtures;
    const cycleRow = await createCycle(alice, { source: "blank", name: "Harvest" });
    await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);
    const series = await createSeries(alice, { cycleId: cycleRow.id });
    const occurrences = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [
        { startsAt: iso(24), endsAt: iso(25) },
        { startsAt: iso(48), endsAt: iso(49) },
      ],
    });
    return { ...fixtures, cycleRow, series, occurrences };
  }

  it("deletes a shift and a series while the roster is collecting", async () => {
    const { alice, bob, series, occurrences } = await collectingRoster();
    await expect(deleteShiftOccurrence(bob, occurrences[0].id)).rejects.toThrow(ForbiddenError);

    await deleteShiftOccurrence(alice, occurrences[0].id);
    await expect(getShiftOccurrence(alice, occurrences[0].id)).rejects.toThrow(NotFoundError);

    await expect(deleteShiftSeries(bob, series.id)).rejects.toThrow(ForbiddenError);
    await deleteShiftSeries(alice, series.id);
    expect(await db.select().from(shiftSeries).where(eq(shiftSeries.id, series.id))).toEqual([]);
    expect(await db.select().from(shiftOccurrence).where(eq(shiftOccurrence.seriesId, series.id))).toEqual([]);
  });

  it("refuses once the roster's sign-ups are open — archive is the way out", async () => {
    const { alice, cycleRow, series, occurrences } = await collectingRoster();
    await openCycleShiftSignups(alice, cycleRow.id);
    await expect(deleteShiftOccurrence(alice, occurrences[0].id)).rejects.toThrow(ConflictError);
    await expect(deleteShiftSeries(alice, series.id)).rejects.toThrow(ConflictError);
  });

  it("refuses for a standing series, which is always open", async () => {
    const { alice, series, occurrences } = await seriesWithTwoShifts();
    await expect(deleteShiftOccurrence(alice, occurrences[0].id)).rejects.toThrow(ConflictError);
    await expect(deleteShiftSeries(alice, series.id)).rejects.toThrow(ConflictError);
  });

  it("never deletes over a sign-up carried in from a standing series", async () => {
    const { alice, bob, cycleRow, series, occurrences } = await collectingRoster();
    // Sign-ups only happen while open; a standing series moved into a
    // collecting event is how one gets here, so insert it directly.
    await db.insert(shiftSignupTable).values({ occurrenceId: occurrences[0].id, memberId: bob.id });
    expect(cycleRow.shiftSignupsOpenedAt).toBeNull();

    await expect(deleteShiftOccurrence(alice, occurrences[0].id)).rejects.toThrow(ConflictError);
    await expect(deleteShiftSeries(alice, series.id)).rejects.toThrow(ConflictError);
  });

  it("deleting a series unlinks a Kitchen meal instead of failing", async () => {
    const { alice, series } = await collectingRoster();
    const [plan] = await db
      .insert(menuPlan)
      .values({ communityId: alice.communityId, title: "Harvest menu", createdBy: alice.id })
      .returning();
    const [linked] = await db
      .insert(meal)
      .values({ menuPlanId: plan.id, label: "Friday dinner", date: "2026-12-04", shiftSeriesId: series.id })
      .returning();

    await deleteShiftSeries(alice, series.id);
    const [after] = await db.select().from(meal).where(eq(meal.id, linked.id));
    expect(after.shiftSeriesId).toBeNull();
  });
});

async function seriesWithTwoShifts() {
  const fixtures = await setUpModule();
  const series = await createSeries(fixtures.alice, { defaultCapacity: 2 });
  const occurrences = await generateShiftOccurrences(fixtures.alice, series.id, {
    mode: "explicit",
    slots: [
      { startsAt: iso(24), endsAt: iso(25) },
      { startsAt: iso(48), endsAt: iso(49) },
    ],
  });
  return { ...fixtures, series, occurrences };
}

function slotOf(o: { startsAt: Date; endsAt: Date }, capacity: number | null) {
  return { startsAt: o.startsAt.toISOString(), endsAt: o.endsAt.toISOString(), capacity };
}

describe("Reading a shift's times back from the form", () => {
  // 2026-10-25 is when Madrid's clocks go back: 02:00-03:00 happens twice.
  const firstTwoThirty = new Date("2026-10-25T00:30:00.000Z");
  const secondTwoThirty = new Date("2026-10-25T01:30:00.000Z");

  it("keeps the stored instant when the field wasn't changed, even in the repeated hour", () => {
    expect(instantFromShiftInput("2026-10-25T02:30", firstTwoThirty, "Europe/Madrid")).toEqual(firstTwoThirty);
    expect(instantFromShiftInput("2026-10-25T02:30", secondTwoThirty, "Europe/Madrid")).toEqual(secondTwoThirty);
  });

  it("reads a changed value on the venue's clock", () => {
    expect(instantFromShiftInput("2026-11-26T18:00", firstTwoThirty, "Europe/Madrid").toISOString()).toBe(
      "2026-11-26T17:00:00.000Z",
    );
  });
});

describe("Edits stay inside the rules around them", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("an ended shift that follows the default doesn't block lowering it", async () => {
    const { alice, bob, series } = await seriesWithTwoShifts();
    const [past] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(-3), endsAt: iso(-2) }],
    });
    await db.insert(shiftSignupTable).values([
      { occurrenceId: past.id, memberId: alice.id, status: "completed" },
      { occurrenceId: past.id, memberId: bob.id, status: "completed" },
    ]);

    const updated = await updateShiftSeries(alice, series.id, { defaultCapacity: 1 });
    expect(updated.defaultCapacity).toBe(1);
  });

  it("another community's series and shifts are not found", async () => {
    const { series, occurrences } = await seriesWithTwoShifts();
    const other = await createFixtures();
    await updateCommunity(other.alice, { modulesEnabled: ["shifts"] });
    await grantShiftManagementTo(other.alice, other.branch.id);

    await expect(updateShiftSeries(other.alice, series.id, { title: "Mine" })).rejects.toThrow(NotFoundError);
    await expect(deleteShiftSeries(other.alice, series.id)).rejects.toThrow(NotFoundError);
    await expect(updateShiftOccurrence(other.alice, occurrences[0].id, { capacity: 3 })).rejects.toThrow(NotFoundError);
    await expect(deleteShiftOccurrence(other.alice, occurrences[0].id)).rejects.toThrow(NotFoundError);
  });

  it("a closed event's roster is frozen", async () => {
    const { alice, branch: testBranch } = await setUpModule();
    const cycleRow = await createCycle(alice, { source: "blank", name: "Harvest" });
    await grantShiftManagementTo(alice, testBranch.id, cycleRow.id);
    const series = await createSeries(alice, { cycleId: cycleRow.id });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: iso(24), endsAt: iso(25) }],
    });
    await db.update(cycleTable).set({ closedAt: new Date() }).where(eq(cycleTable.id, cycleRow.id));

    await expect(updateShiftSeries(alice, series.id, { title: "Late change" })).rejects.toThrow(ForbiddenError);
    await expect(updateShiftOccurrence(alice, occurrence.id, { capacity: 3 })).rejects.toThrow(ForbiddenError);
    await expect(deleteShiftOccurrence(alice, occurrence.id)).rejects.toThrow(ForbiddenError);
    await expect(deleteShiftSeries(alice, series.id)).rejects.toThrow(ForbiddenError);
  });

  it("a blank title is refused, and a blank description is cleared", async () => {
    expect(() => updateShiftSeriesInput.parse({ title: "   " })).toThrow(ZodError);

    const { alice, series } = await seriesWithTwoShifts();
    const updated = await updateShiftSeries(alice, series.id, updateShiftSeriesInput.parse({ description: "   " }));
    expect(updated.description).toBeNull();
  });

  it("recognises the foreign-key error a racing sign-up causes on delete", async () => {
    const { bob, occurrences } = await seriesWithTwoShifts();
    await signUpForShift(bob, occurrences[0].id);
    // What deleteShiftOccurrence runs if a sign-up lands right after its check.
    const err = await db
      .delete(shiftOccurrence)
      .where(eq(shiftOccurrence.id, occurrences[0].id))
      .catch((e: unknown) => e);
    expect(isForeignKeyViolation(err)).toBe(true);
    expect(isForeignKeyViolation(new Error("something else"))).toBe(false);
  });
});
