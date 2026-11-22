import {
  formatDayLabel,
  resolveDayPeriod,
  type DayItemScope,
  type DayScopeData,
  type DayView,
} from "./day-labels";
import type { DateDisplayMode } from "./display";
import { formatInstantRange } from "./instants";
import { formatTimeInZone, localDateInZone } from "./timezone";

type Instant = Date | string | number;

const iso = (i: Instant) => new Date(i).toISOString();

/**
 * A shift's time as words, following the viewer's date display setting.
 *
 * A shift is read against its own event and phases (see day-labels.ts, and
 * docs/plans/day-labels-plan.md). When the viewer reads dates as periods and
 * the shift's day belongs to a short phase or event, the date becomes that
 * period's name and a weekday: "Peach Please · Fri, 14:00–15:30". In every
 * other case (exact mode, a standing series with no event, an event with no
 * dates or longer than a week, a day outside the period) it reads exactly as
 * it always did: "Oct 9, 2026, 14:00–15:30".
 *
 * Which day a shift falls on is decided on the venue's clock (`timeZone`),
 * not the viewer's or the server's, so a late-evening shift can't read as the
 * wrong day.
 *
 * `scope` is the item's own phase, if it has one; `view` is what the page
 * already says (an event heading above the list, say), which the label then
 * leaves out.
 */
export function formatShiftRange(
  start: Instant,
  end: Instant,
  timeZone: string,
  mode: DateDisplayMode,
  data: DayScopeData | null | undefined,
  scope: DayItemScope = {},
  view?: DayView,
): string {
  const exact = () => formatInstantRange(start, end, timeZone);
  if (mode !== "period" || !data) return exact();

  const startDay = localDateInZone(iso(start), timeZone);
  const startPeriod = resolveDayPeriod(startDay, data, scope);
  if (!startPeriod) return exact();

  const startLabel = formatDayLabel(startDay, mode, startPeriod, view);
  const startTime = formatTimeInZone(iso(start), timeZone);
  const endTime = formatTimeInZone(iso(end), timeZone);
  const endDay = localDateInZone(iso(end), timeZone);
  if (endDay === startDay) return `${startLabel.visible}, ${startTime}–${endTime}`;

  // Crosses midnight: the end names its own day, in the same terms as the
  // start where it can, or as a plain date where it has left the period.
  const endLabel = formatDayLabel(endDay, mode, resolveDayPeriod(endDay, data, scope), view);
  return `${startLabel.visible}, ${startTime} – ${endLabel.visible}, ${endTime}`;
}
