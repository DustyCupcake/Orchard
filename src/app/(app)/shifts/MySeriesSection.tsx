import type { shiftOccurrence as shiftOccurrenceTable, shiftSeries as shiftSeriesTable, shiftSignup as shiftSignupTable } from "@/db/schema";
import {
  archiveShiftSeriesAction,
  generateOccurrencesAction,
  markShiftSignupNoShowAction,
  unarchiveShiftSeriesAction,
} from "./actions";

type ShiftSeriesRow = typeof shiftSeriesTable.$inferSelect;
type ShiftOccurrenceRow = typeof shiftOccurrenceTable.$inferSelect;
type ShiftSignupRow = typeof shiftSignupTable.$inferSelect;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatRange(startsAt: Date | string, endsAt: Date | string) {
  return `${new Date(startsAt).toLocaleString()} – ${new Date(endsAt).toLocaleTimeString()}`;
}

// The coordinator's own management view — see docs/spec.md's "Shifts /
// rota" and docs/development-plan.md's Phase 29 ("a coordinator view
// ... listing each occurrence's current signups"). Rendered by
// page.tsx only for series the current member coordinates (creator, or
// whoever holds sourceTaskId if set).
export default function MySeriesSection({
  series,
  memberNameById,
}: {
  series: { series: ShiftSeriesRow; occurrences: ShiftOccurrenceRow[]; signups: ShiftSignupRow[] }[];
  memberNameById: Map<string, string>;
}) {
  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
      <h2>My series</h2>
      {series.map(({ series: s, occurrences, signups }) => {
        const signupsByOccurrence = new Map<string, ShiftSignupRow[]>();
        for (const sg of signups) {
          const list = signupsByOccurrence.get(sg.occurrenceId) ?? [];
          list.push(sg);
          signupsByOccurrence.set(sg.occurrenceId, list);
        }

        return (
          <div
            key={s.id}
            style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "1rem" }}
          >
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#666" }}>
              {s.archivedAt ? "Archived" : "Active"} · default capacity {s.defaultCapacity}
            </p>
            <strong>{s.title}</strong>
            {s.description && <p style={{ margin: "0.2rem 0" }}>{s.description}</p>}

            <form action={s.archivedAt ? unarchiveShiftSeriesAction : archiveShiftSeriesAction} style={{ marginTop: "0.4rem" }}>
              <input type="hidden" name="seriesId" value={s.id} />
              <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                {s.archivedAt ? "Unarchive" : "Archive"}
              </button>
            </form>

            <h4 style={{ marginBottom: "0.3rem" }}>Occurrences</h4>
            {occurrences.length === 0 && <p style={{ color: "#666", fontSize: "0.85rem" }}>None yet.</p>}
            {occurrences.map((o) => {
              const roster = signupsByOccurrence.get(o.id) ?? [];
              const ended = new Date(o.endsAt) <= new Date();
              return (
                <div key={o.id} style={{ fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                  <strong>{formatRange(o.startsAt, o.endsAt)}</strong> — capacity{" "}
                  {o.capacity ?? s.defaultCapacity} — {roster.length} signed up
                  {roster.length > 0 && (
                    <ul style={{ margin: "0.2rem 0 0" }}>
                      {roster.map((sg) => (
                        <li key={sg.id}>
                          {memberNameById.get(sg.memberId) ?? "—"} ({sg.status})
                          {ended && sg.status === "signed_up" && (
                            <form action={markShiftSignupNoShowAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
                              <input type="hidden" name="signupId" value={sg.id} />
                              <button type="submit" style={{ padding: "0.1rem 0.4rem", fontSize: "0.8rem" }}>
                                Mark no-show
                              </button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}

            <details style={{ marginTop: "0.6rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Generate occurrences</summary>

              <div style={{ marginTop: "0.5rem" }}>
                <h5 style={{ margin: "0 0 0.3rem" }}>Weekly pattern</h5>
                <form
                  action={generateOccurrencesAction}
                  style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 400 }}
                >
                  <input type="hidden" name="seriesId" value={s.id} />
                  <input type="hidden" name="mode" value="weekly" />
                  <label style={{ fontSize: "0.85rem" }}>
                    From
                    <input type="date" name="startDate" required style={{ padding: "0.3rem", marginLeft: "0.4rem" }} />
                  </label>
                  <label style={{ fontSize: "0.85rem" }}>
                    To
                    <input type="date" name="endDate" required style={{ padding: "0.3rem", marginLeft: "0.4rem" }} />
                  </label>
                  <div style={{ fontSize: "0.85rem" }}>
                    {DAY_LABELS.map((label, i) => (
                      <label key={i} style={{ marginRight: "0.6rem" }}>
                        <input type="checkbox" name="daysOfWeek" value={i} /> {label}
                      </label>
                    ))}
                  </div>
                  <label style={{ fontSize: "0.85rem" }}>
                    Start time
                    <input type="time" name="startTime" required style={{ padding: "0.3rem", marginLeft: "0.4rem" }} />
                  </label>
                  <label style={{ fontSize: "0.85rem" }}>
                    Duration (minutes)
                    <input
                      type="number"
                      name="durationMinutes"
                      min={1}
                      required
                      style={{ padding: "0.3rem", marginLeft: "0.4rem", width: "6rem" }}
                    />
                  </label>
                  <button type="submit" style={{ padding: "0.3rem 0.6rem", width: "fit-content" }}>
                    Generate
                  </button>
                </form>

                <h5 style={{ margin: "0.8rem 0 0.3rem" }}>Explicit list</h5>
                <form
                  action={generateOccurrencesAction}
                  style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 400 }}
                >
                  <input type="hidden" name="seriesId" value={s.id} />
                  <input type="hidden" name="mode" value="explicit" />
                  <label style={{ fontSize: "0.85rem" }}>
                    One per line, <code>startsAt|endsAt</code>
                    <br />
                    <textarea
                      name="slotsRaw"
                      rows={3}
                      placeholder={"2026-09-10T14:00|2026-09-10T15:00"}
                      style={{ padding: "0.4rem", width: "100%", fontFamily: "monospace" }}
                    />
                  </label>
                  <button type="submit" style={{ padding: "0.3rem 0.6rem", width: "fit-content" }}>
                    Generate
                  </button>
                </form>
              </div>
            </details>
          </div>
        );
      })}
    </section>
  );
}
