import type { ReactNode } from "react";
import { formatWeekday, instantFromZoned, localDateInZone } from "@/lib/dates";

/**
 * The shift views on /shifts: the chronological, day-split list, the
 * day-columns calendar, and the standing schedule — plus the pure logic they
 * read. The page loads the rows; these functions group, filter and place
 * them, so the views' behaviour is testable without a database.
 *
 * Days are the 6am–6am convention the programme availability grid uses
 * (src/lib/event-scheduling/availability.ts — "a session at 01:00 belongs
 * to the evening before it"): a shift that starts in 00:00–06:00 belongs
 * to the previous day. Positions inside a day are *offsets*: minutes since
 * that day's 06:00 on the venue clock. The calendar and the time filter work
 * in offsets, never in absolute instants, so every day column shares one
 * time-of-day axis. Everything in one scope (an event, or Standing) reads on
 * that scope's clock, so a row's day, offsets and times never disagree.
 */

/** The minute of the clock a day begins at: 06:00. */
export const DAY_START_MINUTES = 6 * 60;
const MINUTES_PER_DAY = 24 * 60;
/** The calendar's row height in minutes — the programme grid's, too. */
export const AXIS_STEP_MINUTES = 30;

/** A shift as the views render and filter it. */
export interface ShiftViewRow {
  /** The occurrence's id — its identity in the views. */
  id: string;
  seriesId: string;
  /** The series' placement: an event roster, or standing (null). */
  cycleId: string | null;
  title: string;
  description: string | null;
  branchId: string | null;
  branchName: string | null;
  /** The series' tags — the tag filter reads these. */
  tags: string[];
  /** The effective capacity: the occurrence's own number, else the series' default. */
  capacity: number;
  /** How many sign-ups the occurrence has right now. */
  signups: number;
  /** The occurrence's start and end — ISO strings. */
  startsAt: string;
  endsAt: string;
  /** The shift's time, already worded for the viewer (DayLabeler.shiftRange). */
  when: string;
  /** The shift's 6am–6am day: startsAt read on the venue clock, minus six hours. */
  day: string;
  /** Minutes from that day's 06:00 to the shift's start and end. */
  startOffset: number;
  endOffset: number;
  /** The shift's start and end on the venue clock, as "HH:MM". */
  startTime: string;
  endTime: string;
  iAmSignedUp: boolean;
  signupsOpen: boolean;
  /** The row's action cluster (Sign up / Withdraw / not-open-yet) — server-rendered forms. */
  actions: ReactNode;
}

export interface ShiftViewFilters {
  /** Tags a shift must have any of; empty = every shift. */
  tags: string[];
  /** The branchId a shift must be on; null = any branch. */
  branchId: string | null;
  /** From/To on the shift's 6am–6am day — both null = every day. */
  from: string | null;
  to: string | null;
  /** From/To times, as "HH:MM" on the venue clock. */
  timeFrom: string | null;
  timeTo: string | null;
}

export const NO_FILTERS: ShiftViewFilters = {
  tags: [],
  branchId: null,
  from: null,
  to: null,
  timeFrom: null,
  timeTo: null,
};

/** "09:30" → 570, the minutes since 00:00. A missing parse reads as 00:00. */
function wallMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** A clock time as an offset into the 6am–6am day: "06:00" → 0, "01:00" → 1140. */
export function offsetOfClock(hhmm: string): number {
  return (wallMinutes(hhmm) - DAY_START_MINUTES + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** An offset as the clock reads it: 0 → "06:00", 1140 → "01:00". */
export function clockOfOffset(offset: number): string {
  const total = (((offset + DAY_START_MINUTES) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function shiftMatchesFilters(row: ShiftViewRow, filters: ShiftViewFilters): boolean {
  if (filters.tags.length > 0 && !filters.tags.some((t) => row.tags.includes(t))) return false;
  if (filters.branchId !== null && row.branchId !== filters.branchId) return false;
  if (filters.from !== null && row.day < filters.from) return false;
  if (filters.to !== null && row.day > filters.to) return false;
  // A time filter matches when the shift's [start, end) overlaps [from, to),
  // read as offsets in the 6am–6am day, so a 22:00–01:00 shift is "late" and
  // the small hours sort after the evening rather than before the morning.
  // A "To" of 06:00 means the end of the day, not its start.
  const fromOffset = filters.timeFrom !== null ? offsetOfClock(filters.timeFrom) : null;
  let toOffset = filters.timeTo !== null ? offsetOfClock(filters.timeTo) : null;
  if (toOffset === 0) toOffset = MINUTES_PER_DAY;
  if (fromOffset !== null && row.endOffset <= fromOffset) return false;
  if (toOffset !== null && row.startOffset >= toOffset) return false;
  return true;
}

export interface DayGroup {
  day: string;
  label: string;
  rows: ShiftViewRow[];
}

/**
 * The chronological grouping of a day-split list: days ascending (a
 * string compare of YYYY-MM-DD is chronological), each day's rows sorted
 * by start time. The label is the day's, as the viewer reads it.
 */
export function groupShiftsByDay(rows: ShiftViewRow[], dayLabelByDay: Record<string, string>): DayGroup[] {
  const byDay = new Map<string, ShiftViewRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }
  return [...byDay.keys()].sort().map((day) => ({
    day,
    label: dayLabelByDay[day] ?? day,
    rows: byDay.get(day)!.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
  }));
}

/**
 * A shift's 6am–6am day: the instant minus six hours, read as the calendar
 * date in the venue's zone — the day a shift starting 00:00–06:00 lands on
 * the previous day, the same boundary the programme grid uses.
 */
export function shiftDay(timeZone: string, startsAt: Date): string {
  return localDateInZone(new Date(startsAt.getTime() - 6 * 60 * 60_000).toISOString(), timeZone);
}

/**
 * A shift's day and its start/end as minutes after that day's 06:00 on the
 * venue clock. Measured against the real instant of 06:00, so a shift ending
 * after the next 06:00 simply has an end offset past 1440.
 */
export function shiftOffsets(
  timeZone: string,
  startsAt: Date,
  endsAt: Date,
): { day: string; startOffset: number; endOffset: number } {
  const day = shiftDay(timeZone, startsAt);
  const dayStart = instantFromZoned(`${day}T06:00`, timeZone).getTime();
  return {
    day,
    startOffset: Math.round((startsAt.getTime() - dayStart) / 60_000),
    endOffset: Math.round((endsAt.getTime() - dayStart) / 60_000),
  };
}

/** Add `n` days to a "YYYY-MM-DD" string. */
export function addDaysToDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` ("YYYY-MM-DD" strings). */
function dayGap(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** The calendar's page of days: `start` plus the next `count - 1`. */
export function calendarWindowDays(start: string, count: number): string[] {
  const out = [start];
  for (let i = 1; i < count; i++) out.push(addDaysToDay(start, i));
  return out;
}

/**
 * How many day-columns the calendar can show at a width: one on a phone, two
 * on a tablet, three on a desktop — each column needs room for its lanes.
 */
export function daysPerPageForWidth(width: number): number {
  if (width < 640) return 1;
  if (width < 1024) return 2;
  return 3;
}

/** The most lanes a day column shows side by side before the rest fold into "+N more". */
export function maxLanesForDays(daysPerPage: number): number {
  return daysPerPage <= 1 ? 3 : 2;
}

/** The shifts in the window's day-columns — one bucket per column day. */
export function shiftsByWindowDay(rows: ShiftViewRow[], windowDays: string[]): Map<string, ShiftViewRow[]> {
  const byDay = new Map<string, ShiftViewRow[]>();
  for (const row of rows) {
    if (!windowDays.includes(row.day)) continue;
    const list = byDay.get(row.day) ?? [];
    list.push(row);
    byDay.set(row.day, list);
  }
  return byDay;
}

/**
 * The time-of-day span the calendar draws: the earliest start through the
 * latest end across the shifts in the window, widened to whole half-hours and
 * held inside the 6am–6am day. One axis, shared by every column.
 */
export function calendarAxis(rows: ShiftViewRow[]): { fromOffset: number; toOffset: number } | null {
  if (rows.length === 0) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const r of rows) {
    from = Math.min(from, r.startOffset);
    to = Math.max(to, r.endOffset);
  }
  from = Math.max(0, Math.floor(from / AXIS_STEP_MINUTES) * AXIS_STEP_MINUTES);
  to = Math.min(MINUTES_PER_DAY, Math.ceil(to / AXIS_STEP_MINUTES) * AXIS_STEP_MINUTES);
  if (to <= from) to = Math.min(MINUTES_PER_DAY, from + AXIS_STEP_MINUTES);
  return { fromOffset: from, toOffset: to };
}

export interface LaneInput {
  id: string;
  start: number;
  end: number;
  /** Tie-break for blocks that start together (the series title). */
  order?: string;
}

export interface LanePlacement {
  /** Which lane, from the left. */
  lane: number;
  /** How many lanes the block's overlapping cluster shares (chip lane included). */
  lanes: number;
}

export interface OverflowChip extends LanePlacement {
  start: number;
  end: number;
  /** The ids of the blocks folded into the chip. */
  ids: string[];
}

/**
 * Side-by-side lanes for overlapping blocks, the way a calendar lays out a
 * crowded day. Blocks that overlap, directly or through a chain of other
 * blocks, form a cluster that shares the column's width; inside a cluster
 * each block takes the first lane that is free when it starts. Order is
 * deterministic: start, then the longer block, then `order`, then id.
 *
 * A cluster that needs more than `maxLanes` lanes keeps `maxLanes - 1` of
 * them and folds the rest into one chip in the last lane, covering the span
 * of the folded blocks.
 */
export function assignLanes(
  blocks: LaneInput[],
  maxLanes: number,
): { placements: Map<string, LanePlacement>; chips: OverflowChip[] } {
  const cap = Math.max(2, Math.floor(maxLanes));
  const sorted = blocks
    .map((b) => ({ ...b, end: Math.max(b.end, b.start + 1) }))
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.end - a.end ||
        (a.order ?? "").localeCompare(b.order ?? "") ||
        a.id.localeCompare(b.id),
    );

  const placements = new Map<string, LanePlacement>();
  const chips: OverflowChip[] = [];

  let i = 0;
  while (i < sorted.length) {
    // One cluster: keep adding blocks while they start before the cluster's end.
    const cluster: (typeof sorted)[number][] = [];
    let clusterEnd = -Infinity;
    while (i < sorted.length && (cluster.length === 0 || sorted[i].start < clusterEnd)) {
      cluster.push(sorted[i]);
      clusterEnd = Math.max(clusterEnd, sorted[i].end);
      i++;
    }

    const laneEnds: number[] = [];
    const rawLane = new Map<string, number>();
    for (const b of cluster) {
      let lane = laneEnds.findIndex((end) => end <= b.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(b.end);
      } else {
        laneEnds[lane] = b.end;
      }
      rawLane.set(b.id, lane);
    }

    if (laneEnds.length <= cap) {
      for (const b of cluster) placements.set(b.id, { lane: rawLane.get(b.id)!, lanes: laneEnds.length });
      continue;
    }

    const hidden = cluster.filter((b) => rawLane.get(b.id)! >= cap - 1);
    for (const b of cluster) {
      if (rawLane.get(b.id)! < cap - 1) placements.set(b.id, { lane: rawLane.get(b.id)!, lanes: cap });
    }
    chips.push({
      lane: cap - 1,
      lanes: cap,
      start: Math.min(...hidden.map((b) => b.start)),
      end: Math.max(...hidden.map((b) => b.end)),
      ids: hidden.map((b) => b.id),
    });
  }

  return { placements, chips };
}

/** Tags as stored on a series: trimmed, lowercased, empty ones dropped, de-duplicated. */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** The form's comma-separated tags field → the tags stored on a series, so "Cooking" and "cooking" are one filter. */
export function parseTags(value: string | null | undefined): string[] {
  return normalizeTags(String(value ?? "").split(","));
}

// --- Scopes: the tabs of /shifts ------------------------------------------

export const STANDING_SCOPE_KEY = "standing";

/** One tab of /shifts: an event's roster, or the standing series. */
export interface ShiftScope {
  /** The event's id, or STANDING_SCOPE_KEY. */
  key: string;
  label: string;
  kind: "event" | "standing";
  /** When this scope's next shift starts (ISO), or null when it has none upcoming. */
  nextStartsAt: string | null;
}

/**
 * The tab order: events by their next shift (soonest first, those with none
 * after), then Standing last.
 */
export function orderScopes(scopes: ShiftScope[]): ShiftScope[] {
  const events = scopes
    .filter((s) => s.kind === "event")
    .sort((a, b) => {
      if (a.nextStartsAt === null && b.nextStartsAt === null) return a.label.localeCompare(b.label);
      if (a.nextStartsAt === null) return 1;
      if (b.nextStartsAt === null) return -1;
      return a.nextStartsAt.localeCompare(b.nextStartsAt) || a.label.localeCompare(b.label);
    });
  return [...events, ...scopes.filter((s) => s.kind === "standing")];
}

/**
 * Which scope the page shows: the requested one when it exists, else the
 * event whose next shift is soonest, else Standing, else whatever is left.
 */
export function resolveScope(requested: string | undefined, scopes: ShiftScope[]): ShiftScope | null {
  const ordered = orderScopes(scopes);
  const asked = requested ? ordered.find((s) => s.key === requested) : undefined;
  if (asked) return asked;
  return (
    ordered.find((s) => s.kind === "event" && s.nextStartsAt !== null) ??
    ordered.find((s) => s.kind === "standing") ??
    ordered[0] ??
    null
  );
}

// --- The standing schedule -------------------------------------------------

export interface SeriesGroup {
  seriesId: string;
  /** The series' upcoming shifts, soonest first. */
  rows: ShiftViewRow[];
}

/** Upcoming shifts grouped per series, the series with the soonest next shift first. */
export function groupRowsBySeries(rows: ShiftViewRow[]): SeriesGroup[] {
  const bySeries = new Map<string, ShiftViewRow[]>();
  for (const row of rows) {
    const list = bySeries.get(row.seriesId) ?? [];
    list.push(row);
    bySeries.set(row.seriesId, list);
  }
  return [...bySeries.entries()]
    .map(([seriesId, list]) => ({
      seriesId,
      rows: list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    }))
    .sort(
      (a, b) =>
        new Date(a.rows[0].startsAt).getTime() - new Date(b.rows[0].startsAt).getTime() ||
        a.rows[0].title.localeCompare(b.rows[0].title),
    );
}

/**
 * A line for a regular series — "Weekly on Tue · 18:00–20:00" or "Every
 * other Tue · …" — or null when the shifts aren't a plain rhythm (fewer than
 * two, different times, or uneven gaps).
 */
export function describeSeriesPattern(rows: ShiftViewRow[]): string | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted[0];
  if (sorted.some((r) => r.startTime !== first.startTime || r.endTime !== first.endTime)) return null;
  const gap = dayGap(sorted[0].day, sorted[1].day);
  if (gap !== 7 && gap !== 14) return null;
  for (let i = 1; i < sorted.length; i++) {
    if (dayGap(sorted[i - 1].day, sorted[i].day) !== gap) return null;
  }
  const weekday = formatWeekday(first.day);
  const times = `${first.startTime}–${first.endTime}`;
  return gap === 7 ? `Weekly on ${weekday} · ${times}` : `Every other ${weekday} · ${times}`;
}
