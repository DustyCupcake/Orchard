import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cycle, member, participation } from "@/db/schema";
import { eq } from "drizzle-orm";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import { declareParticipation, declareParticipationInput } from "@/lib/participation";
import { createProfileQuestion, answerProfileQuestion } from "@/lib/profile-questions";
import { AppError, ForbiddenError } from "@/lib/errors";
import {
  ALLERGY_OPTIONS,
  DEFAULT_MEAL_TIMES,
  attendanceForMeal,
  createDish,
  createMeal,
  createDishIngredient,
  createMenuPlan,
  effectiveHeadCount,
  getMealConstraintPanel,
  mealClockTime,
  normaliseTime,
  presenceAtMeal,
  publishMenuPlan,
  purchaseList,
  resolveMealTimes,
  scaledIngredients,
  updateMeal,
  updateMenuPlanMealTimes,
  type AttendanceContext,
  type PresenceInput,
} from "@/lib/kitchen";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";

// Who is eating which meal, from arrival and departure — everything optional
// on every side. The rule under test: information narrows, and its absence
// never excludes anyone. A person is counted out only by something they said,
// and a meal on their arrival or departure day that can't be placed is
// counted and flagged as uncertain.

const TIMES = resolveMealTimes();
const EVENT = { startDate: "2026-10-02", endDate: "2026-10-05" };

function person(overrides: Partial<PresenceInput> = {}): PresenceInput {
  return {
    status: "coming",
    arrivalDate: null,
    departureDate: null,
    arrivalTime: null,
    departureTime: null,
    firstMeal: null,
    lastMeal: null,
    ...overrides,
  };
}
const meal = (date: string, slot: "breakfast" | "lunch" | "dinner" | null = null, time: string | null = null) => ({
  date,
  slot,
  time,
});

describe("times", () => {
  it("treats Postgres's HH:MM:SS and a form's HH:MM as one time, and anything else as none", () => {
    expect(normaliseTime("16:00:00")).toBe("16:00");
    expect(normaliseTime("16:00")).toBe("16:00");
    expect(normaliseTime("4pm")).toBeNull();
    expect(normaliseTime("25:00")).toBeNull();
    expect(normaliseTime("")).toBeNull();
    expect(normaliseTime(null)).toBeNull();
  });

  it("lays a menu's own times over the defaults and ignores a malformed one", () => {
    expect(resolveMealTimes()).toEqual(DEFAULT_MEAL_TIMES);
    expect(resolveMealTimes({ dinner: "20:30", lunch: "nonsense" })).toEqual({
      ...DEFAULT_MEAL_TIMES,
      dinner: "20:30",
    });
  });

  it("takes a meal's own time over its slot's, and has none without either", () => {
    expect(mealClockTime({ slot: "lunch", time: null }, TIMES)).toBe("12:30");
    expect(mealClockTime({ slot: "lunch", time: "17:00:00" }, TIMES)).toBe("17:00");
    expect(mealClockTime({ slot: null, time: null }, TIMES)).toBeNull();
    expect(mealClockTime({ slot: null, time: "10:15" }, TIMES)).toBe("10:15");
  });
});

describe("is this person there for this meal?", () => {
  it("rules out a day outside their dates and keeps every day inside", () => {
    const p = person({ arrivalDate: "2026-10-03", departureDate: "2026-10-04" });
    expect(presenceAtMeal(meal("2026-10-02"), p, EVENT, TIMES).in).toBe(false);
    expect(presenceAtMeal(meal("2026-10-05"), p, EVENT, TIMES).in).toBe(false);
    // Strictly between the dates: no edge, no doubt.
    const outside = presenceAtMeal(meal("2026-10-03"), person({ arrivalDate: "2026-10-01", departureDate: "2026-10-09" }), EVENT, TIMES);
    expect(outside).toMatchObject({ in: true, uncertain: false, arriving: false, leaving: false });
  });

  it("falls back to the event's own dates when someone gave none, and to nothing when it has none", () => {
    expect(presenceAtMeal(meal("2026-10-03"), person(), EVENT, TIMES)).toMatchObject({ in: true, noDates: true, uncertain: false });
    expect(presenceAtMeal(meal("2026-10-09"), person(), EVENT, TIMES).in).toBe(false);
    expect(presenceAtMeal(meal("2026-10-09"), person(), { startDate: null, endDate: null }, TIMES).in).toBe(true);
  });

  it("counts an arrival day with no information, and flags it", () => {
    const r = presenceAtMeal(meal("2026-10-03", "dinner"), person({ arrivalDate: "2026-10-03" }), EVENT, TIMES);
    expect(r).toMatchObject({ in: true, uncertain: true, arriving: true });
  });

  it("uses an arrival time against the meal's time", () => {
    const p = person({ arrivalDate: "2026-10-03", arrivalTime: "16:00" });
    expect(presenceAtMeal(meal("2026-10-03", "lunch"), p, EVENT, TIMES).in).toBe(false);
    expect(presenceAtMeal(meal("2026-10-03", "dinner"), p, EVENT, TIMES)).toMatchObject({ in: true, uncertain: false });
    // Arriving exactly at the meal's time counts.
    expect(presenceAtMeal(meal("2026-10-03", "dinner"), person({ arrivalDate: "2026-10-03", arrivalTime: "19:00" }), EVENT, TIMES).in).toBe(true);
  });

  it("uses a first meal in meals, and prefers it to a time", () => {
    const p = person({ arrivalDate: "2026-10-03", firstMeal: "dinner" });
    expect(presenceAtMeal(meal("2026-10-03", "breakfast"), p, EVENT, TIMES).in).toBe(false);
    expect(presenceAtMeal(meal("2026-10-03", "lunch"), p, EVENT, TIMES).in).toBe(false);
    expect(presenceAtMeal(meal("2026-10-03", "dinner"), p, EVENT, TIMES)).toMatchObject({ in: true, uncertain: false });
    // Said they land at 09:00 but their first meal is dinner: dinner it is.
    const both = person({ arrivalDate: "2026-10-03", arrivalTime: "09:00", firstMeal: "dinner" });
    expect(presenceAtMeal(meal("2026-10-03", "lunch"), both, EVENT, TIMES).in).toBe(false);
  });

  it("falls back to the time when the meal has no slot to compare with a first meal", () => {
    const p = person({ arrivalDate: "2026-10-03", firstMeal: "dinner", arrivalTime: "16:00" });
    // No slot but its own time 17:00: the first meal can't be compared, the time can.
    expect(presenceAtMeal(meal("2026-10-03", null, "17:00"), p, EVENT, TIMES)).toMatchObject({ in: true, uncertain: false });
    expect(presenceAtMeal(meal("2026-10-03", null, "12:00"), p, EVENT, TIMES).in).toBe(false);
  });

  it("flags a meal that has neither a slot nor a time, however much the person said", () => {
    const p = person({ arrivalDate: "2026-10-03", arrivalTime: "16:00" });
    expect(presenceAtMeal(meal("2026-10-03"), p, EVENT, TIMES)).toMatchObject({ in: true, uncertain: true });
  });

  it("takes a meal's own time over its slot's default", () => {
    const p = person({ arrivalDate: "2026-10-03", arrivalTime: "16:00" });
    // A late 'lunch' at 17:00 is after they arrive, though lunch's default is not.
    expect(presenceAtMeal(meal("2026-10-03", "lunch", "17:00"), p, EVENT, TIMES).in).toBe(true);
  });

  it("uses the menu's own meal times", () => {
    const late = resolveMealTimes({ dinner: "15:00" });
    const p = person({ arrivalDate: "2026-10-03", arrivalTime: "16:00" });
    expect(presenceAtMeal(meal("2026-10-03", "dinner"), p, EVENT, TIMES).in).toBe(true);
    expect(presenceAtMeal(meal("2026-10-03", "dinner"), p, EVENT, late).in).toBe(false);
  });

  it("mirrors all of that on the day someone leaves", () => {
    const byTime = person({ departureDate: "2026-10-04", departureTime: "14:00" });
    expect(presenceAtMeal(meal("2026-10-04", "lunch"), byTime, EVENT, TIMES)).toMatchObject({ in: true, uncertain: false, leaving: true });
    expect(presenceAtMeal(meal("2026-10-04", "dinner"), byTime, EVENT, TIMES).in).toBe(false);

    const byMeal = person({ departureDate: "2026-10-04", lastMeal: "breakfast" });
    expect(presenceAtMeal(meal("2026-10-04", "breakfast"), byMeal, EVENT, TIMES).in).toBe(true);
    expect(presenceAtMeal(meal("2026-10-04", "lunch"), byMeal, EVENT, TIMES).in).toBe(false);

    expect(presenceAtMeal(meal("2026-10-04", "dinner"), person({ departureDate: "2026-10-04" }), EVENT, TIMES)).toMatchObject({
      in: true,
      uncertain: true,
      leaving: true,
    });
  });

  it("applies both edges to someone who arrives and leaves the same day", () => {
    const p = person({ arrivalDate: "2026-10-03", arrivalTime: "10:00", departureDate: "2026-10-03", departureTime: "15:00" });
    expect(presenceAtMeal(meal("2026-10-03", "breakfast"), p, EVENT, TIMES).in).toBe(false);
    expect(presenceAtMeal(meal("2026-10-03", "lunch"), p, EVENT, TIMES)).toMatchObject({ in: true, uncertain: false });
    expect(presenceAtMeal(meal("2026-10-03", "dinner"), p, EVENT, TIMES).in).toBe(false);
    // One edge certain and the other not is still uncertain.
    const half = person({ arrivalDate: "2026-10-03", arrivalTime: "10:00", departureDate: "2026-10-03" });
    expect(presenceAtMeal(meal("2026-10-03", "lunch"), half, EVENT, TIMES).uncertain).toBe(true);
  });

  it("ignores a first meal when there's no arrival date to attach it to", () => {
    // Nothing says which day this is their first, so it can't rule anyone out.
    expect(presenceAtMeal(meal("2026-10-02", "breakfast"), person({ firstMeal: "dinner" }), EVENT, TIMES).in).toBe(true);
  });
});

describe("attendance across a meal", () => {
  const ctx = (rows: AttendanceContext["rows"], memberIds: string[]): AttendanceContext => ({
    event: EVENT,
    times: TIMES,
    rows,
    memberIds,
  });
  const row = (memberId: string, p: Partial<PresenceInput>) => ({ memberId, ...person(p) });

  it("counts the people who are coming and there, separately flags what it is unsure of, and never counts maybes", () => {
    const rows = [
      row("a", {}), // coming, no dates: whole event
      row("b", { arrivalDate: "2026-10-03" }), // arrives that day, nothing else said
      row("c", { arrivalDate: "2026-10-03", arrivalTime: "09:00" }), // arrives before: certain
      row("d", { arrivalDate: "2026-10-03", arrivalTime: "21:00" }), // after dinner: out
      row("e", { status: "maybe" }),
      row("f", { status: "not_coming" }),
    ];
    const r = attendanceForMeal(meal("2026-10-03", "dinner"), ctx(rows, ["a", "b", "c", "d", "e", "f", "g"]));
    expect(r).toMatchObject({ available: true, present: 3, uncertain: 1, arriving: 2, leaving: 0, noDates: 1, maybe: 1 });
    expect(r.presentMemberIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("lets everyone who might be there into the dietary set, and only rules out the ones who said they won't be", () => {
    const rows = [
      row("a", {}),
      row("e", { status: "maybe" }),
      row("f", { status: "not_coming" }),
      row("h", { arrivalDate: "2026-10-04" }), // not there yet: out
      row("i", { status: "unknown" }),
    ];
    const r = attendanceForMeal(meal("2026-10-03", "dinner"), ctx(rows, ["a", "e", "f", "g", "h", "i"]));
    // g has no row at all (hasn't said); i said nothing either. Both stay in.
    expect(r.possibleMemberIds.sort()).toEqual(["a", "e", "g", "i"]);
  });

  it("works out the effective headcount: arrivals plus guests, or the typed number", () => {
    const attendance = attendanceForMeal(meal("2026-10-03", "dinner"), ctx([row("a", {}), row("b", {})], ["a", "b"]));
    const m = { date: "2026-10-03", slot: null, time: null, headCount: 20, guests: 3 } as const;
    expect(effectiveHeadCount({ ...m, headCountSource: "participation" }, attendance)).toBe(5);
    expect(effectiveHeadCount({ ...m, headCountSource: "manual" }, attendance)).toBe(20);
    // Nothing to read (a standing menu): falls back to what was typed.
    expect(effectiveHeadCount({ ...m, headCountSource: "participation" }, { ...attendance, available: false })).toBe(20);
    // A worked-out zero is no number, not a meal for nobody.
    expect(effectiveHeadCount({ ...m, guests: 0, headCountSource: "participation" }, { ...attendance, present: 0 })).toBeNull();
  });
});

describe("headcount from arrivals, end to end", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function event() {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    const [ev] = await db
      .insert(cycle)
      .values({ communityId: alice.communityId, name: "Autumn", startDate: "2026-10-02", endDate: "2026-10-05" })
      .returning();
    const grantTask = await insertTask(alice.communityId, branch.id, alice.id, {
      cycleId: ev.id,
      title: "Kitchen",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
    });
    await grantPermission(alice.communityId, "kitchen", grantTask.id);
    await claimTask(alice, grantTask.id);
    const extra = async (name: string) =>
      (await db.insert(member).values({ communityId: alice.communityId, name }).returning())[0];
    const cara = await extra("Cara");
    const dev = await extra("Dev");
    const eli = await extra("Eli");
    const plan = await createMenuPlan(alice, { title: "Autumn", cycleId: ev.id });
    return { alice, bob, cara, dev, eli, ev, plan };
  }

  const declare = (memberId: string, cycleId: string, values: Partial<typeof participation.$inferInsert>) =>
    db.insert(participation).values({ cycleId, memberId, status: "coming", ...values });

  it("scales a dish and builds the shopping list from the people who are there", async () => {
    const { alice, bob, cara, dev, eli, ev, plan } = await event();
    await declare(alice.id, ev.id, {});
    await declare(bob.id, ev.id, { arrivalDate: "2026-10-03", arrivalTime: "21:00" }); // after dinner: out
    await declare(cara.id, ev.id, { arrivalDate: "2026-10-03" }); // that day, unknown: counted
    await declare(dev.id, ev.id, { status: "maybe" });
    await declare(eli.id, ev.id, { status: "not_coming" });

    const dinner = await createMeal(alice, {
      menuPlanId: plan.id,
      label: "Friday dinner",
      date: "2026-10-03",
      slot: "dinner",
      headCountSource: "participation",
      guests: 2,
    });
    const stew = await createDish(alice, { mealId: dinner.id, name: "Stew", serves: 2 });
    await createDishIngredient(alice, { dishId: stew.id, name: "Beans", amount: 100, unit: "g" });

    // alice + cara + 2 guests = 4, cooked from a recipe for 2: ×2.
    expect((await scaledIngredients(alice, dinner.id))[0]).toMatchObject({ scaledAmount: 200, factor: 2 });
    expect(await purchaseList(alice, dinner.id)).toEqual([{ name: "Beans", unit: "g", amount: 200, unmeasured: false }]);
  });

  it("moves as plans change — nothing about the number is stored", async () => {
    const { alice, bob, ev, plan } = await event();
    await declare(alice.id, ev.id, {});
    const m = await createMeal(alice, { menuPlanId: plan.id, label: "Lunch", date: "2026-10-03", slot: "lunch", headCountSource: "participation" });
    const stew = await createDish(alice, { mealId: m.id, name: "Stew", serves: 1 });
    await createDishIngredient(alice, { dishId: stew.id, name: "Beans", amount: 10, unit: "g" });
    expect((await scaledIngredients(alice, m.id))[0].scaledAmount).toBe(10);

    await declare(bob.id, ev.id, {});
    expect((await scaledIngredients(alice, m.id))[0].scaledAmount).toBe(20);
    await db.update(participation).set({ status: "not_coming" }).where(eq(participation.memberId, bob.id));
    expect((await scaledIngredients(alice, m.id))[0].scaledAmount).toBe(10);
  });

  it("refuses 'from arrivals' on a standing menu, which has no event", async () => {
    const f = await createFixtures();
    await updateCommunity(f.alice, { modulesEnabled: ["kitchen"] });
    const t = await insertTask(f.alice.communityId, f.branch.id, f.alice.id, { title: "Kitchen", effort: "owns_a_thing", effortMagnitude: { hours_per_week: 2 } });
    await grantPermission(f.alice.communityId, "kitchen", t.id);
    await claimTask(f.alice, t.id);
    const standing = await createMenuPlan(f.alice, { title: "Standing" });
    await expect(
      createMeal(f.alice, { menuPlanId: standing.id, label: "Dinner", date: "2026-10-03", headCountSource: "participation" }),
    ).rejects.toThrow(AppError);
    const manual = await createMeal(f.alice, { menuPlanId: standing.id, label: "Dinner", date: "2026-10-03", headCount: 8 });
    await expect(updateMeal(f.alice, manual.id, { headCountSource: "participation" })).rejects.toThrow(/standing menu/);
  });

  it("validates and normalises a meal's time and slot", async () => {
    const { alice, plan } = await event();
    const m = await createMeal(alice, { menuPlanId: plan.id, label: "Late", date: "2026-10-03", slot: "dinner", time: "21:15:00" });
    expect(m).toMatchObject({ slot: "dinner", time: "21:15:00", headCountSource: "manual", guests: 0 });
    await expect(createMeal(alice, { menuPlanId: plan.id, label: "Bad", date: "2026-10-03", time: "9pm" })).rejects.toThrow();
    // Clearing both is an explicit null.
    const cleared = await updateMeal(alice, m.id, { slot: null, time: null });
    expect(cleared).toMatchObject({ slot: null, time: null });
  });

  it("narrows the dietary check to who could be there, erring wide", async () => {
    const { alice, bob, cara, dev, eli, ev, plan } = await event();
    const allergy = await createProfileQuestion(alice, {
      label: "Allergies",
      responseType: "multi_choice",
      options: ALLERGY_OPTIONS,
      allowOther: true,
      scope: "once_ever",
      sensitive: true,
      audience: { unlockedByGrantModuleKey: "kitchen" },
      kitchenSignal: "allergy",
    });
    for (const who of [bob, cara, dev, eli]) {
      await answerProfileQuestion(who, allergy.id, { status: "answered", value: ["Peanuts"] });
    }
    await declare(bob.id, ev.id, { status: "not_coming" }); // said no: out
    await declare(cara.id, ev.id, { arrivalDate: "2026-10-04" }); // not there yet: out
    await declare(dev.id, ev.id, { status: "maybe" }); // might be: in
    // eli has said nothing at all: in.
    const dinner = await createMeal(alice, { menuPlanId: plan.id, label: "Friday dinner", date: "2026-10-03", slot: "dinner" });
    await createDish(alice, { mealId: dinner.id, name: "Satay", allergenFlags: ["peanuts"] });

    const panel = await getMealConstraintPanel(alice, dinner.id);
    expect(panel.dishes[0].allergy.map((c) => c.name).sort()).toEqual(["Dev", "Eli"]);
    expect(panel.coverage).toMatchObject({ considered: 3 }); // alice, dev, eli
  });

  it("checks everyone on a standing menu, which has no arrivals to narrow by", async () => {
    const f = await createFixtures();
    await updateCommunity(f.alice, { modulesEnabled: ["kitchen"] });
    const t = await insertTask(f.alice.communityId, f.branch.id, f.alice.id, { title: "Kitchen", effort: "owns_a_thing", effortMagnitude: { hours_per_week: 2 } });
    await grantPermission(f.alice.communityId, "kitchen", t.id);
    await claimTask(f.alice, t.id);
    const allergy = await createProfileQuestion(f.alice, {
      label: "Allergies",
      responseType: "multi_choice",
      options: ALLERGY_OPTIONS,
      scope: "once_ever",
      sensitive: true,
      audience: { unlockedByGrantModuleKey: "kitchen" },
      kitchenSignal: "allergy",
    });
    await answerProfileQuestion(f.bob, allergy.id, { status: "answered", value: ["Peanuts"] });
    const plan = await createMenuPlan(f.alice, { title: "Standing" });
    const m = await createMeal(f.alice, { menuPlanId: plan.id, label: "Dinner", date: "2026-10-03" });
    await createDish(f.alice, { mealId: m.id, name: "Satay", allergenFlags: ["peanuts"] });
    const panel = await getMealConstraintPanel(f.alice, m.id);
    expect(panel.coverage).toBeNull();
    expect(panel.dishes[0].allergy.map((c) => c.name)).toEqual(["Bob"]);
  });
});

describe("a menu's default meal times", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function kitchen() {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    const t = await insertTask(alice.communityId, branch.id, alice.id, { title: "Kitchen", effort: "owns_a_thing", effortMagnitude: { hours_per_week: 2 } });
    await grantPermission(alice.communityId, "kitchen", t.id);
    await claimTask(alice, t.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    return { alice, bob, plan };
  }

  it("stores only what differs, clears a blank, and falls back to the built-ins", async () => {
    const { alice, plan } = await kitchen();
    expect(plan.mealTimes).toBeNull();
    const set = await updateMenuPlanMealTimes(alice, plan.id, { dinner: "20:30", lunch: "" });
    expect(set.mealTimes).toEqual({ dinner: "20:30" });
    expect(resolveMealTimes(set.mealTimes)).toEqual({ ...DEFAULT_MEAL_TIMES, dinner: "20:30" });
    const cleared = await updateMenuPlanMealTimes(alice, plan.id, { dinner: null });
    expect(cleared.mealTimes).toBeNull();
  });

  it("is the holder's to change, and only while the menu is a draft", async () => {
    const { alice, bob, plan } = await kitchen();
    await expect(updateMenuPlanMealTimes(bob, plan.id, { dinner: "20:00" })).rejects.toThrow(ForbiddenError);
    await publishMenuPlan(alice, plan.id);
    await expect(updateMenuPlanMealTimes(alice, plan.id, { dinner: "20:00" })).rejects.toThrow(/published/);
  });
});

describe("saying when you arrive and leave", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function openEvent() {
    const { alice } = await createFixtures();
    const [ev] = await db
      .insert(cycle)
      .values({ communityId: alice.communityId, name: "Autumn", startDate: "2026-10-02", endDate: "2026-10-05" })
      .returning();
    return { alice, ev };
  }

  it("stores optional times and a first and last meal, normalised", async () => {
    const { alice, ev } = await openEvent();
    const saved = await declareParticipation(alice, ev.id, {
      status: "coming",
      arrivalDate: "2026-10-03",
      arrivalTime: "17:40",
      departureDate: "2026-10-05",
      lastMeal: "lunch",
    });
    expect(saved).toMatchObject({ arrivalTime: "17:40:00", departureTime: null, firstMeal: null, lastMeal: "lunch" });
  });

  it("leaves what's there alone when a caller doesn't mention it, and clears on an explicit null", async () => {
    const { alice, ev } = await openEvent();
    await declareParticipation(alice, ev.id, { status: "coming", arrivalTime: "17:40", firstMeal: "dinner" });
    // The one-click status buttons send a status and nothing else.
    const again = await declareParticipation(alice, ev.id, { status: "maybe" });
    expect(again).toMatchObject({ status: "maybe", arrivalTime: "17:40:00", firstMeal: "dinner" });
    const cleared = await declareParticipation(alice, ev.id, { status: "maybe", arrivalTime: null, firstMeal: null });
    expect(cleared).toMatchObject({ arrivalTime: null, firstMeal: null });
  });

  it("rejects a time that isn't one, and a meal that isn't a meal", () => {
    expect(declareParticipationInput.safeParse({ status: "coming", arrivalTime: "5pm" }).success).toBe(false);
    expect(declareParticipationInput.safeParse({ status: "coming", firstMeal: "brunch" }).success).toBe(false);
    expect(declareParticipationInput.safeParse({ status: "coming", arrivalTime: "17:40" }).success).toBe(true);
  });
});
