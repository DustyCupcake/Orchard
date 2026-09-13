// Pure grouping/filtering helpers for the board's alternate views
// (docs/spec.md's Views: "sort by phase/deadline → schedule" and
// "group by branch → coordinator coverage") — kept separate from
// crud.ts's DB-backed listTasksWithAssignments so they're trivially
// unit-testable against plain fixtures, no Postgres required.

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
