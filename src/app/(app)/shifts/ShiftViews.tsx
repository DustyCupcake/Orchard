"use client";

import { useMemo, useState } from "react";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { BUTTON_SECONDARY } from "@/components/ui/kit";
import DayColumnsGrid, { type GridBlock, type GridColumn } from "@/components/shifts/DayColumnsGrid";
import DayGroupedList from "@/components/shifts/DayGroupedList";
import { useDaysPerPage } from "@/components/shifts/useDaysPerPage";
import { formatExactDate } from "@/lib/dates";
import {
  NO_FILTERS,
  addDaysToDay,
  assignLanes,
  calendarAxis,
  calendarWindowDays,
  groupShiftsByDay,
  maxLanesForDays,
  shiftMatchesFilters,
  shiftsByWindowDay,
  type ShiftViewFilters,
  type ShiftViewRow,
} from "@/lib/shifts/views";
import ShiftBlock, { ShiftOverflowChip, toneOfShift } from "./ShiftBlock";
import ShiftFilters from "./ShiftFilters";
import ShiftRowCard from "./ShiftRowCard";

/**
 * One event's shifts: the chronological, day-split list (the default) and a
 * List/Calendar toggle. Filters — tags, branch, day range and time overlap —
 * narrow the shift set both views read, so the calendar follows the filters
 * too. Everything here is the one event's, so every row reads on the same
 * clock. The pure logic (grouping, filtering, lanes, paging) lives in
 * src/lib/shifts/views.ts.
 */
export default function ShiftViews({
  rows,
  dayLabelByDay,
  branches,
}: {
  rows: ShiftViewRow[];
  /** Each day's heading as the viewer reads it — the DayLabeler's `heading`. */
  dayLabelByDay: Record<string, string>;
  branches: { id: string; name: string }[];
}) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filters, setFilters] = useState<ShiftViewFilters>(NO_FILTERS);
  // The calendar's first day; null = the earliest day any visible shift is on.
  const [pageStart, setPageStart] = useState<string | null>(null);
  const daysPerPage = useDaysPerPage();

  const tags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((r) => shiftMatchesFilters(r, filters)), [rows, filters]);

  const days = useMemo(() => [...new Set(filtered.map((r) => r.day))].sort(), [filtered]);
  const firstDay = days[0] ?? null;
  const lastDay = days[days.length - 1] ?? null;
  const start = pageStart ?? firstDay;
  const windowDays = useMemo(() => (start ? calendarWindowDays(start, daysPerPage) : []), [start, daysPerPage]);

  const byDay = useMemo(() => shiftsByWindowDay(filtered, windowDays), [filtered, windowDays]);
  const inWindow = useMemo(() => [...byDay.values()].flat(), [byDay]);
  const axis = useMemo(() => calendarAxis(inWindow), [inWindow]);
  const maxLanes = maxLanesForDays(daysPerPage);

  const groups = useMemo(
    () =>
      groupShiftsByDay(filtered, dayLabelByDay).map(({ label, rows: dayRows }) => ({
        label,
        items: dayRows.map((r) => <ShiftRowCard key={r.id} row={r} />),
      })),
    [filtered, dayLabelByDay],
  );

  const columns: GridColumn[] = useMemo(
    () =>
      windowDays.map((day) => {
        const dayRows = byDay.get(day) ?? [];
        const rowById = new Map(dayRows.map((r) => [r.id, r] as const));
        const { placements, chips } = assignLanes(
          dayRows.map((r) => ({ id: r.id, start: r.startOffset, end: r.endOffset, order: r.title })),
          maxLanes,
        );
        const blocks: GridBlock[] = [];
        for (const r of dayRows) {
          const p = placements.get(r.id);
          if (!p) continue; // folded into a chip
          blocks.push({
            key: r.id,
            startOffset: r.startOffset,
            endOffset: r.endOffset,
            lane: p.lane,
            lanes: p.lanes,
            tone: toneOfShift(r),
            content: <ShiftBlock row={r} />,
          });
        }
        for (const chip of chips) {
          blocks.push({
            key: `more-${chip.ids.join("-")}`,
            startOffset: chip.start,
            endOffset: chip.end,
            lane: chip.lane,
            lanes: chip.lanes,
            tone: "more",
            content: <ShiftOverflowChip rows={chip.ids.map((id) => rowById.get(id)!)} />,
          });
        }
        return { day, label: dayLabelByDay[day] ?? formatExactDate(day), blocks };
      }),
    [windowDays, byDay, dayLabelByDay, maxLanes],
  );

  const setFilter = (patch: Partial<ShiftViewFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPageStart(null);
  };

  const canGoBack = start !== null && firstDay !== null && start > firstDay;
  const canGoForward = start !== null && lastDay !== null && addDaysToDay(start, daysPerPage) <= lastDay;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegmentedControl
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List" },
            { value: "calendar", label: "Calendar" },
          ]}
        />
        <ShiftFilters tags={tags} branches={branches} filters={filters} setFilter={setFilter} dayFilters />
      </div>

      {filtered.length === 0 ? (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {rows.length === 0 ? "No upcoming shifts yet." : "No shifts match your filters."}
        </p>
      ) : view === "list" ? (
        <DayGroupedList groups={groups} />
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => start && setPageStart(addDaysToDay(start, -daysPerPage))}
              className={`${BUTTON_SECONDARY} disabled:opacity-40`}
            >
              Previous
            </button>
            <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
              {windowDays.length > 1
                ? `${formatExactDate(windowDays[0])} – ${formatExactDate(windowDays[windowDays.length - 1])}`
                : formatExactDate(windowDays[0])}
            </span>
            <button
              type="button"
              disabled={!canGoForward}
              onClick={() => start && setPageStart(addDaysToDay(start, daysPerPage))}
              className={`${BUTTON_SECONDARY} disabled:opacity-40`}
            >
              Next
            </button>
          </div>
          {axis ? (
            <DayColumnsGrid columns={columns} fromOffset={axis.fromOffset} toOffset={axis.toOffset} />
          ) : (
            <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">No shifts in this period.</p>
          )}
        </div>
      )}
    </div>
  );
}
