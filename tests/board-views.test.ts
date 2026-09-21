import { describe, expect, it } from "vitest";
import { groupTasksByBranchCoverage, groupTasksByPhase } from "@/lib/tasks";

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

describe("groupTasksByBranchCoverage", () => {
  function coverageTask(overrides: {
    id: string;
    branchId: string;
    title?: string;
    status?: string;
    attentionLevel?: string;
    critical?: boolean;
    deadlineDate?: string | null;
  }) {
    return {
      id: overrides.id,
      branchId: overrides.branchId,
      title: overrides.title ?? overrides.id,
      status: overrides.status ?? "unclaimed",
      attentionLevel: overrides.attentionLevel ?? "ok",
      critical: overrides.critical ?? false,
      deadlineDate: overrides.deadlineDate ?? null,
    };
  }

  it("groups active tasks by branch and computes public health status", () => {
    const branches = [
      { id: "b1", name: "Fruit" },
      { id: "b2", name: "Wood" },
    ];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", attentionLevel: "hard" }),
      coverageTask({ id: "t2", branchId: "b1", attentionLevel: "soft" }),
      coverageTask({ id: "t3", branchId: "b2", attentionLevel: "ok" }),
    ];

    const groups = groupTasksByBranchCoverage(tasks, branches, new Set());
    expect(groups).toHaveLength(2);

    const fruit = groups.find((g) => g.branchId === "b1")!;
    expect(fruit.status).toBe("struggling");
    expect(fruit.counts).toBeNull(); // not a coord holder
    expect(fruit.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);

    const wood = groups.find((g) => g.branchId === "b2")!;
    expect(wood.status).toBe("on_track");
    expect(wood.tasks.map((t) => t.id)).toEqual(["t3"]);
  });

  it("shows counts only for coordination holders of that branch", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", attentionLevel: "escalated" }),
      coverageTask({ id: "t2", branchId: "b1", attentionLevel: "soft" }),
    ];

    const groups = groupTasksByBranchCoverage(tasks, branches, new Set(["b1"]));
    expect(groups[0].counts).toEqual({ soft: 1, hard: 0, escalated: 1 });
  });

  it("sorts branches worst-first (struggling > attention_needed > on_track)", () => {
    const branches = [
      { id: "b1", name: "Alpha" },
      { id: "b2", name: "Beta" },
      { id: "b3", name: "Gamma" },
    ];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b2", attentionLevel: "soft" }),
      coverageTask({ id: "t2", branchId: "b3", attentionLevel: "hard" }),
      coverageTask({ id: "t3", branchId: "b1", attentionLevel: "ok" }),
    ];

    const groups = groupTasksByBranchCoverage(tasks, branches, new Set());
    expect(groups.map((g) => g.branchId)).toEqual(["b3", "b2", "b1"]);
  });

  it("sorts tasks worst-first within a branch", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", attentionLevel: "ok" }),
      coverageTask({ id: "t2", branchId: "b1", attentionLevel: "escalated" }),
      coverageTask({ id: "t3", branchId: "b1", attentionLevel: "hard" }),
    ];

    const groups = groupTasksByBranchCoverage(tasks, branches, new Set());
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("excludes done tasks from health computation", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", status: "done", attentionLevel: "hard" }),
      coverageTask({ id: "t2", branchId: "b1", status: "unclaimed", attentionLevel: "ok" }),
    ];

    const groups = groupTasksByBranchCoverage(tasks, branches, new Set());
    expect(groups[0].status).toBe("on_track");
    expect(groups[0].tasks).toHaveLength(1);
  });

  it("shows empty branches as on_track", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const groups = groupTasksByBranchCoverage([], branches, new Set());
    expect(groups[0].status).toBe("on_track");
    expect(groups[0].tasks).toHaveLength(0);
  });
});
