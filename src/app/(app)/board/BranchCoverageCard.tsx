import type { groupTasksByBranchCoverage } from "@/lib/tasks";
import type { BranchHealthStatus } from "@/lib/dashboard";
import type { listTasksWithAssignments } from "@/lib/tasks";
import { Tag } from "@/components/ui/kit";
import TaskCard from "./TaskCard";

type BoardTask = Awaited<ReturnType<typeof listTasksWithAssignments>>[number];
type BranchGroup = ReturnType<typeof groupTasksByBranchCoverage<BoardTask>>[number];

const SHOWN_BY_DEFAULT = 5;

const STATUS_LABEL: Record<BranchHealthStatus, string> = {
  on_track: "On track",
  attention_needed: "Attention needed",
  struggling: "Struggling",
};

const STATUS_TONE: Record<BranchHealthStatus, "success" | "warning" | "danger"> = {
  on_track: "success",
  attention_needed: "warning",
  struggling: "danger",
};

export default function BranchCoverageCard({
  group,
  tierNames,
  branchNameById,
  currentMemberId,
  myPendingRequests,
  coordinationBranchIds,
}: {
  group: BranchGroup;
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-[var(--text)]">{group.branchName}</h3>
          <Tag tone={STATUS_TONE[group.status]}>{STATUS_LABEL[group.status]}</Tag>
        </div>
        {group.counts && (
          <span className="text-[12px] text-[var(--text-muted)]">
            {group.counts.escalated > 0 && <span className="text-[var(--danger)]">{group.counts.escalated} escalated</span>}
            {group.counts.escalated > 0 && group.counts.hard > 0 && " · "}
            {group.counts.hard > 0 && <span className="text-[var(--danger)]">{group.counts.hard} hard</span>}
            {((group.counts.escalated > 0 || group.counts.hard > 0) && group.counts.soft > 0) && " · "}
            {group.counts.soft > 0 && <span className="text-[var(--warning)]">{group.counts.soft} soft</span>}
            {group.counts.escalated === 0 && group.counts.hard === 0 && group.counts.soft === 0 && "No flags"}
          </span>
        )}
      </div>

      <div className="mt-3">
        {group.tasks.length === 0 && <p className="text-[13px] text-[var(--text-muted)]">No active tasks.</p>}
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
