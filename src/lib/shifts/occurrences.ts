import { and, asc, count, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, shiftOccurrence, shiftSeries, shiftSignup } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { getEventTimeZone } from "../cycles/time-zone";
import { instantFromZoned, localInputFromInstant } from "../dates/timezone";
import {
  getShiftSeries,
  isForeignKeyViolation,
  requireShiftCoordinator,
  requireShiftRosterNotClosed,
  requireShiftRosterNotOpen,
} from "./series";

type Member = typeof memberTable.$inferSelect;
type ShiftSeriesRow = typeof shiftSeries.$inferSelect;
type ShiftOccurrenceRow = typeof shiftOccurrence.$inferSelect;

// Guards against an obvious fat-finger (e.g. an end year typed where an
// end date was meant) rather than any real design limit — a coordinator
// who genuinely needs more can just call this more than once.
const MAX_OCCURRENCES_PER_CALL = 366;

const weeklyPatternInput = z.object({
  mode: z.literal("weekly"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "startTime must be HH:mm"),
  durationMinutes: z.number().int().positive(),
});

const explicitSlotInput = z
  .object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })
  .refine((s) => new Date(s.endsAt) > new Date(s.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
const explicitListInput = z.object({
  mode: z.literal("explicit"),
  slots: z.array(explicitSlotInput).min(1),
});

export const generateShiftOccurrencesInput = z.discriminatedUnion("mode", [
  weeklyPatternInput,
  explicitListInput,
]);
export type GenerateShiftOccurrencesInput = z.infer<typeof generateShiftOccurrencesInput>;

// startTime is a wall-clock at the venue, so each date is resolved
// against the event's zone rather than as UTC. That is what makes a weekly
// 09:00 shift stay at 09:00 across a clock change: the instants are
// computed per date, not by adding seven days to the first one. The dates
// themselves are plain days, so the weekday is read off the date directly
// and doesn't depend on any zone.
function computeWeeklySlots(input: z.infer<typeof weeklyPatternInput>, timeZone: string) {
  const daysSet = new Set(input.daysOfWeek);
  const slots: { startsAt: Date; endsAt: Date }[] = [];

  const cursor = new Date(`${input.startDate}T00:00:00.000Z`);
  const end = new Date(`${input.endDate}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError("Invalid startDate/endDate");
  }
  if (cursor > end) {
    throw new AppError("startDate must be on or before endDate");
  }

  while (cursor <= end) {
    if (daysSet.has(cursor.getUTCDay())) {
      const day = cursor.toISOString().slice(0, 10);
      const startsAt = instantFromZoned(`${day}T${input.startTime}`, timeZone);
      slots.push({ startsAt, endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000) });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

// "A coordinator picks a date range and either a weekly day-of-week +
// time, or a plain explicit list of datetimes ... and the system
// inserts the resulting rows once" — no live-evaluated recurrence-rule
// engine, explicit rows only. Coordinator-only.
export async function generateShiftOccurrences(
  actor: Member,
  seriesId: string,
  input: GenerateShiftOccurrencesInput,
) {
  const series = await getShiftSeries(actor, seriesId);
  await requireShiftCoordinator(actor, series);

  const slots =
    input.mode === "weekly"
      ? computeWeeklySlots(input, await getEventTimeZone(actor.communityId, series.cycleId))
      : input.slots.map((s) => ({ startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) }));

  if (slots.length === 0) {
    throw new AppError("That range/pattern produced no occurrences");
  }
  if (slots.length > MAX_OCCURRENCES_PER_CALL) {
    throw new AppError(
      `That would create ${slots.length} occurrences in one call — narrow the range (max ${MAX_OCCURRENCES_PER_CALL})`,
    );
  }

  return db
    .insert(shiftOccurrence)
    .values(slots.map((s) => ({ seriesId, startsAt: s.startsAt, endsAt: s.endsAt })))
    .returning();
}

export async function getShiftOccurrence(actor: Member, occurrenceId: string) {
  const [row] = await db
    .select({ occurrence: shiftOccurrence, series: shiftSeries })
    .from(shiftOccurrence)
    .innerJoin(shiftSeries, eq(shiftOccurrence.seriesId, shiftSeries.id))
    .where(and(eq(shiftOccurrence.id, occurrenceId), eq(shiftSeries.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Shift occurrence not found");
  }
  return row;
}

export function effectiveCapacity(occurrence: Pick<ShiftOccurrenceRow, "capacity">, series: Pick<ShiftSeriesRow, "defaultCapacity">) {
  return occurrence.capacity ?? series.defaultCapacity;
}

// One shift's own times and capacity. Every field is optional; what's
// left out keeps its stored value. capacity null = follow the series
// default again. Times may move even when people are signed up; they are
// not told automatically (the page says so and names them).
export const updateShiftOccurrenceInput = z.object({
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  capacity: z.number().int().positive("People needed must be at least 1").nullable().optional(),
});
export type UpdateShiftOccurrenceInput = z.infer<typeof updateShiftOccurrenceInput>;

// A datetime-local value can't tell apart the two 02:30s of the night the
// clocks go back, so reading it back can move a shift by an hour. When the
// manager left the field as it was shown, keep the stored instant.
export function instantFromShiftInput(local: string, stored: Date, timeZone: string): Date {
  return local === localInputFromInstant(stored.toISOString(), timeZone) ? stored : instantFromZoned(local, timeZone);
}

async function countSignups(occurrenceId: string) {
  const [row] = await db
    .select({ n: count(shiftSignup.id) })
    .from(shiftSignup)
    .where(eq(shiftSignup.occurrenceId, occurrenceId));
  return row?.n ?? 0;
}

export async function updateShiftOccurrence(actor: Member, occurrenceId: string, input: UpdateShiftOccurrenceInput) {
  const parsed = updateShiftOccurrenceInput.parse(input);
  const { occurrence, series } = await getShiftOccurrence(actor, occurrenceId);
  await requireShiftCoordinator(actor, series);
  await requireShiftRosterNotClosed(series);

  // An ended shift is history: its sign-ups may already be marked
  // completed or no-show, and contribution counts read them.
  const now = new Date();
  if (occurrence.endsAt <= now) {
    throw new ConflictError("This shift has ended — it can't be edited");
  }

  const startsAt = parsed.startsAt ? new Date(parsed.startsAt) : occurrence.startsAt;
  const endsAt = parsed.endsAt ? new Date(parsed.endsAt) : occurrence.endsAt;
  const capacity = parsed.capacity !== undefined ? parsed.capacity : occurrence.capacity;
  if (endsAt <= startsAt) {
    throw new AppError("The end must be after the start");
  }
  if (startsAt.getTime() !== occurrence.startsAt.getTime() && startsAt <= now) {
    throw new AppError("A shift can't be moved into the past");
  }
  // Ending a running shift in the past would make it count as ended, and an
  // ended shift can't be edited, so the mistake couldn't be undone.
  if (endsAt.getTime() !== occurrence.endsAt.getTime() && endsAt <= now) {
    throw new AppError("A shift can't be set to end in the past");
  }

  const signups = await countSignups(occurrenceId);
  if (effectiveCapacity({ capacity }, series) < signups) {
    throw new ConflictError(`${signups} people are already signed up — this shift needs room for at least ${signups}`);
  }

  const [updated] = await db
    .update(shiftOccurrence)
    .set({ startsAt, endsAt, capacity })
    .where(eq(shiftOccurrence.id, occurrenceId))
    .returning();
  return updated;
}

// Same rule as deleteShiftSeries: only while the roster isn't open, and
// never over someone's sign-up.
export async function deleteShiftOccurrence(actor: Member, occurrenceId: string) {
  const { series } = await getShiftOccurrence(actor, occurrenceId);
  await requireShiftCoordinator(actor, series);
  await requireShiftRosterNotClosed(series);
  await requireShiftRosterNotOpen(series);
  const taken = new ConflictError("Someone is signed up for this shift — it can't be deleted");
  if ((await countSignups(occurrenceId)) > 0) {
    throw taken;
  }
  try {
    await db.delete(shiftOccurrence).where(eq(shiftOccurrence.id, occurrenceId));
  } catch (err) {
    // A sign-up that lands between the check and the delete.
    throw isForeignKeyViolation(err) ? taken : err;
  }
}

// The general browse surface — every future occurrence in the
// Community whose series isn't archived, for "browse upcoming
// occurrences grouped by series" on /shifts. Open to any member. D11
// gating: unconfirmed proposals (cycle-placed, confirmedAt null) are
// hidden entirely; a confirmed series in a still-collecting cycle shows
// as visible-but-closed (signupsOpen false) until its roster's open
// act; standing series are always open.
export async function listUpcomingShiftOccurrences(actor: Member) {
  const rows = await db
    .select({ occurrence: shiftOccurrence, series: shiftSeries })
    .from(shiftOccurrence)
    .innerJoin(shiftSeries, eq(shiftOccurrence.seriesId, shiftSeries.id))
    .where(
      and(
        eq(shiftSeries.communityId, actor.communityId),
        isNull(shiftSeries.archivedAt),
        isNotNull(shiftSeries.confirmedAt),
        gte(shiftOccurrence.startsAt, new Date()),
      ),
    )
    .orderBy(asc(shiftOccurrence.startsAt));

  const cycleIds = [...new Set(rows.map((r) => r.series.cycleId).filter((c): c is string => c !== null))];
  const openedById = new Map<string, boolean>();
  if (cycleIds.length > 0) {
    const cycleRows = await db
      .select({ id: cycle.id, shiftSignupsOpenedAt: cycle.shiftSignupsOpenedAt })
      .from(cycle)
      .where(inArray(cycle.id, cycleIds));
    for (const c of cycleRows) {
      openedById.set(c.id, c.shiftSignupsOpenedAt !== null);
    }
  }

  return rows.map((r) => ({
    ...r,
    signupsOpen: r.series.cycleId ? openedById.get(r.series.cycleId) === true : true,
  }));
}

// The coordinator's own management view — every occurrence for their
// series, past and future, not just what's upcoming.
export async function listOccurrencesForSeries(actor: Member, seriesId: string) {
  const series = await getShiftSeries(actor, seriesId);
  await requireShiftCoordinator(actor, series);

  return db
    .select()
    .from(shiftOccurrence)
    .where(eq(shiftOccurrence.seriesId, seriesId))
    .orderBy(asc(shiftOccurrence.startsAt));
}
