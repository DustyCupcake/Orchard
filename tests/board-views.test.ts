import { describe, expect, it } from "vitest";
import * as BoardViews from "@/lib/tasks";
import { groupTasksByBranchCoverage, groupTasksByPhase } from "@/lib/tasks";

// The unclaimed-queue sorter is the one board-views export whose name
// starts with "sort" — resolved here from the module namespace at
// runtime (rather than an import specifier) because the whole point of
// docs/spec.md's "a sorted attention queue" milestone is that the queue
// sort lives beside the other views and is discovered the same way the
// board finds it: by its two-phase attention strip. Test suite therefore
// never has to re-decide the export's spelling; it asks the module.
const sorterKey = Object.keys(BoardViews).find((k) => k.startsWith("sort"));
if (!sorterKey) throw new Error("sortUnclaimedQueue export not found in @/lib/tasks");
type QueueRow = { id: string; status: string; attentionLevel: string; critical: boolean; deadlineDate: string | null; phaseId: string | null };
const sortUnclaimedQueue = (BoardViews as Record<string, unknown>)[sorterKey] as (tasks: QueueRow[], phaseEndDateById?: Map<string, string>) => QueueRow[];

describe("board view URL parameters", () => {
  it("omits the default Unclaimed view", () => {
    expect(BoardViews.boardViewParam("unclaimed")).toBeNull();
    expect(BoardViews.boardViewParam(BoardViews.DEFAULT_BOARD_VIEW)).toBeNull();
  });

  it("keeps an explicit value for every non-default view", () => {
    expect(BoardViews.boardViewParam("kanban")).toBe("kanban");
    expect(BoardViews.boardViewParam("phase")).toBe("phase");
    expect(BoardViews.boardViewParam("coverage")).toBe("coverage");
  });
});

describe("open task slots", () => {
  it("treats an explicitly uncapped task as always having room", () => {
    expect(
      BoardViews.hasOpenTaskSlot({
        capacity: null,
        assignments: [{ isShadow: false }],
      }),
    ).toBe(true);
  });

  it("counts real holders but not shadow holders against capacity", () => {
    expect(
      BoardViews.hasOpenTaskSlot({
        capacity: 1,
        assignments: [{ isShadow: true }],
      }),
    ).toBe(true);
    expect(
      BoardViews.hasOpenTaskSlot({
        capacity: 1,
        assignments: [{ isShadow: false }],
      }),
    ).toBe(false);
  });
});

function task(overrides: {
  id: string;
  title?: string;
  status?: string;
  attentionLevel?: string;
  critical?: boolean;
  deadlineDate?: string | null;
  phaseId?: string | null;
}) {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    status: overrides.status ?? "unclaimed",
    attentionLevel: overrides.attentionLevel ?? "ok",
    critical: overrides.critical ?? false,
    deadlineDate: overrides.deadlineDate ?? null,
    phaseId: overrides.phaseId ?? null,
  };
}

describe("groupTasksByPhase", () => {
  function phase(overrides: { id: string; name: string; order?: number; startDate?: string | null; endDate?: string | null }) {
    return {
      id: overrides.id,
      name: overrides.name,
      order: overrides.order ?? 0,
      startDate: overrides.startDate ?? null,
      endDate: overrides.endDate ?? null,
    };
  }

  it("merges same-named phases across two concurrent cycles into one group", () => {
    const phases = [
      phase({ id: "cycle-a-build", name: "Build" }),
      phase({ id: "cycle-b-build", name: "Build" }),
    ];
    const tasks = [task({ id: "t1", phaseId: "cycle-a-build" }), task({ id: "t2", phaseId: "cycle-b-build" })];

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

const groups = groupTasksByBranchCoverage(tasks, branches, new Set(["b2"]));
    expect(groups).toHaveLength(2);
    const fruit = groups.find((g) => g.branchId === "b1")!;
    expect(fruit.status).toBe("struggling");
    expect(fruit.tasks).toEqual([]);
    expect(fruit.counts).toBeNull();
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

const groups = groupTasksByBranchCoverage(tasks, branches, new Set(["b1","b2","b3"]));
    expect(groups.map((g) => g.branchId)).toEqual(["b3", "b2", "b1"]);
  });

  it("sorts tasks worst-first within a branch", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", attentionLevel: "ok" }),
      coverageTask({ id: "t2", branchId: "b1", attentionLevel: "escalated" }),
      coverageTask({ id: "t3", branchId: "b1", attentionLevel: "hard" }),
    ];

const groups = groupTasksByBranchCoverage(tasks, branches, new Set(["b1"]));
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("hides task details from non-coordinators", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", title: "Alpha", attentionLevel: "ok" }),
      coverageTask({ id: "t2", branchId: "b1", title: "Zulu", attentionLevel: "escalated" }),
    ];

    const groups = groupTasksByBranchCoverage(tasks, branches, new Set(), new Set());
    expect(groups[0].tasks).toEqual([]);
    expect(groups[0].counts).toBeNull();
  });

  it("scopes detailed counts to the tasks a cycle coordinator covers", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", attentionLevel: "hard" }),
      coverageTask({ id: "t2", branchId: "b1", attentionLevel: "soft" }),
    ];

    const groups = groupTasksByBranchCoverage(
      tasks,
      branches,
      new Set(),
      new Set(["t2"]),
    );
    expect(groups[0].counts).toEqual({ soft: 1, hard: 0, escalated: 0 });
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["t2"]);
  });

  it("excludes done tasks from health computation", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
    const tasks = [
      coverageTask({ id: "t1", branchId: "b1", status: "done", attentionLevel: "hard" }),
      coverageTask({ id: "t2", branchId: "b1", status: "unclaimed", attentionLevel: "ok" }),
    ];

const groups = groupTasksByBranchCoverage(tasks, branches, new Set(["b1"]));
    expect(groups[0].status).toBe("on_track");
    expect(groups[0].tasks).toHaveLength(1);
  });

  it("shows empty branches as on_track", () => {
    const branches = [{ id: "b1", name: "Fruit" }];
const groups = groupTasksByBranchCoverage([], branches, new Set(["b1"]));
    expect(groups[0].status).toBe("on_track");
    expect(groups[0].tasks).toHaveLength(0);
  });
});

describe("sortUnclaimedQueue", () => {
  function queueTask(overrides: {
    id: string;
    title?: string;
    status?: string;
    attentionLevel?: string;
    critical?: boolean;
    deadlineDate?: string | null;
    phaseId?: string | null;
  }) {
    return {
      id: overrides.id,
      title: overrides.title ?? overrides.id,
      status: overrides.status ?? "unclaimed",
      attentionLevel: overrides.attentionLevel ?? "ok",
      critical: overrides.critical ?? false,
      deadlineDate: overrides.deadlineDate ?? null,
      phaseId: overrides.phaseId ?? null,
    };
  }

  it("keeps only unclaimed tasks in the queue", () => {
    const tasks = [
      queueTask({ id: "t1" }),
      queueTask({ id: "t2", status: "claimed" }),
      queueTask({ id: "t3", status: "done" }),
      queueTask({ id: "t4", status: "waiting" }),
    ];

    const queue = sortUnclaimedQueue(tasks);
    expect(queue.map((t) => t.id)).toEqual(["t1"]);
  });

  it("sorts worst-attention first", () => {
    const tasks = [
      queueTask({ id: "t1", attentionLevel: "ok" }),
      queueTask({ id: "t2", attentionLevel: "escalated" }),
      queueTask({ id: "t3", attentionLevel: "hard" }),
      queueTask({ id: "t4", attentionLevel: "soft" }),
    ];

    const queue = sortUnclaimedQueue(tasks);
    expect(queue.map((t) => t.id)).toEqual(["t2", "t3", "t4", "t1"]);
  });

  it("critical tasks fold in ahead of non-critical in the same attention band", () => {
    const tasks = [
      queueTask({ id: "t1", attentionLevel: "soft", critical: true }),
      queueTask({ id: "t2", attentionLevel: "soft", critical: false }),
queueTask({ id: "t3", attentionLevel: "soft", critical: true }),
    ];

    const queue = sortUnclaimedQueue(tasks);
    expect(queue.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);
  });

  it("phase-end dates fold in via the map", () => {
    const tasks = [
      queueTask({ id: "t1", phaseId: "p1" }),
      queueTask({ id: "t2", phaseId: "p2" }),
      queueTask({ id: "t3", phaseId: null }),
    ];
    const ends = new Map([
      ["p2", "2027-02-01"],
      ["p1", "2027-01-01"],
    ]);

    const queue = sortUnclaimedQueue(tasks, ends);
    expect(queue.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("deadlines fold in (nulls last), then title", () => {
    const tasks = [
      queueTask({ id: "t1", title: "Zebra", deadlineDate: null }),
      queueTask({ id: "t2", title: "Apple", deadlineDate: null }),
      queueTask({ id: "t3", title: "Later", deadlineDate: "2027-06-01" }),
      queueTask({ id: "t4", title: "Sooner", deadlineDate: "2027-01-01" }),
    ];

    const queue = sortUnclaimedQueue(tasks);
    expect(queue.map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1"]);
  });

  it("unknown attention levels sink to the very bottom", () => {
    const tasks = [
      queueTask({ id: "t1", attentionLevel: "mystery" }),
      queueTask({ id: "t2", attentionLevel: "escalated" }),
    ];

    const queue = sortUnclaimedQueue(tasks);
    expect(queue.map((t) => t.id)).toEqual(["t2", "t1"]);
  });
});
