"use client";

import { useMemo, useRef, useState } from "react";
import { BUTTON_SECONDARY, LABEL } from "@/components/ui/kit";
import { formatTimeInZone } from "@/lib/dates";
// Deep import, deliberately not the @/lib/event-scheduling barrel. The
// barrel re-exports crud.ts, which reaches @/db and the postgres driver,
// whose node built-ins (fs, net, tls) don't resolve in a client bundle —
// so a client component reaching for the barrel fails the build with a
// module-not-found on 'fs'. The earlier PreferredSlotsEditor could use the
// barrel only because its EventSlot import was type-only and erased.
import {
  CELL_MINUTES,
  GRID_ROWS_PER_DAY,
  expandWindowsToCells,
  gridCellInstant,
  gridDayHeading,
  gridDayLabel,
  gridDays,
  gridRowHourLabel,
  gridWeeks,
} from "@/lib/event-scheduling/availability";
import type { EventSlot } from "@/lib/event-scheduling/crud";

const ROWS_PER_HOUR = 60 / CELL_MINUTES;
// The whole day, 06:00 to 06:00, so an evening or early-morning session
// doesn't need the grid rebuilt for a wider range first — see
// gridRowWallClock for why the day starts at six.
const ROW_COUNT = GRID_ROWS_PER_DAY;
const CELL_MS = CELL_MINUTES * 60_000;

/**
 * A host painting the times they could do a proposal, rather than typing
 * them.
 *
 * Deliberately modelled on Scheduling polls' AvailabilityGrid — same
 * click-or-drag paint, same half-hour cells, same click-then-drag
 * interaction — but not a reuse of it, and the differences are the point:
 *
 * - **The event's clock, not the viewer's.** That grid says so in its own
 *   header comment and means it: a poll asks "when are *you* free", which
 *   is about the viewer. This asks when the thing can happen, which the
 *   venue decides, not wherever the person submitting happens to be. Two
 *   hosts in different zones painting the same event would otherwise
 *   produce grids that mean different moments.
 * - **No fetch.** That grid POSTs on its own button because a poll is a
 *   re-openable submission in its own right. Availability here is one
 *   field of a proposal that submits as a whole, so this paints into
 *   hidden inputs on the surrounding form and lets the Server Action save
 *   it — the same contract as LineItemsEditor and AgendaItemForm's
 *   options list.
 *
 * Cells are absolute UTC instants, each built by resolving that row's wall
 * clock in the event's zone. DST falls out of instantFromZoned's own
 * two-pass offset read; a transition day simply has one instant claimed by
 * two wall clocks, and the Set collapses them.
 *
 * Duration is owned here rather than sitting in the surrounding form
 * because the summary line below depends on it — "that leaves four ways to
 * start a 90-minute session" is the whole reason painting is better than
 * typing, so it should update as the host types the length.
 */
export default function AvailabilityGrid({
  rangeStart,
  rangeEnd,
  timeZone,
  initialWindows,
  initialDurationMinutes,
}: {
  /** YYYY-MM-DD, inclusive — the days shown as columns. */
  rangeStart: string;
  rangeEnd: string;
  timeZone: string;
  initialWindows: EventSlot[];
  initialDurationMinutes: number;
}) {
  // A week at a time: an event can run for months, and a column per day
  // for all of them is a wide, slow grid nobody can scan. What's painted
  // is held outside the page state, so moving between weeks keeps it.
  const weeks = useMemo(() => gridWeeks(gridDays(rangeStart, rangeEnd)), [rangeStart, rangeEnd]);
  const [weekIndex, setWeekIndex] = useState(0);
  const week = Math.min(weekIndex, Math.max(0, weeks.length - 1));
  const days = weeks[week] ?? [];
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(expandWindowsToCells(initialWindows)),
  );
  const [duration, setDuration] = useState(String(initialDurationMinutes || ""));
  const dragging = useRef(false);
  const paintValue = useRef(true);

  const durationMinutes = Number(duration) || 0;

  function paint(iso: string, value: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(iso);
      else next.delete(iso);
      return next;
    });
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>, iso: string) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = true;
    paintValue.current = !selected.has(iso);
    paint(iso, paintValue.current);
  }

  function onEnter(iso: string) {
    if (!dragging.current) return;
    paint(iso, paintValue.current);
  }

  const cells = [...selected].sort();
  const placements = durationMinutes > 0 ? countPlacements(cells, durationMinutes) : 0;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Duration (minutes)</span>
        <input
          type="number"
          name="durationMinutes"
          min={1}
          required
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="w-fit rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5"
        />
      </label>

      <span className={LABEL}>When could you do it?</span>

      {weeks.length > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={week === 0}
            onClick={() => setWeekIndex(week - 1)}
            className={BUTTON_SECONDARY}
          >
            Previous week
          </button>
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            {gridDayLabel(days[0])} – {gridDayLabel(days[days.length - 1])} · week{" "}
            {week + 1} of {weeks.length}
          </span>
          <button
            type="button"
            disabled={week === weeks.length - 1}
            onClick={() => setWeekIndex(week + 1)}
            className={BUTTON_SECONDARY}
          >
            Next week
          </button>
        </div>
      )}

      <input type="hidden" name="availabilityCells" value={JSON.stringify(cells)} />

      <div
        className="max-h-[420px] overflow-auto rounded-[var(--radius-md)] border border-[var(--border)]"
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
      >
        <div className="flex select-none">
          <div className="sticky left-0 z-10 flex shrink-0 flex-col bg-[var(--surface)]">
            <div className="h-10 w-9" />
            {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => (
              <div
                key={rowIdx}
                className={`h-[18px] pr-1 text-right text-[length:var(--text-micro)] text-[var(--text-muted)] ${rowIdx % ROWS_PER_HOUR === 0 ? "visible" : "invisible"}`}
              >
                {gridRowHourLabel(rowIdx)}
              </div>
            ))}
          </div>
          {days.map((day) => (
            // Columns share whatever width there is, so a short event gets
            // wide columns instead of a thin strip on the left; the minimum
            // is what keeps seven of them readable.
            <div key={day} className="flex min-w-[4.25rem] flex-1 flex-col">
              <div className="flex h-10 flex-col items-center justify-center text-[length:var(--text-meta)] leading-tight text-[var(--text-muted)]">
                <span>{gridDayHeading(day).weekday}</span>
                <span>{gridDayHeading(day).date}</span>
              </div>
              {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => {
                const iso = gridCellInstant(day, rowIdx, timeZone);
                if (!iso) {
                  // The wall clock this row names doesn't exist on this
                  // day (a DST gap). Render an inert cell rather than
                  // silently letting it paint the neighbouring instant.
                  return <div key={`${day}-${rowIdx}`} className="h-[18px] w-full bg-[var(--surface-sunken)]" />;
                }
                const isSelected = selected.has(iso);
                return (
                  <div
                    key={iso}
                    onPointerDown={(e) => onDown(e, iso)}
                    onPointerEnter={() => onEnter(iso)}
                    title={cellLabel(iso, timeZone)}
                    className={`h-[18px] border-l border-t ${rowIdx % ROWS_PER_HOUR === 0 ? "border-t-[var(--border)]" : "border-t-[var(--surface-sunken)]"} border-l-[var(--surface-sunken)] ${isSelected ? "bg-[var(--accent-1)]" : "bg-[var(--surface)]"} cursor-pointer`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          className={BUTTON_SECONDARY}
        >
          Clear
        </button>
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {selected.size === 0
            ? "Click, or click-and-drag, to paint the windows you could do this in."
            : `${formatMinutes(selected.size)} painted${
                durationMinutes > 0 ? `, which leaves ${placements} possible start${placements === 1 ? "" : "s"} for a ${durationMinutes}-minute session.` : "."
              }`}
        </span>
      </div>
      <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
        All times are in {timeZone}.
      </span>
    </div>
  );
}

function cellLabel(iso: string, timeZone: string): string {
  const end = new Date(new Date(iso).getTime() + CELL_MS).toISOString();
  return `${formatTimeInZone(iso, timeZone)} – ${formatTimeInZone(end, timeZone)}`;
}

function formatMinutes(cells: number): string {
  const total = cells * CELL_MINUTES;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h}h ${m}m`;
}

/**
 * Mirrors candidatePlacements in the lib, but over raw cells rather than
 * collapsed windows, so the counter doesn't round-trip on every repaint.
 *
 * Duplicated on purpose, and deliberately kept dumb: this is a label a
 * host reads, not a number anything is stored or acted on. The lib
 * version is what the Server Action and conflict detection trust, and
 * there is a test asserting the two agree on the cases that matter.
 */
function countPlacements(cells: string[], durationMinutes: number): number {
  if (durationMinutes <= 0 || cells.length === 0) return 0;
  const needed = Math.ceil(durationMinutes / CELL_MINUTES);

  const times = [...new Set(cells.map((c) => new Date(c).getTime()))].sort((a, b) => a - b);
  const runs: number[] = [];
  let run = 0;
  for (let i = 0; i < times.length; i++) {
    if (i > 0 && times[i] - times[i - 1] === CELL_MS) run += 1;
    else {
      if (run > 0) runs.push(run);
      run = 1;
    }
  }
  if (run > 0) runs.push(run);

  return runs.reduce((sum, r) => sum + Math.max(0, r - needed + 1), 0);
}