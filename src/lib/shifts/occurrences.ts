import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shiftOccurrence, shiftSeries } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import { getShiftSeries, requireShiftCoordinator } from "./series";

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

// UTC throughout, matching this codebase's general posture elsewhere
// (Budget deadlines, Event scheduling slots) — no per-viewer timezone
// conversion for the generation inputs themselves.
function computeWeeklySlots(input: z.infer<typeof weeklyPatternInput>) {
  const [hour, minute] = input.startTime.split(":").map(Number);
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
      const startsAt = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hour, minute),
      );
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
      ? computeWeeklySlots(input)
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

// The general browse surface — every future occurrence in the
// Community whose series isn't archived, for "browse upcoming
// occurrences grouped by series" on /shifts. Open to any member.
export async function listUpcomingShiftOccurrences(actor: Member) {
  const rows = await db
    .select({ occurrence: shiftOccurrence, series: shiftSeries })
    .from(shiftOccurrence)
    .innerJoin(shiftSeries, eq(shiftOccurrence.seriesId, shiftSeries.id))
    .where(
      and(
        eq(shiftSeries.communityId, actor.communityId),
        isNull(shiftSeries.archivedAt),
        gte(shiftOccurrence.startsAt, new Date()),
      ),
    )
    .orderBy(asc(shiftOccurrence.startsAt));
  return rows;
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
