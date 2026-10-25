import Link from "next/link";
import { getViewerClock } from "@/lib/view-clock";
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
import { getBudgetCycleForCycle } from "@/lib/budget";
import {
  getCycleParticipationSummary,
  getMyParticipation,
  listOpenEventParticipationCards,
} from "@/lib/participation";
import { getCycleShiftRoster } from "@/lib/shifts";
import { listForms } from "@/lib/forms";
import { laneRuleOf, listLanes, listOpenLanes } from "@/lib/recruitment/admission-lanes";
import { describeLaneConsequence } from "@/lib/recruitment/lane-rules";
import { listWaitlisted } from "@/lib/recruitment/admission";
import {
  confirmShiftProposalAction,
  openCycleShiftSignupsAction,
} from "../../shifts/actions";
import { getCommunity, isAdmin, listCycleTypes } from "@/lib/settings";
import { listOutstandingQuestions } from "@/lib/profile-questions";
import { isModuleEnabled } from "@/lib/modules";
import { describeBoundaryWindow, formatDateRange, formatInstant, localInputFromInstant } from "@/lib/dates";
import { getEventTimeZone } from "@/lib/cycles";
import { listTaskPacks } from "@/lib/task-packs";
import { HIGHLIGHTABLE_MODULES } from "@/lib/nav";
import { ClonePreviewGrid, ClonePreviewList } from "@/components/ClonePreview";
import { cycle as cycleTable } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { db } from "@/db";
import { eq } from "drizzle-orm";
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
  updateEventLanesAction,
  admitWaitlistedAction,
} from "./actions";
import SelectField from "@/components/ui/SelectField";

type Member = typeof memberTable.$inferSelect;
type Cycle = Awaited<ReturnType<typeof listCycles>>[number];

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unknown: "Haven't said",
  coming: "Coming",
  maybe: "Maybe",
  not_coming: "Not coming",
};

// datetime-local wants "YYYY-MM-DDTHH:mm" with no offset. These windows
// are typed on the event's clock, so the field is filled in on that clock
// too — not the server's.
function toDatetimeLocal(date: Date, timeZone: string) {
  return localInputFromInstant(date.toISOString(), timeZone);
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

// "Who's actually planning to be there, and how much room is left" —
// see docs/spec.md's "Participation & capacity" under Cycle and
// docs/plans/development-plan.md's Phase 31. Core, not gated behind
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
// docs/plans/development-plan.md's Phase 44. This is that screen's minimal
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
  const [cycleTypes, packs, preview] = await Promise.all([
    listCycleTypes(viewing),
    listTaskPacks(viewing),
    hasPreviousCycle && (previewStart || previewEnd)
      ? previewClonePreviousCycle(viewing, previewStart || null, previewEnd || null)
      : Promise.resolve(null),
  ]);
  const packNameById = new Map(packs.map((p) => [p.id, p.name]));
  // "Correctly pre-selects that pack when starting a new Cycle of that
  // type" — see docs/plans/development-plan.md's Phase 55 Done-when. No
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
  const clock = await getViewerClock();
  const [summary, mine, canConfigure, communityRow] = await Promise.all([
    getCycleParticipationSummary(viewing, cycleId),
    getMyParticipation(viewing, cycleId),
    canInitiateCycle(viewing),
    getCommunity(viewing),
  ]);
  const shiftsOn = isModuleEnabled(communityRow, "shifts");
  // The cycle's shift roster (§5.6) — visible to any member of the
  // community, management actions only for the cycle's manager.
  const roster = shiftsOn ? await getCycleShiftRoster(viewing, cycleId) : null;
  // Only needed for the cycle-settings/phase-dates sections below —
  // skip the extra query entirely for anyone who can't see them.
  const withPhases = canConfigure ? await getCycle(viewing, cycleId) : null;
  // The clock these windows are typed on — see lib/dates/timezone.ts.
  const eventClock = await getEventTimeZone(viewing.communityId, cycleId);
  // Forms pickable as the cycle's own application form (blank = fall
  // back to the community's standing form) — only for the same
  // audience, same reason.
  const forms = canConfigure ? await listForms(viewing) : [];
  // docs/plans/admission-flow.md §2a — lanes are community-wide and an event never
  // overrides one; it chooses which are open for it. The lanes the community
  // has, the ones open here, and whether this event follows the community's
  // own set or has chosen its own. None of this is gated on `canConfigure`:
  // which lanes someone could arrive by is the admission design of their own
  // community, not an administrative secret, so only the *controls* are
  // restricted — the same split the settings screen uses.
  const allLanes = (await listLanes(communityRow.id)).map(laneRuleOf);
  const openLaneIds = new Set((await listOpenLanes(communityRow.id, cycleId)).map((l) => l.id));
  const [{ own: ownLaneSet }] = await db
    .select({ own: cycleTable.ownAdmissionLanes })
    .from(cycleTable)
    .where(eq(cycleTable.id, cycleId));
  // People approved for a place the event didn't have room for (§6), in the
  // order they started waiting. Only those who can configure the event see them.
  const waitlisted = canConfigure ? await listWaitlisted(cycleId) : [];
  // Admin-only, and only meaningful for a still-open cycle — see
  // closeCycle's own budget-owner warning (src/lib/cycles/lifecycle.ts).
  const budgetCycleRow =
    isAdminNow && !closed && isModuleEnabled(communityRow, "budget")
      ? await getBudgetCycleForCycle(viewing, cycleId)
      : null;
  const needsBudgetDoneWarning = Boolean(budgetCycleRow && !budgetCycleRow.settledAt);
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
            {clock.deadline(summary.returningWindowClosesAt)}.
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
                          {formatInstant(occurrence.startsAt, eventClock)} — {signupCount}/{capacity} signed up
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
            <fieldset className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <legend className="px-1 text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                For the kitchen (all optional)
              </legend>
              <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                If the kitchen is working out how many are eating each meal, these let it count you in for the right ones on
                the day you arrive and the day you leave. Skip them and it counts you for both days.
              </p>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Arrival time</span>
                <input type="time" name="arrivalTime" defaultValue={mine.arrivalTime?.slice(0, 5) ?? ""} className={`${INPUT} w-fit`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Or: the first meal you&rsquo;ll eat there</span>
                <SelectField name="firstMeal" defaultValue={mine.firstMeal ?? ""} className={INPUT}>
                  <option value="">Not sure</option>
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </SelectField>
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Departure time</span>
                <input type="time" name="departureTime" defaultValue={mine.departureTime?.slice(0, 5) ?? ""} className={`${INPUT} w-fit`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Or: the last meal you&rsquo;ll eat there</span>
                <SelectField name="lastMeal" defaultValue={mine.lastMeal ?? ""} className={INPUT}>
                  <option value="">Not sure</option>
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </SelectField>
              </label>
              <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                A first or last meal wins over a time if you give both.
              </p>
            </fieldset>
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
              <span className={LABEL}>Returning-priority window closes at, {eventClock} (optional)</span>
              <input
                type="datetime-local"
                name="returningWindowClosesAt"
                defaultValue={
                  summary.returningWindowClosesAt ? toDatetimeLocal(new Date(summary.returningWindowClosesAt), eventClock) : ""
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
              <span className={LABEL}>Joining window closes at, {eventClock} (optional — blank = until the event closes)</span>
              <input
                type="datetime-local"
                name="joiningWindowClosesAt"
                defaultValue={
                  withPhases?.joiningWindowClosesAt
                    ? toDatetimeLocal(new Date(withPhases.joiningWindowClosesAt), eventClock)
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

      {/* Which lanes this event opens (docs/plans/admission-flow.md §2a). Not part of
          the Admin-gated "Event settings" above, because it is not an
          administrative fact about the event: a member arriving by one of
          these lanes is being measured against it, so the lanes are stated to
          everyone and only the controls that change them are restricted. */}
      {!closed && (
        <section className="mt-6">
          <div className="flex max-w-[640px] flex-col gap-3">
            <div>
              <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">How people can join this event</h3>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                {ownLaneSet
                  ? "This event has chosen its own lanes. Everything else about a lane is the community's, and its application form is this event's."
                  : "This event opens the same lanes as the community does, and follows the community if it changes them."}
              </p>
            </div>
            {!canConfigure ? (
              <ul className="flex flex-col gap-2">
                {allLanes
                  .filter((l) => l.id && openLaneIds.has(l.id))
                  .map((lane) => (
                    <li key={lane.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                      <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{lane.name}</span>
                      <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">{describeLaneConsequence(lane)}</p>
                    </li>
                  ))}
                {openLaneIds.size === 0 && (
                  <li className="text-[length:var(--text-body)] text-[var(--text-muted)]">No lane is open for this event.</li>
                )}
              </ul>
            ) : (
              <form action={updateEventLanesAction} className="flex flex-col gap-3">
                <input type="hidden" name="cycleId" value={cycleId} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                  <input type="radio" name="laneMode" value="community" defaultChecked={!ownLaneSet} className="mt-1" />
                  <span>The same lanes as the community</span>
                </label>
                <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                  <input type="radio" name="laneMode" value="own" defaultChecked={ownLaneSet} className="mt-1" />
                  <span>Choose which lanes this event opens</span>
                </label>
                <ul className="flex flex-col gap-2 pl-6">
                  {allLanes.map((lane) => (
                    <li key={lane.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                      <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                        <input
                          type="checkbox"
                          name="laneId"
                          value={lane.id}
                          defaultChecked={Boolean(lane.id && openLaneIds.has(lane.id))}
                          className="mt-1"
                        />
                        <span>
                          <strong>{lane.name}</strong>
                          <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
                            {describeLaneConsequence(lane)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Each kind of invitation has to belong to exactly one of the lanes you open. A different process for
                  just this event is a different lane — add one under Settings → Recruitment, and open it only here.
                </p>
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Save this event&rsquo;s lanes
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {canConfigure && waitlisted.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Waiting for a place</h3>
          <p className="mt-1 max-w-[640px] text-[length:var(--text-body)] text-[var(--text-muted)]">
            These people have been approved, but the event is full, so they aren&rsquo;t members yet. They&rsquo;re admitted,
            oldest first, as soon as room appears — someone no longer coming, an invite revoked, the capacity raised. You can also
            admit one now, over the capacity.
          </p>
          <ul className="mt-3 flex max-w-[640px] flex-col gap-2">
            {waitlisted.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <span className="text-[length:var(--text-body)] text-[var(--text)]">
                  {w.name}
                  <span className="ml-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    waiting since {w.waitlistedAt ? clock.date(w.waitlistedAt) : "—"}
                  </span>
                </span>
                <form action={admitWaitlistedAction}>
                  <input type="hidden" name="arrivalId" value={w.id} />
                  <input type="hidden" name="cycleScope" value={cycleScope} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Admit now
                  </button>
                </form>
              </li>
            ))}
          </ul>
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
                &ldquo;{budgetCycleRow!.title}&rdquo; hasn&rsquo;t been settled yet — settling it closes its books and returns any surplus to the community&rsquo;s budget.
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

// See docs/plans/development-plan.md's Phase 39 — a phase spine an existing
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
