import { z } from "zod";
import type { EventSlot } from "./crud";

/**
 * A proposal's painted availability, and the slot arithmetic a scheduling
 * owner does on top of it.
 *
 * A proposal no longer names the times it wants. It paints the times it
 * *could* do, and the owner picks a concrete start inside that. That's
 * the difference between "Thursday 15:00" and "Thursday afternoon" —
 * and it's what makes several proposals combinable, since each one
 * carries a range and the owner only has to find one placement per
 * proposal that doesn't collide with the others. With fixed starts, two
 * proposals that could both fit in a shared afternoon still collide
 * unless their authors happened to type matching times.
 *
 * ## Why this file exists at all
 *
 * Every function here is pure arithmetic over instants. That is
 * deliberate and not incidental: the same questions get asked in three
 * places — the editor's "what did I just paint" summary, the owner's
 * review list of candidate placements, and conflict detection — and when
 * they disagreed the result was a programme that claimed two proposals
 * were fine together when they weren't.
 *
 * ## Half-hour cells
 *
 * A cell is 30 minutes, matching Scheduling polls' AvailabilityGrid,
 * because the interaction is meant to feel like that grid. It is NOT
 * copied wholesale: those cells are instants in the *viewer's* zone,
 * because a poll asks "when are you free" about the viewer. These are
 * instants on the *event's* wall clock, because a thing happening at a
 * venue happens where the venue is. Same interaction, different question.
 *
 * `preferred_slots` on the row is now a list of availability windows,
 * each of which may be longer than the proposal's durationMinutes. The
 * column shape didn't change — a window is still {startsAt, endsAt} —
 * which is what keeps every existing proposal valid and readable: a
 * stored single slot is a one-cell-shaped window, i.e. "only this time
 * works". It also means `confirmedSlot` needs no migration or rethink;
 * a confirmation is a concrete placement, which is what it always was.
 */

export const CELL_MINUTES = 30;
const CELL_MS = CELL_MINUTES * 60_000;

/**
 * What PreferredSlotsEditor posts: the ISO instants of every painted
 * cell, absolute and UTC, exactly like a poll's availability
 * submission. Collapsed into windows server-side rather than on the
 * client, so the arithmetic that decides what a painted shape *means*
 * has one home and is testable without a browser.
 */
export const paintedCellsInput = z
  .object({
    cells: z.array(z.string().datetime()),
  })
  .refine((v) => v.cells.length <= 20_000, {
    // 20k cells is a 400-day full-day range; past that the grid is a
    // bug rather than an intent, and an unbounded array is a cheap way
    // to make the owner recompute conflicts over 20k proposals worth of
    // pairs. Not a design limit.
    message: "That is more availability than a programme can hold",
  });
export type PaintedCellsInput = z.infer<typeof paintedCellsInput>;

function toMs(iso: string) {
  return new Date(iso).getTime();
}

function toSlot(startMs: number, endMs: number): EventSlot {
  return { startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() };
}

/**
 * Painted cells -> contiguous availability windows.
 *
 * Cells arrive as unordered absolute instants and go out as runs of
 * touching half-hours. Two behaviours worth naming:
 *
 * - **Duplicates collapse.** A DST fall-back makes two distinct
 *   wall-clock times the same instant, so the grid can legitimately
 *   paint the same cell twice. Storing it twice would inflate every
 *   duration calculation downstream.
 * - **A gap breaks a run.** So a painted 15:00-15:30 and 16:00-16:30
 *   become two windows, not one 90-minute hole. Runs are what the owner
 *   places inside, and a proposal can't be placed across a gap its host
 *   said they were unavailable.
 */
export function collapseCellsToWindows(cells: string[]): EventSlot[] {
  const times = [...new Set(cells.map(toMs))].sort((a, b) => a - b);

  const windows: EventSlot[] = [];
  let runStart: number | null = null;
  let runEnd = 0;

  for (const t of times) {
    if (runStart === null) {
      runStart = t;
      runEnd = t + CELL_MS;
      continue;
    }
    if (t === runEnd) {
      runEnd = t + CELL_MS;
      continue;
    }
    windows.push(toSlot(runStart, runEnd));
    runStart = t;
    runEnd = t + CELL_MS;
  }
  if (runStart !== null) windows.push(toSlot(runStart, runEnd));
  return windows;
}

/**
 * The inverse, for pre-filling a grid from stored windows.
 *
 * Not the exact inverse of collapseCellsToWindows when a window isn't an
 * exact multiple of the cell — a 45-minute window yields one 30-minute
 * cell and the remaining 15 minutes are dropped. That's the right
 * trade: a proposal's availability is authored on the grid, so anything
 * stored is already cell-aligned, and rounding *up* instead would paint
 * a host into time they said they didn't have.
 */
export function expandWindowsToCells(windows: EventSlot[]): string[] {
  const cells: string[] = [];
  for (const w of windows) {
    const start = toMs(w.startsAt);
    const end = toMs(w.endsAt);
    for (let t = start; t + CELL_MS <= end; t += CELL_MS) {
      cells.push(new Date(t).toISOString());
    }
  }
  return [...new Set(cells)].sort();
}

export function windowMinutes(w: EventSlot): number {
  return (toMs(w.endsAt) - toMs(w.startsAt)) / 60_000;
}

/**
 * Every concrete placement of a `durationMinutes`-long session that fits
 * inside the painted availability, on half-hour boundaries.
 *
 * The half-hour grid is the reason this is finite. A 90-minute session
 * inside a 15:00-18:00 window has exactly six possible starts — 15:00,
 * 15:30, 16:00, 16:30, 17:00, and... that's five; there is no sixth,
 * because 17:30 would run past 18:00. The owner's review list shows
 * these, so "several options in there" is visible rather than implied.
 *
 * A window shorter than the duration contributes nothing, which is the
 * right outcome: a host who painted 15:00-15:30 for a two-hour session
 * has not offered that session any placement.
 */
export function candidatePlacements(
  windows: EventSlot[],
  durationMinutes: number,
): EventSlot[] {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];
  const durationMs = durationMinutes * 60_000;
  const placements: EventSlot[] = [];

  for (const w of windows) {
    const start = toMs(w.startsAt);
    const end = toMs(w.endsAt);
    for (let t = start; t + durationMs <= end; t += CELL_MS) {
      placements.push(toSlot(t, t + durationMs));
    }
  }
  return placements;
}

/**
 * The first and last start a `durationMinutes` session can take inside a
 * window, on the same half-hour lattice candidatePlacements walks. A
 * window too short to hold the session is read as the session itself —
 * one fixed placement filling it — which is how a proposal that predates
 * painted availability (a single slot) keeps meaning "only this time".
 */
function startBounds(w: EventSlot, durationMinutes: number): { first: number; last: number; durationMs: number } {
  const start = toMs(w.startsAt);
  const end = toMs(w.endsAt);
  const durationMs = Math.min(durationMinutes * 60_000, end - start);
  const last = start + Math.floor((end - durationMs - start) / CELL_MS) * CELL_MS;
  return { first: start, last, durationMs };
}

/**
 * Whether this pair of windows genuinely forces a clash, given how long
 * each session needs to be.
 *
 * A clash is real only when there is NO way to place both sessions inside
 * their own availability without them overlapping. Overlapping windows
 * alone prove nothing: two proposals that both painted 15:00-17:00 for an
 * hour each overlap completely and can still run back to back.
 *
 * One session either finishes before the other starts or starts after it
 * ends, so it is enough to try the two orderings at their extremes: A
 * as early as it can go with B as late as it can, and the reverse. If
 * neither ordering leaves a gap, no pair of placements does.
 *
 * Worked examples, all one-hour sessions:
 * - 15:00-16:00 vs 16:00-17:00: no overlap, never a clash.
 * - 15:00-17:00 vs 15:00-17:00: A at 15:00, B at 16:00. Not a clash.
 * - 15:00-16:30 vs 15:30-17:00: A at 15:00, B at 16:00. Not a clash.
 * - 15:00-16:00 vs 15:30-16:30: both are pinned, and they overlap by half
 *   an hour. A clash.
 * - 15:00-16:30 vs 15:00-16:30: ninety minutes can't hold two hours.
 *   A clash.
 *
 * This is pairwise, and that's deliberate: the owner places proposals one
 * at a time, and a full interval-graph colouring would be a much larger
 * machine for a case the spec leaves to people ("the scheduler
 * facilitating but not arbitrating by default").
 */
export function windowsForceClash(
  a: EventSlot,
  b: EventSlot,
  durationAMinutes: number,
  durationBMinutes: number,
): boolean {
  if (toMs(a.endsAt) <= toMs(b.startsAt) || toMs(b.endsAt) <= toMs(a.startsAt)) {
    return false;
  }
  const boundsA = startBounds(a, durationAMinutes);
  const boundsB = startBounds(b, durationBMinutes);
  const aThenB = boundsB.last >= boundsA.first + boundsA.durationMs;
  const bThenA = boundsA.last >= boundsB.first + boundsB.durationMs;
  return !aThenB && !bThenA;
}

/**
 * A stretch of time long enough to hold every proposal that's still
 * waiting to be placed, or null when nothing fits them all.
 *
 * This is the question painted availability makes answerable, and it's not
 * the same as the pairwise clash flag: "these two overlap" is a
 * conversation between two hosts, whereas "is there *any* stretch that
 * holds the whole unplaced programme" is what the person with the
 * scheduling task actually needs in front of them.
 *
 * The sweep is deliberately greedy and simple. For each candidate start in
 * time order, try to place every pending proposal back to back from there.
 * For *earliest* such stretch on intervals this is optimal — starting
 * later can only leave less room afterwards, never more — and the owner
 * wants the earliest window they can actually use. It does not attempt a
 * globally optimal programme, and shouldn't: the spec deliberately leaves
 * that to people ("the scheduler facilitating but not arbitrating by
 * default"). This is a starting point they can move, not a verdict.
 *
 * A proposal with no valid placement is skipped rather than counted as a
 * failure. It can't be placed at all, so whether it fits this stretch is
 * not a question — and if it's the only one, returning null would hide the
 * useful fact that it has nowhere to go.
 */
export function commonPlacementWindow(
  proposals: { windows: EventSlot[]; durationMinutes: number }[],
): EventSlot | null {
  const placeable = proposals
    .filter((p) => p.durationMinutes > 0)
    .map((p) => {
      const options = candidatePlacements(p.windows, p.durationMinutes);
      return {
        durationMs: p.durationMinutes * 60_000,
        starts: new Set(options.map((o) => toMs(o.startsAt))),
      };
    })
    .filter((p) => p.starts.size > 0);

  if (placeable.length === 0) return null;

  const allStarts = [...new Set(placeable.flatMap((p) => [...p.starts]))].sort((a, b) => a - b);

  for (const start of allStarts) {
    let cursor = start;
    let fits = true;
    for (const p of placeable) {
      if (!p.starts.has(cursor)) {
        fits = false;
        break;
      }
      cursor += p.durationMs;
    }
    if (fits) {
      return { startsAt: new Date(start).toISOString(), endsAt: new Date(cursor).toISOString() };
    }
  }
  return null;
}

/** Days shown per page of an availability grid. */
export const GRID_WEEK_DAYS = 7;
// An event's own dates entered the wrong way round, or a typo'd year,
// shouldn't be able to ask for an unbounded number of pages.
const MAX_GRID_DAYS = 366;

/**
 * The days an availability grid covers, as YYYY-MM-DD, inclusive of both
 * ends. Empty when the range runs backwards.
 */
export function gridDays(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last && days.length < MAX_GRID_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * The days split into pages of a week, counted from the first day of the
 * event rather than from a calendar Monday — the grid's job is to show the
 * event, and an event that starts on a Thursday shouldn't open on three
 * empty days.
 */
export function gridWeeks(days: string[]): string[][] {
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += GRID_WEEK_DAYS) {
    weeks.push(days.slice(i, i + GRID_WEEK_DAYS));
  }
  return weeks;
}
