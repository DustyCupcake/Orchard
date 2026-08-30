import { z } from "zod";

// The shared absolute/relative date shape — see docs/spec.md's "Absolute"
// and "Relative" (under Phase/Cycle) and docs/development-plan.md's
// Phase 39. One boundary (a Phase's start, or its end) is either:
//   - absolute: a hand-typed date, or explicitly unset (null) — carries
//     no anchor information at all.
//   - relative, offset mode: a signed day count from one of the anchor's
//     two boundaries, submitted either as the offset itself (typed
//     directly) or as a target date to recompute the offset from (the
//     "drag it to a new date" path — spec: what's actually persisted is
//     always a recomputed offset/percent, never a bare date).
//   - relative, percent mode: 0–100% of the way between the anchor's two
//     boundaries, submitted the same two ways.
export const dateBoundaryInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("absolute"), date: z.string().min(1).nullable() }),
  z
    .object({
      type: z.literal("relative_offset"),
      anchor: z.enum(["cycle_start", "cycle_end"]),
      offsetDays: z.number().int().optional(),
      targetDate: z.string().min(1).optional(),
    })
    .refine((v) => v.offsetDays !== undefined || v.targetDate !== undefined, {
      message: "relative_offset needs either offsetDays or targetDate",
    }),
  z
    .object({
      type: z.literal("relative_percent"),
      percent: z.number().int().min(0).max(100).optional(),
      targetDate: z.string().min(1).optional(),
    })
    .refine((v) => v.percent !== undefined || v.targetDate !== undefined, {
      message: "relative_percent needs either percent or targetDate",
    }),
]);
export type DateBoundaryInput = z.infer<typeof dateBoundaryInput>;

// The column group a boundary resolves to — matches Phase's own
// start_*/end_* columns (and, by design, whatever shape Task milestone
// and CalendarEvent end up reusing this against).
export interface StoredBoundary {
  dateType: "absolute" | "relative";
  date: string | null; // authoritative in absolute mode; cached/resolved in relative mode
  relativeMode: "offset" | "percent" | null;
  offsetAnchor: "cycle_start" | "cycle_end" | null;
  offsetDays: number | null;
  percent: number | null;
}

export const EMPTY_BOUNDARY: StoredBoundary = {
  dateType: "absolute",
  date: null,
  relativeMode: null,
  offsetAnchor: null,
  offsetDays: null,
  percent: null,
};

// Plain YYYY-MM-DD day math — Drizzle's `date` columns round-trip as
// this exact string shape (see src/lib/attention/job.ts's own note),
// and every boundary in this shape is a calendar date, never a instant,
// so this is done in UTC to avoid DST-related off-by-one drift.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00.000Z`).getTime();
  const b = new Date(`${to}T00:00:00.000Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// Converts a validated DateBoundaryInput into stored columns, resolving
// the cached `date` immediately against the given anchor Cycle dates
// (either or both may be null — the anchor is "missing," not zero; see
// docs/spec.md's "Event window" — a boundary that can't resolve yet
// just gets a null cached date, not an error).
export function toStoredBoundary(
  input: DateBoundaryInput,
  anchorStart: string | null,
  anchorEnd: string | null,
): StoredBoundary {
  if (input.type === "absolute") {
    return { ...EMPTY_BOUNDARY, dateType: "absolute", date: input.date };
  }

  if (input.type === "relative_offset") {
    const anchorDate = input.anchor === "cycle_start" ? anchorStart : anchorEnd;
    const offsetDays =
      input.offsetDays !== undefined
        ? input.offsetDays
        : anchorDate && input.targetDate
          ? daysBetween(anchorDate, input.targetDate)
          : null;
    return {
      dateType: "relative",
      date: offsetDays !== null && anchorDate ? addDays(anchorDate, offsetDays) : null,
      relativeMode: "offset",
      offsetAnchor: input.anchor,
      offsetDays,
      percent: null,
    };
  }

  // relative_percent
  const percent =
    input.percent !== undefined
      ? input.percent
      : anchorStart && anchorEnd && input.targetDate
        ? percentBetween(anchorStart, anchorEnd, input.targetDate)
        : null;
  return {
    dateType: "relative",
    date: resolvePercent(anchorStart, anchorEnd, percent),
    relativeMode: "percent",
    offsetAnchor: null,
    offsetDays: null,
    percent,
  };
}

function percentBetween(anchorStart: string, anchorEnd: string, target: string): number {
  const span = daysBetween(anchorStart, anchorEnd);
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((daysBetween(anchorStart, target) / span) * 100)));
}

function resolvePercent(
  anchorStart: string | null,
  anchorEnd: string | null,
  percent: number | null,
): string | null {
  if (!anchorStart || !anchorEnd || percent === null) return null;
  const span = daysBetween(anchorStart, anchorEnd);
  return addDays(anchorStart, Math.round((span * percent) / 100));
}

// Recomputes a boundary's cached `date` against (possibly new) anchor
// dates, without changing its mode/anchor/offset/percent recipe — used
// when the anchor Cycle's own start_date/end_date move and every
// relative Phase boundary under it needs to track along. Absolute
// boundaries are untouched (they carry no anchor relationship at all).
export function recomputeBoundary(
  boundary: StoredBoundary,
  anchorStart: string | null,
  anchorEnd: string | null,
): StoredBoundary {
  if (boundary.dateType === "absolute") return boundary;
  if (boundary.relativeMode === "offset") {
    const anchorDate = boundary.offsetAnchor === "cycle_start" ? anchorStart : anchorEnd;
    return {
      ...boundary,
      date: anchorDate && boundary.offsetDays !== null ? addDays(anchorDate, boundary.offsetDays) : null,
    };
  }
  return { ...boundary, date: resolvePercent(anchorStart, anchorEnd, boundary.percent) };
}

// The soft "drifted closer to the other boundary" flag — see
// docs/spec.md's "A soft check worth having, not yet a hard one."
// Offset-mode only: percent-mode items are defined against both ends
// at once and scale automatically, so they're structurally immune.
export function isBoundaryDrifted(
  boundary: StoredBoundary,
  anchorStart: string | null,
  anchorEnd: string | null,
): boolean {
  if (boundary.dateType !== "relative" || boundary.relativeMode !== "offset") return false;
  if (!boundary.date || !anchorStart || !anchorEnd) return false;
  const distToStart = Math.abs(daysBetween(boundary.date, anchorStart));
  const distToEnd = Math.abs(daysBetween(boundary.date, anchorEnd));
  const closerTo = distToStart <= distToEnd ? "cycle_start" : "cycle_end";
  return closerTo !== boundary.offsetAnchor;
}

// "Cloning carries the recipe, not the date" — docs/spec.md's own
// heading. A relative boundary's recipe (mode/anchor/offset-or-percent)
// carries forward as-is — its cached `date` is dropped here and
// recomputed fresh once the new Cycle gets its own dates (see
// recomputeBoundary, called elsewhere once those are known). An
// absolute boundary doesn't carry a bare date across a clone (a new
// cycle's "opening day" isn't the old one's); instead it's converted
// into a derived offset recipe (mode offset, anchor cycle_start)
// measured against the *source* cycle's own start_date, so even a
// cycle that was never relatively-dated still produces a usable
// recommendation on its next clone. Un-derivable (no source start_date,
// or the boundary was never set at all) falls back to a fully unset
// boundary — the same "dates don't carry across a clone" behavior this
// codebase had before Phase 39.
export function deriveClonedBoundaryRecipe(
  boundary: StoredBoundary,
  sourceCycleStart: string | null,
): StoredBoundary {
  if (boundary.dateType === "relative") {
    return { ...boundary, date: null };
  }
  if (boundary.date && sourceCycleStart) {
    return {
      dateType: "relative",
      date: null,
      relativeMode: "offset",
      offsetAnchor: "cycle_start",
      offsetDays: daysBetween(sourceCycleStart, boundary.date),
      percent: null,
    };
  }
  return { ...EMPTY_BOUNDARY };
}

// "An end can't resolve before its own start" — docs/spec.md's one
// defined sanity check, applied here to a direct edit of one pair
// (a Phase's own start/end, or a Cycle's own start_date/end_date).
// Only meaningful when both sides actually resolve to something.
export function violatesBoundaryOrder(startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) return false;
  return endDate < startDate;
}
