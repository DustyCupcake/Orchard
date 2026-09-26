"use client";

import { useState } from "react";
import { INPUT, LABEL } from "./ui/kit";
import SegmentedControl from "./ui/SegmentedControl";

type DateMode = "absolute" | "relative";
type ParentType = "cycle" | "phase";

export type DateFieldBase = "mode" | "date" | "parentType" | "phaseId";

/**
 * The deliberately small authoring surface: choose absolute/relative,
 * then choose a date. The server derives the canonical relative recipe
 * from the selected parent period. One date input remains mounted while
 * switching modes, so a date is never accidentally discarded.
 */
export default function DateModeField({
  legend = "When",
  fieldNames,
  mode,
  date,
  parentType,
  phaseId,
  phases,
  phaseSelectDefaultLabel = "This task’s own Phase",
  defaultParentType,
  relativeAllowed = true,
  defaultMode = "relative",
  relativeHint,
  footer,
}: {
  legend?: string;
  fieldNames: Record<DateFieldBase, string>;
  mode?: DateMode;
  date?: string | null;
  parentType?: ParentType | null;
  phaseId?: string | null;
  phases?: { id: string; name: string }[];
  phaseSelectDefaultLabel?: string;
  defaultParentType?: ParentType;
  relativeAllowed?: boolean;
  defaultMode?: DateMode;
  relativeHint?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const initialMode: DateMode = mode === "relative" && !relativeAllowed ? "absolute" : mode ?? (relativeAllowed ? defaultMode : "absolute");
  const [selectedMode, setSelectedMode] = useState<DateMode>(initialMode);
  const [selectedParent, setSelectedParent] = useState<ParentType>(
    parentType ?? defaultParentType ?? (phases?.length ? "phase" : "cycle"),
  );

  const options = relativeAllowed
    ? [
        { value: "absolute" as const, label: "Absolute" },
        { value: "relative" as const, label: "Relative" },
      ]
    : [{ value: "absolute" as const, label: "Absolute" }];

  return (
    <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <legend className="px-1 text-[12px] text-[var(--text-muted)]">{legend}</legend>
      <input type="hidden" name={fieldNames.mode} value={selectedMode} />

      <div className="flex flex-col gap-2.5">
        <SegmentedControl value={selectedMode} onChange={setSelectedMode} options={options} />

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Date</span>
          <input type="date" name={fieldNames.date} defaultValue={date ?? ""} className={INPUT} />
        </label>

        {selectedMode === "relative" && phases && phases.length > 0 && (
          <>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Relative to</span>
              <select
                name={fieldNames.parentType}
                value={selectedParent}
                onChange={(e) => setSelectedParent(e.target.value as ParentType)}
                className={INPUT}
              >
                <option value="phase">This task’s Phase</option>
                <option value="cycle">The task’s Event</option>
              </select>
            </label>

            {selectedParent === "phase" && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Phase</span>
                <select name={fieldNames.phaseId} defaultValue={phaseId ?? ""} className={INPUT}>
                  <option value="">{phaseSelectDefaultLabel}</option>
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {selectedMode === "relative" && !phases?.length && (
          <input type="hidden" name={fieldNames.parentType} value="cycle" />
        )}

        {selectedMode === "relative" && relativeHint && (
          <p className="text-[12px] text-[var(--text-muted)]">{relativeHint}</p>
        )}
        {!relativeAllowed && (
          <p className="text-[12px] text-[var(--text-muted)]">
            A relative date needs at least one date on its parent period.
          </p>
        )}
      </div>
      {footer}
    </fieldset>
  );
}
