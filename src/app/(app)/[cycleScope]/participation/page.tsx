import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import {
  canInitiateCycle,
  getCycle,
  listCycles,
  previewClonePreviousCycle,
  resolveViewScopeFromSegment,
} from "@/lib/cycles";
import { getBudgetCycleForCycle, getCurrentBudgetCycle } from "@/lib/budget";
import { getCycleParticipationSummary, getMyParticipation } from "@/lib/participation";
import { getCommunity, isAdmin, listCycleTypes } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { listTaskPacks } from "@/lib/task-packs";
import { HIGHLIGHTABLE_MODULES } from "@/lib/nav";
import { ClonePreviewGrid, ClonePreviewList } from "@/components/ClonePreview";
import type { member as memberTable } from "@/db/schema";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import DateModeField, { type DateFieldBase } from "@/components/DateModeField";
import {
  addPhaseAction,
  closeCycleAction,
  createCycleAction,
  declareParticipationAction,
  exportCycleAsTaskPackAction,
  updateCycleSettingsAction,
  updatePhaseBoundaryAction,
  updatePhaseHighlightAction,
} from "./actions";

type Member = typeof memberTable.$inferSelect;
type Cycle = Awaited<ReturnType<typeof listCycles>>[number];

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// "Who's actually planning to be there, and how much room is left" —
// see docs/spec.md's "Participation & capacity" under Cycle and
// docs/development-plan.md's Phase 31. Core, not gated behind
// Recruitment — a Community with cycles on always has this page,
// whether or not Recruitment ever gets turned on. Moved under
// /[cycleScope]/ in Phase 65 — see ../layout.tsx for how the segment
// resolves, and view-scope.ts's own comment on why this page's
// "active" aggregate is every *open* cycle, not the nav's own
// "coming to" definition (a member needs to see cycles they haven't
// declared on yet in order to declare on them at all).
export default async function ParticipationPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycleScope: string }>;
  searchParams: Promise<{
    error?: string;
    declared?: string;
    settingsUpdated?: string;
    phaseUpdated?: string;
    phaseAdded?: string;
    highlightUpdated?: string;
    cycleCreated?: string;
    budgetNotStarted?: string;
    cycleClosed?: string;
    previewStart?: string;
    previewEnd?: string;
    previewView?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { cycleScope } = await params;
  const {
    error,
    declared,
    settingsUpdated,
    phaseUpdated,
    phaseAdded,
    highlightUpdated,
    cycleCreated,
    budgetNotStarted,
    cycleClosed,
    previewStart,
    previewEnd,
    previewView,
  } = await searchParams;

  const [scope, allCycles, canConfigure, isAdminNow] = await Promise.all([
    resolveViewScopeFromSegment(viewing, cycleScope),
    listCycles(viewing),
    canInitiateCycle(viewing),
    isAdmin(viewing),
  ]);
  // The [cycleScope] layout above already 404s an unresolvable segment
  // before this page ever renders — this is just satisfying the type.
  if (!scope) redirect("/active/participation");

  const hasPreviousCycle = allCycles.length > 0;
  const openCycle = allCycles.find((c) => !c.closedAt) ?? null;
  const cyclesToRender: Cycle[] = scope.kind === "aggregate" ? allCycles.filter((c) => !c.closedAt) : [scope.cycle];

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Participation</h1>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {declared && (
        <div className="mt-4">
          <Banner tone="success">Your participation is saved.</Banner>
        </div>
      )}
      {settingsUpdated && (
        <div className="mt-4">
          <Banner tone="success">Cycle settings updated.</Banner>
        </div>
      )}
      {phaseUpdated && (
        <div className="mt-4">
          <Banner tone="success">Phase dates updated.</Banner>
        </div>
      )}
      {phaseAdded && (
        <div className="mt-4">
          <Banner tone="success">Phase added.</Banner>
        </div>
      )}
      {highlightUpdated && (
        <div className="mt-4">
          <Banner tone="success">Phase highlight updated.</Banner>
        </div>
      )}
      {cycleCreated && (
        <div className="mt-4">
          <Banner tone="success">Cycle created — set its dates below, if you know them yet.</Banner>
        </div>
      )}
      {budgetNotStarted && (
        <div className="mt-4">
          <Banner tone="warning">
            Couldn&rsquo;t auto-start this cycle&rsquo;s Budget (the carried-forward owner task may no
            longer exist) — start one by hand from /budget.
          </Banner>
        </div>
      )}
      {cycleClosed && (
        <div className="mt-4">
          <Banner tone="success">Cycle closed.</Banner>
        </div>
      )}

      {cyclesToRender.length === 0 ? (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          No open cycle yet — there&rsquo;s nothing to declare participation against until one
          exists.
        </p>
      ) : (
        cyclesToRender.map((c) => (
          <ParticipationForCycle
            key={c.id}
            viewing={viewing}
            cycleId={c.id}
            cycleName={c.name}
            cycleScope={cycleScope}
            closed={Boolean(c.closedAt)}
            isAdminNow={isAdminNow}
          />
        ))
      )}

      {canConfigure && (
        <StartNewCycleSection
          viewing={viewing}
          cycleScope={cycleScope}
          hasPreviousCycle={hasPreviousCycle}
          openCycleName={openCycle?.name ?? null}
          previewStart={previewStart}
          previewEnd={previewEnd}
          previewView={previewView === "list" ? "list" : "grid"}
        />
      )}
    </main>
  );
}

// "The Pack import review screen gains the date preview" —
// docs/development-plan.md's Phase 44. This is that screen's minimal
// real form: preview a hypothetical clone (calendar or list, toggled
// by the reviewer) before committing to anything, then create for real
// below. `openCycleName` (Phase 65) drives the already-open-cycle
// confirmation — a required checkbox rather than a separate resubmit
// step, since this form's other fields (name, source, cycle type)
// would otherwise need to survive a full confirm/resubmit round trip.
async function StartNewCycleSection({
  viewing,
  cycleScope,
  hasPreviousCycle,
  openCycleName,
  previewStart,
  previewEnd,
  previewView,
}: {
  viewing: Member;
  cycleScope: string;
  hasPreviousCycle: boolean;
  openCycleName: string | null;
  previewStart?: string;
  previewEnd?: string;
  previewView: "grid" | "list";
}) {
  const [cycleTypes, packs, preview, communityRow, previousBudgetCycle] = await Promise.all([
    listCycleTypes(viewing),
    listTaskPacks(viewing),
    hasPreviousCycle && (previewStart || previewEnd)
      ? previewClonePreviousCycle(viewing, previewStart || null, previewEnd || null)
      : Promise.resolve(null),
    getCommunity(viewing),
    getCurrentBudgetCycle(viewing),
  ]);
  const packNameById = new Map(packs.map((p) => [p.id, p.name]));
  // Only offer the auto-start checkbox when startBudgetCycleForNewCycle
  // (src/lib/budget/cycles.ts) would actually succeed — Budget on, and
  // a previous BudgetCycle to carry the owner task forward from that
  // isn't itself still active. Otherwise this Community's very first
  // Budget cycle still has to be started by hand from /budget, same as
  // always — there's no owner task to guess at yet.
  const canAutoStartBudget =
    isModuleEnabled(communityRow, "budget") && previousBudgetCycle?.status === "confirmed";
  // "Correctly pre-selects that pack when starting a new Cycle of that
  // type" — see docs/development-plan.md's Phase 55 Done-when. No
  // client JS to pre-fill one <select> from another's chosen value, so
  // this is a plain, static link straight into the real import review
  // screen instead — already carrying the right pack and cycle type.
  const typesWithDefaultPack = cycleTypes.filter((t) => t.defaultPackId && packNameById.has(t.defaultPackId));

  return (
    <section className="mt-8 border-t border-[var(--border)] pt-6">
      <SectionHeading>Start a new cycle</SectionHeading>

      {typesWithDefaultPack.length > 0 && (
        <div className={`mt-4 ${CARD}`}>
          <h3 className="text-[15px] font-medium text-[var(--text)]">Quick-start from a Cycle type&rsquo;s default pack</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[13px]">
            {typesWithDefaultPack.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/task-packs/import/${t.defaultPackId}?cycleTypeId=${t.id}&cycleName=${encodeURIComponent(t.name)}`}
                  className="text-[var(--accent-1)] hover:underline"
                >
                  Start a new {t.name} cycle from &ldquo;{packNameById.get(t.defaultPackId!)}&rdquo;
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasPreviousCycle && (
        <div className={`mt-4 ${CARD}`}>
          <h3 className="text-[15px] font-medium text-[var(--text)]">Preview a clone</h3>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            See what cloning the most recent cycle would resolve to against a hypothetical
            start/end, before committing to anything. Reuses the exact same recompute the real
            Cycle-settings form above uses, so this always matches what actually lands once you
            create the clone and set its dates for real.
          </p>
          <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Hypothetical start</span>
              <input type="date" name="previewStart" defaultValue={previewStart ?? ""} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Hypothetical end</span>
              <input type="date" name="previewEnd" defaultValue={previewEnd ?? ""} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>View</span>
              <select name="previewView" defaultValue={previewView} className={INPUT}>
                <option value="grid">Calendar</option>
                <option value="list">List</option>
              </select>
            </label>
            <button type="submit" className={BUTTON_SECONDARY}>
              Preview
            </button>
          </form>

          {preview &&
            (previewView === "list" ? <ClonePreviewList preview={preview} /> : <ClonePreviewGrid preview={preview} />)}
        </div>
      )}

      {openCycleName && (
        <div className="mt-4">
          <Banner tone="warning">
            &ldquo;{openCycleName}&rdquo; is already open — starting another cycle won&rsquo;t close it.
          </Banner>
        </div>
      )}

      <form action={createCycleAction} className="mt-4 flex max-w-[400px] flex-col gap-2">
        <input type="hidden" name="cycleScope" value={cycleScope} />
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name</span>
          <input type="text" name="name" required className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Source</span>
          <select name="source" defaultValue={hasPreviousCycle ? "clone_previous" : "blank"} className={INPUT}>
            <option value="blank">Blank</option>
            {hasPreviousCycle && <option value="clone_previous">Clone the most recent cycle</option>}
          </select>
        </label>
        {cycleTypes.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Cycle type (optional)</span>
            <select name="cycleTypeId" defaultValue="" className={INPUT}>
              <option value="">No cycle type</option>
              {cycleTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="text-[12px] text-[var(--text-muted)]">
          A clone&rsquo;s own start/end aren&rsquo;t set here — use the Cycle settings form above once
          it exists.
        </p>
        {canAutoStartBudget && (
          <CheckField
            label={`Also start a Budget cycle for this Cycle (owner task carried forward from "${previousBudgetCycle!.title}")`}
            name="startBudget"
            defaultChecked
          />
        )}
        {openCycleName && <CheckField label="I understand — start anyway" name="confirmed" />}
        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Create
        </button>
      </form>
    </section>
  );
}

async function ParticipationForCycle({
  viewing,
  cycleId,
  cycleName,
  cycleScope,
  closed,
  isAdminNow,
}: {
  viewing: Member;
  cycleId: string;
  cycleName: string;
  cycleScope: string;
  closed: boolean;
  isAdminNow: boolean;
}) {
  const [summary, mine, canConfigure, communityRow] = await Promise.all([
    getCycleParticipationSummary(viewing, cycleId),
    getMyParticipation(viewing, cycleId),
    canInitiateCycle(viewing),
    getCommunity(viewing),
  ]);
  // Only needed for the cycle-settings/phase-dates sections below —
  // skip the extra query entirely for anyone who can't see them.
  const withPhases = canConfigure ? await getCycle(viewing, cycleId) : null;
  // Admin-only, and only meaningful for a still-open cycle — see
  // closeCycle's own budget-owner warning (src/lib/cycles/lifecycle.ts).
  const budgetCycleRow =
    isAdminNow && !closed && isModuleEnabled(communityRow, "budget")
      ? await getBudgetCycleForCycle(viewing, cycleId)
      : null;
  const needsBudgetDoneWarning = Boolean(budgetCycleRow && !budgetCycleRow.ownerMarkedDoneAt);

  return (
    <>
      <section id="cycle-settings" className="mt-6">
        <div className="flex items-center gap-2">
          <SectionHeading>{cycleName}</SectionHeading>
          {closed && <Tag>closed, read-only</Tag>}
        </div>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
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
          <p className={`mt-1 text-[13px] ${summary.returningWindowOpen ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
            Returning-priority window {summary.returningWindowOpen ? "open" : "closed"} — closes{" "}
            {new Date(summary.returningWindowClosesAt).toLocaleString()}.
          </p>
        )}
      </section>

      {!closed && (
        <section className="mt-6">
          <SectionHeading>Your plans</SectionHeading>
          <form action={declareParticipationAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Status</span>
              <select name="status" defaultValue={mine.status} className={INPUT}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Arrival date (optional)</span>
              <input type="date" name="arrivalDate" defaultValue={mine.arrivalDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Departure date (optional)</span>
              <input type="date" name="departureDate" defaultValue={mine.departureDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Note (optional)</span>
              <textarea name="note" rows={2} defaultValue={mine.note ?? ""} className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save
            </button>
          </form>
        </section>
      )}

      {canConfigure && !closed && (
        <section className="mt-6">
          <SectionHeading>Cycle settings</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Visible to you because you can start a cycle for this Community — the same authority
            configures its capacity and returning-priority window.
          </p>
          <form action={updateCycleSettingsAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Capacity (optional — blank = unlimited)</span>
              <input type="number" name="capacity" min={1} defaultValue={summary.capacity ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Start date (optional)</span>
              <input type="date" name="startDate" defaultValue={withPhases?.startDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>End date (optional)</span>
              <input type="date" name="endDate" defaultValue={withPhases?.endDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Returning-priority window closes at (optional)</span>
              <input
                type="datetime-local"
                name="returningWindowClosesAt"
                defaultValue={
                  summary.returningWindowClosesAt ? toDatetimeLocal(new Date(summary.returningWindowClosesAt)) : ""
                }
                className={`${INPUT} w-fit`}
              />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save settings
            </button>
          </form>
        </section>
      )}

      {withPhases && !closed && (
        <PhaseDatesSection phases={withPhases.phases} cycleId={cycleId} cycleScope={cycleScope} />
      )}

      {canConfigure && (
        <section className="mt-6">
          <SectionHeading>Export as a Task Pack</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Save this cycle&rsquo;s full task set (or a hand-picked subset, from the board&rsquo;s own
            bulk selection) as a named, downloadable pack — see{" "}
            <Link href="/task-packs" className="text-[var(--accent-1)] hover:underline">
              Task Packs
            </Link>{" "}
            to manage what&rsquo;s saved, share one as a file, or import one into a new cycle.
          </p>
          <form action={exportCycleAsTaskPackAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Pack name</span>
              <input type="text" name="name" required defaultValue={cycleName} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Description (optional)</span>
              <textarea name="description" rows={2} className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Export whole cycle
            </button>
          </form>
        </section>
      )}

      {isAdminNow && !closed && (
        <section className="mt-6 border-t border-[var(--border)] pt-6">
          <SectionHeading>Close this cycle</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Locks everything about this cycle — no exception. Reaching a closed cycle afterward is
            a normal, read-only state, not an error.
          </p>
          {needsBudgetDoneWarning && (
            <div className="mt-3">
              <Banner tone="warning">
                The current Budget owner hasn&rsquo;t marked &ldquo;{budgetCycleRow!.title}&rdquo; done yet.
              </Banner>
            </div>
          )}
          <form action={closeCycleAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            {needsBudgetDoneWarning && <CheckField label="Close anyway" name="overrideBudgetWarning" />}
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Close cycle
            </button>
          </form>
        </section>
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
// Cycle's own dates resolve against. No rename/reorder here (phases,
// once added, keep whatever name/order they were given) — this is for
// editing an existing phase's dates plus (below) adding a new one.
function PhaseDatesSection({ phases, cycleId, cycleScope }: { phases: PhaseRow[]; cycleId: string; cycleScope: string }) {
  return (
    <section className="mt-6">
      <SectionHeading>Phase dates</SectionHeading>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        Each boundary is either an absolute date or relative to the cycle&rsquo;s own start/end —
        type a new offset/percent directly, or pick a target date to drag it there (either way,
        what&rsquo;s persisted is the recomputed offset/percent, never a bare date).
      </p>
      {phases.length === 0 && <p className="mt-3 text-[13px] text-[var(--text-muted)]">None yet.</p>}
      <div className="mt-3 flex flex-col gap-3">
        {phases.map((p) => (
          <div key={p.id} className={`max-w-[500px] ${CARD}`}>
            <h3 className="text-[15px] font-medium text-[var(--text)]">{p.name}</h3>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Start: {p.startDate ?? "unresolved"} — {describeBoundary("Start", p, p.startDateType, p.startRelativeMode)}
              <br />
              End: {p.endDate ?? "unresolved"} — {describeBoundary("End", p, p.endDateType, p.endRelativeMode)}
            </p>
            {p.flags.orderInvalid && (
              <p className="mt-1 text-[13px] text-[var(--danger)]">This phase&rsquo;s end resolves before its own start.</p>
            )}
            {p.flags.startDrifted && (
              <p className="mt-1 text-[13px] text-[var(--warning)]">
                Start was set relative to {p.startOffsetAnchor ? ANCHOR_LABEL[p.startOffsetAnchor] : "?"}, but it&rsquo;s
                now closer to the other boundary.
              </p>
            )}
            {p.flags.endDrifted && (
              <p className="mt-1 text-[13px] text-[var(--warning)]">
                End was set relative to {p.endOffsetAnchor ? ANCHOR_LABEL[p.endOffsetAnchor] : "?"}, but it&rsquo;s now
                closer to the other boundary.
              </p>
            )}
            <form action={updatePhaseBoundaryAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="phaseId" value={p.id} />
              <input type="hidden" name="cycleScope" value={cycleScope} />
              <PhaseBoundaryFields prefix="start" p={p} />
              <PhaseBoundaryFields prefix="end" p={p} />
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Save dates
              </button>
            </form>
            <form action={updatePhaseHighlightAction} className="mt-3 flex items-end gap-2">
              <input type="hidden" name="phaseId" value={p.id} />
              <input type="hidden" name="cycleScope" value={cycleScope} />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Pin a module for everyone coming while this phase is current</span>
                <select name="highlightModuleKey" defaultValue={p.highlightModuleKey ?? ""} className={INPUT}>
                  <option value="">None</option>
                  {HIGHLIGHTABLE_MODULES.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={BUTTON_SECONDARY}>
                Save
              </button>
            </form>
          </div>
        ))}
      </div>

      <details className="mt-4 max-w-[500px] rounded-[var(--radius-md)] border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">Add a phase</summary>
        <form action={addPhaseAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="cycleId" value={cycleId} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name</span>
            <input type="text" name="name" required className={INPUT} />
          </label>
          <PhaseBoundaryFields prefix="start" />
          <PhaseBoundaryFields prefix="end" />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Add
          </button>
        </form>
      </details>
    </section>
  );
}

// `p` is omitted entirely for the "Add a phase" form below (a brand-new
// phase has no existing row to default from) — mirrors how
// tasks/[id]/page.tsx's MilestoneDateFields handles its own optional
// `milestone` prop for the identical add-vs-edit dual use.
function PhaseBoundaryFields({ prefix, p }: { prefix: "start" | "end"; p?: PhaseRow }) {
  const dateType = prefix === "start" ? p?.startDateType : p?.endDateType;
  const relativeMode = prefix === "start" ? p?.startRelativeMode : p?.endRelativeMode;
  const anchor = prefix === "start" ? p?.startOffsetAnchor : p?.endOffsetAnchor;
  const offsetDays = prefix === "start" ? p?.startOffsetDays : p?.endOffsetDays;
  const percent = prefix === "start" ? p?.startPercent : p?.endPercent;
  const absoluteDate = prefix === "start" ? p?.startDate : p?.endDate;

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fieldNames: Record<DateFieldBase, string> = {
    mode: `${prefix}${cap("mode")}`,
    absoluteDate: `${prefix}${cap("absoluteDate")}`,
    anchor: `${prefix}${cap("anchor")}`,
    offsetDays: `${prefix}${cap("offsetDays")}`,
    percent: `${prefix}${cap("percent")}`,
    targetDate: `${prefix}${cap("targetDate")}`,
    phaseId: `${prefix}${cap("phaseId")}`,
  };

  return (
    <DateModeField
      legend={prefix === "start" ? "Start" : "End"}
      fieldNames={fieldNames}
      mode={dateType}
      relativeMode={relativeMode}
      anchor={anchor}
      absoluteDate={dateType === "absolute" ? absoluteDate : undefined}
      offsetDays={relativeMode === "offset" ? offsetDays : undefined}
      percent={relativeMode === "percent" ? percent : undefined}
    />
  );
}
