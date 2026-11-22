import { describe, expect, it } from "vitest";
import { formatInstantRange, formatShiftRange, type DayScopeData } from "@/lib/dates";

// A four-day event, Thu 2027-03-04 to Sun 2027-03-07, on Madrid's clock
// (UTC+1 in early March).
const ZONE = "Europe/Madrid";
const event: DayScopeData = {
  cycle: { id: "c1", name: "Peach Please", startDate: "2027-03-04", endDate: "2027-03-07" },
  phases: [],
};
const at = (local: string) => new Date(`${local}:00+01:00`);

describe("formatShiftRange", () => {
  it("reads a shift inside a short event as the event and a weekday, in period mode", () => {
    expect(formatShiftRange(at("2027-03-05T14:00"), at("2027-03-05T15:30"), ZONE, "period", event)).toBe(
      "Peach Please · Fri, 14:00–15:30",
    );
  });

  it("keeps the exact date in exact mode", () => {
    const start = at("2027-03-05T14:00");
    const end = at("2027-03-05T15:30");
    expect(formatShiftRange(start, end, ZONE, "exact", event)).toBe(formatInstantRange(start, end, ZONE));
  });

  it("keeps the exact date for a shift outside the event's dates", () => {
    const start = at("2027-03-03T10:00"); // the day before it starts
    const end = at("2027-03-03T12:00");
    expect(formatShiftRange(start, end, ZONE, "period", event)).toBe(formatInstantRange(start, end, ZONE));
  });

  it("keeps the exact date when the event is longer than a week", () => {
    const start = at("2027-03-05T14:00");
    const end = at("2027-03-05T15:30");
    const long = { ...event, cycle: { ...event.cycle, endDate: "2027-03-20" } };
    expect(formatShiftRange(start, end, ZONE, "period", long)).toBe(formatInstantRange(start, end, ZONE));
  });

  it("keeps the exact date with no event (a standing series)", () => {
    const start = at("2027-03-05T14:00");
    const end = at("2027-03-05T15:30");
    expect(formatShiftRange(start, end, ZONE, "period", null)).toBe(formatInstantRange(start, end, ZONE));
  });

  it("takes the weekday from the venue's clock, not UTC", () => {
    // 00:30 Saturday in Madrid is still Friday 23:30 in UTC.
    expect(formatShiftRange(at("2027-03-06T00:30"), at("2027-03-06T02:00"), ZONE, "period", event)).toBe(
      "Peach Please · Sat, 00:30–02:00",
    );
  });

  it("names both days when a shift crosses midnight inside the event", () => {
    expect(formatShiftRange(at("2027-03-05T22:00"), at("2027-03-06T02:00"), ZONE, "period", event)).toBe(
      "Peach Please · Fri, 22:00 – Peach Please · Sat, 02:00",
    );
  });

  it("falls back to a plain date for the end when it runs past the event", () => {
    expect(formatShiftRange(at("2027-03-07T22:00"), at("2027-03-08T02:00"), ZONE, "period", event)).toBe(
      "Peach Please · Sun, 22:00 – Mar 8, 2027, 02:00",
    );
  });

  describe("with phases", () => {
    // A three-day Set-up phase before the event, outside the event's own dates.
    const withSetup: DayScopeData = {
      cycle: event.cycle,
      phases: [{ id: "p1", name: "Set-up", order: 1, startDate: "2027-03-01", endDate: "2027-03-03" }],
    };

    it("reads a shift in a phase outside the event's dates as that phase", () => {
      expect(formatShiftRange(at("2027-03-02T10:00"), at("2027-03-02T12:00"), ZONE, "period", withSetup)).toBe(
        "Peach Please · Set-up · Tue, 10:00–12:00",
      );
    });

    it("leaves out what the view already says", () => {
      const start = at("2027-03-02T10:00");
      const end = at("2027-03-02T12:00");
      expect(
        formatShiftRange(start, end, ZONE, "period", withSetup, {}, { cycleId: "c1" }),
      ).toBe("Set-up · Tue, 10:00–12:00");
      expect(
        formatShiftRange(start, end, ZONE, "period", withSetup, {}, { cycleId: "c1", phaseId: "p1" }),
      ).toBe("Tue, 10:00–12:00");
    });
  });
});
