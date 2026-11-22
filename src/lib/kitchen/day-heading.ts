import type { DayLabeler } from "../dates";

/**
 * A day on the menu or the shopping list, written the way the member reads
 * dates (src/lib/dates/day-labeler.ts): "Friday, March 5" for someone reading
 * exact dates, or just "Friday" inside a short phase or event. The Kitchen is
 * one event's menu, so the heading never repeats the event or phase's name;
 * the weekday is the point. A standing, event-less menu has no period, so it
 * always reads the full date.
 *
 * `phaseId` is the phase the meal belongs to, if it has one of its own
 * (docs/plans/day-labels-plan.md D2).
 */
export function dayHeading(
  labeler: DayLabeler,
  date: string,
  item: { cycleId: string | null; phaseId?: string | null },
): string {
  const period = labeler.period(date, item);
  return labeler.heading(date, item, { cycleId: item.cycleId, phaseId: period?.phaseId ?? null });
}
