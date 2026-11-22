import { describe, expect, it } from "vitest";
import { buildDayScopes, createDayLabeler, formatInstant } from "@/lib/dates";

// No database: the labeler is pure over the events it is handed. The
// loader that fetches them is covered in tests/day-scopes.test.ts.

const cycles = [
  { id: "c1", name: "Peach Please", startDate: "2027-03-04", endDate: "2027-03-07" },
  { id: "c2", name: "Long Summer", startDate: "2027-06-01", endDate: "2027-08-31" },
  { id: "c3", name: "Undated", startDate: null, endDate: null },
];
const phases = [
  { id: "setup", cycleId: "c1", name: "Set-up", order: 1, startDate: "2027-03-01", endDate: "2027-03-03" },
  { id: "recruit", cycleId: "c1", name: "Recruitment", order: 2, startDate: "2027-03-04", endDate: "2027-03-06" },
  { id: "build", cycleId: "c1", name: "Build", order: 3, startDate: "2027-03-04", endDate: "2027-03-05" },
  { id: "week1", cycleId: "c2", name: "Week 1", order: 1, startDate: "2027-06-01", endDate: "2027-06-07" },
  { id: "orphan", cycleId: "gone", name: "Orphan", order: 1, startDate: "2027-03-01", endDate: "2027-03-02" },
];
const scopes = buildDayScopes(cycles, phases);
const period = createDayLabeler("period", scopes);
const exact = createDayLabeler("exact", scopes);

describe("buildDayScopes", () => {
  it("gathers each event's phases under it and drops phases of unlisted events", () => {
    expect([...scopes.keys()]).toEqual(["c1", "c2", "c3"]);
    expect(scopes.get("c1")?.phases.map((p) => p.name)).toEqual(["Set-up", "Recruitment", "Build"]);
    expect(scopes.get("c3")?.phases).toEqual([]);
  });
});

describe("createDayLabeler", () => {
  it("labels a day from the item's event and phase", () => {
    expect(period.label("2027-03-02", { cycleId: "c1" }).visible).toBe("Peach Please · Set-up · Tue");
    expect(period.label("2027-03-07", { cycleId: "c1" }).visible).toBe("Peach Please · Sun");
  });

  it("finds the event from a phase alone", () => {
    expect(period.label("2027-03-02", { phaseId: "setup" }).visible).toBe("Peach Please · Set-up · Tue");
  });

  it("holds an item to its own phase, even where a narrower one overlaps", () => {
    expect(period.label("2027-03-05", { cycleId: "c1", phaseId: "recruit" }).visible).toBe(
      "Peach Please · Recruitment · Fri",
    );
    // No phase of its own: the narrowest guess.
    expect(period.label("2027-03-05", { cycleId: "c1" }).visible).toBe("Peach Please · Build · Fri");
  });

  it("is a plain date with no event, an unknown event, or one that isn't short or has no dates", () => {
    expect(period.label("2027-03-05").visible).toBe("Mar 5, 2027");
    expect(period.label("2027-03-05", {}).visible).toBe("Mar 5, 2027");
    expect(period.label("2027-03-05", { cycleId: "nope" }).visible).toBe("Mar 5, 2027");
    expect(period.label("2027-07-04", { cycleId: "c2" }).visible).toBe("Jul 4, 2027"); // longer than a week
    expect(period.label("2027-03-05", { cycleId: "c3" }).visible).toBe("Mar 5, 2027"); // no dates
    expect(period.label("2027-06-03", { cycleId: "c2" }).visible).toBe("Long Summer · Week 1 · Thu");
  });

  it("is a plain date in exact mode whatever the item says", () => {
    expect(exact.label("2027-03-02", { cycleId: "c1" }).visible).toBe("Mar 2, 2027");
    expect(exact.heading("2027-03-05", { cycleId: "c1" })).toBe("Friday, March 5");
    expect(exact.columnHeading("2027-03-05", { cycleId: "c1" })).toEqual({ weekday: "Fri", date: "Mar 5" });
  });

  it("writes headings and column headings in a short period", () => {
    expect(period.heading("2027-03-05", { cycleId: "c1" }, { cycleId: "c1", phaseId: "build" })).toBe("Friday");
    expect(period.heading("2027-03-05", { cycleId: "c1" })).toBe("Peach Please · Build · Friday");
    expect(period.columnHeading("2027-03-05", { cycleId: "c1" })).toEqual({ weekday: "Fri", date: null });
    expect(period.columnHeading("2027-03-09", { cycleId: "c1" })).toEqual({ weekday: "Tue", date: "Mar 9" });
  });

  it("writes a shift's time the same way", () => {
    const start = new Date("2027-03-05T14:00:00+01:00");
    const end = new Date("2027-03-05T15:30:00+01:00");
    expect(period.shiftRange(start, end, "Europe/Madrid", { cycleId: "c1" }, { cycleId: "c1" })).toBe(
      "Build · Fri, 14:00–15:30",
    );
    expect(period.shiftRange(start, end, "Europe/Madrid")).toBe("Mar 5, 2027, 14:00–15:30");
    expect(exact.shiftRange(start, end, "Europe/Madrid", { cycleId: "c1" })).toBe("Mar 5, 2027, 14:00–15:30");
  });

  it("labels the day an instant falls on in a zone, for a feed row with no time to show", () => {
    // 23:30 on 5 March in Madrid is 22:30 UTC the same day; 00:30 on the 6th is still the 5th in UTC.
    const lateFriday = new Date("2027-03-05T23:30:00+01:00");
    const pastMidnight = new Date("2027-03-06T00:30:00+01:00");
    expect(period.instantLabel(lateFriday, "Europe/Madrid", { cycleId: "c1" }).visible).toBe("Peach Please · Build · Fri");
    expect(period.instantLabel(pastMidnight, "Europe/Madrid", { cycleId: "c1" }).visible).toBe("Peach Please · Recruitment · Sat");
    // The zone decides the day, not the host: the same instant is Friday in UTC.
    expect(period.instantLabel(pastMidnight, "UTC", { cycleId: "c1" }).visible).toBe("Peach Please · Build · Fri");
    // No event, or outside every period: the plain date.
    expect(period.instantLabel(lateFriday, "Europe/Madrid").visible).toBe("Mar 5, 2027");
    expect(period.instantLabel(new Date("2027-03-20T12:00:00Z"), "UTC", { cycleId: "c1" }).visible).toBe("Mar 20, 2027");
  });

  it("reads an instant in Exact mode exactly as formatInstant's date style always did", () => {
    for (const iso of ["2027-03-05T23:30:00+01:00", "2027-03-06T00:30:00+01:00", "2027-12-31T23:59:00Z", "2027-01-01T00:00:00Z"]) {
      for (const zone of ["Europe/Madrid", "UTC", "Pacific/Auckland", "America/New_York"]) {
        expect(exact.instantLabel(new Date(iso), zone, { cycleId: "c1" }).visible).toBe(formatInstant(new Date(iso), zone, "date"));
      }
    }
  });

  it("reports its mode", () => {
    expect(period.mode).toBe("period");
    expect(exact.mode).toBe("exact");
  });
});
