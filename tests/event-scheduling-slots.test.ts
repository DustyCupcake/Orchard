import { describe, expect, it } from "vitest";
import { buildDayScopes, createDayLabeler } from "@/lib/dates";
import { formatEventTime } from "@/lib/event-scheduling";

// No database. How a saved programme time reads back, for whoever is
// looking at it.

// A week-long event, Thu 2026-09-10 to Wed 2026-09-16, with a Set-up phase
// before it and a long phase that is more than a week.
const scopes = buildDayScopes(
  [
    { id: "reunion", name: "Reunion", startDate: "2026-09-10", endDate: "2026-09-16" },
    { id: "later", name: "Later", startDate: "2026-10-01", endDate: "2026-10-07" },
    { id: "undated", name: "Undated", startDate: null, endDate: null },
  ],
  [
    { id: "setup", cycleId: "reunion", name: "Set-up", order: 1, startDate: "2026-09-07", endDate: "2026-09-09" },
    { id: "long", cycleId: "reunion", name: "Run-up", order: 2, startDate: "2026-08-01", endDate: "2026-09-06" },
  ],
);
const exact = createDayLabeler("exact", scopes);
const period = createDayLabeler("period", scopes);
const reunion = { cycleId: "reunion" };

describe("formatEventTime", () => {
  const time = { startsAt: "2026-09-10T12:00:00.000Z", endsAt: "2026-09-10T13:30:00.000Z" };

  it("reads the clock in the event's zone, not the host's", () => {
    // 12:00 UTC is 14:00 in Madrid — the member proposing 14:00 has to
    // see 14:00 again.
    expect(formatEventTime(time, "Europe/Madrid", exact).visible).toBe("Sep 10, 2026, 14:00–15:30");
    expect(formatEventTime(time, "UTC", exact).visible).toBe("Sep 10, 2026, 12:00–13:30");
    expect(formatEventTime(time, "America/New_York", exact).visible).toBe("Sep 10, 2026, 08:00–09:30");
  });

  // A 23:00 start in Madrid is the next day in UTC. The date has to be the
  // one the room is on, or the weekday shown beside it is wrong too.
  it("takes the calendar date from the event's zone", () => {
    const late = { startsAt: "2026-09-10T21:00:00.000Z", endsAt: "2026-09-10T22:00:00.000Z" };
    expect(formatEventTime(late, "Europe/Madrid", exact).visible).toBe("Sep 10, 2026, 23:00–00:00");
    expect(formatEventTime(late, "UTC", exact).visible).toBe("Sep 10, 2026, 21:00–22:00");
    // And the weekday is the room's, not UTC's: 00:30 Friday in Madrid is still Thursday in UTC.
    const small = { startsAt: "2026-09-10T22:30:00.000Z", endsAt: "2026-09-10T23:30:00.000Z" };
    expect(formatEventTime(small, "Europe/Madrid", period, reunion).visible).toBe("Reunion · Fri, 00:30–01:30");
  });

  it("shows the event and weekday instead of the date when that setting is on", () => {
    expect(formatEventTime(time, "UTC", period, reunion).visible).toBe("Reunion · Thu, 12:00–13:30");
  });

  it("leaves the event's name out where the page already says it", () => {
    expect(formatEventTime(time, "UTC", period, reunion, reunion).visible).toBe("Thu, 12:00–13:30");
  });

  it("names the phase a slot falls in, outside the event's own dates", () => {
    const setup = { startsAt: "2026-09-08T09:00:00.000Z", endsAt: "2026-09-08T10:00:00.000Z" };
    expect(formatEventTime(setup, "UTC", period, reunion).visible).toBe("Reunion · Set-up · Tue, 09:00–10:00");
    expect(formatEventTime(setup, "UTC", period, reunion, reunion).visible).toBe("Set-up · Tue, 09:00–10:00");
  });

  it("keeps the time range in period mode — only the date is abbreviated", () => {
    // The whole point of a proposal is a window of time; dropping it would
    // leave "Reunion · Thu" with nothing to compare against.
    const label = formatEventTime(time, "UTC", period, reunion);
    expect(label.visible).toContain("12:00");
    expect(label.visible).toContain("13:30");
  });

  it("keeps the exact date available for a hover, whatever the setting", () => {
    expect(formatEventTime(time, "UTC", period, reunion).exact).toBe("Sep 10, 2026, 12:00–13:30");
    expect(formatEventTime(time, "UTC", exact, reunion).exact).toBe("Sep 10, 2026, 12:00–13:30");
  });

  it("falls back to the exact date when the time is outside every period", () => {
    // A period is only unambiguous for a date inside it, so this asserts the
    // formatting passes that through rather than inventing its own rule.
    expect(formatEventTime(time, "UTC", period, { cycleId: "later" }).visible).toBe("Sep 10, 2026, 12:00–13:30");
  });

  it("falls back to the exact date when there is no event, an unknown one, or one with no dates", () => {
    expect(formatEventTime(time, "UTC", period).visible).toBe("Sep 10, 2026, 12:00–13:30");
    expect(formatEventTime(time, "UTC", period, { cycleId: null }).visible).toBe("Sep 10, 2026, 12:00–13:30");
    expect(formatEventTime(time, "UTC", period, { cycleId: "nope" }).visible).toBe("Sep 10, 2026, 12:00–13:30");
    expect(formatEventTime(time, "UTC", period, { cycleId: "undated" }).visible).toBe("Sep 10, 2026, 12:00–13:30");
  });

  // An availability window and a confirmed placement are the same shape and
  // read identically; only the number of open options differs, which is the
  // owner's arithmetic rather than a formatting concern.
  it("formats a wider availability window the same way", () => {
    const window = { startsAt: "2026-09-10T12:00:00.000Z", endsAt: "2026-09-10T16:00:00.000Z" };
    expect(formatEventTime(window, "UTC", exact).visible).toBe("Sep 10, 2026, 12:00–16:00");
  });
});
