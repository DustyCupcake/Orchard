import {
  formatDateLabel,
  formatExactDate,
  formatTimeInZone,
  localDateInZone,
  type DateDisplayMode,
  type PeriodDateContext,
} from "../dates";
import type { EventSlot } from "./crud";

/**
 * Reading a programme's times as words.
 *
 * Two settings decide what a saved time looks like, and they answer
 * different questions. Community.defaultDateDisplayMode / a Member's
 * override decide whether a date reads as a real calendar date or as
 * "the event, on a Thursday". Cycle.timeZone (inheriting
 * Community.timeZone) decides what clock those words are on. Both are
 * applied here rather than at each call site so the published programme,
 * a member's own proposal list, and the scheduling owner's review list
 * can't drift apart — they were three near-identical `formatSlot`
 * functions that each formatted in whatever zone the server happened to
 * be in, which is why a time proposed as 14:00 read back as a different
 * hour depending on where the app was deployed.
 *
 * One function for both kinds of row here, not two. An availability
 * window and a confirmed placement are the same shape ({startsAt,
 * endsAt}) and read identically — the difference is only in how many
 * options the first one leaves open, which is the owner's arithmetic in
 * availability.ts, not a formatting concern.
 */
export interface EventTimeLabel {
  /** What to show, per the viewer's date display setting. */
  visible: string;
  /** The same time as an unambiguous wall-clock, for a tooltip/label. */
  exact: string;
}

export function formatEventTime(
  range: EventSlot,
  dateDisplayMode: DateDisplayMode,
  timeZone: string,
  period?: PeriodDateContext | null,
): EventTimeLabel {
  // The calendar date the range falls on *in the event's zone* — a window
  // starting at 23:00 in Europe/Madrid is the next day in UTC, and
  // formatDateLabel expects a plain YYYY-MM-DD it can compare against a
  // period's own start_date/end_date.
  const localDate = localDateInZone(range.startsAt, timeZone);
  const label = formatDateLabel(localDate, dateDisplayMode, period ?? null);
  const times = `${formatTimeInZone(range.startsAt, timeZone)}–${formatTimeInZone(range.endsAt, timeZone)}`;
  return {
    visible: `${label.visible}, ${times}`,
    exact: `${formatExactDate(localDate)}, ${times}`,
  };
}