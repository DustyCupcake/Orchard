import { buildMonthGrid, MONTH_LABEL } from "@/lib/calendar";
import type { ClonePreview } from "@/lib/cycles";

// Shared between /participation's own clone-previous-cycle preview
// (Phase 44) and /task-packs/import's pack-import date preview (Phase
// 55) — both compute the exact same ClonePreview shape (see
// src/lib/cycles/crud.ts's previewClonePreviousCycle and
// src/lib/task-packs/import.ts's previewPackImportDates), so this is
// the one place that renders it, not two drifting copies.

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthsSpanned(dates: string[]): { year: number; month: number }[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const [minY, minM] = sorted[0].split("-").map(Number);
  const [maxY, maxM] = sorted[sorted.length - 1].split("-").map(Number);
  const months: { year: number; month: number }[] = [];
  let y = minY;
  let m = minM;
  while ((y < maxY || (y === maxY && m <= maxM)) && months.length < 12) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

export function ClonePreviewGrid({ preview }: { preview: ClonePreview }) {
  const entriesByDate = new Map<string, string[]>();
  for (const p of preview.phases) {
    if (p.start) entriesByDate.set(p.start, [...(entriesByDate.get(p.start) ?? []), `${p.name} starts`]);
    if (p.end) entriesByDate.set(p.end, [...(entriesByDate.get(p.end) ?? []), `${p.name} ends`]);
  }
  for (const m of preview.milestones) {
    if (m.date) entriesByDate.set(m.date, [...(entriesByDate.get(m.date) ?? []), `${m.label} (${m.taskTitle})`]);
  }

  const months = monthsSpanned([...entriesByDate.keys()]);
  if (months.length === 0) {
    return (
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Nothing resolves yet — give both a hypothetical start and end above.
      </p>
    );
  }

  return (
    <div className="mt-3">
      {months.map(({ year, month }) => (
        <div key={`${year}-${month}`} className="mb-4">
          <div className="text-[12px] font-semibold text-[var(--text)]">
            {MONTH_LABEL[month - 1]} {year}
          </div>
          <table className="mt-1 w-full table-fixed border-collapse text-[11px]">
            <thead>
              <tr>
                {WEEKDAY_LABEL.map((w) => (
                  <th key={w} className="border border-[var(--border)] p-0.5 text-[var(--text-muted)]">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buildMonthGrid(year, month).map((week) => (
                <tr key={week[0].date}>
                  {week.map((day) => (
                    <td
                      key={day.date}
                      className={`h-12 border border-[var(--border)] p-0.5 align-top ${day.inMonth ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
                    >
                      <div>{Number(day.date.slice(8, 10))}</div>
                      {(entriesByDate.get(day.date) ?? []).slice(0, 2).map((label, i) => (
                        <div key={i} className="text-[10px] text-[var(--accent-1)]">
                          {label}
                        </div>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// "List mode collapses by phase, denser than the grid" — docs/spec.md.
export function ClonePreviewList({ preview }: { preview: ClonePreview }) {
  const cycleAnchored = preview.milestones.filter((m) => !m.phaseName);
  return (
    <div className="mt-3 text-[13px]">
      {preview.phases.length === 0 && cycleAnchored.length === 0 && (
        <p className="text-[var(--text-muted)]">Nothing to carry forward — the source cycle has no phases or milestones.</p>
      )}
      {preview.phases.map((p) => (
        <div key={p.name} className="mb-2">
          <p className="font-medium text-[var(--text)]">{p.name}</p>
          <p className="text-[var(--text-muted)]">
            Start: {p.start ?? "unresolved"} · End: {p.end ?? "unresolved"}
          </p>
          <ul className="ml-5 mt-1 list-disc text-[var(--text)]">
            {preview.milestones
              .filter((m) => m.phaseName === p.name)
              .map((m, i) => (
                <li key={i}>
                  {m.label} ({m.taskTitle}) — {m.date ?? "unresolved"}
                </li>
              ))}
          </ul>
        </div>
      ))}
      {cycleAnchored.length > 0 && (
        <div>
          <p className="font-medium text-[var(--text)]">Cycle-anchored</p>
          <ul className="ml-5 mt-1 list-disc text-[var(--text)]">
            {cycleAnchored.map((m, i) => (
              <li key={i}>
                {m.label} ({m.taskTitle}) — {m.date ?? "unresolved"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
