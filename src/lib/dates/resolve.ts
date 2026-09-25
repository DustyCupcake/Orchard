import { z } from "zod";
import { AppError } from "../errors";

export type RelativeBasis = "start" | "end" | "between";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const relativeBasis = z.enum(["start", "end", "between"]);

// The user-facing authoring shape is deliberately small: choose absolute
// or relative, then choose a date. `basis`/`value` are optional escape
// hatches for internal callers that already have a recipe to preserve or
// migrate; ordinary forms submit only `type` and `date`.
export const dateBoundaryInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("absolute"), date: isoDate.nullable() }),
  z
    .object({
      type: z.literal("relative"),
      date: isoDate,
      basis: relativeBasis.optional(),
      value: z.number().int().optional(),
    })
    .refine((v) => (v.basis === undefined) === (v.value === undefined), {
      message: "relative basis and value must be supplied together",
    }),
]);
export type DateBoundaryInput = z.infer<typeof dateBoundaryInput>;

export interface StoredBoundary {
  dateType: "absolute" | "relative";
  /** Authoritative in absolute mode; eagerly cached/resolved in relative mode. */
  date: string | null;
  /** start/end = signed days; between = hundredths of a percent. */
  relativeBasis: RelativeBasis | null;
  relativeValue: number | null;
}

export const EMPTY_BOUNDARY: StoredBoundary = {
  dateType: "absolute",
  date: null,
  relativeBasis: null,
  relativeValue: null,
};

// Plain YYYY-MM-DD day math — Drizzle's date columns round-trip as this
// exact string shape, and every boundary in this shape is a calendar date,
// never an instant. UTC keeps day arithmetic stable across DST.
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

function relativeDate(
  basis: RelativeBasis,
  value: number,
  anchorStart: string | null,
  anchorEnd: string | null,
): StoredBoundary {
  if (basis === "between") {
    if (!anchorStart || !anchorEnd) {
      throw new AppError("A between relationship needs both parent dates");
    }
    if (anchorEnd < anchorStart) {
      throw new AppError("The parent period's end date cannot be before its start date");
    }
    if (value < 0 || value > 10_000) {
      throw new AppError("A between relationship must be between 0 and 100 percent");
    }
    return {
      dateType: "relative",
      date: resolvePercent(anchorStart, anchorEnd, value),
      relativeBasis: "between",
      relativeValue: value,
    };
  }

  const anchorDate = basis === "start" ? anchorStart : anchorEnd;
  if (!anchorDate) {
    throw new AppError(`A relative date based on the ${basis} needs that parent date`);
  }
  return {
    dateType: "relative",
    date: addDays(anchorDate, value),
    relativeBasis: basis,
    relativeValue: value,
  };
}

function inferRelativeDate(date: string, anchorStart: string | null, anchorEnd: string | null): StoredBoundary {
  if (anchorStart && anchorEnd) {
    if (anchorEnd < anchorStart) {
      throw new AppError("The parent period's end date cannot be before its start date");
    }
    if (date < anchorStart) {
      return relativeDate("start", daysBetween(anchorStart, date), anchorStart, anchorEnd);
    }
    if (date > anchorEnd) {
      return relativeDate("end", daysBetween(anchorEnd, date), anchorStart, anchorEnd);
    }
    return relativeDate("between", percentBetween(anchorStart, anchorEnd, date), anchorStart, anchorEnd);
  }

  if (anchorStart) {
    return relativeDate("start", daysBetween(anchorStart, date), anchorStart, anchorEnd);
  }
  if (anchorEnd) {
    return relativeDate("end", daysBetween(anchorEnd, date), anchorStart, anchorEnd);
  }

  throw new AppError("A relative date needs at least one parent boundary date");
}

/** Converts the small authoring input into the canonical stored recipe. */
export function toStoredBoundary(
  input: DateBoundaryInput,
  anchorStart: string | null,
  anchorEnd: string | null,
): StoredBoundary {
  if (input.type === "absolute") {
    return { ...EMPTY_BOUNDARY, dateType: "absolute", date: input.date };
  }

  if (input.basis !== undefined && input.value !== undefined) {
    return relativeDate(input.basis, input.value, anchorStart, anchorEnd);
  }

  return inferRelativeDate(input.date, anchorStart, anchorEnd);
}

/**
 * Editing a relative field should not silently rewrite its recipe when the
 * user only saved the same resolved date again. If a newly supplied parent
 * boundary makes the old recipe non-canonical, normalization still wins.
 */
export function boundaryForEditing(
  existing: StoredBoundary,
  input: DateBoundaryInput,
  anchorStart: string | null,
  anchorEnd: string | null,
): StoredBoundary {
  if (input.type === "relative" && existing.dateType === "relative") {
    const normalizedExisting = normalizeBoundary(existing, anchorStart, anchorEnd);
    if (normalizedExisting.date === input.date) return normalizedExisting;
  }
  return toStoredBoundary(input, anchorStart, anchorEnd);
}

/**
 * Converts a target date to hundredths of a percent. The target is
 * clamped because this helper is also useful when inspecting legacy data;
 * normal authoring never sends an out-of-range target to it.
 */
export function percentBetween(anchorStart: string, anchorEnd: string, target: string): number {
  const span = daysBetween(anchorStart, anchorEnd);
  if (span <= 0) return 0;
  return Math.min(10_000, Math.max(0, Math.round((daysBetween(anchorStart, target) / span) * 10_000)));
}

export function resolvePercent(anchorStart: string | null, anchorEnd: string | null, value: number | null): string | null {
  if (!anchorStart || !anchorEnd || value === null || anchorEnd < anchorStart) return null;
  const span = daysBetween(anchorStart, anchorEnd);
  return addDays(anchorStart, Math.round((span * value) / 10_000));
}

/** Recomputes only the cached date; the recipe itself never changes. */
export function recomputeBoundary(
  boundary: StoredBoundary,
  anchorStart: string | null,
  anchorEnd: string | null,
): StoredBoundary {
  if (boundary.dateType === "absolute") return boundary;
  if (boundary.relativeBasis === "start") {
    return {
      ...boundary,
      date:
        anchorStart && boundary.relativeValue !== null
          ? addDays(anchorStart, boundary.relativeValue)
          : null,
    };
  }
  if (boundary.relativeBasis === "end") {
    return {
      ...boundary,
      date:
        anchorEnd && boundary.relativeValue !== null
          ? addDays(anchorEnd, boundary.relativeValue)
          : null,
    };
  }
  return {
    ...boundary,
    date: resolvePercent(anchorStart, anchorEnd, boundary.relativeValue),
  };
}

/**
 * Re-bases a recipe against the currently known parent span. This is used
 * when the second boundary of a previously one-sided period appears, and
 * by the one-time legacy cleanup for old in-range offsets.
 */
export function normalizeBoundary(
  boundary: StoredBoundary,
  anchorStart: string | null,
  anchorEnd: string | null,
): StoredBoundary {
  if (boundary.dateType === "absolute") return boundary;
  const current = recomputeBoundary(boundary, anchorStart, anchorEnd);
  if (!current.date) return current;

  if (anchorStart && anchorEnd) {
    if (anchorEnd < anchorStart) return current;
    if (current.date < anchorStart) {
      return relativeDate("start", daysBetween(anchorStart, current.date), anchorStart, anchorEnd);
    }
    if (current.date > anchorEnd) {
      return relativeDate("end", daysBetween(anchorEnd, current.date), anchorStart, anchorEnd);
    }
    return relativeDate("between", percentBetween(anchorStart, anchorEnd, current.date), anchorStart, anchorEnd);
  }

  // With one known boundary, the basis is already the only meaningful
  // representation. Keep it stable until the opposite boundary arrives.
  return current;
}

/** Cloning carries the recipe, not the cached/resolved date. */
export function deriveClonedBoundaryRecipe(
  boundary: StoredBoundary,
  sourceCycleStart: string | null,
  sourceCycleEnd: string | null = null,
): StoredBoundary {
  if (boundary.dateType === "relative") {
    return { ...boundary, date: null };
  }
  if (boundary.date && sourceCycleStart) {
    return {
      ...toStoredBoundary({ type: "relative", date: boundary.date }, sourceCycleStart, sourceCycleEnd),
      date: null,
    };
  }
  return { ...EMPTY_BOUNDARY };
}

/** The one direct-edit sanity check shared by Cycle and Phase boundaries. */
export function violatesBoundaryOrder(startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) return false;
  return endDate < startDate;
}
