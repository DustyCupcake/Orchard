import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, member, participation, MEAL_SLOTS, type MealSlot } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getMenuPlan, type MenuPlanRow } from "./menu";

type Member = typeof memberTable.$inferSelect;

// Who is eating which meal, from the event's Participation — arrival and
// departure dates, optionally with times, or a first and last meal.
//
// Everything here is optional on every side, because most communities have
// partial information and some have none: a member may give neither date,
// one, or both; may add a clock time; may say "my first meal is dinner"
// instead; a meal may have a slot, a clock time, both or neither. The rule
// is that **information narrows and its absence never excludes anyone**: a
// person is only ever counted out when they have said something that puts
// them out, and where a meal on their arrival or departure day can't be
// told from what they've said, they are counted and the meal is flagged as
// uncertain, so the cook can see how much of the number is a guess.
//
// All of it is derived on read. Nothing is written back to a meal.

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
};

/** The built-in clock times, used when a menu hasn't set its own. Only ever
 *  compared with a person's arrival or departure time. */
export const DEFAULT_MEAL_TIMES: Record<MealSlot, string> = {
  breakfast: "08:00",
  lunch: "12:30",
  dinner: "19:00",
};

const SLOT_RANK: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2 };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** "16:00:00" (what Postgres returns) and "16:00" (what a form sends) are the
 *  same time; anything else is no time at all. Zero-padded "HH:MM" strings
 *  compare correctly as text, which is what the rest of this file relies on. */
export function normaliseTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = TIME.exec(raw.trim());
  return match ? `${match[1]}:${match[2]}` : null;
}

/** The menu's three times, with its own overrides laid over the defaults. A
 *  malformed override is ignored rather than trusted. */
export function resolveMealTimes(custom?: Partial<Record<MealSlot, string>> | null): Record<MealSlot, string> {
  const times = { ...DEFAULT_MEAL_TIMES };
  for (const slot of MEAL_SLOTS) {
    const own = normaliseTime(custom?.[slot]);
    if (own) times[slot] = own;
  }
  return times;
}

/** A meal's clock time: its own override, else its slot's time on this menu,
 *  else unknown. A meal with neither is a meal whose time we can't compare. */
export function mealClockTime(
  meal: { slot: MealSlot | null; time: string | null },
  times: Record<MealSlot, string>,
): string | null {
  return normaliseTime(meal.time) ?? (meal.slot ? times[meal.slot] : null);
}

export type PresenceInput = {
  status: "unknown" | "coming" | "maybe" | "not_coming";
  arrivalDate: string | null;
  departureDate: string | null;
  arrivalTime: string | null;
  departureTime: string | null;
  firstMeal: MealSlot | null;
  lastMeal: MealSlot | null;
};

export type Presence = {
  /** Not ruled out for this meal. */
  in: boolean;
  /** In, but only because nothing said otherwise: this is their arrival or
   *  departure day and neither a first/last meal nor a time could place the
   *  meal either side of it. */
  uncertain: boolean;
  arriving: boolean;
  leaving: boolean;
  /** Gave neither date, so assumed there for the whole event. */
  noDates: boolean;
};

const OUT: Presence = { in: false, uncertain: false, arriving: false, leaving: false, noDates: false };

/**
 * Is this person there for this meal? — judged on dates and what they said
 * about the day, never on their status (that is the caller's business, since
 * a headcount counts the people who are coming and a dietary check cares
 * about everyone who might be).
 *
 * Order of evidence on the day someone arrives (and, mirrored, leaves):
 * their own first (last) meal beats a clock time, because it is their
 * statement of which meals they'll eat; a clock time is compared with the
 * meal's; and with neither, or a meal that has no slot or time to compare,
 * the day is counted and flagged. Dates outside their window always rule
 * them out — an absent date falls back to the event's own start and end, and
 * to nothing at all if the event has none.
 */
export function presenceAtMeal(
  meal: { date: string; slot: MealSlot | null; time: string | null },
  p: Pick<PresenceInput, "arrivalDate" | "departureDate" | "arrivalTime" | "departureTime" | "firstMeal" | "lastMeal">,
  event: { startDate: string | null; endDate: string | null },
  times: Record<MealSlot, string>,
): Presence {
  const start = p.arrivalDate ?? event.startDate;
  const end = p.departureDate ?? event.endDate;
  if ((start && meal.date < start) || (end && meal.date > end)) return OUT;

  const arriving = p.arrivalDate === meal.date;
  const leaving = p.departureDate === meal.date;
  const noDates = !p.arrivalDate && !p.departureDate;
  const at = mealClockTime(meal, times);
  let uncertain = false;

  if (arriving) {
    const verdict =
      p.firstMeal && meal.slot
        ? SLOT_RANK[meal.slot] >= SLOT_RANK[p.firstMeal]
        : normaliseTime(p.arrivalTime) && at
          ? at >= normaliseTime(p.arrivalTime)!
          : null;
    if (verdict === false) return OUT;
    if (verdict === null) uncertain = true;
  }
  if (leaving) {
    const verdict =
      p.lastMeal && meal.slot
        ? SLOT_RANK[meal.slot] <= SLOT_RANK[p.lastMeal]
        : normaliseTime(p.departureTime) && at
          ? at <= normaliseTime(p.departureTime)!
          : null;
    if (verdict === false) return OUT;
    if (verdict === null) uncertain = true;
  }
  return { in: true, uncertain, arriving, leaving, noDates };
}

export type AttendanceContext = {
  event: { startDate: string | null; endDate: string | null };
  times: Record<MealSlot, string>;
  rows: (PresenceInput & { memberId: string })[];
  /** Every member of the community, because someone with no Participation
   *  row has simply not said yet. */
  memberIds: string[];
};

export type MealAttendance = {
  /** The plan belongs to an event, so there is participation to read. A
   *  standing menu has none, and its meals can only be counted by hand. */
  available: boolean;
  /** Coming, and not ruled out for this meal. */
  present: number;
  /** Of `present`, how many are counted only because nothing could rule them
   *  out — their arrival or departure day with no way to place the meal. */
  uncertain: number;
  arriving: number;
  leaving: number;
  /** Coming, with neither date: assumed there for the whole event. */
  noDates: number;
  /** Said maybe and not ruled out. Never counted; shown beside the number. */
  maybe: number;
  /** The members who are coming and there, for listing. */
  presentMemberIds: string[];
  /** Everyone who could be at this meal: everyone but those who said they
   *  aren't coming or whose dates rule them out. Errs wide on purpose — it is
   *  who a dietary check must cover, and a missed allergy costs more than an
   *  extra name. */
  possibleMemberIds: string[];
};

export const NO_ATTENDANCE: MealAttendance = {
  available: false,
  present: 0,
  uncertain: 0,
  arriving: 0,
  leaving: 0,
  noDates: 0,
  maybe: 0,
  presentMemberIds: [],
  possibleMemberIds: [],
};

/** Pure: one meal against everyone's participation. */
export function attendanceForMeal(
  meal: { date: string; slot: MealSlot | null; time: string | null },
  ctx: AttendanceContext,
): MealAttendance {
  const byMember = new Map(ctx.rows.map((r) => [r.memberId, r]));
  const out: MealAttendance = { ...NO_ATTENDANCE, available: true, presentMemberIds: [], possibleMemberIds: [] };

  for (const memberId of ctx.memberIds) {
    const row = byMember.get(memberId);
    // No row is "hasn't said": possible, never counted.
    if (!row) {
      out.possibleMemberIds.push(memberId);
      continue;
    }
    if (row.status === "not_coming") continue;
    const presence = presenceAtMeal(meal, row, ctx.event, ctx.times);
    if (!presence.in) continue;
    out.possibleMemberIds.push(memberId);
    if (row.status === "maybe") {
      out.maybe++;
    } else if (row.status === "coming") {
      out.present++;
      out.presentMemberIds.push(memberId);
      if (presence.uncertain) out.uncertain++;
      if (presence.arriving) out.arriving++;
      if (presence.leaving) out.leaving++;
      if (presence.noDates) out.noDates++;
    }
  }
  return out;
}

/**
 * Read what's needed to work out attendance for a plan, once. Null for a
 * standing menu (no event, so nothing to read).
 *
 * The event's own start and end dates stand in for a missing arrival or
 * departure, so someone who gave no dates is assumed there throughout —
 * and, if the event has no dates either, simply there.
 */
export async function loadAttendanceContext(actor: Member, plan: MenuPlanRow): Promise<AttendanceContext | null> {
  if (!plan.cycleId) return null;
  const [event] = await db
    .select({ startDate: cycle.startDate, endDate: cycle.endDate })
    .from(cycle)
    .where(and(eq(cycle.id, plan.cycleId), eq(cycle.communityId, actor.communityId)));
  if (!event) return null;

  const rows = await db.select().from(participation).where(eq(participation.cycleId, plan.cycleId));
  const members = await db.select({ id: member.id }).from(member).where(eq(member.communityId, actor.communityId));
  return {
    event,
    times: resolveMealTimes(plan.mealTimes),
    rows: rows.map((r) => ({
      memberId: r.memberId,
      status: r.status,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      arrivalTime: normaliseTime(r.arrivalTime),
      departureTime: normaliseTime(r.departureTime),
      firstMeal: r.firstMeal,
      lastMeal: r.lastMeal,
    })),
    memberIds: members.map((m) => m.id),
  };
}

type MealForCount = {
  date: string;
  slot: MealSlot | null;
  time: string | null;
  headCount: number | null;
  headCountSource: "manual" | "participation";
  guests: number;
};

/**
 * The number this meal is cooked for.
 *
 * "From arrivals" is the people who are coming and there for the meal plus
 * the holder's guests; "manual" is the typed number. A meal set to arrivals
 * on a menu with no event (nothing to read) falls back to what was typed, and
 * a worked-out zero is reported as no number rather than as a meal for
 * nobody — a headcount of nothing would switch scaling off exactly like a
 * missing one, so it is said that way.
 */
export function effectiveHeadCount(meal: MealForCount, attendance: MealAttendance): number | null {
  if (meal.headCountSource === "participation" && attendance.available) {
    const n = attendance.present + meal.guests;
    return n > 0 ? n : null;
  }
  return meal.headCount && meal.headCount > 0 ? meal.headCount : null;
}

/** One meal's effective headcount, for a caller holding only a meal row (the
 *  scaling and purchasing reads). Loads participation only when the meal asks
 *  for it. */
export async function resolveMealHeadCount(actor: Member, meal: MealForCount & { menuPlanId: string }): Promise<number | null> {
  if (meal.headCountSource !== "participation") return effectiveHeadCount(meal, NO_ATTENDANCE);
  const plan = await getMenuPlan(actor, meal.menuPlanId);
  const ctx = await loadAttendanceContext(actor, plan);
  return effectiveHeadCount(meal, ctx ? attendanceForMeal(meal, ctx) : NO_ATTENDANCE);
}
