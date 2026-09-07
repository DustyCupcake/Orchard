"use client";

import { useMemo, useRef, useState } from "react";
import { BUTTON_PRIMARY } from "@/components/ui/kit";

// A day-by-time paint grid — see docs/spec.md's "Availability input is
// a drag-select grid, not a typed-in range." Each cell represents one
// half-hour slot rendered in the VIEWER'S OWN local timezone (built
// from the browser's local Date constructor, not parsed as UTC), then
// submitted as an absolute ISO instant. Two viewers in different
// zones each paint their own local daytime hours, and the aggregate
// still counts overlapping *absolute* moments correctly — this is
// what "timezones render per viewer" means here, applied to the grid
// itself, not just the eventual confirmed time.
const START_HOUR = 8;
const END_HOUR = 22;
const SLOT_MINUTES = 30;
const ROWS_PER_HOUR = 60 / SLOT_MINUTES;
const ROW_COUNT = (END_HOUR - START_HOUR) * ROWS_PER_HOUR;

function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function buildDays(rangeStart: string, rangeEnd: string): Date[] {
  const start = parseDateLocal(rangeStart);
  const end = parseDateLocal(rangeEnd);
  const days: Date[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function cellDate(day: Date, rowIdx: number): Date {
  const totalMinutes = START_HOUR * 60 + rowIdx * SLOT_MINUTES;
  const d = new Date(day);
  d.setHours(0, totalMinutes, 0, 0);
  return d;
}

export default function AvailabilityGrid({
  pollId,
  rangeStart,
  rangeEnd,
  initialSelected,
  readOnly,
  submitUrl,
}: {
  pollId: string;
  rangeStart: string;
  rangeEnd: string;
  initialSelected: string[];
  readOnly: boolean;
  // Defaults to the ordinary authenticated-member endpoint — pass a
  // different URL for a non-member submitter (Phase 34's Recruitment
  // intro call, see /intro-call/[token]) to post to instead. The grid
  // interaction itself doesn't care who's submitting.
  submitUrl?: string;
}) {
  const days = useMemo(() => buildDays(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dragging = useRef(false);
  const paintValue = useRef(true);

  function paint(iso: string, value: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(iso);
      else next.delete(iso);
      return next;
    });
    setSaved(false);
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>, iso: string) {
    if (readOnly) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = true;
    paintValue.current = !selected.has(iso);
    paint(iso, paintValue.current);
  }

  function onEnter(iso: string) {
    if (readOnly || !dragging.current) return;
    paint(iso, paintValue.current);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(submitUrl ?? `/api/scheduling-polls/${pollId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slots: [...selected] }),
      });
      if (res.ok) {
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onPointerUp={() => (dragging.current = false)} onPointerLeave={() => (dragging.current = false)}>
      <div className="flex select-none overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
        <div className="flex shrink-0 flex-col">
          <div className="h-8" />
          {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => (
            <div
              key={rowIdx}
              className={`h-[18px] pr-1 text-right text-[11px] text-[var(--text-muted)] ${rowIdx % ROWS_PER_HOUR === 0 ? "visible" : "invisible"}`}
            >
              {cellDate(days[0] ?? new Date(), rowIdx).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={day.toISOString()} className="flex w-16 shrink-0 flex-col">
            <div className="h-8 text-center text-[12px] text-[var(--text-muted)]">
              {day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
            </div>
            {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => {
              const iso = cellDate(day, rowIdx).toISOString();
              const isSelected = selected.has(iso);
              return (
                <div
                  key={iso}
                  onPointerDown={(e) => onDown(e, iso)}
                  onPointerEnter={() => onEnter(iso)}
                  className={`h-[18px] border-l border-t ${rowIdx % ROWS_PER_HOUR === 0 ? "border-t-[var(--border)]" : "border-t-[var(--surface-sunken)]"} border-l-[var(--surface-sunken)] ${isSelected ? "bg-[var(--accent-1)]" : "bg-[var(--surface)]"} ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                />
              );
            })}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={save} disabled={saving} className={BUTTON_PRIMARY}>
            {saving ? "Saving…" : "Save my availability"}
          </button>
          {saved && <span className="text-[13px] text-[var(--success)]">Saved.</span>}
          <span className="text-[12px] text-[var(--text-muted)]">
            Click, or click-and-drag, to paint the windows you&rsquo;re free. Shown in your own local time.
          </span>
        </div>
      )}
    </div>
  );
}
