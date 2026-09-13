import { describe, expect, it } from "vitest";
import { groupTasksByPhase } from "@/lib/tasks";

// Pure grouping logic (see CHANGELOG.md's "Board views: a view switcher,
// a by-phase layout, and deadline milestones") — no database needed,
// unlike most of this test suite, since board-views.ts only ever
// operates on data callers have already fetched.
describe("groupTasksByPhase", () => {
  function task(overrides: { id: string; phaseId?: string | null; deadlineDate?: string | null; title?: string }) {
    return {
      id: overrides.id,
      title: overrides.title ?? overrides.id,
      phaseId: overrides.phaseId ?? null,
      deadlineDate: overrides.deadlineDate ?? null,
    };
  }

  it("merges same-named phases across two concurrent cycles into one group", async () => {
    const phases = [
      { id: "cycle-a-build", name: "Build", order: 1, startDate: "2027-02-01", endDate: "2027-03-01" },
      { id: "cycle-b-build", name: "Build", order: 1, startDate: "2028-02-01", endDate: "2028-03-01" },
    ];
    const tasks = [
      task({ id: "t1", phaseId: "cycle-a-build" }),
      task({ id: "t2", phaseId: "cycle-b-build" }),
    ];

    const groups = groupTasksByPhase(tasks, phases);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Build");
    expect(groups[0].tasks.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("phase-less tasks land in a 'No phase' bucket sorted after every named phase", () => {
    const phases = [{ id: "p1", name: "Recruiting", order: 0, startDate: null, endDate: null }];
    const tasks = [task({ id: "t1", phaseId: "p1" }), task({ id: "t2", phaseId: null })];

    const groups = groupTasksByPhase(tasks, phases);
    expect(groups.map((g) => g.name)).toEqual(["Recruiting", "No phase"]);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("a task whose phaseId isn't in the given phases list also lands in 'No phase'", () => {
    const tasks = [task({ id: "t1", phaseId: "some-deleted-phase" })];
    const groups = groupTasksByPhase(tasks, []);
    expect(groups.map((g) => g.name)).toEqual(["No phase"]);
  });

  it("sorts groups by phase order, then name for ties", () => {
    const phases = [
      { id: "p1", name: "Wind-down", order: 2, startDate: null, endDate: null },
      { id: "p2", name: "Planning", order: 0, startDate: null, endDate: null },
      { id: "p3", name: "Build", order: 1, startDate: null, endDate: null },
    ];
    const tasks = [task({ id: "t1", phaseId: "p1" }), task({ id: "t2", phaseId: "p2" }), task({ id: "t3", phaseId: "p3" })];

    const groups = groupTasksByPhase(tasks, phases);
    expect(groups.map((g) => g.name)).toEqual(["Planning", "Build", "Wind-down"]);
  });

  it("sorts tasks within a group by deadlineDate (nulls last), then title", () => {
    const phases = [{ id: "p1", name: "Build", order: 0, startDate: null, endDate: null }];
    const tasks = [
      task({ id: "t1", phaseId: "p1", title: "Zebra", deadlineDate: null }),
      task({ id: "t2", phaseId: "p1", title: "Apple", deadlineDate: null }),
      task({ id: "t3", phaseId: "p1", title: "Later", deadlineDate: "2027-06-01" }),
      task({ id: "t4", phaseId: "p1", title: "Sooner", deadlineDate: "2027-01-01" }),
    ];

    const groups = groupTasksByPhase(tasks, phases);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1"]);
  });
});
