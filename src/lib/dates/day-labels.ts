import { isShortPeriod, formatExactDate, formatWeekday, type DateDisplayMode, type DateLabel } from "./display";
import { daysBetween } from "./resolve";

/**
 * Which short period a day belongs to, and how to say the day in terms of
 * it. The rules are docs/plans/day-labels-plan.md's D1 to D4:
 *
 * - The scope comes from the item, never from the date (D1). An item names
 *   its event and, where it has one, its phase; nothing here looks at a bare
 *   date and guesses which event it is.
 * - An item's own phase is authoritative (D2). If it qualifies, that is the
 *   period. If it doesn't, the item falls to its event and then the full
 *   date; it is never handed to some other phase that happens to contain the
 *   day. Only an item that names no phase has one found by containment.
 * - No scope, or no qualifying period, is the full date (D3).
 * - A label names only what the view doesn't already say (D4).
 * - Exact mode is the full date, always (D8).
 *
 * Pure: no database, no clock. A caller hands in the event and its phases.
 */

export interface DayCycle {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

export interface DayPhase {
  id: string;
  name: string;
  /** Phases carry an order; a tie between two qualifying phases goes to the lower one. */
  order: number;
  startDate: string | null;
  endDate: string | null;
}

/** An event and its phases: everything the resolver needs to place a day. */
export interface DayScopeData {
  cycle: DayCycle;
  phases: DayPhase[];
}

/** The part of an item's own scope that the event doesn't already say. */
export interface DayItemScope {
  /** The phase the item is explicitly associated with, if any. Authoritative (D2). */
  phaseId?: string | null;
}

/** What the surrounding view already established (D4), so a label needn't repeat it. */
export interface DayView {
  cycleId?: string | null;
  phaseId?: string | null;
}

export interface ResolvedDayPeriod {
  kind: "phase" | "event";
  cycleId: string;
  cycleName: string;
  phaseId: string | null;
  phaseName: string | null;
  startDate: string;
  endDate: string;
}

function qualifies(day: string, start: string | null, end: string | null): start is string {
  return Boolean(start && end && isShortPeriod(start, end) && day >= start && day <= end);
}

// Only ever called on a phase that already qualified, so both dates are set.
const phaseSpan = (p: DayPhase) => daysBetween(p.startDate as string, p.endDate as string);

/**
 * The short period `day` belongs to for an item with this scope, or null
 * when it belongs to none (so it reads as a full date).
 */
export function resolveDayPeriod(
  day: string | null | undefined,
  data: DayScopeData | null | undefined,
  scope: DayItemScope = {},
): ResolvedDayPeriod | null {
  if (!day || !data) return null;
  const { cycle, phases } = data;

  const asPhase = (p: DayPhase): ResolvedDayPeriod => ({
    kind: "phase",
    cycleId: cycle.id,
    cycleName: cycle.name,
    phaseId: p.id,
    phaseName: p.name,
    startDate: p.startDate as string,
    endDate: p.endDate as string,
  });

  let phase: DayPhase | undefined;
  if (scope.phaseId) {
    // Its own phase, and only that one. Not qualifying means "not a phase
    // label", not "try another phase".
    const own = phases.find((p) => p.id === scope.phaseId);
    if (own && qualifies(day, own.startDate, own.endDate)) phase = own;
  } else {
    // No phase of its own: the narrowest dated phase that contains the day,
    // a tie to the lower order. A best guess, which is why it is only for
    // items that carry no phase.
    phase = phases
      .filter((p) => qualifies(day, p.startDate, p.endDate))
      .sort((a, b) => phaseSpan(a) - phaseSpan(b) || a.order - b.order)[0];
  }
  if (phase) return asPhase(phase);

  if (qualifies(day, cycle.startDate, cycle.endDate)) {
    return {
      kind: "event",
      cycleId: cycle.id,
      cycleName: cycle.name,
      phaseId: null,
      phaseName: null,
      startDate: cycle.startDate as string,
      endDate: cycle.endDate as string,
    };
  }
  return null;
}

/** The names to put before the weekday: only what `view` doesn't already say. */
function prefixNames(period: ResolvedDayPeriod, view: DayView | undefined): string[] {
  const names: string[] = [];
  const eventShown = Boolean(view?.cycleId && view.cycleId === period.cycleId);
  const phaseShown = Boolean(period.phaseId && view?.phaseId && view.phaseId === period.phaseId);
  // A view scoped to a phase is scoped to that phase's event too.
  if (!eventShown && !phaseShown) names.push(period.cycleName);
  if (period.phaseName && !phaseShown) names.push(period.phaseName);
  return names;
}

/** "Peach Please · Set-up · Wed" — or "Wed" inside a view that already says it. */
export function formatDayLabel(
  day: string | null | undefined,
  mode: DateDisplayMode,
  period: ResolvedDayPeriod | null,
  view?: DayView,
): DateLabel {
  if (!day) {
    return { canonical: "", exact: "Unresolved", weekday: "", visible: "Unresolved", periodAvailable: false };
  }
  const exact = formatExactDate(day);
  const weekday = formatWeekday(day);
  if (mode === "period" && period) {
    return {
      canonical: day,
      exact,
      weekday,
      visible: [...prefixNames(period, view), weekday].join(" · "),
      periodAvailable: true,
    };
  }
  return { canonical: day, exact, weekday, visible: exact, periodAvailable: period !== null };
}

const longHeading = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const longWeekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const shortMonthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * A list or section heading for a day: "Friday, March 5" in exact mode (what
 * the kitchen has always printed), "Friday" in a short period, with any
 * names the view doesn't already say in front of it.
 */
export function formatDayHeading(
  day: string,
  mode: DateDisplayMode,
  period: ResolvedDayPeriod | null,
  view?: DayView,
): string {
  if (mode === "period" && period) {
    return [...prefixNames(period, view), longWeekday.format(atNoon(day))].join(" · ");
  }
  return longHeading.format(atNoon(day));
}

/**
 * A grid column's heading as two short lines. Plain data, so a server page can
 * work it out and hand it to a client component that paints the grid.
 */
export interface DayColumnHeading {
  weekday: string;
  /** Null when the weekday stands alone (inside a short period). */
  date: string | null;
}

/**
 * A grid column heading as two short lines ("Sat" over "Nov 28"), or just
 * the weekday inside a short period: the date line is dropped, since the
 * weekday is the point and a column heading has no room for names.
 */
export function formatDayColumnHeading(
  day: string,
  mode: DateDisplayMode,
  period: ResolvedDayPeriod | null,
): DayColumnHeading {
  const weekday = formatWeekday(day);
  if (mode === "period" && period) return { weekday, date: null };
  return { weekday, date: shortMonthDay.format(atNoon(day)) };
}
