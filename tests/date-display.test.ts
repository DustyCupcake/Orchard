import { describe, expect, it } from "vitest";
import {
  effectiveDateDisplayMode,
  formatExactDate,
  formatWeekday,
  isShortPeriod,
} from "@/lib/dates";

describe("date display formatter", () => {
  it("formats canonical dates in UTC without local-time shifts", () => {
    expect(formatExactDate("2027-03-01")).toBe("Mar 1, 2027");
    expect(formatWeekday("2027-03-01")).toBe("Mon");
  });

  // How a day is written in a period (and when it isn't) is pinned in
  // tests/day-labels.test.ts; this is only the seven-day line itself.
  it("counts a period as short up to seven days and no further", () => {
    expect(isShortPeriod("2027-03-01", "2027-03-07")).toBe(true);
    expect(isShortPeriod("2027-03-01", "2027-03-08")).toBe(false);
    expect(isShortPeriod("2027-03-08", "2027-03-01")).toBe(false);
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
