import type { shiftOccurrence as shiftOccurrenceTable, shiftSeries as shiftSeriesTable, shiftSignup as shiftSignupTable } from "@/db/schema";
import { BUTTON_DESTRUCTIVE, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import Modal from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { localInputFromInstant } from "@/lib/dates";
import {
  archiveShiftSeriesAction,
  deleteShiftOccurrenceAction,
  deleteShiftSeriesAction,
  generateOccurrencesAction,
  markShiftSignupNoShowAction,
  setShiftSeriesScopeAction,
  unarchiveShiftSeriesAction,
  updateShiftOccurrenceAction,
  updateShiftSeriesAction,
} from "./actions";

type ShiftSeriesRow = typeof shiftSeriesTable.$inferSelect;
type ShiftOccurrenceRow = typeof shiftOccurrenceTable.$inferSelect;
type ShiftSignupRow = typeof shiftSignupTable.$inferSelect;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A <summary> that looks like a button: a zero-JS disclosure toggle.
const SUMMARY_BUTTON = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";

// The shift manager's own management view — see docs/spec.md's "Shifts /
// rota" and docs/plans/development-plan.md's Phase 29 ("a coordinator view
// ... listing each occurrence's current signups"). Rendered by page.tsx
// only for series in scopes the current member actually manages (the
// shift_management grant, D10 — src/lib/shifts/management.ts). Each
// card shows the series' scope (§5.6: "Cycle N roster" vs "Standing
// series") and, for a managing member, lets them re-place it into any
// other scope they manage (destination-manager gated server-side too).
export default function MySeriesSection({
  series,
  memberNameById,
  cycleNameById,
  placementOptions,
  branches,
  shiftZone,
  shiftWhen,
  rosterOpen,
  rosterClosed,
}: {
  series: { series: ShiftSeriesRow; occurrences: ShiftOccurrenceRow[]; signups: ShiftSignupRow[] }[];
  memberNameById: Map<string, string>;
  cycleNameById: Map<string, { name: string }>;
  placementOptions: { cycleId: string | null; label: string }[];
  branches: { id: string; name: string }[];
  /** Whether people can sign up in this scope yet. A standing series always can. Deleting is only offered before. */
  rosterOpen: (cycleId: string | null) => boolean;
  /** A closed event's roster is frozen: its series and shifts can't be edited or deleted. */
  rosterClosed: (cycleId: string | null) => boolean;
  /** The venue clock for a series' event — what its times are typed and shown in. */
  shiftZone: (cycleId: string | null) => string;
  /** A shift's time worded per the viewer's date display setting. */
  shiftWhen: (startsAt: Date, endsAt: Date, cycleId: string | null) => string;
}) {
  return (
    <section className="mt-8 border-t border-[var(--border)] pt-6">
      <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Series you manage</h2>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        Set the dates people can sign up for, see who&rsquo;s coming, and edit, move or archive a series.
      </p>
      <div className="mt-3 flex flex-col gap-4">
        {series.map(({ series: s, occurrences, signups }) => {
          const signupsByOccurrence = new Map<string, ShiftSignupRow[]>();
          for (const sg of signups) {
            const list = signupsByOccurrence.get(sg.occurrenceId) ?? [];
            list.push(sg);
            signupsByOccurrence.set(sg.occurrenceId, list);
          }

          const scopeLabel = s.cycleId
            ? `Event ${cycleNameById.get(s.cycleId)?.name ?? "—"} roster`
            : "Standing series";
          const replacementOptions = placementOptions.filter((o) => o.cycleId !== s.cycleId);
          const zone = shiftZone(s.cycleId);
          const frozen = rosterClosed(s.cycleId);
          const deletable = !frozen && !rosterOpen(s.cycleId) && signups.length === 0;

          return (
            <div key={s.id} className={CARD}>
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={s.archivedAt ? "neutral" : "success"}>{s.archivedAt ? "Archived" : "Active"}</Tag>
                <Tag tone="neutral">{scopeLabel}</Tag>
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{s.defaultCapacity} per shift</span>
              </div>
              <p className="mt-1.5 text-[length:var(--text-body)] font-medium text-[var(--text)]">{s.title}</p>
              {s.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{s.description}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!frozen && (
                  <Modal
                    trigger={<>Edit<span className="sr-only"> “{s.title}”</span></>}
                    triggerClassName={BUTTON_SECONDARY}
                    title={`Edit “${s.title}”`}
                  >
                    <form action={updateShiftSeriesAction} className="flex flex-col gap-3">
                      <input type="hidden" name="seriesId" value={s.id} />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Title</span>
                        <input type="text" name="title" required defaultValue={s.title} className={INPUT} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Description (optional)</span>
                        <textarea name="description" rows={3} defaultValue={s.description ?? ""} className={INPUT} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Branch (optional)</span>
                        <select name="branchId" defaultValue={s.branchId ?? ""} className={INPUT}>
                          <option value="">No branch</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>People per shift</span>
                        <input
                          type="number"
                          name="defaultCapacity"
                          min={1}
                          required
                          defaultValue={s.defaultCapacity}
                          className={`${INPUT} w-fit`}
                        />
                        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                          Changes every shift that uses the default. A shift with its own number keeps it.
                        </span>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Tags (comma-separated)</span>
                        <input type="text" name="tags" defaultValue={s.tags.join(", ")} className={INPUT} />
                      </label>
                      <SubmitButton className={`${BUTTON_PRIMARY} w-fit`} pendingLabel="Saving…">
                        Save series
                      </SubmitButton>
                    </form>
                  </Modal>
                )}

                {replacementOptions.length > 0 && (
                  <Modal
                    trigger={<>Move<span className="sr-only"> “{s.title}”</span></>}
                    triggerClassName={BUTTON_SECONDARY}
                    title={`Move “${s.title}”`}
                    description="It moves with all its shifts, and people already signed up stay signed up. Because you manage the new place, it's confirmed there right away."
                  >
                    <form action={setShiftSeriesScopeAction} className="flex flex-col gap-3">
                      <input type="hidden" name="seriesId" value={s.id} />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Move to</span>
                        <select name="cycleId" defaultValue="" className={INPUT}>
                          {replacementOptions.map((o) => (
                            <option key={o.cycleId ?? "standing"} value={o.cycleId ?? ""}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton className={`${BUTTON_PRIMARY} w-fit`} pendingLabel="Moving…">
                        Move series
                      </SubmitButton>
                    </form>
                  </Modal>
                )}

                <form action={s.archivedAt ? unarchiveShiftSeriesAction : archiveShiftSeriesAction}>
                  <input type="hidden" name="seriesId" value={s.id} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    {s.archivedAt ? "Unarchive" : "Archive"}
                  </button>
                </form>

                {deletable && (
                  <Modal
                    trigger={<>Delete<span className="sr-only"> “{s.title}”</span></>}
                    triggerClassName={BUTTON_SECONDARY}
                    title={`Delete “${s.title}”?`}
                    description={`This deletes the series and its ${occurrences.length} shift${occurrences.length === 1 ? "" : "s"}, and can't be undone. Sign-ups aren't open yet, so nobody has signed up.`}
                  >
                    <form action={deleteShiftSeriesAction}>
                      <input type="hidden" name="seriesId" value={s.id} />
                      <SubmitButton className={BUTTON_DESTRUCTIVE} pendingLabel="Deleting…">
                        Delete series
                      </SubmitButton>
                    </form>
                  </Modal>
                )}
              </div>

              <h4 className="mt-4 text-[length:var(--text-body)] font-medium text-[var(--text)]">Shifts</h4>
              {occurrences.length === 0 && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">No dates yet — add some below so people can sign up.</p>}
              <div className="mt-1.5 flex flex-col gap-2">
                {occurrences.map((o) => {
                  const roster = signupsByOccurrence.get(o.id) ?? [];
                  const ended = new Date(o.endsAt) <= new Date();
                  const rosterNames = roster.map((sg) => memberNameById.get(sg.memberId) ?? "—").join(", ");
                  const when = shiftWhen(o.startsAt, o.endsAt, s.cycleId);
                  return (
                    <div key={o.id} className="text-[length:var(--text-body)] text-[var(--text)]">
                      <span className="font-medium">{when}</span>{" "}
                      <span className="text-[var(--text-muted)]">
                        — {roster.length} of {o.capacity ?? s.defaultCapacity} signed up
                        {o.capacity !== null && " (its own number)"}
                      </span>
                      {!ended && !frozen && (
                        <details className="ml-1 inline-block align-baseline open:block">
                          <summary className={`${BUTTON_GHOST} ${SUMMARY_BUTTON} inline-block px-1.5 py-0`}>
                            Edit<span className="sr-only"> shift {when}</span>
                          </summary>
                          <form action={updateShiftOccurrenceAction} className="mt-1.5 mb-2 flex max-w-[440px] flex-col gap-2">
                            <input type="hidden" name="occurrenceId" value={o.id} />
                            <label className="flex flex-col gap-1">
                              <span className={LABEL}>Starts ({zone})</span>
                              <input
                                type="datetime-local"
                                name="startsAt"
                                required
                                defaultValue={localInputFromInstant(o.startsAt.toISOString(), zone)}
                                className={`${INPUT} w-fit`}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className={LABEL}>Ends ({zone})</span>
                              <input
                                type="datetime-local"
                                name="endsAt"
                                required
                                defaultValue={localInputFromInstant(o.endsAt.toISOString(), zone)}
                                className={`${INPUT} w-fit`}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className={LABEL}>People needed</span>
                              <input
                                type="number"
                                name="capacity"
                                min={Math.max(1, roster.length)}
                                defaultValue={o.capacity ?? ""}
                                placeholder={`${s.defaultCapacity} (series default)`}
                                className={`${INPUT} w-fit`}
                              />
                              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                                Leave empty to use the series default ({s.defaultCapacity}).
                              </span>
                            </label>
                            {roster.length > 0 && (
                              <p className="text-[length:var(--text-meta)] text-[var(--warning)]">
                                {roster.length} signed up ({rosterNames}). They won&rsquo;t be told about a new time
                                automatically, so let them know.
                              </p>
                            )}
                            <SubmitButton className={`${BUTTON_PRIMARY} w-fit`} pendingLabel="Saving…">
                              Save shift
                            </SubmitButton>
                          </form>
                        </details>
                      )}
                      {!frozen && !rosterOpen(s.cycleId) && roster.length === 0 && (
                        <Modal
                          trigger={<>Delete<span className="sr-only"> shift {when}</span></>}
                          triggerClassName={`${BUTTON_GHOST} ml-1 px-1.5 py-0`}
                          title="Delete this shift?"
                          description={`${s.title}, ${when}. This can't be undone. Nobody has signed up for it.`}
                        >
                          <form action={deleteShiftOccurrenceAction}>
                            <input type="hidden" name="occurrenceId" value={o.id} />
                            <SubmitButton className={BUTTON_DESTRUCTIVE} pendingLabel="Deleting…">
                              Delete shift
                            </SubmitButton>
                          </form>
                        </Modal>
                      )}
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
                <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Add dates</summary>

                <div className="mt-3 flex flex-col gap-4">
                  <div>
                    <h5 className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Repeat weekly</h5>
                    <form action={generateOccurrencesAction} className="mt-1.5 flex max-w-[400px] flex-col gap-2">
                      <input type="hidden" name="seriesId" value={s.id} />
                      <input type="hidden" name="mode" value="weekly" />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>First day</span>
                        <input type="date" name="startDate" required className={INPUT} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Last day</span>
                        <input type="date" name="endDate" required className={INPUT} />
                      </label>
                      <div className="flex flex-wrap gap-3 text-[length:var(--text-body)] text-[var(--text)]" role="group" aria-label="Days of the week">
                        {DAY_LABELS.map((label, i) => (
                          <label key={i} className="flex items-center gap-1">
                            <input type="checkbox" name="daysOfWeek" value={i} /> {label}
                          </label>
                        ))}
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Start time ({zone})</span>
                        <input type="time" name="startTime" required className={`${INPUT} w-fit`} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Length of each shift (minutes)</span>
                        <input type="number" name="durationMinutes" min={1} required className={`${INPUT} w-fit`} />
                      </label>
                      <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                        Add weekly shifts
                      </button>
                    </form>
                  </div>

                  <div>
                    <h5 className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Pick exact times</h5>
                    <form action={generateOccurrencesAction} className="mt-1.5 flex max-w-[400px] flex-col gap-2">
                      <input type="hidden" name="seriesId" value={s.id} />
                      <input type="hidden" name="mode" value="explicit" />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>One shift per line, as start|end, in {zone} time</span>
                        <textarea
                          name="slotsRaw"
                          rows={3}
                          placeholder={"2026-09-10T14:00|2026-09-10T15:00"}
                          className={`${INPUT} font-mono`}
                        />
                      </label>
                      <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                        Add these shifts
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
