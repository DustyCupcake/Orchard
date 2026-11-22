import type { listTasksWithAssignments, PhaseGroup } from "@/lib/tasks";
import { getDayLabeler } from "@/lib/day-labeler";
import { Tag } from "@/components/ui/kit";
import TaskCard from "./TaskCard";

type BoardTask = Awaited<ReturnType<typeof listTasksWithAssignments>>[number];

const STATUS_COLUMNS = [
  { status: "unclaimed", label: "Unclaimed" },
  { status: "claimed", label: "Claimed" },
  { status: "waiting", label: "Waiting" },
  { status: "done", label: "Done" },
] as const;

const SHOWN_BY_DEFAULT = 5;

// One phase as a card, not a column — a Community can have any number
// of phases (unlike status, a fixed four), so a card-plus-show-more
// list scales where a kanban column wouldn't. Reuses the exact same
// TaskCard the kanban view renders; only the grouping/layout differs.
export default async function PhaseCard({
  group,
  tierNames,
  branchNameById,
  currentMemberId,
  myPendingRequests,
  isCoordinationHolderForTask,
  coordinationNameFor,
  backstopNameFor,
}: {
  group: PhaseGroup<BoardTask>;
  tierNames: Map<string, string>;
  branchNameById: Map<string, string>;
  currentMemberId: string;
  myPendingRequests: Map<string, string>;
  isCoordinationHolderForTask: (t: BoardTask) => boolean;
  coordinationNameFor: (t: BoardTask) => string | null;
  backstopNameFor: (t: BoardTask) => string | null;
}) {
  const shown = group.tasks.slice(0, SHOWN_BY_DEFAULT);
  const rest = group.tasks.slice(SHOWN_BY_DEFAULT);
  const cycleIds = new Set(group.tasks.map((task) => task.cycleId).filter((id): id is string => id !== null));
  // The card's own start and end, read in terms of this phase (src/lib/dates/
  // day-labeler.ts). The card's title already names the phase, so the dates
  // read as just "Mon – Fri" inside a short phase. A card that merges
  // same-named phases of several open events has no single event to read them
  // against, so it keeps plain dates, as it always did.
  const labeler = await getDayLabeler();
  const item = cycleIds.size === 1 ? { cycleId: [...cycleIds][0], phaseId: group.phaseId } : { cycleId: null };
  const view = { cycleId: item.cycleId, phaseId: group.phaseId };
  const startLabel = labeler.label(group.startDate, item, view);
  const endLabel = labeler.label(group.endDate, item, view);

  const renderTask = (t: BoardTask) => (
    <TaskCard
      key={t.id}
      task={t}
      assignments={t.assignments}
      requirements={t.requirements}
      unmetRequirements={t.unmetRequirements}
      groupCoverage={t.groupCoverage}
      tierNames={tierNames}
      branchName={branchNameById.get(t.branchId) ?? "—"}
      currentMemberId={currentMemberId}
      myPendingRequestId={myPendingRequests.get(t.id) ?? null}
      isCoordinationHolderForTask={isCoordinationHolderForTask(t)}
      coordinationName={coordinationNameFor(t)}
      backstopName={backstopNameFor(t)}
      dayView={view}
    />
  );

  return (
    <div className="mb-6 rounded-[var(--radius-md)] border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h3 className="text-[length:var(--text-heading)] font-semibold text-[var(--text)]">{group.name}</h3>
        {(group.startDate || group.endDate) && (
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            <span title={`${startLabel.exact} – ${endLabel.exact}`}>
               <time dateTime={group.startDate ?? undefined} aria-label={startLabel.exact}>{startLabel.visible}</time> – <time dateTime={group.endDate ?? undefined} aria-label={endLabel.exact}>{endLabel.visible}</time>
             </span>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {STATUS_COLUMNS.map((col) => (
          <Tag key={col.status}>
            {col.label}: {group.tasks.filter((t) => t.status === col.status).length}
          </Tag>
        ))}
      </div>

      <div className="mt-3">
        {group.tasks.length === 0 && <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">No tasks.</p>}
        {shown.map(renderTask)}
        {rest.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--accent-1)]">
              Show {rest.length} more
            </summary>
            <div className="mt-3">{rest.map(renderTask)}</div>
          </details>
        )}
      </div>
    </div>
  );
}
