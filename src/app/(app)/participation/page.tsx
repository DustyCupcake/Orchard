import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCurrentCycle } from "@/lib/profile-questions";
import { canInitiateCycle, getCycle, previewClonePreviousCycle, type ClonePreview } from "@/lib/cycles";
import { getCycleParticipationSummary, getMyParticipation } from "@/lib/participation";
import { listCycleTypes } from "@/lib/settings";
import { buildMonthGrid, MONTH_LABEL } from "@/lib/calendar";
import type { member as memberTable } from "@/db/schema";
import {
  createCycleAction,
  declareParticipationAction,
  updateCycleSettingsAction,
  updatePhaseBoundaryAction,
} from "./actions";

type Member = typeof memberTable.$inferSelect;

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unknown: "Haven't said",
  coming: "Coming",
  maybe: "Maybe",
  not_coming: "Not coming",
};

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not a full
// ISO string with a timezone offset — same helper src/app/schedule's
// EventReviewSection.tsx already uses.
function toDatetimeLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "Who's actually planning to be there, and how much room is left" —
// see docs/spec.md's "Participation & capacity" under Cycle and
// docs/development-plan.md's Phase 31. Core, not gated behind
// Recruitment — a Community with cycles on always has this page,
// whether or not Recruitment ever gets turned on.
export default async function ParticipationPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    declared?: string;
    settingsUpdated?: string;
    phaseUpdated?: string;
    cycleCreated?: string;
    previewStart?: string;
    previewEnd?: string;
    previewView?: string;
  }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error, declared, settingsUpdated, phaseUpdated, cycleCreated, previewStart, previewEnd, previewView } =
    await searchParams;

  const [currentCycle, canConfigure] = await Promise.all([
    getCurrentCycle(currentMember.communityId),
    canInitiateCycle(currentMember),
  ]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Participation</h1>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {declared && <p style={{ color: "#2a7a2a" }}>Your participation is saved.</p>}
      {settingsUpdated && <p style={{ color: "#2a7a2a" }}>Cycle settings updated.</p>}
      {phaseUpdated && <p style={{ color: "#2a7a2a" }}>Phase dates updated.</p>}
      {cycleCreated && <p style={{ color: "#2a7a2a" }}>Cycle created — set its dates below, if you know them yet.</p>}

      {!currentCycle ? (
        <p style={{ color: "#666" }}>
          No current cycle yet — there&rsquo;s nothing to declare participation against until one
          exists.
        </p>
      ) : (
        <ParticipationForCycle
          currentMember={currentMember}
          cycleId={currentCycle.id}
          cycleName={currentCycle.name}
        />
      )}

      {canConfigure && (
        <StartNewCycleSection
          currentMember={currentMember}
          hasPreviousCycle={currentCycle !== null}
          previewStart={previewStart}
          previewEnd={previewEnd}
          previewView={previewView === "list" ? "list" : "grid"}
        />
      )}
    </main>
  );
}

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

// "The Pack import review screen gains the date preview" —
// docs/development-plan.md's Phase 44. No such review screen (or any
// cycle-creation UI at all) existed before this phase — see
// src/app/(app)/participation/actions.ts's own createCycleAction
// comment. This is that screen's minimal real form: preview a
// hypothetical clone (calendar or list, toggled by the reviewer) before
// committing to anything, then create for real below.
async function StartNewCycleSection({
  currentMember,
  hasPreviousCycle,
  previewStart,
  previewEnd,
  previewView,
}: {
  currentMember: Member;
  hasPreviousCycle: boolean;
  previewStart?: string;
  previewEnd?: string;
  previewView: "grid" | "list";
}) {
  const [cycleTypes, preview] = await Promise.all([
    listCycleTypes(currentMember),
    hasPreviousCycle && (previewStart || previewEnd)
      ? previewClonePreviousCycle(currentMember, previewStart || null, previewEnd || null)
      : Promise.resolve(null),
  ]);

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #ddd", paddingTop: "1.5rem" }}>
      <h2>Start a new cycle</h2>

      {hasPreviousCycle && (
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: "1rem", marginBottom: "1rem" }}>
          <h3 style={{ marginTop: 0, fontSize: "0.95rem" }}>Preview a clone</h3>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            See what cloning the most recent cycle would resolve to against a hypothetical
            start/end, before committing to anything. Reuses the exact same recompute the real
            Cycle-settings form above uses, so this always matches what actually lands once you
            create the clone and set its dates for real.
          </p>
          <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
            <label style={{ fontSize: "0.85rem" }}>
              Hypothetical start
              <br />
              <input type="date" name="previewStart" defaultValue={previewStart ?? ""} style={{ padding: "0.4rem" }} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Hypothetical end
              <br />
              <input type="date" name="previewEnd" defaultValue={previewEnd ?? ""} style={{ padding: "0.4rem" }} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              View
              <br />
              <select name="previewView" defaultValue={previewView} style={{ padding: "0.4rem" }}>
                <option value="grid">Calendar</option>
                <option value="list">List</option>
              </select>
            </label>
            <button type="submit" style={{ padding: "0.4rem 1rem" }}>
              Preview
            </button>
          </form>

          {preview &&
            (previewView === "list" ? <ClonePreviewList preview={preview} /> : <ClonePreviewGrid preview={preview} />)}
        </div>
      )}

      <form
        action={createCycleAction}
        style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}
      >
        <label>
          Name
          <br />
          <input type="text" name="name" required style={{ padding: "0.4rem", width: "100%" }} />
        </label>
        <label>
          Source
          <br />
          <select name="source" defaultValue={hasPreviousCycle ? "clone_previous" : "blank"} style={{ padding: "0.4rem", width: "100%" }}>
            <option value="blank">Blank</option>
            {hasPreviousCycle && <option value="clone_previous">Clone the most recent cycle</option>}
          </select>
        </label>
        {cycleTypes.length > 0 && (
          <label>
            Cycle type (optional)
            <br />
            <select name="cycleTypeId" defaultValue="" style={{ padding: "0.4rem", width: "100%" }}>
              <option value="">No cycle type</option>
              {cycleTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p style={{ color: "#666", fontSize: "0.8rem", margin: 0 }}>
          A clone&rsquo;s own start/end aren&rsquo;t set here — use the Cycle settings form above once
          it exists.
        </p>
        <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
          Create
        </button>
      </form>
    </section>
  );
}

function ClonePreviewGrid({ preview }: { preview: ClonePreview }) {
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
function ClonePreviewList({ preview }: { preview: ClonePreview }) {
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

async function ParticipationForCycle({
  currentMember,
  cycleId,
  cycleName,
}: {
  currentMember: Member;
  cycleId: string;
  cycleName: string;
}) {
  const [summary, mine, canConfigure] = await Promise.all([
    getCycleParticipationSummary(currentMember, cycleId),
    getMyParticipation(currentMember, cycleId),
    canInitiateCycle(currentMember),
  ]);
  // Only needed for the cycle-settings/phase-dates sections below —
  // skip the extra query entirely for anyone who can't see them.
  const withPhases = canConfigure ? await getCycle(currentMember, cycleId) : null;

  return (
    <>
      <section style={{ marginTop: "1rem" }}>
        <h2>{cycleName}</h2>
        <p style={{ color: "#666" }}>
          {summary.capacity === null ? (
            "No capacity cap set — unlimited."
          ) : (
            <>
              Capacity {summary.capacity} · {summary.comingCount} coming ·{" "}
              {summary.remainingCapacity !== null && summary.remainingCapacity < 0
                ? `${-summary.remainingCapacity} over capacity`
                : `${summary.remainingCapacity} remaining`}
            </>
          )}
        </p>
        {summary.returningWindowClosesAt && (
          <p style={{ color: summary.returningWindowOpen ? "#2a7a2a" : "#666" }}>
            Returning-priority window {summary.returningWindowOpen ? "open" : "closed"} — closes{" "}
            {new Date(summary.returningWindowClosesAt).toLocaleString()}.
          </p>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Your plans</h2>
        <form
          action={declareParticipationAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}
        >
          <input type="hidden" name="cycleId" value={cycleId} />
          <label>
            Status
            <br />
            <select name="status" defaultValue={mine.status} style={{ padding: "0.4rem", width: "100%" }}>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Arrival date (optional)
            <br />
            <input
              type="date"
              name="arrivalDate"
              defaultValue={mine.arrivalDate ?? ""}
              style={{ padding: "0.4rem" }}
            />
          </label>
          <label>
            Departure date (optional)
            <br />
            <input
              type="date"
              name="departureDate"
              defaultValue={mine.departureDate ?? ""}
              style={{ padding: "0.4rem" }}
            />
          </label>
          <label>
            Note (optional)
            <br />
            <textarea name="note" rows={2} defaultValue={mine.note ?? ""} style={{ padding: "0.4rem", width: "100%" }} />
          </label>
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Save
          </button>
        </form>
      </section>

      {canConfigure && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Cycle settings</h2>
          <p style={{ color: "#666", fontSize: "0.85rem" }}>
            Visible to you because you can start a cycle for this Community — the same authority
            configures its capacity and returning-priority window.
          </p>
          <form
            action={updateCycleSettingsAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 400 }}
          >
            <input type="hidden" name="cycleId" value={cycleId} />
            <label>
              Capacity (optional — blank = unlimited)
              <br />
              <input
                type="number"
                name="capacity"
                min={1}
                defaultValue={summary.capacity ?? ""}
                style={{ padding: "0.4rem" }}
              />
            </label>
            <label>
              Start date (optional)
              <br />
              <input
                type="date"
                name="startDate"
                defaultValue={withPhases?.startDate ?? ""}
                style={{ padding: "0.4rem" }}
              />
            </label>
            <label>
              End date (optional)
              <br />
              <input
                type="date"
                name="endDate"
                defaultValue={withPhases?.endDate ?? ""}
                style={{ padding: "0.4rem" }}
              />
            </label>
            <label>
              Returning-priority window closes at (optional)
              <br />
              <input
                type="datetime-local"
                name="returningWindowClosesAt"
                defaultValue={
                  summary.returningWindowClosesAt ? toDatetimeLocal(new Date(summary.returningWindowClosesAt)) : ""
                }
                style={{ padding: "0.4rem" }}
              />
            </label>
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Save settings
            </button>
          </form>
        </section>
      )}

      {withPhases && withPhases.phases.length > 0 && (
        <PhaseDatesSection phases={withPhases.phases} />
      )}
    </>
  );
}

type CycleWithPhases = Awaited<ReturnType<typeof getCycle>>;
type PhaseRow = CycleWithPhases["phases"][number];

const ANCHOR_LABEL: Record<string, string> = {
  cycle_start: "the cycle's start",
  cycle_end: "the cycle's end",
};

function describeBoundary(prefix: "Start" | "End", p: PhaseRow, dateType: string, relativeMode: string | null) {
  if (dateType === "absolute") return "Absolute date, hand-typed.";
  if (relativeMode === "offset") {
    const anchor = prefix === "Start" ? p.startOffsetAnchor : p.endOffsetAnchor;
    const days = prefix === "Start" ? p.startOffsetDays : p.endOffsetDays;
    return `${days} day(s) from ${anchor ? ANCHOR_LABEL[anchor] : "?"}.`;
  }
  const percent = prefix === "Start" ? p.startPercent : p.endPercent;
  return `${percent}% of the way from the cycle's start to its end.`;
}

// See docs/development-plan.md's Phase 39 — a phase spine an existing
// Cycle's own dates resolve against. No add/rename/reorder here (phases
// are still only created at Cycle-creation time, or carried through a
// clone) — this is purely for editing an existing phase's dates.
function PhaseDatesSection({ phases }: { phases: PhaseRow[] }) {
  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2>Phase dates</h2>
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        Each boundary is either an absolute date or relative to the cycle&rsquo;s own start/end —
        type a new offset/percent directly, or pick a target date to drag it there (either way,
        what&rsquo;s persisted is the recomputed offset/percent, never a bare date).
      </p>
      {phases.map((p) => (
        <div
          key={p.id}
          style={{ border: "1px solid #ddd", borderRadius: 4, padding: "1rem", marginTop: "1rem", maxWidth: 500 }}
        >
          <h3 style={{ margin: 0 }}>{p.name}</h3>
          <p style={{ color: "#666", fontSize: "0.85rem", margin: "0.25rem 0" }}>
            Start: {p.startDate ?? "unresolved"} — {describeBoundary("Start", p, p.startDateType, p.startRelativeMode)}
            <br />
            End: {p.endDate ?? "unresolved"} — {describeBoundary("End", p, p.endDateType, p.endRelativeMode)}
          </p>
          {p.flags.orderInvalid && (
            <p style={{ color: "crimson", fontSize: "0.85rem" }}>
              This phase&rsquo;s end resolves before its own start.
            </p>
          )}
          {p.flags.startDrifted && (
            <p style={{ color: "#b8860b", fontSize: "0.85rem" }}>
              Start was set relative to {p.startOffsetAnchor ? ANCHOR_LABEL[p.startOffsetAnchor] : "?"}, but it&rsquo;s
              now closer to the other boundary.
            </p>
          )}
          {p.flags.endDrifted && (
            <p style={{ color: "#b8860b", fontSize: "0.85rem" }}>
              End was set relative to {p.endOffsetAnchor ? ANCHOR_LABEL[p.endOffsetAnchor] : "?"}, but it&rsquo;s now
              closer to the other boundary.
            </p>
          )}
          <form
            action={updatePhaseBoundaryAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}
          >
            <input type="hidden" name="phaseId" value={p.id} />
            <PhaseBoundaryFields prefix="start" p={p} />
            <PhaseBoundaryFields prefix="end" p={p} />
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Save dates
            </button>
          </form>
        </div>
      ))}
    </section>
  );
}

function PhaseBoundaryFields({ prefix, p }: { prefix: "start" | "end"; p: PhaseRow }) {
  const dateType = prefix === "start" ? p.startDateType : p.endDateType;
  const relativeMode = prefix === "start" ? p.startRelativeMode : p.endRelativeMode;
  const anchor = prefix === "start" ? p.startOffsetAnchor : p.endOffsetAnchor;
  const offsetDays = prefix === "start" ? p.startOffsetDays : p.endOffsetDays;
  const percent = prefix === "start" ? p.startPercent : p.endPercent;
  const absoluteDate = prefix === "start" ? p.startDate : p.endDate;
  const mode = dateType === "relative" ? `relative_${relativeMode}` : "absolute";

  return (
    <fieldset style={{ border: "1px solid #eee", borderRadius: 4, padding: "0.5rem" }}>
      <legend style={{ fontSize: "0.85rem", textTransform: "capitalize" }}>{prefix}</legend>
      <label>
        Mode
        <br />
        <select name={`${prefix}Mode`} defaultValue={mode} style={{ padding: "0.4rem", width: "100%" }}>
          <option value="absolute">Absolute date</option>
          <option value="relative_offset">Relative — offset (days from an anchor)</option>
          <option value="relative_percent">Relative — percent (between start and end)</option>
        </select>
      </label>
      <label>
        Absolute date (used when mode is Absolute)
        <br />
        <input
          type="date"
          name={`${prefix}AbsoluteDate`}
          defaultValue={dateType === "absolute" ? (absoluteDate ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Anchor (used when mode is offset)
        <br />
        <select name={`${prefix}Anchor`} defaultValue={anchor ?? "cycle_start"} style={{ padding: "0.4rem" }}>
          <option value="cycle_start">Cycle start</option>
          <option value="cycle_end">Cycle end</option>
        </select>
      </label>
      <label>
        Offset days (used when mode is offset, and no target date is given below)
        <br />
        <input
          type="number"
          name={`${prefix}OffsetDays`}
          defaultValue={relativeMode === "offset" ? (offsetDays ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Percent 0-100 (used when mode is percent, and no target date is given below)
        <br />
        <input
          type="number"
          min={0}
          max={100}
          name={`${prefix}Percent`}
          defaultValue={relativeMode === "percent" ? (percent ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Or drag to this target date (recomputes and persists the offset/percent above)
        <br />
        <input type="date" name={`${prefix}TargetDate`} style={{ padding: "0.4rem" }} />
      </label>
    </fieldset>
  );
}
