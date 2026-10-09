"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BUTTON_PRIMARY } from "@/components/ui/kit";
import { formatTimeInZone, instantFromZoned } from "@/lib/dates";
// Deep import: the barrel reaches the database driver, which a client
// bundle can't resolve — see the programme grid for the longer note.
import { gridDays } from "@/lib/event-scheduling/availability";

// A day-by-time paint grid — see docs/spec.md's "Availability input is
// a drag-select grid, not a typed-in range." Each cell is one half-hour
// slot on the VIEWER'S OWN clock — the member's own time zone, falling
// back to the browser's for someone with no account (the intro-call
// invitee) — and is submitted as an absolute ISO instant. Two viewers in
// different zones each paint their own daytime hours, and the aggregate
// still counts overlapping *absolute* moments correctly — this is what
// "timezones render per viewer" means here, applied to the grid itself,
// not just the eventual confirmed time.
//
// That is the opposite choice from the programme's availability grid
// (src/app/(app)/schedule/AvailabilityGrid.tsx), which is painted on the
// event's clock: a poll asks "when are *you* free", a programme asks when
// something can happen at the venue.
const START_HOUR = 8;
const END_HOUR = 22;
const SLOT_MINUTES = 30;
const ROWS_PER_HOUR = 60 / SLOT_MINUTES;
const ROW_COUNT = (END_HOUR - START_HOUR) * ROWS_PER_HOUR;

function wallClock(rowIdx: number): string {
  const totalMinutes = START_HOUR * 60 + rowIdx * SLOT_MINUTES;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

// The instant a row names on a given day in the zone, or null when that
// wall clock doesn't exist there (a clock change skipping it) — rendered
// as an inert cell rather than silently painting the neighbouring instant.
function cellIso(day: string, rowIdx: number, timeZone: string): string | null {
  const wanted = wallClock(rowIdx);
  const instant = instantFromZoned(`${day}T${wanted}`, timeZone);
  return formatTimeInZone(instant.toISOString(), timeZone) === wanted ? instant.toISOString() : null;
}

function dayLabel(day: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

export default function AvailabilityGrid({
  pollId,
  rangeStart,
  rangeEnd,
  initialSelected,
  readOnly,
  submitUrl,
  timeZone,
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
  /** The viewer's own clock. Absent for someone with no account: their browser's is used. */
  timeZone?: string;
}) {
  const days = useMemo(() => gridDays(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const [zone, setZone] = useState(timeZone ?? "UTC");
  useEffect(() => {
    // Only the browser knows where an account-less visitor is, and only
    // after mount; the first paint stays on the server's guess so it
    // hydrates cleanly.
    if (timeZone) return;
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (browserZone) setZone(browserZone);
  }, [timeZone]);
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
              className={`h-[18px] pr-1 text-right text-[length:var(--text-micro)] text-[var(--text-muted)] ${rowIdx % ROWS_PER_HOUR === 0 ? "visible" : "invisible"}`}
            >
              {wallClock(rowIdx)}
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={day} className="flex w-16 shrink-0 flex-col">
            <div className="h-8 text-center text-[length:var(--text-meta)] text-[var(--text-muted)]">
              {dayLabel(day, zone)}
            </div>
            {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => {
              const iso = cellIso(day, rowIdx, zone);
              if (!iso) {
                return <div key={`${day}-${rowIdx}`} className="h-[18px] w-full bg-[var(--surface-sunken)]" />;
              }
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
          {saved && <span className="text-[length:var(--text-body)] text-[var(--success)]">Saved.</span>}
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            Click, or click-and-drag, to paint the windows you&rsquo;re free. Shown in {zone}.
          </span>
        </div>
      )}
    </div>
  );
}
