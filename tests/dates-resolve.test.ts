import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  deriveClonedBoundaryRecipe,
  EMPTY_BOUNDARY,
  isBoundaryDrifted,
  recomputeBoundary,
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
    // US spring-forward 2027 falls in March — a naive local-time diff
    // could lose or gain an hour here.
    expect(addDays("2027-03-10", 5)).toBe("2027-03-15");
  });
});

describe("toStoredBoundary", () => {
  it("absolute: stores the date as-is, no anchor info", () => {
    const b = toStoredBoundary({ type: "absolute", date: "2027-04-01" }, "2027-01-01", "2027-06-01");
    expect(b).toEqual({
      dateType: "absolute",
      date: "2027-04-01",
      relativeMode: null,
      offsetAnchor: null,
      offsetDays: null,
      percent: null,
    });
  });

  it("absolute: a null date is a valid, explicitly-unset boundary", () => {
    const b = toStoredBoundary({ type: "absolute", date: null }, "2027-01-01", "2027-06-01");
    expect(b.date).toBeNull();
  });

  it("relative_offset (typed): resolves against the named anchor", () => {
    const b = toStoredBoundary(
      { type: "relative_offset", anchor: "cycle_start", offsetDays: 14 },
      "2027-01-01",
      "2027-06-01",
    );
    expect(b.dateType).toBe("relative");
    expect(b.relativeMode).toBe("offset");
    expect(b.offsetDays).toBe(14);
    expect(b.date).toBe("2027-01-15");
  });

  it("relative_offset anchored to cycle_end", () => {
    const b = toStoredBoundary(
      { type: "relative_offset", anchor: "cycle_end", offsetDays: -7 },
      "2027-01-01",
      "2027-06-01",
    );
    expect(b.date).toBe("2027-05-25");
  });

  it("relative_offset (dragged): reverse-computes the offset from a target date", () => {
    const b = toStoredBoundary(
      { type: "relative_offset", anchor: "cycle_start", targetDate: "2027-01-15" },
      "2027-01-01",
      "2027-06-01",
    );
    expect(b.offsetDays).toBe(14);
    expect(b.date).toBe("2027-01-15");
  });

  it("relative_offset: unresolvable when the named anchor is missing", () => {
    const b = toStoredBoundary(
      { type: "relative_offset", anchor: "cycle_start", offsetDays: 14 },
      null,
      "2027-06-01",
    );
    expect(b.date).toBeNull();
    expect(b.offsetDays).toBe(14); // the recipe itself is still stored
  });

  it("relative_percent (typed): resolves proportionally between both anchors", () => {
    const b = toStoredBoundary({ type: "relative_percent", percent: 50 }, "2027-01-01", "2027-01-11");
    expect(b.date).toBe("2027-01-06");
  });

  it("relative_percent (dragged): reverse-computes the percent from a target date", () => {
    const b = toStoredBoundary(
      { type: "relative_percent", targetDate: "2027-01-06" },
      "2027-01-01",
      "2027-01-11",
    );
    expect(b.percent).toBe(50);
    expect(b.date).toBe("2027-01-06");
  });

  it("relative_percent: unresolvable without both anchors", () => {
    const b = toStoredBoundary({ type: "relative_percent", percent: 50 }, "2027-01-01", null);
    expect(b.date).toBeNull();
    expect(b.percent).toBe(50);
  });
});

describe("recomputeBoundary", () => {
  it("absolute boundaries are untouched by an anchor moving", () => {
    const abs: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-04-01" };
    expect(recomputeBoundary(abs, "2027-02-01", "2027-08-01")).toEqual(abs);
  });

  it("offset-mode boundaries track the anchor as it moves", () => {
    const rel: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-15",
      relativeMode: "offset",
      offsetAnchor: "cycle_start",
      offsetDays: 14,
      percent: null,
    };
    const moved = recomputeBoundary(rel, "2027-02-01", null);
    expect(moved.date).toBe("2027-02-15");
    expect(moved.offsetDays).toBe(14); // the recipe itself never changes
  });

  it("percent-mode boundaries rescale as the span changes", () => {
    const rel: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-06",
      relativeMode: "percent",
      offsetAnchor: null,
      offsetDays: null,
      percent: 50,
    };
    const rescaled = recomputeBoundary(rel, "2027-01-01", "2027-01-21");
    expect(rescaled.date).toBe("2027-01-11");
  });
});

describe("isBoundaryDrifted", () => {
  const cycleStart = "2027-01-01";
  const cycleEnd = "2027-01-31";

  it("flags an offset-mode item that resolved closer to the opposite boundary", () => {
    // Anchored to cycle_start with a huge offset that lands it right
    // next to cycle_end instead.
    const b: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-30",
      relativeMode: "offset",
      offsetAnchor: "cycle_start",
      offsetDays: 29,
      percent: null,
    };
    expect(isBoundaryDrifted(b, cycleStart, cycleEnd)).toBe(true);
  });

  it("does not flag an offset-mode item still closer to its own anchor", () => {
    const b: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-05",
      relativeMode: "offset",
      offsetAnchor: "cycle_start",
      offsetDays: 4,
      percent: null,
    };
    expect(isBoundaryDrifted(b, cycleStart, cycleEnd)).toBe(false);
  });

  it("percent-mode is structurally immune", () => {
    const b: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-30",
      relativeMode: "percent",
      offsetAnchor: null,
      offsetDays: null,
      percent: 97,
    };
    expect(isBoundaryDrifted(b, cycleStart, cycleEnd)).toBe(false);
  });

  it("absolute boundaries are never flagged", () => {
    const b: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-01-30" };
    expect(isBoundaryDrifted(b, cycleStart, cycleEnd)).toBe(false);
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
  it("a relative boundary carries its recipe forward, cached date dropped", () => {
    const rel: StoredBoundary = {
      dateType: "relative",
      date: "2027-01-15",
      relativeMode: "offset",
      offsetAnchor: "cycle_start",
      offsetDays: 14,
      percent: null,
    };
    const derived = deriveClonedBoundaryRecipe(rel, "2027-01-01");
    expect(derived).toEqual({ ...rel, date: null });
  });

  it("an absolute boundary derives an offset recipe against the source cycle's own start_date", () => {
    const abs: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-01-15" };
    const derived = deriveClonedBoundaryRecipe(abs, "2027-01-01");
    expect(derived).toEqual({
      dateType: "relative",
      date: null,
      relativeMode: "offset",
      offsetAnchor: "cycle_start",
      offsetDays: 14,
      percent: null,
    });
  });

  it("un-derivable (no source start_date) falls back to a fully unset boundary", () => {
    const abs: StoredBoundary = { ...EMPTY_BOUNDARY, dateType: "absolute", date: "2027-01-15" };
    expect(deriveClonedBoundaryRecipe(abs, null)).toEqual(EMPTY_BOUNDARY);
  });

  it("a never-set boundary stays unset", () => {
    expect(deriveClonedBoundaryRecipe(EMPTY_BOUNDARY, "2027-01-01")).toEqual(EMPTY_BOUNDARY);
  });
});
