import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
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
  resolveShiftManager,
} from "@/lib/shifts";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
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
import { effectiveTimeZone, formatInstantRange } from "@/lib/dates";
import SelectField from "@/components/ui/SelectField";

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
    // Opens the "add a shift series" form in place of the page body — the
    // header's primary action, the same `?compose=` technique /schedule
    // uses. `fromTask` pre-fills it from a task (the task page's "Make
    // this a recurring shift").
    compose?: string;
    fromTask?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
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
    compose,
    fromTask,
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

  // Scope grouping (§5.6): cycle rosters vs the flat standing list, and
  // the per-cycle window state each group renders.
  const standingUpcoming = upcoming.filter((u) => u.series.cycleId === null);
  const cycleById = new Map(allCycles.map((c) => [c.id, c] as const));
  const upcomingCycleIds = [...new Set(upcoming.map((u) => u.series.cycleId).filter((c): c is string => c !== null))];
  const cycleUpcoming = new Map<string, typeof upcoming>();
  for (const u of upcoming) {
    if (!u.series.cycleId) continue;
    const list = cycleUpcoming.get(u.series.cycleId) ?? [];
    list.push(u);
    cycleUpcoming.set(u.series.cycleId, list);
  }
  const orderedCycleIds = upcomingCycleIds.sort((a, b) =>
    (cycleById.get(a)?.startedAt?.getTime() ?? 0) - (cycleById.get(b)?.startedAt?.getTime() ?? 0),
  );

  const openCycleById = new Map(openCycles.map((c) => [c.id, c] as const));
  const managersByScope = await listShiftManagersForScopes(
    communityRow.id,
    upcomingCycleIds,
  );
  const standingManager = await resolveShiftManager(communityRow.id, null);
  const managedScopeSet = new Set(managedScopes);
  const isStandingManager = managedScopeSet.has(null);

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

          {!composing && pendingProposals.length > 0 && (
            <section className="mt-6">
              <SectionHeading>Waiting for your confirmation</SectionHeading>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                Series added after an event&rsquo;s sign-ups opened — confirm the ones you want on its roster.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {pendingProposals.map(({ series, cycleName }) => (
                  <div key={series.id} className={CARD}>
                    <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{series.title}</p>
                    <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      Proposed for Event {cycleName}
                    </p>
                    <form action={confirmShiftProposalAction} className="mt-2">
                      <input type="hidden" name="seriesId" value={series.id} />
                      <input type="hidden" name="cycleScope" value={series.cycleId ?? ""} />
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
            <SectionHeading>Upcoming shifts</SectionHeading>
            {upcoming.length === 0 && (
              <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                No shifts scheduled yet.
                {canCreateSeries && " Add a series, then a shift manager can set its dates."}
              </p>
            )}

            {orderedCycleIds.map((cycleId) => {
              const cycleRow = cycleById.get(cycleId);
              const cycleRows = cycleUpcoming.get(cycleId) ?? [];
              const activeCycle = openCycleById.get(cycleId);
              const manager = managersByScope.get(cycleId);
              return (
                <div key={cycleId} className="mt-4">
                  <h3 className="text-[length:var(--text-heading)] font-semibold text-[var(--text)]">
                    {cycleRow ? `Event ${cycleRow.name} roster` : "Event roster"}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {activeCycle?.shiftSignupsOpenedAt ? (
                      <Tag tone="success">Sign-ups open</Tag>
                    ) : (
                      <Tag tone="neutral">Sign-ups not open yet</Tag>
                    )}
                    <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      {manager ? `Managed by ${manager.memberName}` : "No shift manager yet — sign-ups stay closed until one is chosen"}
                    </span>
                  </div>
                  {!activeCycle?.shiftSignupsOpenedAt && managedScopeSet.has(cycleId) && (
                    <form action={openCycleShiftSignupsAction} className="mt-2">
                      <input type="hidden" name="cycleId" value={cycleId} />
                      <input type="hidden" name="cycleScope" value={cycleId} />
                      <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                        Open sign-ups
                      </button>
                      <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                        Until then, anyone can add series to this roster. Once opened, sign-ups can&rsquo;t be closed again.
                      </p>
                    </form>
                  )}
                  {activeCycle?.shiftSignupsOpenedAt && !cycleRows[0]?.signupsOpen && (
                    <Tag tone="warning">not open yet</Tag>
                  )}
                  <div className="mt-3 flex flex-col gap-2">
                    {cycleRows.map(({ occurrence, series, signupsOpen }) => (
                      <OccurrenceCard
                        key={occurrence.id}
                        occurrence={occurrence}
                        series={series}
                        timeZone={shiftZone(series.cycleId)}
                        branchNameById={branchNameById}
                        capacity={effectiveCapacity(occurrence, series)}
                        count={countByOccurrenceId.get(occurrence.id) ?? 0}
                        iAmSignedUp={mySignedUpOccurrenceIds.has(occurrence.id)}
                        signupsOpen={signupsOpen}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {standingUpcoming.length > 0 && (
              <div className={`mt-4 ${standingUpcoming.length > 0 ? "" : ""}`}>
                <h3 className="text-[length:var(--text-heading)] font-semibold text-[var(--text)]">Standing series</h3>
                <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Community-wide and always open for sign-ups.
                  {standingManager
                    ? ` Managed by ${standingManager.name}.`
                    : " No manager yet — nobody can add standing series until one is chosen."}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {standingUpcoming.map(({ occurrence, series, signupsOpen }) => (
                    <OccurrenceCard
                      key={occurrence.id}
                      occurrence={occurrence}
                      series={series}
                      timeZone={shiftZone(series.cycleId)}
                      branchNameById={branchNameById}
                      capacity={effectiveCapacity(occurrence, series)}
                      count={countByOccurrenceId.get(occurrence.id) ?? 0}
                      iAmSignedUp={mySignedUpOccurrenceIds.has(occurrence.id)}
                      signupsOpen={signupsOpen}
                    />
                  ))}
                </div>
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
                    <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{formatInstantRange(occurrence.startsAt, occurrence.endsAt, shiftZone(series.cycleId))}</p>
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
              shiftZone={shiftZone}
            />
          )}
        </>
      )}
    </main>
  );
}

// One upcoming-occurrence row, shared by the cycle-roster and standing
// groups. `signupsOpen` is the D11 window state: a collecting roster is
// visible-but-closed (the sign-up button renders disabled), a confirmed
// proposal is never shown here at all (listUpcomingShiftOccurrences
// hides unconfirmed series).
function OccurrenceCard({
  occurrence,
  series,
  timeZone,
  branchNameById,
  capacity,
  count,
  iAmSignedUp,
  signupsOpen,
}: {
  occurrence: { id: string; startsAt: Date; endsAt: Date };
  series: { title: string; branchId: string | null; description: string | null };
  timeZone: string;
  branchNameById: Map<string, string>;
  capacity: number;
  count: number;
  iAmSignedUp: boolean;
  signupsOpen: boolean;
}) {
  const full = count >= capacity;
  return (
    <div className={CARD}>
      <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
        {series.title}
        {series.branchId && (
          <span className="font-normal text-[var(--text-muted)]"> · {branchNameById.get(series.branchId) ?? "—"}</span>
        )}
      </p>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{formatInstantRange(occurrence.startsAt, occurrence.endsAt, timeZone)}</p>
      {series.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{series.description}</p>}
      <p className="mt-1.5 flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
        {count}/{capacity} signed up
        {iAmSignedUp && <Tag tone="success">You&rsquo;re signed up</Tag>}
        {full && !iAmSignedUp && <Tag tone="warning">full</Tag>}
        {!signupsOpen && <Tag tone="neutral">not open yet</Tag>}
      </p>
      <div className="mt-2">
        {iAmSignedUp ? (
          <form action={withdrawFromShiftAction}>
            <input type="hidden" name="occurrenceId" value={occurrence.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Withdraw
            </button>
          </form>
        ) : (
          <form action={signUpForShiftAction}>
            <input type="hidden" name="occurrenceId" value={occurrence.id} />
            <button type="submit" disabled={full || !signupsOpen} className={BUTTON_PRIMARY}>
              {signupsOpen ? "Sign up" : "Not open yet"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}