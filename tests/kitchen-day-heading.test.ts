import { describe, expect, it } from "vitest";
import { buildDayScopes, createDayLabeler } from "@/lib/dates";
import { dayHeading } from "@/lib/kitchen/day-heading";

// No database. How a day reads on the menu and shopping list: the weekday
// alone inside a short phase or event, the full date otherwise, and never the
// event's or phase's name.

const scopes = buildDayScopes(
  [
    { id: "c1", name: "Peach Please", startDate: "2027-03-04", endDate: "2027-03-07" },
    { id: "c2", name: "Long Summer", startDate: "2027-06-01", endDate: "2027-08-31" },
  ],
  [
    { id: "setup", cycleId: "c1", name: "Set-up", order: 1, startDate: "2027-03-01", endDate: "2027-03-03" },
    { id: "recruit", cycleId: "c1", name: "Recruitment", order: 2, startDate: "2027-03-04", endDate: "2027-03-06" },
    { id: "build", cycleId: "c1", name: "Build", order: 3, startDate: "2027-03-04", endDate: "2027-03-05" },
  ],
);
const period = createDayLabeler("period", scopes);
const exact = createDayLabeler("exact", scopes);

describe("kitchen dayHeading", () => {
  it("is the weekday alone for a day in a phase or in the event", () => {
    expect(dayHeading(period, "2027-03-02", { cycleId: "c1" })).toBe("Tuesday"); // Set-up
    expect(dayHeading(period, "2027-03-07", { cycleId: "c1" })).toBe("Sunday"); // event only
  });

  it("is the full date in exact mode, exactly as it always was", () => {
    expect(dayHeading(exact, "2027-03-05", { cycleId: "c1" })).toBe("Friday, March 5");
    expect(dayHeading(exact, "2027-03-05", { cycleId: null })).toBe("Friday, March 5");
  });

  it("is the full date for the standing menu, a long event, or a day outside every period", () => {
    expect(dayHeading(period, "2027-03-05", { cycleId: null })).toBe("Friday, March 5");
    expect(dayHeading(period, "2027-07-02", { cycleId: "c2" })).toBe("Friday, July 2");
    expect(dayHeading(period, "2027-03-20", { cycleId: "c1" })).toBe("Saturday, March 20");
  });

  it("holds a meal to its own phase rather than guessing another", () => {
    // Mar 2 is in Set-up. A meal with no phase of its own is placed there, by guess.
    expect(dayHeading(period, "2027-03-02", { cycleId: "c1" })).toBe("Tuesday");
    // A meal that belongs to Recruitment is not handed to Set-up; Recruitment doesn't
    // contain the day and nor does the event, so it reads as a full date.
    expect(dayHeading(period, "2027-03-02", { cycleId: "c1", phaseId: "recruit" })).toBe("Tuesday, March 2");
    // Inside its own phase it is a plain weekday.
    expect(dayHeading(period, "2027-03-05", { cycleId: "c1", phaseId: "recruit" })).toBe("Friday");
  });
});
