"use client";

import { useState } from "react";
import { INPUT, LABEL } from "./ui/kit";
import SegmentedControl from "./ui/SegmentedControl";

type Anchor = "cycle_start" | "cycle_end" | "phase_start" | "phase_end";
type RelativeMode = "offset" | "percent";
type TopMode = "absolute" | "cycle_relative" | "phase_relative";
export type DateFieldBase = "mode" | "absoluteDate" | "anchor" | "offsetDays" | "percent" | "targetDate" | "phaseId";

function topModeOf(mode: "absolute" | "relative" | undefined, anchor: Anchor | null | undefined): TopMode {
  if (mode === "absolute") return "absolute";
  if (mode === "relative") return anchor === "phase_start" || anchor === "phase_end" ? "phase_relative" : "cycle_relative";
  // No record at all (a fresh add/create form) — default to Cycle-relative,
  // not Absolute, since that's what stays portable when a Cycle is cloned.
  return "cycle_relative";
}

// Shared "When" fieldset — replaces the three near-identical copies that
// used to live in calendar/page.tsx's EventDateFields, tasks/[id]/page.tsx's
// MilestoneDateFields, and [cycleScope]/participation/page.tsx's
// PhaseBoundaryFields, all of which rendered every mode's fields at once
// (absolute date + anchor + offset + percent + target date, all visible
// regardless of which mode was actually selected). Modeled on
// EffortFields.tsx's pattern: local useState swaps which *uncontrolled*
// named fields render, so the server actions reading formData.get(...)
// need no changes. The two fields that no longer have a native form
// control backing them (the top mode and the anchor, both now button
// groups instead of <select>s) are carried by hidden inputs instead;
// every other field is either a real input/select or simply isn't
// rendered — same "absent from formData is fine" convention EffortFields
// already relies on.
export default function DateModeField({
  legend = "When",
  fieldNames,
  mode,
  relativeMode,
  anchor,
  absoluteDate,
  offsetDays,
  percent,
  phaseId,
  phases,
  phaseSelectDefaultLabel = "This task’s own Phase",
  footer,
}: {
  // Callers that already wrap this in their own labeled fieldset (e.g.
  // Phase boundaries' "Start"/"End" pair) override this instead of
  // nesting a second fieldset with its own legend.
  legend?: string;
  // A plain object, not a function — this is a Client Component, and
  // React can't serialize a closure across the server→client boundary
  // (only a "use server" action can cross that way). Each call site
  // computes this as a one-line Record literal instead of the mapper
  // function this used to be.
  fieldNames: Record<DateFieldBase, string>;
  mode?: "absolute" | "relative";
  relativeMode?: RelativeMode | null;
  anchor?: Anchor | null;
  absoluteDate?: string | null;
  offsetDays?: number | null;
  percent?: number | null;
  phaseId?: string | null;
  // Omitted (or empty) entirely hides the Phase-relative option — Calendar
  // events and Phase boundaries have no phase-anchor concept at all;
  // Task milestones pass this, but only when the Cycle actually has phases.
  phases?: { id: string; name: string }[];
  phaseSelectDefaultLabel?: string;
  footer?: React.ReactNode;
}) {
  const fieldName = (base: DateFieldBase) => fieldNames[base];
  const [topMode, setTopMode] = useState<TopMode>(() => topModeOf(mode, anchor));
  const [anchorEdge, setAnchorEdge] = useState<"start" | "end">(() =>
    anchor === "phase_end" || anchor === "cycle_end" ? "end" : "start",
  );
  const [relMode, setRelMode] = useState<RelativeMode>(relativeMode ?? "offset");

  const showPhaseRelative = !!phases && phases.length > 0;
  const computedAnchor: Anchor =
    topMode === "phase_relative"
      ? anchorEdge === "start"
        ? "phase_start"
        : "phase_end"
      : anchorEdge === "start"
        ? "cycle_start"
        : "cycle_end";
  const computedMode = topMode === "absolute" ? "absolute" : relMode === "offset" ? "relative_offset" : "relative_percent";

  return (
    <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <legend className="px-1 text-[12px] text-[var(--text-muted)]">{legend}</legend>

      <input type="hidden" name={fieldName("mode")} value={computedMode} />

      <div className="flex flex-col gap-2.5">
        <SegmentedControl
          value={topMode}
          onChange={setTopMode}
          options={[
            { value: "absolute", label: "Absolute" },
            { value: "cycle_relative", label: "Cycle-relative" },
            ...(showPhaseRelative ? [{ value: "phase_relative" as const, label: "Phase-relative" }] : []),
          ]}
        />

        {topMode === "absolute" && (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Date</span>
            <input type="date" name={fieldName("absoluteDate")} defaultValue={absoluteDate ?? ""} className={INPUT} />
          </label>
        )}

        {topMode !== "absolute" && (
          <>
            <input type="hidden" name={fieldName("anchor")} value={computedAnchor} />
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                size="sm"
                value={anchorEdge}
                onChange={setAnchorEdge}
                options={[
                  { value: "start", label: topMode === "phase_relative" ? "Phase start" : "Cycle start" },
                  { value: "end", label: topMode === "phase_relative" ? "Phase end" : "Cycle end" },
                ]}
              />
              <SegmentedControl
                size="sm"
                value={relMode}
                onChange={setRelMode}
                options={[
                  { value: "offset", label: "Days" },
                  { value: "percent", label: "Percent" },
                ]}
              />
            </div>

            {topMode === "phase_relative" && (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Phase</span>
                <select name={fieldName("phaseId")} defaultValue={phaseId ?? ""} className={INPUT}>
                  <option value="">{phaseSelectDefaultLabel}</option>
                  {phases?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {relMode === "offset" ? (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Offset days</span>
                <input type="number" name={fieldName("offsetDays")} defaultValue={offsetDays ?? ""} className={INPUT} />
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Percent 0-100</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  name={fieldName("percent")}
                  defaultValue={percent ?? ""}
                  className={INPUT}
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Or set the exact date (recalculates the value above)</span>
              <input type="date" name={fieldName("targetDate")} className={INPUT} />
            </label>
          </>
        )}
      </div>
      {footer}
    </fieldset>
  );
}
