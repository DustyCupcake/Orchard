import Link from "next/link";
import TimeZoneInput from "@/components/TimeZoneInput";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import {
  canInitiateCycle,
  endBoundaryOf,
  getCycle,
  listCycles,
  previewClonePreviousCycle,
  resolveViewScopeFromSegment,
  startBoundaryOf,
} from "@/lib/cycles";
import { getBudgetCycleForCycle, getCurrentBudgetCycle } from "@/lib/budget";
import {
  getCycleParticipationSummary,
  getMyParticipation,
  listOpenEventParticipationCards,
} from "@/lib/participation";
import { getCycleShiftRoster } from "@/lib/shifts";
import { listForms } from "@/lib/forms";
import { getJoinLaneRulesForContext, listOverriddenLanes } from "@/lib/recruitment/joining-lanes";
import { JOINING_LANE_COPY, JOINING_LANE_DEFAULTS, JOINING_LANE_ORDER, type JoiningLaneRule } from "@/lib/recruitment/lanes";
import {
  confirmShiftProposalAction,
  openCycleShiftSignupsAction,
} from "../../shifts/actions";
import { getCommunity, isAdmin, listCycleTypes } from "@/lib/settings";
import { listOutstandingQuestions } from "@/lib/profile-questions";
import { isModuleEnabled } from "@/lib/modules";
import { describeBoundaryWindow, formatDateRange } from "@/lib/dates";
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
  updateCycleLaneRulesAction,
} from "./actions";
import SelectField from "@/components/ui/SelectField";

// The one-line "what does this lane do" a per-event override card needs
// next to its inherit checkbox. Deliberately the short form rather than
// the full consequence sentence: this is a summary of the *current*
// state, and the person editing an override is comparing two of them.
function laneSummary(rule: JoiningLaneRule) {
  const proof = {
    basic: "one member’s word is enough",
    nomination: `needs ${rule.supportCount} more member${rule.supportCount === 1 ? "" : "s"}`,
    consensus: "announced to the community before admission",
  }[rule.verificationMode];
  const process = [
    rule.applicationRequired ? "an application" : null,
    rule.interviewRequired ? "an interview" : null,
  ].filter(Boolean);
  return `${proof}${process.length ? `, plus ${process.join(" and ")}` : ""}.`;
}

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
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
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
    shiftOpened?: string;
    proposalConfirmed?: string;
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
    shiftOpened,
    proposalConfirmed,
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

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Events</h1>

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
          <Banner tone="success">Event settings updated.</Banner>
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
          <Banner tone="success">Event created — set its dates below, if you know them yet.</Banner>
        </div>
      )}
      {budgetNotStarted && (
        <div className="mt-4">
          <Banner tone="warning">
            Couldn&rsquo;t auto-start this event&rsquo;s Budget — start one by hand from /budget.
          </Banner>
        </div>
      )}
      {cycleClosed && (
        <div className="mt-4">
          <Banner tone="success">Event closed.</Banner>
        </div>
      )}
      {shiftOpened && (
        <div className="mt-4">
          <Banner tone="success">Sign-ups opened for this event&rsquo;s shift roster — it can&rsquo;t be closed again.</Banner>
        </div>
      )}
      {proposalConfirmed && (
        <div className="mt-4">
          <Banner tone="success">Shift proposal confirmed — it&rsquo;s on the roster now.</Banner>
        </div>
      )}

      {scope.kind === "aggregate" ? (
        <EventIndex viewing={viewing} allCycles={allCycles} />
      ) : (
        <ParticipationForCycle
          viewing={viewing}
          cycleId={scope.cycle.id}
          cycleName={scope.cycle.name}
          cycleScope={cycleScope}
          closed={Boolean(scope.cycle.closedAt)}
          isAdminNow={isAdminNow}
        />
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

/**
 * The index, for the aggregate scope: one card per event, open ones first,
 * and a card linking into each event's own page.
 *
 * **This replaces rendering `ParticipationForCycle` once per open cycle.**
 * That was the mixing: a community with three open events got three complete
 * configuration blocks stacked on one page — three sets of capacity controls,
 * joining config, lane rules, phase dates and pack export, each with no
 * indication which event it belonged to beyond an `<h2>`. It also meant the
 * per-event page and the index were the same page, so there was nowhere to
 * *go* to configure one event. An event's own settings now live at
 * `/{id}/participation`, which is also where the nav switcher's gear points,
 * so the card and the switcher agree on where an event is configured.
 *
 * **Visible to every member, not just whoever can start an event.** It used
 * to be gated on `canInitiateCycle`, which made this page nearly empty for
 * everyone else — but "what events does this community have, and when are
 * they" is not an administrative question, and a member declaring
 * participation needs to find the event to declare against.
 */
async function EventIndex({ viewing, allCycles }: { viewing: Member; allCycles: Cycle[] }) {
  // The same call /community's event cards use, so the numbers here and
  // there cannot disagree. It only covers open events; closed ones need
  // nothing but a name and dates, which allCycles already has.
  const openCards = await listOpenEventParticipationCards(viewing);
  const closedCycles = allCycles
    .filter((c) => c.closedAt)
    .sort((a, b) => (b.closedAt!.getTime() - a.closedAt!.getTime()));

  if (allCycles.length === 0) {
    return (
      <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">
        No events yet. Until one exists there&rsquo;s nothing to declare participation against.
      </p>
    );
  }

  return (
    <section className="mt-6 flex flex-col gap-2">
      {openCards.map((c) => (
        <Link
          key={c.id}
          href={`/${c.id}/participation`}
          className={`${CARD} block transition-colors hover:border-[var(--accent-1)]`}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{c.name}</span>
            {c.myStatus !== "unknown" && (
              <Tag tone={c.myStatus === "coming" ? "success" : c.myStatus === "maybe" ? "warning" : undefined}>
                {PARTICIPATION_LABEL[c.myStatus]}
              </Tag>
            )}
          </div>
          <p className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            {dateRange(c.startDate, c.endDate)}
            {c.capacity !== null && (
              <>
                {" · "}
                {c.comingCount} coming
                {c.remainingCapacity !== null && c.remainingCapacity > 0 && ` · ${c.remainingCapacity} place${c.remainingCapacity === 1 ? "" : "s"} left`}
                {c.remainingCapacity !== null && c.remainingCapacity === 0 && " · full"}
              </>
            )}
            {c.capacity === null && c.comingCount > 0 && ` · ${c.comingCount} coming`}
          </p>
        </Link>
      ))}

      {/* Closed events collapse. A community with a long history would
          otherwise open this page onto a wall of dead cards, and the thing
          a reader wants first is what is happening *now* — the count is in
          the summary so the history's size is known before opening it. */}
      {closedCycles.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)] hover:underline">
            {closedCycles.length} past event{closedCycles.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {closedCycles.map((c) => (
              <Link
                key={c.id}
                href={`/${c.id}/participation`}
                className="flex flex-wrap items-baseline gap-x-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[length:var(--text-body)] transition-colors hover:border-[var(--accent-1)]"
                style={{ opacity: 0.75 }}
              >
                <span className="font-medium text-[var(--text)]">{c.name}</span>
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {dateRange(c.startDate, c.endDate)}
                </span>
              </Link>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function dateRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} – ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return "No dates set yet";
}

const PARTICIPATION_LABEL = {
  coming: "You're coming",
  maybe: "Maybe",
  not_coming: "Not coming",
} as const;

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
  // (src/lib/budget/cycles.ts) would actually succeed — Budget on, and a
  // previous BudgetCycle whose fixed costs can be carried forward isn't
  // itself still active. Otherwise this Community's very first Budget
  // cycle still has to be started by hand from /budget.
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
      <SectionHeading>Start a new event</SectionHeading>

      {typesWithDefaultPack.length > 0 && (
        <div className={`mt-4 ${CARD}`}>
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Quick-start from an Event type&rsquo;s default pack</h3>
          <ul className="mt-2 flex flex-col gap-1 text-[length:var(--text-body)]">
            {typesWithDefaultPack.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/task-packs/import/${t.defaultPackId}?cycleTypeId=${t.id}&cycleName=${encodeURIComponent(t.name)}`}
                  className="text-[var(--accent-1)] hover:underline"
                >
                  Start a new {t.name} event from &ldquo;{packNameById.get(t.defaultPackId!)}&rdquo;
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasPreviousCycle && (
        <div className={`mt-4 ${CARD}`}>
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Preview a clone</h3>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            See what cloning the most recent event would resolve to against a hypothetical
            start/end, before committing to anything. Reuses the exact same recompute the real
            event settings form above uses, so this always matches what actually lands once you
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
            &ldquo;{openCycleName}&rdquo; is already open — starting another event won&rsquo;t close it.
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
          <SelectField name="source" defaultValue={hasPreviousCycle ? "clone_previous" : "blank"} className={INPUT}>
            <option value="blank">Blank</option>
            {hasPreviousCycle && <option value="clone_previous">Clone the most recent event</option>}
          </SelectField>
        </label>
        {cycleTypes.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Event type (optional)</span>
            <select name="cycleTypeId" defaultValue="" className={INPUT}>
              <option value="">No event type</option>
              {cycleTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Start date (optional)</span>
          <input type="date" name="startDate" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>End date (optional)</span>
          <input type="date" name="endDate" className={INPUT} />
        </label>
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Setting a clone&rsquo;s dates here resolves its phased boundaries and re-derives its shift
          roster&rsquo;s occurrence timestamps immediately; a clone started without them defers the
          shift occurrences until you set dates in the event settings form above.
        </p>
        {canAutoStartBudget && (
          <CheckField
            label={`Also start a budget period for this event (fixed costs carried forward from "${previousBudgetCycle!.title}")`}
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
  const shiftsOn = isModuleEnabled(communityRow, "shifts");
  // The community-wide lanes, which is what the per-event overrides fall
  // back to. Read here rather than inside the override loop because it
  // doesn't depend on the event.
  const communityLaneRules = await getJoinLaneRulesForContext(communityRow.id, null);
  // The cycle's shift roster (§5.6) — visible to any member of the
  // community, management actions only for the cycle's manager.
  const roster = shiftsOn ? await getCycleShiftRoster(viewing, cycleId) : null;
  // Only needed for the cycle-settings/phase-dates sections below —
  // skip the extra query entirely for anyone who can't see them.
  const withPhases = canConfigure ? await getCycle(viewing, cycleId) : null;
  // Forms pickable as the cycle's own application form (blank = fall
  // back to the community's standing form) — only for the same
  // audience, same reason.
  const forms = canConfigure ? await listForms(viewing) : [];
  // §5.2 — the community-wide lane rules this event inherits, the ones it
  // has overridden, and which of those it has overridden. Two reads
  // because they answer different questions: the first is what a lane
  // *does* here if nothing is overridden, the second is what has *been*
  // overridden. Reading only the second and defaulting the rest would
  // quietly re-introduce the "never snapshotted" bug the lane model was
  // built to avoid.
  //
  // **None of this is gated on `canConfigure` any more.** Which rule
  // applies to the lane somebody would arrive by is not an administrative
  // question — it is the admission design of their own community, and they
  // have a say in it. Only the *controls* below are Admin-only, which is
  // the same split the settings screen uses: the state is everyone's, the
  // editing is an Admin's.
  const cycleLaneRules = await getJoinLaneRulesForContext(communityRow.id, cycleId);
  const overriddenLanes = new Set(await listOverriddenLanes(communityRow.id, cycleId));
  const laneRows = JOINING_LANE_ORDER.map((key) => ({
    key,
    title: JOINING_LANE_COPY[key].title,
    effective: cycleLaneRules.get(key) ?? communityLaneRules.get(key) ?? JOINING_LANE_DEFAULTS[key],
    isCustom: overriddenLanes.has(key),
  }));
  const customLaneCount = laneRows.filter((l) => l.isCustom).length;
  // Admin-only, and only meaningful for a still-open cycle — see
  // closeCycle's own budget-owner warning (src/lib/cycles/lifecycle.ts).
  const budgetCycleRow =
    isAdminNow && !closed && isModuleEnabled(communityRow, "budget")
      ? await getBudgetCycleForCycle(viewing, cycleId)
      : null;
  const needsBudgetDoneWarning = Boolean(budgetCycleRow && !budgetCycleRow.ownerMarkedDoneAt);
  // The same "questions for this event" the Dashboard's and Community's
  // declare-joining controls route to on submit — linked from here too so
  // the full form's submitter isn't left wondering where to answer them.
  const eventQuestions = (
    await listOutstandingQuestions(viewing, { cycleId })
  ).filter((q) => q.question.scope !== "once_ever");

  return (
    <>
      <section id="cycle-settings" className="mt-6">
        <div className="flex items-center gap-2">
          <SectionHeading>{cycleName}</SectionHeading>
          {closed && <Tag>closed, read-only</Tag>}
        </div>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {summary.capacity === null ? (
            "No capacity cap set — unlimited."
          ) : (
            <>
              Capacity {summary.capacity} · {summary.comingCount} coming{summary.holds > 0 && ` · ${summary.holds} held`} ·{" "}
              {summary.remainingCapacity !== null && summary.remainingCapacity < 0
                ? `${-summary.remainingCapacity} over capacity`
                : `${summary.remainingCapacity} remaining`}
            </>
          )}
        </p>
        {summary.returningWindowClosesAt && (
          <p className={`mt-1 text-[length:var(--text-body)] ${summary.returningWindowOpen ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
            Returning-priority window {summary.returningWindowOpen ? "open" : "closed"} — closes{" "}
            {new Date(summary.returningWindowClosesAt).toLocaleString()}.
          </p>
        )}
      </section>

      {roster && (
        <section className="mt-6">
          <SectionHeading>Shift roster</SectionHeading>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[length:var(--text-body)] text-[var(--text-muted)]">
              {roster.manager
                ? `Managed by ${roster.manager.name}.`
                : "No shift manager selected — this roster stays closed until someone holds a shift_management-granted task in this event."}
            </span>
            {roster.signupsOpened ? (
              <Tag tone="success">Sign-ups open</Tag>
            ) : (
              <Tag tone="neutral">Collecting — sign-ups closed</Tag>
            )}
          </div>

          {!closed && roster.isManager && !roster.signupsOpened && (
            <form action={openCycleShiftSignupsAction} className="mt-2">
              <input type="hidden" name="cycleId" value={cycleId} />
              <input type="hidden" name="cycleScope" value={cycleId} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Open sign-ups for this roster (one-way)
              </button>
            </form>
          )}

          {roster.series.length === 0 ? (
            <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">Nothing placed in this roster yet.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {roster.series.map(({ series: s, confirmedAt, occurrences }) => (
                <div key={s.id} className={CARD}>
                  <div className="flex flex-wrap items-center gap-2">
                    {!confirmedAt && <Tag tone="warning">proposal — pending confirmation</Tag>}
                    <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{s.title}</span>
                  </div>
                  {s.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{s.description}</p>}
                  {!confirmedAt && !closed && roster.isManager && (
                    <form action={confirmShiftProposalAction} className="mt-2">
                      <input type="hidden" name="seriesId" value={s.id} />
                      <input type="hidden" name="cycleScope" value={cycleId} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Confirm for this roster
                      </button>
                    </form>
                  )}
                  {occurrences.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-0.5">
                      {occurrences.map(({ occurrence, capacity, signupCount }) => (
                        <li key={occurrence.id} className="text-[length:var(--text-body)] text-[var(--text)]">
                          {new Date(occurrence.startsAt).toLocaleString()} — {signupCount}/{capacity} signed up
                        </li>
                      ))}
                    </ul>
                  ) : (
                    confirmedAt && (
                      <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">No occurrences generated yet.</p>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!closed && (
        <section className="mt-6">
          <SectionHeading>Your plans</SectionHeading>
          {eventQuestions.length > 0 && (
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
              Your community also asks{" "}
              {eventQuestions.length === 1 ? "one question" : `${eventQuestions.length} questions`} about this
              event —{" "}
              <Link href={`/questions?cycle=${cycleId}`} className="text-[var(--accent-1)] hover:underline">
                answer {eventQuestions.length === 1 ? "it" : "them"} here
              </Link>
              .
            </p>
          )}
          <form action={declareParticipationAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Status</span>
              <SelectField name="status" defaultValue={mine.status} className={INPUT}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
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
          <SectionHeading>Event settings</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Visible to you because you can start an event for this Community — the same authority
            configures its capacity, returning-priority window, and joining config (§4.3/8c).
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
              <span className={LABEL}>Time zone (optional)</span>
              <TimeZoneInput defaultValue={withPhases?.timeZone} placeholder={communityRow.timeZone ?? "UTC"} className={`${INPUT} w-fit`} />
              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                What clock this event&apos;s times are read in. Leave blank to use the community&apos;s
                {communityRow.timeZone ? ` (${communityRow.timeZone})` : " default, UTC"}.
              </span>
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
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Application form (optional — blank = community standing form)</span>
              <SelectField
                name="recruitmentApplicationFormId"
                className={`${INPUT} w-fit`}
                defaultValue={withPhases?.recruitmentApplicationFormId ?? ""}
              >
                <option value="">— use the community&apos;s form —</option>
                {forms
                  .filter((f) => !f.archivedAt)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
              </SelectField>
              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                The event&rsquo;s joining window runs from the returning-priority close above until the
                deadline below; both doors are shut outside it and once capacity is reached.
              </span>
            </label>
            <CheckField
              label="Applications open"
              name="applicationsOpen"
              defaultChecked={withPhases?.applicationsOpen ?? true}
            />
            <CheckField label="Invites open" name="invitesOpen" defaultChecked={withPhases?.invitesOpen ?? true} />
            {/* §2.3/J3's third door, on the event. Deliberately not a
                lane setting: a lane's `interviewRequired` says "an
                arrival on this lane is interviewed", and this says "no
                interviews happen in this event right now". They are
                independent on purpose — an event can interview its
                invitees with the applications door shut, and can stop
                interviewing without touching anybody's admission rule. */}
            <CheckField
              label="Interviews open"
              name="interviewsOpen"
              defaultChecked={withPhases?.interviewsOpen ?? true}
            />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Joining window closes at (optional — blank = until the event closes)</span>
              <input
                type="datetime-local"
                name="joiningWindowClosesAt"
                defaultValue={
                  withPhases?.joiningWindowClosesAt
                    ? toDatetimeLocal(new Date(withPhases.joiningWindowClosesAt))
                    : ""
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

      {/* §5.2 — moved OUT of the "Event settings" section above, which is
          Admin-gated, because these four rules are not an administrative
          fact about the event. They are this community's admission design,
          and a member arriving by one of these lanes is being measured
          against it — so the rules are stated to everyone and only the
          controls that change them are Admin-only. The same split the
          community settings screen uses: the state is everyone's, the
          editing is an Admin's. */}
      {!closed && (
        <section className="mt-6">
          {/* The same four lane cards the community-wide settings
              have, as per-event overrides. A lane this event doesn't
              override inherits the community's rule, and that inheritance
              is the default state rather than a sentinel: an absent row
              is an absent row, so unticking "this event has its own rule
              for…" genuinely hands the lane back rather than freezing
              whatever it happened to be set to. */}
          <div className="mt-6 flex max-w-[600px] flex-col gap-3">
            <div>
              <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">This event&rsquo;s own admission rules</h3>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                {customLaneCount === 0 ? (
                  <>
                    Every lane works exactly as the community has set it — this event doesn&rsquo;t
                    change any of them.
                  </>
                ) : (
                  <>
                    {customLaneCount} of {laneRows.length} lanes work differently here. The rest are
                    the community&rsquo;s, and follow it if the community changes them later.
                  </>
                )}
              </p>
            </div>
            {!canConfigure ? (
              /* The same four lanes, stated rather than editable. A member
                 arriving by one of these is being measured against it, and
                 "one member's word is enough" is the kind of fact they are
                 entitled to read — the same reasoning that opened the
                 community settings screen to every member. */
              <div className="flex flex-col gap-2">
                {laneRows.map((lane) => (
                  <div
                    key={lane.key}
                    className="rounded-[var(--radius-md)] border border-[var(--border)] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{lane.title}</span>
                      <Tag tone={lane.isCustom ? "warning" : undefined}>
                        {lane.isCustom ? "this event's own rule" : "the community's rule"}
                      </Tag>
                    </div>
                    <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      {laneSummary(lane.effective)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
            <form action={updateCycleLaneRulesAction} className="flex flex-col gap-3">
              <input type="hidden" name="cycleId" value={cycleId} />
              <input type="hidden" name="cycleScope" value={cycleScope} />
              <div className="flex flex-col gap-2">
                {laneRows.map((lane) => {
                  const override = cycleLaneRules.get(lane.key);
                  return (
                    <div key={lane.key} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                      <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                        <input
                          type="checkbox"
                          name={`lane.${lane.key}.override`}
                          value="on"
                          defaultChecked={lane.isCustom}
                          className="mt-0.5"
                        />
                        <span>
                          This event has its own rule for <strong>{lane.title}</strong>
                          <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
                            Right now: {laneSummary(lane.effective)}
                          </span>
                        </span>
                      </label>
                      {override && (
                        <div className="mt-2 flex flex-col gap-2 border-l-2 border-[var(--border)] pl-3">
                          <label className="flex max-w-[320px] flex-col gap-1">
                            <span className={LABEL}>How much proof</span>
                            <select name={`lane.${lane.key}.verificationMode`} defaultValue={override.verificationMode} className={INPUT}>
                              <option value="basic">One member&rsquo;s word</option>
                              <option value="nomination">One more member&rsquo;s word</option>
                              <option value="consensus">The whole community sees them arrive</option>
                            </select>
                          </label>
                          {override.verificationMode === "nomination" && (
                            <label className="flex max-w-[160px] flex-col gap-1">
                              <span className={LABEL}>How many people</span>
                              <input
                                type="number"
                                name={`lane.${lane.key}.supportCount`}
                                min={1}
                                max={50}
                                defaultValue={override.supportCount}
                                className={INPUT}
                              />
                            </label>
                          )}
                          <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                            <input
                              type="hidden"
                              name={`lane.${lane.key}.applicationRequired`}
                              value="off"
                            />
                            <input
                              type="checkbox"
                              name={`lane.${lane.key}.applicationRequired`}
                              value="on"
                              defaultChecked={override.applicationRequired}
                            />
                            They fill in the application form
                          </label>
                          <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                            <input type="hidden" name={`lane.${lane.key}.interviewRequired`} value="off" />
                            <input
                              type="checkbox"
                              name={`lane.${lane.key}.interviewRequired`}
                              value="on"
                              defaultChecked={override.interviewRequired}
                            />
                            They have an interview
                          </label>
                          <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                            <input type="hidden" name={`lane.${lane.key}.applyInsteadAvailable`} value="off" />
                            <input
                              type="checkbox"
                              name={`lane.${lane.key}.applyInsteadAvailable`}
                              value="on"
                              defaultChecked={override.applyInsteadAvailable}
                            />
                            They can skip the wait and apply instead
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Save this event&rsquo;s rules
              </button>
            </form>
            )}
          </div>
        </section>
      )}

      {withPhases && !closed && (
        <PhaseDatesSection
          phases={withPhases.phases}
          cycleId={cycleId}
          cycleScope={cycleScope}
          cycleStartDate={withPhases.startDate}
          cycleEndDate={withPhases.endDate}
        />
      )}

      {canConfigure && (
        <section className="mt-6">
          <SectionHeading>Export as a Task Pack</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Save this event&rsquo;s full task set (or a hand-picked subset, from the board&rsquo;s own
            bulk selection) as a named, downloadable pack — see{" "}
            <Link href="/task-packs" className="text-[var(--accent-1)] hover:underline">
              Task Packs
            </Link>{" "}
            to manage what&rsquo;s saved, share one as a file, or import one into a new event.
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
              Export whole event
            </button>
          </form>
        </section>
      )}

      {isAdminNow && !closed && (
        <section className="mt-6 border-t border-[var(--border)] pt-6">
          <SectionHeading>Close this event</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Locks everything about this event — no exception. Reaching a closed event afterward is
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
              Close event
            </button>
          </form>
        </section>
      )}
    </>
  );
}

type CycleWithPhases = Awaited<ReturnType<typeof getCycle>>;
type PhaseRow = CycleWithPhases["phases"][number];

// See docs/development-plan.md's Phase 39 — a phase spine an existing
// Cycle's own dates resolve against. No rename/reorder here (phases,
// once added, keep whatever name/order they were given) — this is for
// editing an existing phase's dates plus (below) adding a new one.
function PhaseDatesSection({
  phases,
  cycleId,
  cycleScope,
  cycleStartDate,
  cycleEndDate,
}: {
  phases: PhaseRow[];
  cycleId: string;
  cycleScope: string;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
}) {
  return (
    <section className="mt-6">
      <SectionHeading>Phase dates</SectionHeading>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        A phase&rsquo;s dates are either set outright or placed against the event&rsquo;s own start and
        end, so moving the event moves them along with it. Each phase says where it sits in words;
        open its edit to change the dates.
      </p>
      {phases.length === 0 && <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">None yet.</p>}
      <div className="mt-3 flex flex-col gap-2">
        {phases.map((p) => (
          <PhaseRowCard
            key={p.id}
            p={p}
            cycleScope={cycleScope}
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
        ))}
      </div>

      <details className="mt-4 max-w-[500px] rounded-[var(--radius-md)] border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--text)]">Add a phase</summary>
        <form action={addPhaseAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="cycleId" value={cycleId} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name</span>
            <input type="text" name="name" required className={INPUT} />
          </label>
          <PhaseBoundaryFields
            prefix="start"
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <PhaseBoundaryFields
            prefix="end"
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Add
          </button>
        </form>
      </details>
    </section>
  );
}

/**
 * One phase as two lines of prose plus its edit disclosure.
 *
 * This used to render its whole authoring form inline, so a handful of
 * phases stacked two bordered fieldsets, a button and a select apiece —
 * the form was the thing you saw, and the phase was the thing you had to
 * look for. The recipe is now the summary: `describeBoundaryWindow` says
 * the same relationship the form was editing ("4 days before the event
 * starts") without anyone reading a signed number, and the controls only
 * mount when asked for. That is the `<details>`-for-edit rule the design
 * conventions already set for every other form on the app.
 */
function PhaseRowCard({
  p,
  cycleScope,
  cycleStartDate,
  cycleEndDate,
}: {
  p: PhaseRow;
  cycleScope: string;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
}) {
  const pinned = HIGHLIGHTABLE_MODULES.find((m) => m.key === p.highlightModuleKey);

  return (
    <div className={`max-w-[500px] ${CARD}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{p.name}</h3>
        {pinned && <Tag tone="accent">{pinned.label} pinned</Tag>}
      </div>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        {formatDateRange(p.startDate, p.endDate)}
        {" — "}
        {describeBoundaryWindow(startBoundaryOf(p), endBoundaryOf(p))}
      </p>
      {p.flags.orderInvalid && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--danger)]">This phase&rsquo;s end resolves before its own start.</p>
      )}

      <details className="mt-1">
        <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Edit</summary>
        <form action={updatePhaseBoundaryAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="phaseId" value={p.id} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <PhaseBoundaryFields
            prefix="start"
            p={p}
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <PhaseBoundaryFields
            prefix="end"
            p={p}
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Save dates
          </button>
        </form>
        <form action={updatePhaseHighlightAction} className="mt-3 flex items-end gap-2">
          <input type="hidden" name="phaseId" value={p.id} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Pin a module for everyone coming while this phase is current</span>
            <SelectField name="highlightModuleKey" defaultValue={p.highlightModuleKey ?? ""} className={INPUT}>
              <option value="">None</option>
              {HIGHLIGHTABLE_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </SelectField>
          </label>
          <button type="submit" className={BUTTON_SECONDARY}>
            Save
          </button>
        </form>
      </details>
    </div>
  );
}

// `p` is omitted entirely for the "Add a phase" form below (a brand-new
// phase has no existing row to default from) — mirrors how
// tasks/[id]/page.tsx's MilestoneDateFields handles its own optional
// `milestone` prop for the identical add-vs-edit dual use.
function PhaseBoundaryFields({
  prefix,
  p,
  cycleStartDate,
  cycleEndDate,
}: {
  prefix: "start" | "end";
  p?: PhaseRow;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
}) {
  const dateType = prefix === "start" ? p?.startDateType : p?.endDateType;
  const date = prefix === "start" ? p?.startDate : p?.endDate;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fieldNames: Record<DateFieldBase, string> = {
    mode: `${prefix}${cap("mode")}`,
    date: `${prefix}${cap("date")}`,
    parentType: `${prefix}${cap("parentType")}`,
    phaseId: `${prefix}${cap("phaseId")}`,
  };
  const relativeAllowed = Boolean(cycleStartDate || cycleEndDate);

  return (
    <DateModeField
      legend={prefix === "start" ? "Start" : "End"}
      fieldNames={fieldNames}
      mode={p ? (dateType === "relative" ? "relative" : "absolute") : undefined}
      date={date}
      relativeAllowed={relativeAllowed}
      defaultMode={relativeAllowed ? "relative" : "absolute"}
      relativeHint="Dates inside the event move proportionally; dates outside move by whole days from the nearest edge."
    />
  );
}
