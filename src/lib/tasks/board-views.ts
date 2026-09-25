// Pure grouping/filtering helpers for the board's alternate views
// (docs/spec.md's Views: "sort by phase/deadline → schedule" and
// "group by branch → coordinator coverage") — kept separate from
// crud.ts's DB-backed listTasksWithAssignments so they're trivially
// unit-testable against plain fixtures, no Postgres required.

import { deriveBranchHealthStatus, type BranchHealthStatus } from "@/lib/dashboard";

export { BranchHealthStatus };

export const BOARD_VIEWS = ["unclaimed", "kanban", "phase", "coverage"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = "unclaimed";

/** Whether a task still has a real (non-shadow) holder slot available. */
export function hasOpenTaskSlot(task: {
  capacity: number | null;
  assignments: readonly { isShadow: boolean }[];
}): boolean {
  const held = task.assignments.filter((assignment) => !assignment.isShadow).length;
  return task.capacity === null || held < task.capacity;
}

// The board's tabs are URL-driven. Keep the omission rule next to the
// canonical list so changing the default landing cannot silently make a
// non-default tab link back to the queue (the old `view=kanban` tab
// had exactly that bug after Unclaimed became the default).
export function boardViewParam(view: BoardView): string | null {
  return view === DEFAULT_BOARD_VIEW ? null : view;
}

export interface PhaseGroupTask {
  id: string;
  phaseId: string | null;
  deadlineDate: string | null;
  title: string;
}

export interface PhaseGroup<T extends PhaseGroupTask> {
  name: string;
  order: number;
  startDate: string | null;
  endDate: string | null;
  tasks: T[];
}

interface PhaseRow {
  id: string;
  name: string;
  order: number;
  startDate: string | null;
  endDate: string | null;
}

// Groups by phase *name*, not id — merges same-named phases across
// concurrently-open cycles into one card, exactly matching
// src/lib/contribution.ts's getContributionBreakdown convention (a
// task with no phase, or whose phase isn't in the given `phases` list,
// lands in one "No phase" bucket sorted last via the same
// Number.MAX_SAFE_INTEGER sentinel Contribution already uses). Each
// group's tasks sort by deadlineDate (nulls last), then title.
export function groupTasksByPhase<T extends PhaseGroupTask>(tasks: T[], phases: PhaseRow[]): PhaseGroup<T>[] {
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const groups = new Map<string, PhaseGroup<T>>();

  for (const t of tasks) {
    const phaseRow = t.phaseId ? phaseById.get(t.phaseId) : undefined;
    const name = phaseRow?.name ?? "No phase";
    if (!groups.has(name)) {
      groups.set(name, {
        name,
        order: phaseRow?.order ?? Number.MAX_SAFE_INTEGER,
        startDate: phaseRow?.startDate ?? null,
        endDate: phaseRow?.endDate ?? null,
        tasks: [],
      });
    }
    groups.get(name)!.tasks.push(t);
  }

  for (const group of groups.values()) {
    group.tasks.sort((a, b) => {
      if (a.deadlineDate && b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate);
      if (a.deadlineDate) return -1;
      if (b.deadlineDate) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  return Array.from(groups.values()).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

// Task shape needed for branch coverage — a subset of what
// listTasksWithAssignments returns, kept minimal so tests need
// no Postgres.
export interface BranchCoverageTask {
  id: string;
  branchId: string;
  title: string;
  status: string;
  attentionLevel: string;
  critical: boolean;
  deadlineDate: string | null;
}

export interface BranchCoverageGroup<T extends BranchCoverageTask> {
  branchId: string;
  branchName: string;
  status: BranchHealthStatus;
  counts: { soft: number; hard: number; escalated: number } | null;
  tasks: T[];
}

// "group by branch → coordinator coverage" — docs/spec.md's Views.
// Public status (on_track/attention_needed/struggling) is for everyone;
// detailed task lists, counts, and triage ordering are limited to the
// coordination authority that covers the task. A cycle-row coordinator
// sees that cycle's tasks; a branch-column coordinator sees the whole
// branch. A branch with no active tasks is on_track.
export function groupTasksByBranchCoverage<T extends BranchCoverageTask>(
  tasks: T[],
  branches: { id: string; name: string }[],
  coordinationBranchIds: Set<string>,
  coordinationTaskIds?: ReadonlySet<string>,
): BranchCoverageGroup<T>[] {
  const groups = new Map<string, BranchCoverageGroup<T>>();
  for (const b of branches) {
    groups.set(b.id, {
      branchId: b.id,
      branchName: b.name,
      status: "on_track",
      counts: null,
      tasks: [],
    });
  }

  // Only active (non-done) tasks count toward branch health
  const activeTasks = tasks.filter((t) => t.status !== "done");

  for (const t of activeTasks) {
    const group = groups.get(t.branchId);
    if (group) group.tasks.push(t);
  }

  for (const group of groups.values()) {
    const hasBranchAuthority = coordinationBranchIds.has(group.branchId);
    const isCoordinatorTask = (task: T) =>
      coordinationTaskIds
        ? coordinationTaskIds.has(task.id)
        : hasBranchAuthority;
    const coordinatorTasks = group.tasks.filter(isCoordinatorTask);
    const publicCounts = {
      soft: group.tasks.filter((t) => t.attentionLevel === "soft").length,
      hard: group.tasks.filter((t) => t.attentionLevel === "hard").length,
      escalated: group.tasks.filter((t) => t.attentionLevel === "escalated").length,
    };
    group.status = deriveBranchHealthStatus(publicCounts);

    // A branch-column coordinator sees every active task in the branch;
    // a cycle-row coordinator sees only the tasks in the cycle(s) they
    // hold. Everyone else receives the public status without the task
    // list or its detailed attention ordering.
    group.tasks = hasBranchAuthority ? group.tasks : coordinatorTasks;

    if (hasBranchAuthority || coordinatorTasks.length > 0) {
      group.counts = {
        soft: coordinatorTasks.filter((t) => t.attentionLevel === "soft").length,
        hard: coordinatorTasks.filter((t) => t.attentionLevel === "hard").length,
        escalated: coordinatorTasks.filter((t) => t.attentionLevel === "escalated").length,
      };
    }

    const attentionOrder: Record<string, number> = { escalated: 0, hard: 1, soft: 2, ok: 3 };
    group.tasks.sort((a, b) => {
      const ao = attentionOrder[a.attentionLevel] ?? 99;
      const bo = attentionOrder[b.attentionLevel] ?? 99;
      if (ao !== bo) return ao - bo;
      if (a.deadlineDate && b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate);
      if (a.deadlineDate) return -1;
      if (b.deadlineDate) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  // Sort: struggling first, then attention_needed, then on_track
  const statusOrder: Record<BranchHealthStatus, number> = { struggling: 0, attention_needed: 1, on_track: 2 };
  return Array.from(groups.values()).sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || a.branchName.localeCompare(b.branchName),
  );
}

// Task shape needed for the default "Unclaimed" attention queue — the
// subset of listTasksWithAssignments rows the queue sort needs, kept
// minimal so tests need no Postgres (same convention as PhaseGroupTask
// / BranchCoverageTask above). Status is included so the queue can
// fuse the "only show unclaimed" rule into the same step that orders
// them rather than expecting callers to filter first.
export interface QueueTask {
  id: string;
  title: string;
  status: string;
  attentionLevel: string;
  critical: boolean;
  deadlineDate: string | null;
  phaseId: string | null;
}

// "Surfacing, not deciding" — Phase 50's own posture, applied to the
// default landing. The queue is *not* a second sort option you can
// flip on; it's what the board shows first. It leans on the same
// worst-first attention hierarchy the board's attention strip already
// computes (escalated > hard > soft > ok), then folds in the two
// things docs/spec.md's Views actually care about — "critical" and
// soonest phase-end — because a task whose phase closes next week is
// more claimable-than-tomorrow than one in a phase that runs all
// cycle. Criticality and near-phase-ends get folded into the queue's
// own attention, exactly the "incorporate dates and criticality into
// the attention/criticality calculation" the exploration asked for.
export function sortUnclaimedQueue<T extends QueueTask>(
  tasks: T[],
  phaseEndDateById: Map<string, string> = new Map(),
): T[] {
  return tasks
    .filter((t) => t.status === "unclaimed")
    .sort((a, b) => {
      const attentionOrder: Record<string, number> = { escalated: 0, hard: 1, soft: 2, ok: 3 };
      const ao = attentionOrder[a.attentionLevel] ?? 99;
      const bo = attentionOrder[b.attentionLevel] ?? 99;
      if (ao !== bo) return ao - bo;

      if (a.critical !== b.critical) return a.critical ? -1 : 1;

      const aPhaseEnd = a.phaseId ? phaseEndDateById.get(a.phaseId) : undefined;
      const bPhaseEnd = b.phaseId ? phaseEndDateById.get(b.phaseId) : undefined;
      if (aPhaseEnd && bPhaseEnd) return aPhaseEnd.localeCompare(bPhaseEnd);
      if (aPhaseEnd) return -1;
      if (bPhaseEnd) return 1;

      if (a.deadlineDate && b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate);
      if (a.deadlineDate) return -1;
      if (b.deadlineDate) return 1;
      return a.title.localeCompare(b.title);
    });
}
