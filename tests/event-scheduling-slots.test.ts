import { describe, expect, it } from "vitest";
import { formatEventTime } from "@/lib/event-scheduling";

// No database. How a saved programme time reads back, for whoever is
// looking at it.

const PERIOD = {
  name: "Reunion",
  startDate: "2026-09-10",
  endDate: "2026-09-16",
};

describe("formatEventTime", () => {
  const time = { startsAt: "2026-09-10T12:00:00.000Z", endsAt: "2026-09-10T13:30:00.000Z" };

  it("reads the clock in the event's zone, not the host's", () => {
    // 12:00 UTC is 14:00 in Madrid — the member proposing 14:00 has to
    // see 14:00 again.
    expect(formatEventTime(time, "exact", "Europe/Madrid").visible).toBe("Sep 10, 2026, 14:00–15:30");
    expect(formatEventTime(time, "exact", "UTC").visible).toBe("Sep 10, 2026, 12:00–13:30");
    expect(formatEventTime(time, "exact", "America/New_York").visible).toBe("Sep 10, 2026, 08:00–09:30");
  });

  // A 23:00 start in Madrid is the next day in UTC. The date has to be the
  // one the room is on, or the weekday shown beside it is wrong too.
  it("takes the calendar date from the event's zone", () => {
    const late = { startsAt: "2026-09-10T21:00:00.000Z", endsAt: "2026-09-10T22:00:00.000Z" };
    expect(formatEventTime(late, "exact", "Europe/Madrid").visible).toBe("Sep 10, 2026, 23:00–00:00");
    expect(formatEventTime(late, "exact", "UTC").visible).toBe("Sep 10, 2026, 21:00–22:00");
  });

  it("shows the period and weekday instead of the date when that setting is on", () => {
    expect(formatEventTime(time, "period", "UTC", PERIOD).visible).toBe("Reunion · Thu, 12:00–13:30");
  });

  it("keeps the time range in period mode — only the date is abbreviated", () => {
    // The whole point of a proposal is a window of time; dropping it would
    // leave "Reunion · Thu" with nothing to compare against.
    const label = formatEventTime(time, "period", "UTC", PERIOD);
    expect(label.visible).toContain("12:00");
    expect(label.visible).toContain("13:30");
  });

  it("keeps the exact date available for a hover, whatever the setting", () => {
    expect(formatEventTime(time, "period", "UTC", PERIOD).exact).toBe("Sep 10, 2026, 12:00–13:30");
    expect(formatEventTime(time, "exact", "UTC", PERIOD).exact).toBe("Sep 10, 2026, 12:00–13:30");
  });

  it("falls back to the exact date when the time is outside the period", () => {
    // formatDateLabel already rules this case — a period is only
    // unambiguous for a date inside it — so this asserts the formatting
    // passes that through rather than inventing its own rule.
    expect(
      formatEventTime(time, "period", "UTC", { ...PERIOD, startDate: "2026-10-01", endDate: "2026-10-07" }).visible,
    ).toBe("Sep 10, 2026, 12:00–13:30");
  });

  it("falls back to the exact date when there is no period at all", () => {
    expect(formatEventTime(time, "period", "UTC", null).visible).toBe("Sep 10, 2026, 12:00–13:30");
  });

  // An availability window and a confirmed placement are the same shape and
  // read identically; only the number of open options differs, which is the
  // owner's arithmetic rather than a formatting concern.
  it("formats a wider availability window the same way", () => {
    const window = { startsAt: "2026-09-10T12:00:00.000Z", endsAt: "2026-09-10T16:00:00.000Z" };
    expect(formatEventTime(window, "exact", "UTC").visible).toBe("Sep 10, 2026, 12:00–16:00");
  });
});