import type { listTasksWithAssignments, PhaseGroup } from "@/lib/tasks";
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
export default function PhaseCard({
  group,
  tierNames,
  branchNameById,
  currentMemberId,
  myPendingRequests,
  coordinationBranchIds,
}: {
  group: PhaseGroup<BoardTask>;
  tierNames: Map<string, string>;
  branchNameById: Map<string, string>;
  currentMemberId: string;
  myPendingRequests: Map<string, string>;
  coordinationBranchIds: Set<string>;
}) {
  const shown = group.tasks.slice(0, SHOWN_BY_DEFAULT);
  const rest = group.tasks.slice(SHOWN_BY_DEFAULT);

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
      isCoordinationHolderForBranch={coordinationBranchIds.has(t.branchId)}
    />
  );

  return (
    <div className="mb-6 rounded-[var(--radius-md)] border border-[var(--border)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">{group.name}</h3>
        {(group.startDate || group.endDate) && (
          <span className="text-[12px] text-[var(--text-muted)]">
            {group.startDate ?? "—"} – {group.endDate ?? "—"}
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
        {group.tasks.length === 0 && <p className="text-[13px] text-[var(--text-muted)]">No tasks.</p>}
        {shown.map(renderTask)}
        {rest.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[13px] font-medium text-[var(--accent-1)]">
              Show {rest.length} more
            </summary>
            <div className="mt-3">{rest.map(renderTask)}</div>
          </details>
        )}
      </div>
    </div>
  );
}
