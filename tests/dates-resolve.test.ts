import { describe, expect, it } from "vitest";
import {
  addDays,
  boundaryForEditing,
  daysBetween,
  deriveClonedBoundaryRecipe,
  EMPTY_BOUNDARY,
  normalizeBoundary,
  percentBetween,
  recomputeBoundary,
  resolvePercent,
  toStoredBoundary,
  violatesBoundaryOrder,
  type StoredBoundary,
} from "@/lib/dates";

describe("addDays / daysBetween", () => {
  it("adds and subtracts signed day counts", () => {
    expect(addDays("2027-03-01", 10)).toBe("2027-03-11");
    expect(addDays("2027-03-01", -5)).toBe("2027-02-24");
  });

  it("computes a signed day count between two dates", () => {
    expect(daysBetween("2027-03-01", "2027-03-11")).toBe(10);
    expect(daysBetween("2027-03-11", "2027-03-01")).toBe(-10);
  });

  it("survives a DST-transition month without off-by-one drift (UTC day math)", () => {
    expect(addDays("2027-03-10", 5)).toBe("2027-03-15");
  });
});

describe("toStoredBoundary", () => {
  it("stores absolute dates without recipe fields", () => {
    expect(toStoredBoundary({ type: "absolute", date: "2027-04-01" }, "2027-01-01", "2027-06-01")).toEqual({
      dateType: "absolute",
      date: "2027-04-01",
      relativeBasis: null,
      relativeValue: null,
    });
  });

  it("allows an explicitly-unset absolute boundary", () => {
    expect(toStoredBoundary({ type: "absolute", date: null }, "2027-01-01", "2027-06-01").date).toBeNull();
  });

  it("infers a percent recipe for a target inside both parent dates", () => {
    const boundary = toStoredBoundary(
      { type: "relative", date: "2027-01-06" },
      "2027-01-01",
      "2027-01-11",
    );
    expect(boundary).toEqual({
      dateType: "relative",
      date: "2027-01-06",
      relativeBasis: "between",
      relativeValue: 5000,
    });
  });

  it("infers a signed start offset for a target before the start", () => {
    expect(toStoredBoundary({ type: "relative", date: "2026-12-28" }, "2027-01-01", "2027-06-01")).toEqual({
      dateType: "relative",
      date: "2026-12-28",
      relativeBasis: "start",
      relativeValue: -4,
    });
  });

  it("infers a signed end offset for a target after the end", () => {
    expect(toStoredBoundary({ type: "relative", date: "2027-06-08" }, "2027-01-01", "2027-06-01")).toEqual({
      dateType: "relative",
      date: "2027-06-08",
      relativeBasis: "end",
      relativeValue: 7,
    });
  });

  it("keeps a one-sided start basis when only the start is known", () => {
    expect(toStoredBoundary({ type: "relative", date: "2027-01-15" }, "2027-01-01", null)).toEqual({
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "start",
      relativeValue: 14,
    });
  });

  it("keeps a one-sided end basis when only the end is known", () => {
    expect(toStoredBoundary({ type: "relative", date: "2027-05-25" }, null, "2027-06-01")).toEqual({
      dateType: "relative",
      date: "2027-05-25",
      relativeBasis: "end",
      relativeValue: -7,
    });
  });

  it("rejects relative authoring with no parent boundary", () => {
    expect(() => toStoredBoundary({ type: "relative", date: "2027-01-01" }, null, null)).toThrow(
      "at least one parent boundary",
    );
  });

  it("accepts an explicit basis/value for internal callers", () => {
    expect(
      toStoredBoundary(
        { type: "relative", date: "2027-01-15", basis: "start", value: 14 },
        "2027-01-01",
        "2027-06-01",
      ),
    ).toEqual({
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "start",
      relativeValue: 14,
    });
  });
});

describe("percent precision and resolution", () => {
  it("stores percent as hundredths and rounds resolved dates to a calendar day", () => {
    expect(percentBetween("2027-01-01", "2027-01-03", "2027-01-02")).toBe(5000);
    expect(percentBetween("2027-01-01", "2027-01-03", "2027-01-01")).toBe(0);
    expect(percentBetween("2027-01-01", "2027-01-03", "2027-01-03")).toBe(10000);
    expect(resolvePercent("2027-01-01", "2027-01-03", 3333)).toBe("2027-01-02");
  });

  it("rejects a between value outside 0–100 percent", () => {
    expect(() =>
      toStoredBoundary(
        { type: "relative", date: "2027-01-01", basis: "between", value: 10001 },
        "2027-01-01",
        "2027-01-03",
      ),
    ).toThrow("between 0 and 100 percent");
  });
});

describe("recomputeBoundary", () => {
  it("leaves absolute boundaries untouched", () => {
    const absolute: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-04-01" };
    expect(recomputeBoundary(absolute, "2027-02-01", "2027-08-01")).toEqual(absolute);
  });

  it("moves a one-sided start offset when the known start moves", () => {
    const relative: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "start",
      relativeValue: 14,
    };
    expect(recomputeBoundary(relative, "2027-02-01", null)).toEqual({
      ...relative,
      date: "2027-02-15",
    });
  });

  it("rescales a between recipe when the parent span changes", () => {
    const relative: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-06",
      relativeBasis: "between",
      relativeValue: 5000,
    };
    expect(recomputeBoundary(relative, "2027-01-01", "2027-01-21").date).toBe("2027-01-11");
  });
});

describe("normalizeBoundary", () => {
  it("turns a one-sided provisional offset into a percent when the missing boundary arrives", () => {
    const provisional: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "start",
      relativeValue: 14,
    };
    expect(normalizeBoundary(provisional, "2027-01-01", "2027-01-31")).toEqual({
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "between",
      relativeValue: 4667,
    });
  });

  it("turns an in-range legacy offset into a percent recipe", () => {
    const legacy: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-10",
      relativeBasis: "start",
      relativeValue: 9,
    };
    expect(normalizeBoundary(legacy, "2027-01-01", "2027-01-31").relativeBasis).toBe("between");
  });

  it("re-bases an outside target onto the natural edge", () => {
    const provisional: StoredBoundary = {
      dateType: "relative",
      date: "2027-02-05",
      relativeBasis: "start",
      relativeValue: 35,
    };
    expect(normalizeBoundary(provisional, "2027-01-01", "2027-01-31")).toEqual({
      dateType: "relative",
      date: "2027-02-05",
      relativeBasis: "end",
      relativeValue: 5,
    });
  });
});

describe("boundaryForEditing", () => {
  it("keeps a canonical recipe when the same resolved date is saved", () => {
    const existing: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "between",
      relativeValue: 4667,
    };
    expect(
      boundaryForEditing(existing, { type: "relative", date: "2027-01-15" }, "2027-01-01", "2027-01-31"),
    ).toEqual(existing);
  });

  it("normalizes a newly bounded provisional recipe even when the date is unchanged", () => {
    const existing: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "start",
      relativeValue: 14,
    };
    expect(
      boundaryForEditing(existing, { type: "relative", date: "2027-01-15" }, "2027-01-01", "2027-01-31"),
    ).toEqual({
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "between",
      relativeValue: 4667,
    });
  });
});

describe("violatesBoundaryOrder", () => {
  it("flags an end resolving before its own start", () => {
    expect(violatesBoundaryOrder("2027-03-01", "2027-02-01")).toBe(true);
  });

  it("does not flag a valid or partially-unresolved pair", () => {
    expect(violatesBoundaryOrder("2027-02-01", "2027-03-01")).toBe(false);
    expect(violatesBoundaryOrder(null, "2027-03-01")).toBe(false);
    expect(violatesBoundaryOrder("2027-02-01", null)).toBe(false);
  });
});

describe("deriveClonedBoundaryRecipe", () => {
  it("carries a relative recipe forward without its cached date", () => {
    const relative: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-15",
      relativeBasis: "between",
      relativeValue: 5000,
    };
    expect(deriveClonedBoundaryRecipe(relative, "2027-01-01", "2027-01-31")).toEqual({
      ...relative,
      date: null,
    });
  });

  it("derives a canonical recipe for an absolute source date", () => {
    const absolute: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-01-15" };
    expect(deriveClonedBoundaryRecipe(absolute, "2027-01-01", "2027-01-31")).toEqual({
      dateType: "relative",
      date: null,
      relativeBasis: "between",
      relativeValue: 4667,
    });
  });

  it("uses the end basis when the source date is after the source cycle", () => {
    const absolute: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-02-05" };
    expect(deriveClonedBoundaryRecipe(absolute, "2027-01-01", "2027-01-31")).toEqual({
      dateType: "relative",
      date: null,
      relativeBasis: "end",
      relativeValue: 5,
    });
  });

  it("falls back to an unset recipe without a source start date", () => {
    const absolute: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-01-15" };
    expect(deriveClonedBoundaryRecipe(absolute, null)).toEqual(EMPTY_BOUNDARY);
  });

  it("leaves a never-set boundary unset", () => {
    expect(deriveClonedBoundaryRecipe(EMPTY_BOUNDARY, "2027-01-01", "2027-01-31")).toEqual(EMPTY_BOUNDARY);
  });
});
