import type { shiftOccurrence as shiftOccurrenceTable, shiftSeries as shiftSeriesTable, shiftSignup as shiftSignupTable } from "@/db/schema";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
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
    <section className="mt-8 border-t border-[var(--border)] pt-6">
      <h2 className="text-[22px] font-semibold text-[var(--text)]">My series</h2>
      <div className="mt-3 flex flex-col gap-4">
        {series.map(({ series: s, occurrences, signups }) => {
          const signupsByOccurrence = new Map<string, ShiftSignupRow[]>();
          for (const sg of signups) {
            const list = signupsByOccurrence.get(sg.occurrenceId) ?? [];
            list.push(sg);
            signupsByOccurrence.set(sg.occurrenceId, list);
          }

          return (
            <div key={s.id} className={CARD}>
              <div className="flex items-center gap-2">
                <Tag tone={s.archivedAt ? "neutral" : "success"}>{s.archivedAt ? "Archived" : "Active"}</Tag>
                <span className="text-[12px] text-[var(--text-muted)]">default capacity {s.defaultCapacity}</span>
              </div>
              <p className="mt-1.5 text-[14px] font-medium text-[var(--text)]">{s.title}</p>
              {s.description && <p className="mt-1 text-[13px] text-[var(--text)]">{s.description}</p>}

              <form action={s.archivedAt ? unarchiveShiftSeriesAction : archiveShiftSeriesAction} className="mt-2">
                <input type="hidden" name="seriesId" value={s.id} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  {s.archivedAt ? "Unarchive" : "Archive"}
                </button>
              </form>

              <h4 className="mt-4 text-[13px] font-medium text-[var(--text)]">Occurrences</h4>
              {occurrences.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-1.5 flex flex-col gap-2">
                {occurrences.map((o) => {
                  const roster = signupsByOccurrence.get(o.id) ?? [];
                  const ended = new Date(o.endsAt) <= new Date();
                  return (
                    <div key={o.id} className="text-[13px] text-[var(--text)]">
                      <span className="font-medium">{formatRange(o.startsAt, o.endsAt)}</span>{" "}
                      <span className="text-[var(--text-muted)]">
                        — capacity {o.capacity ?? s.defaultCapacity} — {roster.length} signed up
                      </span>
                      {roster.length > 0 && (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {roster.map((sg) => (
                            <li key={sg.id} className="flex items-center gap-2 text-[var(--text-muted)]">
                              {memberNameById.get(sg.memberId) ?? "—"} ({sg.status})
                              {ended && sg.status === "signed_up" && (
                                <form action={markShiftSignupNoShowAction}>
                                  <input type="hidden" name="signupId" value={sg.id} />
                                  <button type="submit" className={BUTTON_SECONDARY}>
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
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">Generate occurrences</summary>

                <div className="mt-3 flex flex-col gap-4">
                  <div>
                    <h5 className="text-[12px] font-medium text-[var(--text-muted)]">Weekly pattern</h5>
                    <form action={generateOccurrencesAction} className="mt-1.5 flex max-w-[400px] flex-col gap-2">
                      <input type="hidden" name="seriesId" value={s.id} />
                      <input type="hidden" name="mode" value="weekly" />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>From</span>
                        <input type="date" name="startDate" required className={INPUT} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>To</span>
                        <input type="date" name="endDate" required className={INPUT} />
                      </label>
                      <div className="flex flex-wrap gap-3 text-[13px] text-[var(--text)]">
                        {DAY_LABELS.map((label, i) => (
                          <label key={i} className="flex items-center gap-1">
                            <input type="checkbox" name="daysOfWeek" value={i} /> {label}
                          </label>
                        ))}
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Start time</span>
                        <input type="time" name="startTime" required className={`${INPUT} w-fit`} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Duration (minutes)</span>
                        <input type="number" name="durationMinutes" min={1} required className={`${INPUT} w-fit`} />
                      </label>
                      <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                        Generate
                      </button>
                    </form>
                  </div>

                  <div>
                    <h5 className="text-[12px] font-medium text-[var(--text-muted)]">Explicit list</h5>
                    <form action={generateOccurrencesAction} className="mt-1.5 flex max-w-[400px] flex-col gap-2">
                      <input type="hidden" name="seriesId" value={s.id} />
                      <input type="hidden" name="mode" value="explicit" />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>One per line, startsAt|endsAt</span>
                        <textarea
                          name="slotsRaw"
                          rows={3}
                          placeholder={"2026-09-10T14:00|2026-09-10T15:00"}
                          className={`${INPUT} font-mono`}
                        />
                      </label>
                      <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                        Generate
                      </button>
                    </form>
                  </div>
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </section>
  );
}
