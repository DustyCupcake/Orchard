import { describe, expect, it } from "vitest";
import {
  effectiveDateDisplayMode,
  formatDateLabel,
  formatExactDate,
  formatWeekday,
  isShortPeriod,
} from "@/lib/dates";

describe("date display formatter", () => {
  it("formats canonical dates in UTC without local-time shifts", () => {
    expect(formatExactDate("2027-03-01")).toBe("Mar 1, 2027");
    expect(formatWeekday("2027-03-01")).toBe("Mon");
  });

  it("uses a period name and weekday only for a short, in-range period", () => {
    const label = formatDateLabel("2027-03-02", "period", {
      name: "Build",
      startDate: "2027-03-01",
      endDate: "2027-03-07",
    });
    expect(label.visible).toBe("Build · Tue");
    expect(label.exact).toBe("Mar 2, 2027");
    expect(label.canonical).toBe("2027-03-02");
    expect(label.periodAvailable).toBe(true);
  });

  it("falls back to the exact date outside the period or when context is absent", () => {
    expect(
      formatDateLabel("2027-03-08", "period", {
        name: "Build",
        startDate: "2027-03-01",
        endDate: "2027-03-07",
      }).visible,
    ).toBe("Mar 8, 2027");
    expect(formatDateLabel("2027-03-02", "period").visible).toBe("Mar 2, 2027");
    expect(formatDateLabel(null, "period").visible).toBe("Unresolved");
  });

  it("does not abbreviate long periods", () => {
    expect(isShortPeriod("2027-03-01", "2027-03-07")).toBe(true);
    expect(isShortPeriod("2027-03-01", "2027-03-08")).toBe(false);
    expect(
      formatDateLabel("2027-03-02", "period", {
        name: "Long phase",
        startDate: "2027-03-01",
        endDate: "2027-03-08",
      }).visible,
    ).toBe("Mar 2, 2027");
  });
});

describe("effective date display preference", () => {
  it("inherits the Community default when the member has no override", () => {
    expect(effectiveDateDisplayMode({ dateDisplayMode: null }, { defaultDateDisplayMode: "period" })).toBe("period");
  });

  it("lets an explicit member override win", () => {
    expect(effectiveDateDisplayMode({ dateDisplayMode: "exact" }, { defaultDateDisplayMode: "period" })).toBe("exact");
  });
});
