import {
  formatDayColumnHeading,
  formatDayHeading,
  formatDayLabel,
  resolveDayPeriod,
  type DayColumnHeading,
  type DayCycle,
  type DayPhase,
  type DayScopeData,
  type DayView,
  type ResolvedDayPeriod,
} from "./day-labels";
import type { DateDisplayMode, DateLabel } from "./display";
import { formatShiftRange } from "./shift-time";
import { localDateInZone } from "./timezone";

type Instant = Date | string | number;

/**
 * What an item says about where it belongs: the event, and the phase if it
 * has one of its own. Any of these may be null or absent: an item with no
 * event is a plain date (docs/plans/day-labels-plan.md D3).
 *
 * A phase is enough to find its event, so an item that only carries a
 * `phaseId` still resolves.
 */
export interface DayItem {
  cycleId?: string | null;
  phaseId?: string | null;
}

/**
 * The one place a page asks "how do I write this day?" — the viewer's date
 * display setting and every event's dates, behind a handful of calls that
 * all share the same resolution (day-labels.ts, D1 to D4). Callers pass what
 * their row already carries; they never assemble a period themselves.
 *
 * Synchronous on purpose: whoever builds it has already loaded the events
 * (see `getDayLabeler` in src/lib/day-labeler.ts), so a label can be asked
 * for anywhere a plain string is wanted, including inside a `.map`.
 */
export interface DayLabeler {
  /** The viewer's effective date display setting. */
  readonly mode: DateDisplayMode;
  /** The short period the day belongs to for this item, or null (a full date). */
  period(day: string | null | undefined, item?: DayItem): ResolvedDayPeriod | null;
  /** An inline label: "Peach Please · Set-up · Tue", or "Mar 2, 2027". */
  label(day: string | null | undefined, item?: DayItem, view?: DayView): DateLabel;
  /**
   * The day an instant falls on in `timeZone` (the venue's clock, for a shift),
   * written like `label`. For a feed row that says when something happened or
   * is due and has no time to show.
   */
  instantLabel(instant: Instant, timeZone: string, item?: DayItem, view?: DayView): DateLabel;
  /** A section heading: "Friday, March 5", or "Friday" in a short period. */
  heading(day: string, item?: DayItem, view?: DayView): string;
  /** A grid column's two lines; the weekday alone in a short period. */
  columnHeading(day: string, item?: DayItem): DayColumnHeading;
  /** A shift's time: "Peach Please · Fri, 14:00–15:30", or "Mar 5, 2027, 14:00–15:30". */
  shiftRange(start: Instant, end: Instant, timeZone: string, item?: DayItem, view?: DayView): string;
}

/**
 * Every event's dates and phases, keyed by event id, as the labeler needs
 * them. Pure: rows in, map out. Phases that belong to no listed event are
 * dropped.
 */
export function buildDayScopes(
  cycles: readonly DayCycle[],
  phases: readonly (DayPhase & { cycleId: string })[],
): Map<string, DayScopeData> {
  const scopes = new Map<string, DayScopeData>(
    cycles.map((c) => [
      c.id,
      {
        cycle: { id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate },
        phases: [],
      },
    ]),
  );
  for (const p of phases) {
    scopes
      .get(p.cycleId)
      ?.phases.push({ id: p.id, name: p.name, order: p.order, startDate: p.startDate, endDate: p.endDate });
  }
  return scopes;
}

export function createDayLabeler(mode: DateDisplayMode, scopes: ReadonlyMap<string, DayScopeData>): DayLabeler {
  const cycleIdByPhaseId = new Map<string, string>();
  for (const [cycleId, scope] of scopes) {
    for (const p of scope.phases) cycleIdByPhaseId.set(p.id, cycleId);
  }

  const scopeFor = (item?: DayItem): DayScopeData | null => {
    const cycleId = item?.cycleId ?? (item?.phaseId ? cycleIdByPhaseId.get(item.phaseId) : null);
    return (cycleId && scopes.get(cycleId)) || null;
  };
  const period = (day: string | null | undefined, item?: DayItem) =>
    resolveDayPeriod(day, scopeFor(item), { phaseId: item?.phaseId ?? null });

  return {
    mode,
    period,
    label: (day, item, view) => formatDayLabel(day, mode, period(day, item), view),
    instantLabel: (instant, timeZone, item, view) => {
      const day = localDateInZone(new Date(instant).toISOString(), timeZone);
      return formatDayLabel(day, mode, period(day, item), view);
    },
    heading: (day, item, view) => formatDayHeading(day, mode, period(day, item), view),
    columnHeading: (day, item) => formatDayColumnHeading(day, mode, period(day, item)),
    shiftRange: (start, end, timeZone, item, view) =>
      formatShiftRange(start, end, timeZone, mode, scopeFor(item), { phaseId: item?.phaseId ?? null }, view),
  };
}
