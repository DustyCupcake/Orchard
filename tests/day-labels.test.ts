import { describe, expect, it } from "vitest";
import {
  formatDayColumnHeading,
  formatDayHeading,
  formatDayLabel,
  resolveDayPeriod,
  type DayScopeData,
} from "@/lib/dates";

// An event Thu 2027-03-04 to Sun 2027-03-07, with a Set-up phase before it, a
// Recruitment phase that runs alongside the event's first days, and a long
// phase that is more than a week.
const data: DayScopeData = {
  cycle: { id: "c1", name: "Peach Please", startDate: "2027-03-04", endDate: "2027-03-07" },
  phases: [
    { id: "setup", name: "Set-up", order: 1, startDate: "2027-03-01", endDate: "2027-03-03" },
    { id: "recruit", name: "Recruitment", order: 2, startDate: "2027-03-04", endDate: "2027-03-06" },
    { id: "build", name: "Build", order: 3, startDate: "2027-03-04", endDate: "2027-03-05" },
    { id: "prep", name: "Preparation", order: 4, startDate: "2027-02-01", endDate: "2027-03-03" },
    { id: "undated", name: "Wind-down", order: 5, startDate: "2027-03-08", endDate: null },
  ],
};

describe("resolveDayPeriod", () => {
  it("finds the phase a phase-less item's day falls in", () => {
    expect(resolveDayPeriod("2027-03-02", data)?.phaseName).toBe("Set-up");
  });

  it("takes the narrowest containing phase for a phase-less item, ties to the lower order", () => {
    // Both Recruitment (3 days) and Build (2 days) contain Mar 4 and Mar 5.
    expect(resolveDayPeriod("2027-03-05", data)?.phaseName).toBe("Build");
    const tied: DayScopeData = {
      cycle: data.cycle,
      phases: [
        { id: "b", name: "B", order: 2, startDate: "2027-03-04", endDate: "2027-03-05" },
        { id: "a", name: "A", order: 1, startDate: "2027-03-04", endDate: "2027-03-05" },
      ],
    };
    expect(resolveDayPeriod("2027-03-04", tied)?.phaseName).toBe("A");
  });

  it("uses an item's own phase even where a narrower phase overlaps it", () => {
    // A Recruitment task dated Mar 5 stays in Recruitment's terms, not Build's.
    expect(resolveDayPeriod("2027-03-05", data, { phaseId: "recruit" })?.phaseName).toBe("Recruitment");
  });

  it("never swaps an item's own phase for another one that qualifies", () => {
    // Mar 5 is in Build and Recruitment but not in the item's own phase (Set-up).
    // It falls to the event, not to either of those.
    const r = resolveDayPeriod("2027-03-05", data, { phaseId: "setup" });
    expect(r?.kind).toBe("event");
    expect(r?.phaseName).toBeNull();
    // And a day outside the event too, which another phase would have caught:
    // Mar 9 is in neither the event nor Set-up, so it is a plain date.
    const wide: DayScopeData = {
      cycle: data.cycle,
      phases: [...data.phases, { id: "late", name: "Late", order: 6, startDate: "2027-03-08", endDate: "2027-03-12" }],
    };
    expect(resolveDayPeriod("2027-03-09", wide, { phaseId: "setup" })).toBeNull();
    expect(resolveDayPeriod("2027-03-09", wide)?.phaseName).toBe("Late");
  });

  it("falls to the event when no phase contains the day", () => {
    const r = resolveDayPeriod("2027-03-07", data);
    expect(r?.kind).toBe("event");
    expect(r?.cycleName).toBe("Peach Please");
  });

  it("does not use a phase longer than a week or one with a missing boundary", () => {
    expect(resolveDayPeriod("2027-02-15", data)).toBeNull(); // only the long Preparation phase
    expect(resolveDayPeriod("2027-03-08", data)).toBeNull(); // Wind-down has no end date
  });

  it("is null with no scope or no day, and for an event that is longer than a week", () => {
    expect(resolveDayPeriod("2027-03-02", null)).toBeNull();
    expect(resolveDayPeriod(null, data)).toBeNull();
    const long: DayScopeData = { cycle: { ...data.cycle, endDate: "2027-03-30" }, phases: [] };
    expect(resolveDayPeriod("2027-03-05", long)).toBeNull();
  });

  it("is null for an event with no dates", () => {
    const undated: DayScopeData = { cycle: { ...data.cycle, startDate: null, endDate: null }, phases: [] };
    expect(resolveDayPeriod("2027-03-05", undated)).toBeNull();
  });
});

describe("formatDayLabel", () => {
  const phase = resolveDayPeriod("2027-03-02", data);
  const eventLevel = resolveDayPeriod("2027-03-07", data);

  it("names the event and phase when nothing is already shown", () => {
    expect(formatDayLabel("2027-03-02", "period", phase).visible).toBe("Peach Please · Set-up · Tue");
    expect(formatDayLabel("2027-03-07", "period", eventLevel).visible).toBe("Peach Please · Sun");
  });

  it("leaves out the event inside a view of that event, and both inside a view of that phase", () => {
    expect(formatDayLabel("2027-03-02", "period", phase, { cycleId: "c1" }).visible).toBe("Set-up · Tue");
    expect(formatDayLabel("2027-03-02", "period", phase, { cycleId: "c1", phaseId: "setup" }).visible).toBe("Tue");
    expect(formatDayLabel("2027-03-07", "period", eventLevel, { cycleId: "c1" }).visible).toBe("Sun");
  });

  it("still names a phase the view is not scoped to", () => {
    expect(formatDayLabel("2027-03-02", "period", phase, { cycleId: "c1", phaseId: "build" }).visible).toBe(
      "Set-up · Tue",
    );
    // Another event's view names this event.
    expect(formatDayLabel("2027-03-02", "period", phase, { cycleId: "other" }).visible).toBe(
      "Peach Please · Set-up · Tue",
    );
  });

  it("is the full date in exact mode, with no period, or for an unresolved date", () => {
    expect(formatDayLabel("2027-03-02", "exact", phase).visible).toBe("Mar 2, 2027");
    expect(formatDayLabel("2027-03-02", "period", null).visible).toBe("Mar 2, 2027");
    expect(formatDayLabel(null, "period", null).visible).toBe("Unresolved");
  });

  it("keeps the exact date and weekday available whatever it shows", () => {
    const label = formatDayLabel("2027-03-02", "period", phase);
    expect(label.exact).toBe("Mar 2, 2027");
    expect(label.weekday).toBe("Tue");
    expect(label.canonical).toBe("2027-03-02");
    expect(label.periodAvailable).toBe(true);
  });
});

describe("formatDayHeading", () => {
  const phase = resolveDayPeriod("2027-03-02", data);

  it("is the long form in exact mode, as the kitchen has always printed it", () => {
    expect(formatDayHeading("2027-03-05", "exact", null)).toBe("Friday, March 5");
    expect(formatDayHeading("2027-03-05", "period", null)).toBe("Friday, March 5");
  });

  it("is just the weekday inside a view that already says where it is", () => {
    expect(formatDayHeading("2027-03-02", "period", phase, { cycleId: "c1", phaseId: "setup" })).toBe("Tuesday");
  });

  it("names the period in a view that does not", () => {
    expect(formatDayHeading("2027-03-02", "period", phase)).toBe("Peach Please · Set-up · Tuesday");
  });
});

describe("formatDayColumnHeading", () => {
  const phase = resolveDayPeriod("2027-03-02", data);

  it("is two lines normally and the weekday alone inside a short period", () => {
    expect(formatDayColumnHeading("2027-03-02", "exact", phase)).toEqual({ weekday: "Tue", date: "Mar 2" });
    expect(formatDayColumnHeading("2027-03-02", "period", null)).toEqual({ weekday: "Tue", date: "Mar 2" });
    expect(formatDayColumnHeading("2027-03-02", "period", phase)).toEqual({ weekday: "Tue", date: null });
  });
});
