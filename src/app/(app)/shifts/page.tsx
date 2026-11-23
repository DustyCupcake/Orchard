import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/login-destination";
import { db } from "@/db";
import { member, shiftSignup, task } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { listCycles, listOpenCycles } from "@/lib/cycles";
import {
  effectiveCapacity,
  isShiftCoordinator,
  listMySignupsWithOccurrence,
  listOccurrencesForSeries,
  listPendingShiftProposals,
  listShiftManagerScopesForMember,
  listShiftManagersForScopes,
  listShiftSeries,
  listUpcomingShiftOccurrences,
  orderScopes,
  resolveScope,
  resolveShiftManager,
  shiftOffsets,
  STANDING_SCOPE_KEY,
  type ShiftScope,
  type ShiftViewRow,
} from "@/lib/shifts";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  confirmShiftProposalAction,
  createShiftSeriesAction,
  markShiftSignupCompletedAction,
  openCycleShiftSignupsAction,
  signUpForShiftAction,
  withdrawFromShiftAction,
} from "./actions";
import MySeriesSection from "./MySeriesSection";
import { effectiveTimeZone, formatInstant, type DayView } from "@/lib/dates";
import { getDayLabeler } from "@/lib/day-labeler";
import SelectField from "@/components/ui/SelectField";
import ShiftViews from "./ShiftViews";
import StandingShifts from "./StandingShifts";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

// See docs/spec.md's "Shifts / rota" and docs/plans/development-plan.md's
// Phase 29: recurring, never-"done" work distinct from a Task's
// one-shot claim/finish lifecycle. §2.6/§4.8 (docs/cycle-scope-
// remediation-plan.md): series group by scope — a cycle's roster vs the
// community's standing series — and a cycle roster's sign-ups open only
// on its shift_management holder's one-way act (D11).
export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    seriesCreated?: string;
    signedUp?: string;
    withdrawn?: string;
    occurrencesGenerated?: string;
    archived?: string;
    unarchived?: string;
    markedCompleted?: string;
    markedNoShow?: string;
    shiftOpened?: string;
    proposalConfirmed?: string;
    seriesReplaced?: string;
    seriesUpdated?: string;
    seriesDeleted?: string;
    shiftUpdated?: string;
    shiftDeleted?: string;
    // Opens the "add a shift series" form in place of the page body — the
    // header's primary action, the same `?compose=` technique /schedule
    // uses. `fromTask` pre-fills it from a task (the task page's "Make
    // this a recurring shift").
    compose?: string;
    fromTask?: string;
    // Which tab: an event's id, or "standing" (see resolveScope).
    scope?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect(await loginUrl());
  }

  const {
    error,
    seriesCreated,
    signedUp,
    withdrawn,
    occurrencesGenerated,
    archived,
    unarchived,
    markedCompleted,
    markedNoShow,
    shiftOpened,
    proposalConfirmed,
    seriesReplaced,
    seriesUpdated,
    seriesDeleted,
    shiftUpdated,
    shiftDeleted,
    compose,
    fromTask,
    scope: requestedScope,
  } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "shifts");

  const [upcoming, mySignups, allSeries, branches, allCycles, openCycles, managedScopes, pendingProposals] =
    await Promise.all([
      moduleOn ? listUpcomingShiftOccurrences(viewing) : Promise.resolve([]),
      moduleOn ? listMySignupsWithOccurrence(viewing) : Promise.resolve([]),
      moduleOn ? listShiftSeries(viewing, { includeArchived: true }) : Promise.resolve([]),
      moduleOn ? listBranches(viewing) : Promise.resolve([]),
      moduleOn ? listCycles(viewing) : Promise.resolve([]),
      moduleOn ? listOpenCycles(viewing) : Promise.resolve([]),
      moduleOn ? listShiftManagerScopesForMember(viewing) : Promise.resolve([]),
      moduleOn ? listPendingShiftProposals(viewing) : Promise.resolve([]),
    ]);

  // A shift happens at the venue, so each one reads on its own event's
  // clock — its cycle's zone, else the community's — wherever the viewer is.
  const cycleZoneById = new Map(allCycles.map((c) => [c.id, effectiveTimeZone(c, communityRow)] as const));
  const shiftZone = (cycleId: string | null) =>
    (cycleId && cycleZoneById.get(cycleId)) || effectiveTimeZone(null, communityRow);

  // How a shift's date reads is the viewer's own setting, resolved through
  // the community default (docs/plans/day-labels-plan.md). Where a shift's day
  // falls in a short phase or event it reads as that and a weekday; anything
  // else (a standing series, a longer event, a day outside every phase) keeps
  // the full date. A list that already says which event it is leaves the
  // event's name out of each row (`view`); one that mixes events names it.
  const labeler = await getDayLabeler();
  const shiftWhen = (startsAt: Date, endsAt: Date, cycleId: string | null, view?: DayView) =>
    labeler.shiftRange(startsAt, endsAt, shiftZone(cycleId), { cycleId }, view);
  // For a row under its own event's heading, or on a card that names the event.
  const shiftWhenInEvent = (startsAt: Date, endsAt: Date, cycleId: string | null) =>
    shiftWhen(startsAt, endsAt, cycleId, { cycleId });

  const mySignedUpOccurrenceIds = new Set(mySignups.map((s) => s.signup.occurrenceId));
  const now = new Date();
  const myPastPendingSignups = mySignups.filter(
    (s) => s.signup.status === "signed_up" && new Date(s.occurrence.endsAt) <= now,
  );
  const branchNameById = new Map(branches.map((b) => [b.id, b.name] as const));

  const upcomingIds = upcoming.map((u) => u.occurrence.id);
  const upcomingSignups =
    upcomingIds.length > 0
      ? await db.select().from(shiftSignup).where(inArray(shiftSignup.occurrenceId, upcomingIds))
      : [];
  const countByOccurrenceId = new Map<string, number>();
  for (const s of upcomingSignups) {
    countByOccurrenceId.set(s.occurrenceId, (countByOccurrenceId.get(s.occurrenceId) ?? 0) + 1);
  }

  const myCoordinatedSeries = (
    await Promise.all(
      allSeries.map(async (s) => ((await isShiftCoordinator(viewing, s)) ? s : null)),
    )
  ).filter((s): s is (typeof allSeries)[number] => s !== null);

  const myCoordinatedSeriesWithOccurrences = await Promise.all(
    myCoordinatedSeries.map(async (s) => {
      const occurrences = await listOccurrencesForSeries(viewing, s.id);
      const occurrenceIds = occurrences.map((o) => o.id);
      const signups =
        occurrenceIds.length > 0
          ? await db.select().from(shiftSignup).where(inArray(shiftSignup.occurrenceId, occurrenceIds))
          : [];
      return { series: s, occurrences, signups };
    }),
  );

  const rosterMemberIds = [...new Set(myCoordinatedSeriesWithOccurrences.flatMap((s) => s.signups.map((sg) => sg.memberId)))];
  const memberNameById =
    rosterMemberIds.length > 0
      ? new Map(
          (await db.select().from(member).where(eq(member.communityId, viewing.communityId))).map(
            (m) => [m.id, m.name] as const,
          ),
        )
      : new Map<string, string>();

  const cycleById = new Map(allCycles.map((c) => [c.id, c] as const));
  const openCycleById = new Map(openCycles.map((c) => [c.id, c] as const));
  const managedScopeSet = new Set(managedScopes);
  const isStandingManager = managedScopeSet.has(null);

  // The tabs: an event's roster each, plus Standing (§5.6). An event has a
  // tab while it has an upcoming confirmed shift, its shift manager is the
  // viewer, or a proposal is waiting on one; Standing while it has series or
  // the viewer manages it. `upcoming` arrives in startsAt order, so the first
  // shift seen per scope is its next.
  const nextStartByScope = new Map<string, string>();
  for (const { occurrence, series } of upcoming) {
    const key = series.cycleId ?? STANDING_SCOPE_KEY;
    if (!nextStartByScope.has(key)) nextStartByScope.set(key, occurrence.startsAt.toISOString());
  }
  const eventScopeIds = new Set([...nextStartByScope.keys()].filter((k) => k !== STANDING_SCOPE_KEY));
  for (const c of openCycles) if (managedScopeSet.has(c.id)) eventScopeIds.add(c.id);
  for (const p of pendingProposals) if (p.cycleId) eventScopeIds.add(p.cycleId);
  const scopes: ShiftScope[] = [];
  for (const id of eventScopeIds) {
    const c = cycleById.get(id);
    if (c) scopes.push({ key: id, label: c.name, kind: "event", nextStartsAt: nextStartByScope.get(id) ?? null });
  }
  if (
    nextStartByScope.has(STANDING_SCOPE_KEY) ||
    isStandingManager ||
    allSeries.some((s) => s.cycleId === null && !s.archivedAt)
  ) {
    scopes.push({
      key: STANDING_SCOPE_KEY,
      label: "Standing",
      kind: "standing",
      nextStartsAt: nextStartByScope.get(STANDING_SCOPE_KEY) ?? null,
    });
  }
  const orderedScopes = orderScopes(scopes);
  const activeScope = resolveScope(requestedScope, scopes);
  const activeCycleId = activeScope?.kind === "event" ? activeScope.key : null;

  // Everything below is the active tab's, so every row reads on that scope's
  // one clock: its event's zone, else the community's.
  const scopeZone = shiftZone(activeCycleId);
  const scopeUpcoming = activeScope
    ? upcoming.filter((u) => (u.series.cycleId ?? STANDING_SCOPE_KEY) === activeScope.key)
    : [];

  // The shift views' rows: one per upcoming occurrence in this scope, with
  // everything the list, calendar and standing cards render or filter on —
  // see src/lib/shifts/views.ts. Each row's action forms carry the scope, so
  // a sign-up lands back on this tab.
  const rows: ShiftViewRow[] = scopeUpcoming.map(({ occurrence, series, signupsOpen }) => {
    const count = countByOccurrenceId.get(occurrence.id) ?? 0;
    const capacity = effectiveCapacity(occurrence, series);
    const iAmSignedUp = mySignedUpOccurrenceIds.has(occurrence.id);
    return {
      id: occurrence.id,
      seriesId: series.id,
      cycleId: series.cycleId,
      title: series.title,
      description: series.description,
      branchId: series.branchId,
      branchName: series.branchId ? branchNameById.get(series.branchId) ?? null : null,
      tags: series.tags,
      capacity,
      signups: count,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      when: activeCycleId
        ? shiftWhenInEvent(occurrence.startsAt, occurrence.endsAt, series.cycleId)
        : shiftWhen(occurrence.startsAt, occurrence.endsAt, series.cycleId),
      ...shiftOffsets(scopeZone, occurrence.startsAt, occurrence.endsAt),
      startTime: formatInstant(occurrence.startsAt, scopeZone, "time"),
      endTime: formatInstant(occurrence.endsAt, scopeZone, "time"),
      iAmSignedUp,
      signupsOpen,
      actions: (
        <ShiftActions
          occurrenceId={occurrence.id}
          iAmSignedUp={iAmSignedUp}
          full={count >= capacity}
          signupsOpen={signupsOpen}
          scope={activeScope?.key ?? ""}
        />
      ),
    };
  });

  // The day headings the list and calendar read — the DayLabeler's `heading`
  // for each day that has a shift.
  const dayLabelByDay: Record<string, string> = {};
  for (const r of rows) {
    if (!(r.day in dayLabelByDay)) dayLabelByDay[r.day] = labeler.heading(r.day, { cycleId: activeCycleId });
  }

  // An event's roster state (D11) and manager, shown once above its shifts;
  // Standing's manager line. The open act is the event's manager's, and only
  // while the roster is still collecting.
  const activeCycle = activeCycleId ? cycleById.get(activeCycleId) : undefined;
  const rosterOpened = !!activeCycle?.shiftSignupsOpenedAt;
  const canOpenSignups = !!activeCycleId && !rosterOpened && openCycleById.has(activeCycleId) && managedScopeSet.has(activeCycleId);
  const eventManagerName = activeCycleId
    ? ((await listShiftManagersForScopes(communityRow.id, [activeCycleId])).get(activeCycleId)?.memberName ?? null)
    : null;
  const standingManagerName =
    activeScope?.kind === "standing" ? ((await resolveShiftManager(communityRow.id, null))?.name ?? null) : null;
  const scopeProposals = activeCycleId ? pendingProposals.filter((p) => p.cycleId === activeCycleId) : [];

  // Where this manager may re-place one of their own series (D10: the
  // destination scope's manager's act — the selected scope gates it
  // server-side too, but only honest destinations are offered).
  const placementOptions: { cycleId: string | null; label: string }[] = [];
  if (isStandingManager) placementOptions.push({ cycleId: null, label: "Standing — community-wide" });
  for (const c of openCycles) {
    if (managedScopeSet.has(c.id)) placementOptions.push({ cycleId: c.id, label: `Event ${c.name}` });
  }

  // A series can be added where there's an open event to place it in, or to
  // the standing list by that scope's manager.
  const canCreateSeries = moduleOn && (openCycles.length > 0 || isStandingManager);
  const composing = compose === "1" && canCreateSeries;

  // The task a series is being started from, if any — its title,
  // description, branch and capacity become the form's starting values.
  // Looked up in the viewer's own community only; anything that isn't a
  // task of theirs is ignored rather than an error.
  const sourceTask =
    composing && fromTask && /^[0-9a-f-]{36}$/i.test(fromTask)
      ? ((await db.select().from(task).where(and(eq(task.id, fromTask), eq(task.communityId, viewing.communityId))))[0] ?? null)
      : null;

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title={composing ? "Add a shift series" : "Shifts"}
        description={
          composing
            ? "A series is a recurring job people sign up for — like kitchen cleanup or the door."
            : "Recurring jobs with set times, signed up for one shift at a time. Unlike a task, a series is never done."
        }
        actions={
          canCreateSeries && !composing ? (
            <Link href="/shifts?compose=1" className={BUTTON_PRIMARY}>
              Add a shift series
            </Link>
          ) : undefined
        }
        tabs={
          moduleOn && !composing && activeScope && orderedScopes.length > 1 ? (
            <Tabs tabs={orderedScopes} active={activeScope.key} hrefFor={(key) => `/shifts?scope=${encodeURIComponent(key)}`} />
          ) : undefined
        }
      />

      {!moduleOn && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          {seriesCreated && (
            <div className="mt-4">
              <Banner tone="success">Series added.</Banner>
            </div>
          )}
          {signedUp && (
            <div className="mt-4">
              <Banner tone="success">You&rsquo;re signed up.</Banner>
            </div>
          )}
          {withdrawn && (
            <div className="mt-4">
              <Banner tone="success">Withdrawn.</Banner>
            </div>
          )}
          {occurrencesGenerated && (
            <div className="mt-4">
              <Banner tone="success">Shifts added.</Banner>
            </div>
          )}
          {archived && (
            <div className="mt-4">
              <Banner tone="success">Series archived.</Banner>
            </div>
          )}
          {unarchived && (
            <div className="mt-4">
              <Banner tone="success">Series unarchived.</Banner>
            </div>
          )}
          {markedCompleted && (
            <div className="mt-4">
              <Banner tone="success">Marked completed.</Banner>
            </div>
          )}
          {markedNoShow && (
            <div className="mt-4">
              <Banner tone="success">Marked no-show.</Banner>
            </div>
          )}
          {shiftOpened && (
            <div className="mt-4">
              <Banner tone="success">Sign-ups opened for this event&rsquo;s roster — it can&rsquo;t be closed again.</Banner>
            </div>
          )}
          {proposalConfirmed && (
            <div className="mt-4">
              <Banner tone="success">Proposal confirmed — it&rsquo;s now on the roster.</Banner>
            </div>
          )}
          {seriesReplaced && (
            <div className="mt-4">
              <Banner tone="success">Series moved.</Banner>
            </div>
          )}
          {seriesUpdated && (
            <div className="mt-4">
              <Banner tone="success">Series saved.</Banner>
            </div>
          )}
          {seriesDeleted && (
            <div className="mt-4">
              <Banner tone="success">Series deleted.</Banner>
            </div>
          )}
          {shiftUpdated && (
            <div className="mt-4">
              <Banner tone="success">Shift saved.</Banner>
            </div>
          )}
          {shiftDeleted && (
            <div className="mt-4">
              <Banner tone="success">Shift deleted.</Banner>
            </div>
          )}

          {composing && (
            <section>
              <form action={createShiftSeriesAction} className="flex max-w-[500px] flex-col gap-3">
                {sourceTask && (
                  <>
                    <input type="hidden" name="sourceTaskId" value={sourceTask.id} />
                    <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
                      Starting from the task <span className="font-medium text-[var(--text)]">{sourceTask.title}</span> — its
                      details are filled in below. The task itself isn&rsquo;t changed.
                    </p>
                  </>
                )}
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Where does it belong?</span>
                  <SelectField
                    name="cycleId"
                    defaultValue={sourceTask && isStandingManager ? "" : (openCycles[0]?.id ?? "")}
                    className={INPUT}
                  >
                    {isStandingManager && <option value="">Standing — community-wide, always open</option>}
                    {openCycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        Event {c.name}
                        {c.shiftSignupsOpenedAt ? " (its manager confirms new additions)" : " (opens with the event's roster)"}
                      </option>
                    ))}
                  </SelectField>
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Anyone can add a series to an event whose sign-ups haven&rsquo;t opened yet. After that, additions are
                    proposals its shift manager confirms. Standing series are added by the standing shift manager.
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Title</span>
                  <input type="text" name="title" required defaultValue={sourceTask?.title ?? ""} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Description (optional)</span>
                  <textarea name="description" rows={3} defaultValue={sourceTask?.description ?? ""} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Branch (optional)</span>
                  <SelectField name="branchId" defaultValue={sourceTask?.branchId ?? ""} className={INPUT}>
                    <option value="">No branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </SelectField>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>How many people does each shift need?</span>
                  <input
                    type="number"
                    name="defaultCapacity"
                    min={1}
                    required
                    defaultValue={sourceTask?.capacity ?? 1}
                    className={`${INPUT} w-fit`}
                  />
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    The default for each shift; a single shift can differ.
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Tags (comma-separated)</span>
                  <input type="text" name="tags" placeholder="cooking, tidying, groceries" className={INPUT} />
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    The tags the series filters by on the shift views.
                  </span>
                </label>
                <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Once it&rsquo;s added, the scope&rsquo;s shift manager sets the dates and times people can sign up for.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Adding…">
                    Add series
                  </SubmitButton>
                  <Link href="/shifts" className={BUTTON_SECONDARY}>
                    Cancel
                  </Link>
                </div>
              </form>
            </section>
          )}

          {!composing && activeScope?.kind === "event" && activeCycleId && (
            <div className="mt-6 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {scopes.length === 1 && (
                  <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
                    Event {activeScope.label}
                  </span>
                )}
                {rosterOpened ? (
                  <Tag tone="success">Sign-ups open</Tag>
                ) : (
                  <Tag tone="neutral">Sign-ups not open yet</Tag>
                )}
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {eventManagerName
                    ? `Managed by ${eventManagerName}`
                    : "No shift manager yet — sign-ups stay closed until one is chosen"}
                </span>
              </div>
              {canOpenSignups && (
                <form action={openCycleShiftSignupsAction}>
                  <input type="hidden" name="cycleId" value={activeCycleId} />
                  <input type="hidden" name="scope" value={activeCycleId} />
                  <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                    Open sign-ups
                  </button>
                  <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Until then, anyone can add series to this roster. Once opened, sign-ups can&rsquo;t be closed again.
                  </p>
                </form>
              )}
            </div>
          )}

          {!composing && activeScope?.kind === "standing" && (
            <p className="mt-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              Community-wide and always open for sign-ups.
              {standingManagerName
                ? ` Managed by ${standingManagerName}.`
                : " No manager yet — nobody can add standing series until one is chosen."}
            </p>
          )}

          {!composing && scopeProposals.length > 0 && (
            <section className="mt-6">
              <SectionHeading>Waiting for your confirmation</SectionHeading>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                Series added after this event&rsquo;s sign-ups opened — confirm the ones you want on its roster.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {scopeProposals.map(({ series }) => (
                  <div key={series.id} className={CARD}>
                    <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{series.title}</p>
                    <form action={confirmShiftProposalAction} className="mt-2">
                      <input type="hidden" name="seriesId" value={series.id} />
                      <input type="hidden" name="scope" value={activeCycleId ?? ""} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Confirm for this roster
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!composing && (
            <section className="mt-6">
              <SectionHeading>{activeScope?.kind === "standing" ? "Standing shifts" : "Upcoming shifts"}</SectionHeading>
              {!activeScope && (
                <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                  No shifts scheduled yet.
                  {canCreateSeries && " Add a series, then a shift manager can set its dates."}
                </p>
              )}
              {activeScope?.kind === "standing" && (
                <div className="mt-2">
                  <StandingShifts key={activeScope.key} rows={rows} branches={branches} />
                </div>
              )}
              {activeScope?.kind === "event" && (
                <div className="mt-2">
                  <ShiftViews key={activeScope.key} rows={rows} dayLabelByDay={dayLabelByDay} branches={branches} />
                  {rows.length === 0 && canCreateSeries && (
                    <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      Add a series, then a shift manager can set its dates.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {!composing && myPastPendingSignups.length > 0 && (
            <section className="mt-8">
              <SectionHeading>My past shifts</SectionHeading>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                Self-reported — mark a shift completed once it&rsquo;s actually happened.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {myPastPendingSignups.map(({ signup, occurrence, series }) => (
                  <div key={signup.id} className={CARD}>
                    <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{series.title}</p>
                    <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{shiftWhen(occurrence.startsAt, occurrence.endsAt, series.cycleId)}</p>
                    <form action={markShiftSignupCompletedAction} className="mt-2">
                      <input type="hidden" name="signupId" value={signup.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Mark completed
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!composing && myCoordinatedSeriesWithOccurrences.length > 0 && (
            <MySeriesSection
              series={myCoordinatedSeriesWithOccurrences}
              memberNameById={memberNameById}
              cycleNameById={cycleById}
              placementOptions={placementOptions}
              branches={branches}
              shiftZone={shiftZone}
              shiftWhen={shiftWhenInEvent}
              rosterOpen={(cycleId) => !cycleId || cycleById.get(cycleId)?.shiftSignupsOpenedAt != null}
              rosterClosed={(cycleId) => !!cycleId && cycleById.get(cycleId)?.closedAt != null}
            />
          )}
        </>
      )}
    </main>
  );
}

// The action cluster of a row — Sign up / Withdraw — the same cluster the
// old roster cards carried. `full` is the row's capacity reached without the
// viewer signed up; `signupsOpen` is the D11 window state: a collecting
// roster is visible-but-closed (the button renders disabled).
function ShiftActions({
  occurrenceId,
  iAmSignedUp,
  full,
  signupsOpen,
  scope,
}: {
  occurrenceId: string;
  iAmSignedUp: boolean;
  full: boolean;
  signupsOpen: boolean;
  /** The tab the viewer is on, so the action lands back on it. */
  scope: string;
}) {
  if (iAmSignedUp) {
    return (
      <form action={withdrawFromShiftAction}>
        <input type="hidden" name="occurrenceId" value={occurrenceId} />
        <input type="hidden" name="scope" value={scope} />
        <button type="submit" className={BUTTON_SECONDARY}>
          Withdraw
        </button>
      </form>
    );
  }
  return (
    <form action={signUpForShiftAction}>
      <input type="hidden" name="occurrenceId" value={occurrenceId} />
      <input type="hidden" name="scope" value={scope} />
      <button type="submit" disabled={full || !signupsOpen} className={BUTTON_PRIMARY}>
        {signupsOpen ? "Sign up" : "Not open yet"}
      </button>
    </form>
  );
}