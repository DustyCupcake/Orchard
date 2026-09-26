import { describe, expect, it } from "vitest";
import {
  describeBoundaryRecipe,
  describeBoundaryWindow,
  formatDateRange,
  type DescribableBoundary,
} from "@/lib/dates";

/** A boundary with a resolved date — the minimum the prose will describe. */
function recipe(over: Partial<DescribableBoundary> = {}): DescribableBoundary {
  return { dateType: "relative", date: "2027-01-01", relativeBasis: "start", relativeValue: 0, ...over };
}

/** What `EMPTY_BOUNDARY` looks like: absolute, but with no date. */
const UNSET: DescribableBoundary = {
  dateType: "absolute",
  date: null,
  relativeBasis: null,
  relativeValue: null,
};

describe("describeBoundaryRecipe", () => {
  it("says 'before' for a negative offset and 'after' for a positive one, never a sign", () => {
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "start", relativeValue: -4 }))).toBe(
      "4 days before the event starts",
    );
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "start", relativeValue: 4 }))).toBe(
      "4 days after the event starts",
    );
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "end", relativeValue: -2 }))).toBe(
      "2 days before the event ends",
    );
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "end", relativeValue: 7 }))).toBe(
      "7 days after the event ends",
    );
  });

  it("agrees on one day rather than printing '1 day(s)'", () => {
    expect(describeBoundaryRecipe(recipe({ relativeValue: 1 }))).toBe("1 day after the event starts");
    expect(describeBoundaryRecipe(recipe({ relativeValue: -1 }))).toBe("1 day before the event starts");
  });

  // 0% and 100% are not "the start" and "the end" of anything — a
  // `between` at 0 is just the parent's first day. inferRelativeDate
  // compares strictly, so a phase beginning on the event's first day
  // really is stored this way.
  it("never prints 0% or 100%, and says which day those actually are", () => {
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 0 }))).toBe(
      "on the event’s first day",
    );
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 10_000 }))).toBe(
      "on the event’s last day",
    );
  });

  it("clamps a sub-percent figure rather than rounding it onto an edge", () => {
    // A year-long cycle puts a single day at ~27 hundredths of a percent.
    // That is NOT the event's first day, and must not round onto "0%".
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 27 }))).toBe(
      "1% of the way through the event",
    );
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 9_973 }))).toBe(
      "99% of the way through the event",
    );
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 4_667 }))).toBe(
      "47% of the way through the event",
    );
  });

  it("reads a genuine proportion as a whole percent", () => {
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 5_000 }))).toBe(
      "50% of the way through the event",
    );
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 1 }))).toBe(
      "1% of the way through the event",
    );
  });

  // Two stored recipes, one day: a zero offset and a 0% proportion are
  // the same instant and must not read differently.
  it("gives a zero offset the same words as the equivalent 0%/100% edge", () => {
    const zeroStart = describeBoundaryRecipe(recipe({ relativeBasis: "start", relativeValue: 0 }));
    const zeroEnd = describeBoundaryRecipe(recipe({ relativeBasis: "end", relativeValue: 0 }));
    expect(zeroStart).toBe(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 0 })));
    expect(zeroEnd).toBe(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 10_000 })));
    expect(zeroStart).toBe("on the event’s first day");
    expect(zeroEnd).toBe("on the event’s last day");
  });

  it("keeps a deliberate absolute date distinct from an unset one", () => {
    expect(describeBoundaryRecipe(recipe({ dateType: "absolute", date: "2027-04-01" }))).toBe(
      "a date you set by hand",
    );
    // EMPTY_BOUNDARY is itself `dateType: "absolute"` — only the missing
    // date tells "nobody has set this" apart from a decision.
    expect(describeBoundaryRecipe(UNSET)).toBeNull();
    expect(describeBoundaryRecipe(recipe({ date: null, relativeBasis: null, relativeValue: null }))).toBeNull();
  });

  it("names the parent it was given, not a hardcoded 'event'", () => {
    expect(describeBoundaryRecipe(recipe({ relativeBasis: "between", relativeValue: 0 }), "the phase")).toBe(
      "on the phase’s first day",
    );
    expect(describeBoundaryRecipe(recipe({ relativeValue: -3 }), "the phase")).toBe(
      "3 days before the phase starts",
    );
  });
});

describe("describeBoundaryWindow", () => {
  it("states both edges in one sentence, each clause self-contained", () => {
    expect(
      describeBoundaryWindow(
        recipe({ relativeBasis: "between", relativeValue: 0 }),
        recipe({ relativeBasis: "end", relativeValue: -3 }),
      ),
    ).toBe("Starts on the event’s first day, ends 3 days before the event ends.");
  });

  it("says which half is missing rather than gluing a hole into a sentence", () => {
    const known = recipe({ relativeBasis: "start", relativeValue: 0 });
    expect(describeBoundaryWindow(known, UNSET)).toBe(
      "Starts on the event’s first day. The end isn’t set yet.",
    );
    expect(describeBoundaryWindow(UNSET, known)).toBe("Ends on the event’s first day. The start isn’t set yet.");
    expect(describeBoundaryWindow(UNSET, UNSET)).toBe("No dates set yet.");
  });
});

describe("formatDateRange", () => {
  it("carries a shared year once", () => {
    expect(formatDateRange("2027-09-01", "2027-09-14")).toBe("Sep 1 – Sep 14, 2027");
  });

  it("repeats the year across a range that spans one", () => {
    expect(formatDateRange("2026-12-28", "2027-01-04")).toBe("Dec 28, 2026 – Jan 4, 2027");
  });

  it("prints only the half it knows", () => {
    expect(formatDateRange("2027-09-01", null)).toBe("Sep 1, 2027 – ");
    expect(formatDateRange(null, "2027-09-14")).toBe(" – Sep 14, 2027");
    expect(formatDateRange(null, null)).toBe("No dates set");
  });
});
