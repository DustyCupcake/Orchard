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
      <p style={{ color: "#666", fontSize: "0.85rem", marginTop: "0.5rem" }}>
        Nothing resolves yet — give both a hypothetical start and end above.
      </p>
    );
  }

  return (
    <div style={{ marginTop: "0.75rem" }}>
      {months.map(({ year, month }) => (
        <div key={`${year}-${month}`} style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "#444" }}>
            {MONTH_LABEL[month - 1]} {year}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.7rem", marginTop: "0.25rem" }}>
            <thead>
              <tr>
                {WEEKDAY_LABEL.map((w) => (
                  <th key={w} style={{ border: "1px solid #eee", padding: "2px", color: "#888" }}>
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
                      style={{
                        border: "1px solid #eee",
                        padding: "2px",
                        verticalAlign: "top",
                        height: "3rem",
                        color: day.inMonth ? "inherit" : "#ccc",
                      }}
                    >
                      <div>{Number(day.date.slice(8, 10))}</div>
                      {(entriesByDate.get(day.date) ?? []).slice(0, 2).map((label, i) => (
                        <div key={i} style={{ color: "#2a5a9a", fontSize: "0.6rem" }}>
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
    <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
      {preview.phases.length === 0 && cycleAnchored.length === 0 && (
        <p style={{ color: "#666" }}>Nothing to carry forward — the source cycle has no phases or milestones.</p>
      )}
      {preview.phases.map((p) => (
        <div key={p.name} style={{ marginBottom: "0.5rem" }}>
          <strong>{p.name}</strong>
          <div style={{ color: "#666" }}>
            Start: {p.start ?? "unresolved"} · End: {p.end ?? "unresolved"}
          </div>
          <ul style={{ margin: "0.25rem 0 0 1.25rem" }}>
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
          <strong>Cycle-anchored</strong>
          <ul style={{ margin: "0.25rem 0 0 1.25rem" }}>
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
