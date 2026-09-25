"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  bulkClaimAction,
  bulkMoveTasksAction,
  exportSelectedTasksAsPackAction,
} from "@/app/(app)/board/actions";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from "@/components/ui/kit";

type ExportableTask = {
  id: string;
  title: string;
  branchName: string;
};

type MoveBranch = { id: string; name: string };
type MoveCycle = { id: string; name: string };
type MovePhase = { id: string; name: string; cycleId: string };

type TaskSelectionContextValue = {
  availableIds: Set<string>;
  selectedIds: Set<string>;
  selectedCount: number;
  selectedClaimableTaskIds: string[];
  selectedExportableTasks: ExportableTask[];
  selectedMovableTaskIds: string[];
  moveBranches: MoveBranch[];
  moveCycles: MoveCycle[];
  movePhases: MovePhase[];
  returnTo: string;
  exportCycleId: string | null;
  canExport: boolean;
  exportOpen: boolean;
  moveOpen: boolean;
  toggle: (id: string, on: boolean) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
  openExport: () => void;
  closeExport: () => void;
  openMove: () => void;
  closeMove: () => void;
};

const TaskSelectionContext = createContext<TaskSelectionContextValue | null>(null);
const NO_CYCLE = "__none__";
const NO_PHASE = "__none__";

/**
 * The board is still server-rendered, but selection necessarily needs a
 * small shared client island: a checkbox on each card has to update the
 * action menu and the other cards without a page reload. The context is
 * optional so TaskCard can remain safe to render from any other surface.
 */
export function useTaskSelection() {
  return useContext(TaskSelectionContext);
}

export function TaskSelectionCheckbox({
  taskId,
  title,
}: {
  taskId: string;
  title: string;
}) {
  const selection = useTaskSelection();
  if (!selection || !selection.availableIds.has(taskId)) return null;

  return (
    <input
      type="checkbox"
      checked={selection.selectedIds.has(taskId)}
      onChange={(event) => selection.toggle(taskId, event.target.checked)}
      aria-label={`Select ${title} for batch actions`}
      title="Select for batch actions"
      data-task-id={taskId}
      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent-1)]"
    />
  );
}

export function TaskSelectionProvider({
  children,
  claimableTaskIds,
  movableTaskIds,
  exportableTasks,
  exportCycleId,
  canExport = false,
  branches,
  cycles,
  phases,
  returnTo,
}: {
  children: ReactNode;
  claimableTaskIds: string[];
  movableTaskIds: string[];
  exportableTasks: ExportableTask[];
  exportCycleId: string | null;
  canExport?: boolean;
  branches: MoveBranch[];
  cycles: MoveCycle[];
  phases: MovePhase[];
  returnTo: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  const claimableIds = useMemo(() => new Set(claimableTaskIds), [claimableTaskIds]);
  const movableIds = useMemo(() => new Set(movableTaskIds), [movableTaskIds]);
  const exportableIds = useMemo(
    () => new Set(exportableTasks.map((task) => task.id)),
    [exportableTasks],
  );
  const availableIds = useMemo(() => {
    const ids = new Set(movableIds);
    for (const id of claimableIds) ids.add(id);
    for (const id of exportableIds) ids.add(id);
    return ids;
  }, [claimableIds, exportableIds, movableIds]);

  // Filter at the context boundary as well as when toggling. This keeps
  // a selection from surviving a filter/view change if the page is ever
  // kept alive by a client navigation.
  const selectedIds = useMemo(() => {
    const next = new Set<string>();
    for (const id of selected) {
      if (availableIds.has(id)) next.add(id);
    }
    return next;
  }, [availableIds, selected]);

  // Next's client navigation can preserve this client island while the
  // server supplies a different view/filter set. Prune the source state
  // as well as the derived value so a task cannot reappear selected when
  // the user navigates back to the earlier view.
  useEffect(() => {
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => availableIds.has(id)));
      const unchanged = next.size === previous.size && [...previous].every((id) => next.has(id));
      return unchanged ? previous : next;
    });
    setExportOpen(false);
    setMoveOpen(false);
  }, [availableIds, canExport, exportCycleId]);

  const selectedClaimableTaskIds = useMemo(
    () => claimableTaskIds.filter((id) => selectedIds.has(id)),
    [claimableTaskIds, selectedIds],
  );
  const selectedExportableTasks = useMemo(
    () => exportableTasks.filter((task) => selectedIds.has(task.id)),
    [exportableTasks, selectedIds],
  );
  const selectedMovableTaskIds = useMemo(
    () => movableTaskIds.filter((id) => selectedIds.has(id)),
    [movableTaskIds, selectedIds],
  );

  const toggle = (id: string, on: boolean) => {
    if (!availableIds.has(id)) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const setAll = (on: boolean) => {
    setSelected(on ? new Set(availableIds) : new Set());
  };
  const clear = () => {
    setSelected(new Set());
    setExportOpen(false);
    setMoveOpen(false);
  };
  const openExport = () => {
    if (canExport && exportCycleId) {
      setMoveOpen(false);
      setExportOpen(true);
    }
  };
  const openMove = () => {
    setExportOpen(false);
    setMoveOpen(true);
  };

  const value: TaskSelectionContextValue = {
    availableIds,
    selectedIds,
    selectedCount: selectedIds.size,
    selectedClaimableTaskIds,
    selectedExportableTasks,
    selectedMovableTaskIds,
    moveBranches: branches,
    moveCycles: cycles,
    movePhases: phases,
    returnTo,
    exportCycleId,
    canExport,
    exportOpen,
    moveOpen,
    toggle,
    setAll,
    clear,
    openExport,
    closeExport: () => setExportOpen(false),
    openMove,
    closeMove: () => setMoveOpen(false),
  };

  return <TaskSelectionContext.Provider value={value}>{children}</TaskSelectionContext.Provider>;
}

// Keep the original default import working for callers outside the board
// while making the page's actual role explicit.
export default TaskSelectionProvider;

function ExportPanel({ selection }: { selection: TaskSelectionContextValue }) {
  if (!selection.exportCycleId) return null;

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[var(--text)]">
          Export selected as a Task Pack
        </h3>
        <button type="button" onClick={selection.closeExport} className={BUTTON_SECONDARY}>
          Close
        </button>
      </div>
      {selection.selectedExportableTasks.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Select one or more cards in this cycle before exporting.
        </p>
      ) : (
        <form action={exportSelectedTasksAsPackAction} className="mt-3 flex max-w-[520px] flex-col gap-2">
          <input type="hidden" name="cycleId" value={selection.exportCycleId} />
          <input type="hidden" name="returnTo" value={selection.returnTo} />
          {selection.selectedExportableTasks.map((task) => (
            <input key={task.id} type="hidden" name="taskIds" value={task.id} />
          ))}
          <label className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
            Pack name
            <input
              type="text"
              name="name"
              required
              className={INPUT}
              placeholder="e.g. Prep weekend pack"
            />
          </label>
          <ul className="max-h-40 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] p-2 text-[12px] text-[var(--text-muted)]">
            {selection.selectedExportableTasks.map((task) => (
              <li key={task.id} className="py-0.5">
                {task.title} <span>({task.branchName})</span>
              </li>
            ))}
          </ul>
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Export selected
          </button>
        </form>
      )}
    </div>
  );
}

function MovePanel({ selection }: { selection: TaskSelectionContextValue }) {
  const [cycleChoice, setCycleChoice] = useState("");
  const [phaseChoice, setPhaseChoice] = useState("");
  const cycleNameById = new Map(selection.moveCycles.map((cycle) => [cycle.id, cycle.name]));
  const phaseOptions = cycleChoice && cycleChoice !== NO_CYCLE
    ? selection.movePhases.filter((phase) => phase.cycleId === cycleChoice)
    : [];

  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-[var(--text)]">Move selected tasks</h3>
        <button type="button" onClick={selection.closeMove} className={BUTTON_SECONDARY}>
          Close
        </button>
      </div>
      {selection.selectedMovableTaskIds.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Select one or more cards before moving them.
        </p>
      ) : (
        <form action={bulkMoveTasksAction} className="mt-3 flex max-w-[620px] flex-col gap-2">
          {selection.selectedMovableTaskIds.map((id) => (
            <input key={id} type="hidden" name="taskIds" value={id} />
          ))}
          <input type="hidden" name="returnTo" value={selection.returnTo} />
          <label className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
            Branch
            <select name="branchId" defaultValue="" className={INPUT}>
              <option value="">Keep current branch</option>
              {selection.moveBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
            Cycle
            <select
              name="cycleId"
              value={cycleChoice}
              onChange={(event) => {
                const nextCycle = event.target.value;
                setCycleChoice(nextCycle);
                setPhaseChoice(nextCycle === NO_CYCLE ? NO_PHASE : "");
              }}
              className={INPUT}
            >
              <option value="">Keep current cycle</option>
              <option value={NO_CYCLE}>No cycle (unscoped)</option>
              {selection.moveCycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
            Phase
            <select
              name="phaseId"
              value={phaseChoice}
              onChange={(event) => setPhaseChoice(event.target.value)}
              disabled={!cycleChoice}
              className={INPUT}
            >
              <option value="">Keep current phase</option>
              {cycleChoice === NO_CYCLE && <option value={NO_PHASE}>No phase</option>}
              {phaseOptions.map((phase) => (
                <option key={phase.id} value={phase.id}>
                  {cycleNameById.get(phase.cycleId) ?? "Unknown cycle"} · {phase.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12px] text-[var(--text-muted)]">
            Leave a field on &ldquo;keep current&rdquo; to change only the placement you choose. Choose a
            cycle before choosing a phase; a cycle change clears an incompatible phase, and each
            task is validated independently.
          </p>
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Move selected
          </button>
        </form>
      )}
    </div>
  );
}

export function TaskSelectionBar() {
  const selection = useTaskSelection();
  if (!selection || selection.availableIds.size === 0) return null;

  const allSelected = selection.selectedIds.size === selection.availableIds.size;

  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => selection.setAll(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent-1)]"
          />
          Select all tasks in this view
        </label>
        <span className="text-[12px] text-[var(--text-muted)]" aria-live="polite">
          {selection.selectedCount} selected
        </span>
        {selection.selectedCount > 0 && (
          <button type="button" onClick={selection.clear} className="text-[12px] text-[var(--accent-1)] hover:underline">
            Clear selection
          </button>
        )}
        <span className="text-[12px] text-[var(--text-muted)]">
          Claim, export, and move are available from the ⋯ menu; each action applies only to
          eligible selected cards. A tag filter can define a cluster to select in one step.
        </span>
      </div>
      {selection.exportOpen && <ExportPanel selection={selection} />}
      {selection.moveOpen && <MovePanel selection={selection} />}
    </div>
  );
}

export function TaskSelectionActionMenu() {
  const selection = useTaskSelection();
  if (!selection || selection.availableIds.size === 0) return null;

  return (
    <>
      <span className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
        {selection.selectedCount === 0
          ? "Select tasks on cards to enable batch actions"
          : `${selection.selectedCount} task${selection.selectedCount === 1 ? "" : "s"} selected`}
      </span>
      {selection.selectedClaimableTaskIds.length > 0 && (
        <form action={bulkClaimAction} className="contents">
          <input type="hidden" name="returnTo" value={selection.returnTo} />
          {selection.selectedClaimableTaskIds.map((id) => (
            <input key={id} type="hidden" name="taskIds" value={id} />
          ))}
          <button type="submit">
            Claim selected ({selection.selectedClaimableTaskIds.length} of {selection.selectedCount})
          </button>
        </form>
      )}
      {selection.canExport && (
        selection.exportCycleId ? (
          <button type="button" onClick={selection.openExport}>
            Export selected as a Task Pack ({selection.selectedExportableTasks.length} of {selection.selectedCount})
          </button>
        ) : (
          <span className="px-3 py-2 text-[12px] text-[var(--text-muted)]">
            Narrow to one cycle to export a Task Pack
          </span>
        )
      )}
      {selection.selectedMovableTaskIds.length > 0 && (
        <button type="button" onClick={selection.openMove}>
          Move selected ({selection.selectedMovableTaskIds.length} of {selection.selectedCount})
        </button>
      )}
    </>
  );
}
