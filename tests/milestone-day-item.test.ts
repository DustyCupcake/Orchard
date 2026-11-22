import { describe, expect, it } from "vitest";
import { milestoneDayItem } from "@/lib/tasks";

// No database. A milestone's date is written in terms of its task's event and
// a phase; this is which phase (docs/plans/day-labels-plan.md D1/D2).

const task = { cycleId: "c1", phaseId: "recruit" };

describe("milestoneDayItem", () => {
  it("uses the phase a milestone points at", () => {
    expect(milestoneDayItem({ parentType: "phase", phaseId: "build" }, task)).toEqual({ cycleId: "c1", phaseId: "build" });
  });

  it("uses the task's own phase when a phase milestone leaves it null", () => {
    expect(milestoneDayItem({ parentType: "phase", phaseId: null }, task)).toEqual({ cycleId: "c1", phaseId: "recruit" });
  });

  it("uses the task's own phase for a cycle-relative or absolute milestone, so a Recruitment task stays in Recruitment's terms", () => {
    expect(milestoneDayItem({ parentType: "cycle", phaseId: null }, task)).toEqual({ cycleId: "c1", phaseId: "recruit" });
    expect(milestoneDayItem({ parentType: null, phaseId: null }, task)).toEqual({ cycleId: "c1", phaseId: "recruit" });
  });

  it("has no phase for a task with none, and no scope at all for a task with no event", () => {
    expect(milestoneDayItem({ parentType: "cycle", phaseId: null }, { cycleId: "c1", phaseId: null })).toEqual({
      cycleId: "c1",
      phaseId: null,
    });
    expect(milestoneDayItem({ parentType: null, phaseId: null }, { cycleId: null, phaseId: null })).toEqual({
      cycleId: null,
      phaseId: null,
    });
  });
});
