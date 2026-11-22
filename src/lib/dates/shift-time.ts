import { formatDateLabel, type DateDisplayMode, type PeriodDateContext } from "./display";
import { formatInstantRange } from "./instants";
import { formatTimeInZone, localDateInZone } from "./timezone";

type Instant = Date | string | number;

const iso = (i: Instant) => new Date(i).toISOString();

/**
 * A shift's time as words, following the viewer's date display setting.
 *
 * A shift belongs to an event, and the event's own dates are the period it
 * is read against. When the viewer reads dates as periods, the event is a
 * week or less, and the shift starts inside it, the date becomes the
 * event's name and a weekday — "Peach Please · Thu, 14:00–15:30". In every
 * other case — exact mode, a longer event, no event (a standing series),
 * an event with no dates yet, or a shift that falls outside the event's
 * dates — it reads exactly as it always did: "Oct 9, 2026, 14:00–15:30".
 *
 * Which weekday a shift falls on is decided on the venue's clock
 * (`timeZone`), not the viewer's or the server's, so a late-evening shift
 * can't read as the wrong day.
 */
export function formatShiftRange(
  start: Instant,
  end: Instant,
  timeZone: string,
  mode: DateDisplayMode,
  period?: PeriodDateContext | null,
): string {
  const exact = () => formatInstantRange(start, end, timeZone);
  if (mode !== "period" || !period) return exact();

  const startDate = localDateInZone(iso(start), timeZone);
  const startLabel = formatDateLabel(startDate, mode, period);
  if (!startLabel.periodAvailable) return exact();

  const startTime = formatTimeInZone(iso(start), timeZone);
  const endTime = formatTimeInZone(iso(end), timeZone);
  const endDate = localDateInZone(iso(end), timeZone);
  if (endDate === startDate) return `${startLabel.visible}, ${startTime}–${endTime}`;

  // Crosses midnight: the end names its own day, in the same terms as the
  // start where it can, or as a plain date where it has left the event.
  const endLabel = formatDateLabel(endDate, mode, period);
  return `${startLabel.visible}, ${startTime} – ${endLabel.visible}, ${endTime}`;
}
