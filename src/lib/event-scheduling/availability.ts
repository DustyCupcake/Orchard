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
 * The largest single stretch of `outer` that doesn't intersect `blocker`,
 * in MINUTES — the unit the durations this is compared against are in.
 * When they don't overlap at all, that's simply `outer`'s own length.
 *
 * The minute conversion is the whole subtlety here. These are timestamp
 * differences, so without the division this returns ~1,800,000 for an
 * hour of slack, and every comparison against a duration in minutes then
 * passes trivially — which reads as "nothing ever conflicts", silently,
 * because the code still typechecks and still runs.
 */
function freeMinutes(outer: EventSlot, blocker: EventSlot): number {
  const outerStart = toMs(outer.startsAt);
  const outerEnd = toMs(outer.endsAt);
  const blockStart = toMs(blocker.startsAt);
  const blockEnd = toMs(blocker.endsAt);

  if (blockEnd <= outerStart || blockStart >= outerEnd) {
    return windowMinutes(outer);
  }
  const beforeMs = Math.min(outerEnd, blockStart) - outerStart;
  const afterMs = outerEnd - Math.max(outerStart, blockEnd);
  return Math.max(0, Math.max(beforeMs, afterMs)) / 60_000;
}

/**
 * Whether this pair of windows genuinely forces a clash, given how long
 * each session needs to be.
 *
 * The old check was `slotsOverlap(a, b)` — plain overlap. That was
 * correct when a slot *was* the placement, because overlap then meant
 * the same moment twice. It is wrong now that a window is a range of
 * options: two proposals painted 15:00-16:00 and 15:30-16:30 are both
 * one hour and can perfectly well run back to back, so flagging them as
 * conflicting would tell the owner to go and negotiate a clash that
 * doesn't exist.
 *
 * So overlap is necessary but not sufficient. A clash is real when the
 * windows overlap AND neither session can dodge the other inside its own
 * availability — i.e. neither has a long enough clear stretch left.
 *
 * Worked examples, all one-hour sessions:
 * - 15:00-16:00 vs 16:00-17:00 — no overlap, never a clash.
 * - 15:00-16:00 vs 15:30-16:30 — overlap, but A has a clear 15:00-15:30
 *   (30 min, too short) ... A's free stretch is [15:00,15:30] = 30 min,
 *   short. B's is [16:00,16:30] = 30 min, short. So this IS a clash —
 *   correctly, because one hour each cannot both fit in a shared hour and
 *   a half.
 * - 15:00-16:30 vs 15:30-17:00 — A's clear stretch is 15:00-15:30 (30m),
 *   short; B's is 16:30-17:00 (30m), short. Clash. Also correct: one
 *   hour each inside a shared 90 minutes leaves only 30 minutes of slack.
 * - 15:00-17:00 vs 15:30-16:00 — A can dodge (clear 15:00-15:30 plus
 *   16:00-17:00; the largest single stretch is 16:00-17:00 = 60m, enough).
 *   Not a clash, correctly: A goes at 16:00.
 *
 * Note this is pairwise, and pairwise is the right granularity here —
 * the owner places proposals one at a time against what's already
 * confirmed, and a full interval-graph colouring would be a much larger
 * machine for a case the spec explicitly leaves to people ("the
 * scheduler facilitating but not arbitrating by default").
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
  return freeMinutes(a, b) < durationAMinutes && freeMinutes(b, a) < durationBMinutes;
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