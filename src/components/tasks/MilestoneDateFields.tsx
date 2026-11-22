import type { getCycle } from "@/lib/cycles";
import { describeBoundaryRecipe } from "@/lib/dates";
import type { listTaskMilestones } from "@/lib/tasks";
import DateModeField, { type DateFieldBase } from "@/components/DateModeField";

type MilestoneRow = Awaited<ReturnType<typeof listTaskMilestones>>[number];
type CyclePhaseRow = Awaited<ReturnType<typeof getCycle>>["phases"][number];

const MILESTONE_DATE_FIELD_NAMES: Record<DateFieldBase, string> = {
  mode: "dateMode",
  date: "date",
  parentType: "parentType",
  phaseId: "milestonePhaseId",
};

// The milestone date editor, shared by the task edit screen
// (src/app/(app)/tasks/[id]/edit/page.tsx). Used to live inside the
// task page itself; moved out when the task's config editing moved to
// the edit screen (docs/plans/task-interface-plan.md D1).
export default function MilestoneDateFields({
  milestone,
  phases,
  cycleStartDate,
  cycleEndDate,
  taskPhaseId,
}: {
  milestone?: MilestoneRow;
  phases: CyclePhaseRow[];
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  taskPhaseId: string | null;
}) {
  const taskPhase = taskPhaseId ? phases.find((p) => p.id === taskPhaseId) : undefined;
  const defaultParentType = taskPhase?.startDate || taskPhase?.endDate ? "phase" : "cycle";
  const relativeAllowed = Boolean(cycleStartDate || cycleEndDate || phases.some((p) => p.startDate || p.endDate));
  const parentType = milestone?.parentType ?? defaultParentType;
  const resolvedDate = milestone?.resolvedDate ?? (milestone?.dateType === "absolute" ? milestone.absoluteDate : null);
  // The same prose the phase view uses for its own boundaries — see
  // lib/dates/describe.ts, which is why this isn't a third copy. A
  // milestone row has no cached `date` column (Phase boundaries do), so
  // the resolved date is threaded in under the shared shape's name.
  const recipe =
    milestone && resolvedDate
      ? describeBoundaryRecipe(
          {
            dateType: milestone.dateType,
            date: resolvedDate,
            relativeBasis: milestone.relativeBasis,
            relativeValue: milestone.relativeValue,
          },
          milestone.parentType === "phase" ? "the phase" : "the event",
        )
      : null;

  return (
    <DateModeField
      fieldNames={MILESTONE_DATE_FIELD_NAMES}
      mode={milestone ? (milestone.dateType === "relative" ? "relative" : "absolute") : undefined}
      date={resolvedDate}
      parentType={parentType}
      phaseId={milestone?.phaseId}
      phases={phases}
      phaseSelectDefaultLabel="This task’s own Phase"
      defaultParentType={defaultParentType}
      relativeAllowed={relativeAllowed}
      defaultMode={relativeAllowed ? "relative" : "absolute"}
      relativeHint="The task’s own Phase is the default parent; choose another Phase when this milestone belongs to a different one."
      footer={
        milestone &&
        resolvedDate && (
          <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            Currently: {resolvedDate}
            {recipe && ` — ${recipe}`}
          </p>
        )
      }
    />
  );
}
