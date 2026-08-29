import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shiftOccurrence, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  archiveShiftSeries,
  createShiftSeries,
  effectiveCapacity,
  generateShiftOccurrences,
  getShiftOccurrence,
  isShiftCoordinator,
  listMySignups,
  listOccurrencesForSeries,
  listShiftSeries,
  listSignupsForOccurrence,
  listUpcomingShiftOccurrences,
  markShiftSignupCompleted,
  markShiftSignupNoShow,
  rotateTaskIntoShift,
  signUpForShift,
  unarchiveShiftSeries,
  withdrawFromShift,
} from "@/lib/shifts";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

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
  const { alice } = fixtures;
  await updateCommunity(alice, { modulesEnabled: ["shifts"] });
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

  it("rejects a branch or source task from another community", async () => {
    const { alice } = await setUpModule();
    const { alice: strangerAlice, branch: strangerBranch } = await createFixtures();
    const strangerTask = await insertTask(strangerAlice.communityId, strangerBranch.id, strangerAlice.id);

    await expect(createSeries(alice, { branchId: strangerBranch.id })).rejects.toThrow(NotFoundError);
    await expect(createSeries(alice, { sourceTaskId: strangerTask.id })).rejects.toThrow(NotFoundError);
  });
});

describe("Coordinator authority", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("the creator is always the coordinator", async () => {
    const { alice, bob } = await setUpModule();
    const series = await createSeries(alice);
    expect(await isShiftCoordinator(alice, series)).toBe(true);
    expect(await isShiftCoordinator(bob, series)).toBe(false);
  });

  it("whoever holds sourceTaskId is also a coordinator", async () => {
    const { alice, bob, branch: testBranch } = await setUpModule();
    const sourceTask = await insertTask(alice.communityId, testBranch.id, alice.id);
    const series = await createSeries(bob, { sourceTaskId: sourceTask.id });

    expect(await isShiftCoordinator(alice, series)).toBe(false);
    await claimTask(alice, sourceTask.id);
    expect(await isShiftCoordinator(alice, series)).toBe(true);
  });

  it("archiving and unarchiving are coordinator-only", async () => {
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

  it("is only available to a current holder", async () => {
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
