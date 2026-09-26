import type { StoredBoundary } from "./resolve";

/** The four fields a boundary's prose can be read from, and no more. */
export type DescribableBoundary = Pick<StoredBoundary, "dateType" | "date" | "relativeBasis" | "relativeValue">;

/**
 * Reads a stored boundary recipe out loud, or returns `null` for a
 * boundary that isn't set.
 *
 * `date` is a required input rather than an optional extra, and that is
 * the whole reason this takes a normalized shape: **an unset boundary
 * looks absolute.** `EMPTY_BOUNDARY` is `{ dateType: "absolute", date:
 * null }`, so "a date you set by hand" and "nobody has set one" are the
 * same three recipe fields and can only be told apart by the resolved
 * date. Passing the recipe alone would confidently report "a date you set
 * by hand" about a phase that has no end date at all.
 *
 * The stored shape is machinery — a signed day count against one edge, or
 * hundredths of a percent through the whole span — and printing it raw
 * tells a reader nothing ("-4 day(s) from the event's start", "0% of the
 * way through the event"). Everything below exists because the number is
 * a poor description of the thing it points at:
 *
 *  - **A negative offset is "before", a positive one is "after."** The
 *    sign is carried by the word, so a reader never has to read a minus
 *    sign as a direction, and no caller prints a raw signed number.
 *  - **A proportion is never printed as 0% or 100%.** Those aren't "the
 *    start" and "the end" of anything — they're just the first and last
 *    day of the parent period, which the edge sentences say far better
 *    anyway. This case is not exotic: `inferRelativeDate` compares
 *    strictly, so a phase beginning on the event's *first* day is stored
 *    as a `between` at 0, and `normalizeBoundary` re-bases to one every
 *    time the parent span changes.
 *  - **Zero days from an edge is the edge itself.** Same reasoning, and
 *    it's the same sentence the two ends of a percentage collapse to, so
 *    two different stored recipes for one day read identically.
 *
 * The percent is rounded to a whole number, then **clamped into 1–99** so
 * the rounding can never walk a real proportion back out onto 0% or 100%.
 * Rounding alone would conflate "0.01% of the way in" with "the first
 * day", which is a different claim and a false one — the two edges are
 * recognized by their stored value being exactly 0 or exactly 10000, not
 * by what they round to. A figure smaller than a percent is still only
 * the best whole-percent description available, and the exact date is
 * never in doubt: it's stored alongside the recipe and callers print it
 * separately.
 */
export function describeBoundaryRecipe(boundary: DescribableBoundary, parent = "the event"): string | null {
  if (!boundary.date) return null;
  if (boundary.dateType === "absolute") return "a date you set by hand";

  const { relativeBasis: basis, relativeValue: value } = boundary;
  if (basis === null || value === null) return null;

  if (basis === "between") {
    if (value <= 0) return `on ${parent}’s first day`;
    if (value >= 10_000) return `on ${parent}’s last day`;
    const percent = Math.min(99, Math.max(1, Math.round(value / 100)));
    return `${percent}% of the way through ${parent}`;
  }

  if (value === 0) return `on ${parent}’s ${basis === "start" ? "first" : "last"} day`;

  const count = Math.abs(value);
  const days = `${count} ${count === 1 ? "day" : "days"}`;
  return `${days} ${value < 0 ? "before" : "after"} ${parent} ${basis === "start" ? "starts" : "ends"}`;
}

/**
 * A whole window in one sentence. Each clause is self-contained rather
 * than elided with a pronoun, because someone scanning a list of phases
 * shouldn't have to remember the clause above to read the one below.
 */
export function describeBoundaryWindow(
  start: DescribableBoundary,
  end: DescribableBoundary,
  parent = "the event",
): string {
  const from = describeBoundaryRecipe(start, parent);
  const to = describeBoundaryRecipe(end, parent);
  if (from && to) return `Starts ${from}, ends ${to}.`;
  if (from) return `Starts ${from}. The end isn’t set yet.`;
  if (to) return `Ends ${to}. The start isn’t set yet.`;
  return "No dates set yet.";
}
