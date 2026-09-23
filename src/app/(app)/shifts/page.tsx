import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member, shiftSignup } from "@/db/schema";
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
import {
  confirmShiftProposalAction,
  createShiftSeriesAction,
  markShiftSignupCompletedAction,
  openCycleShiftSignupsAction,
  signUpForShiftAction,
  withdrawFromShiftAction,
} from "./actions";
import MySeriesSection from "./MySeriesSection";

export const dynamic = "force-dynamic";

function formatRange(startsAt: Date | string, endsAt: Date | string) {
  return `${new Date(startsAt).toLocaleString()} – ${new Date(endsAt).toLocaleTimeString()}`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// See docs/spec.md's "Shifts / rota" and docs/development-plan.md's
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
    if (managedScopeSet.has(c.id)) placementOptions.push({ cycleId: c.id, label: `Cycle ${c.name}` });
  }

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Shifts</h1>

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
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
              <Banner tone="success">Series created.</Banner>
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
              <Banner tone="success">Occurrences generated.</Banner>
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
              <Banner tone="success">Sign-ups opened for this cycle&rsquo;s roster — it can&rsquo;t be closed again.</Banner>
            </div>
          )}
          {proposalConfirmed && (
            <div className="mt-4">
              <Banner tone="success">Proposal confirmed — it&rsquo;s now on the roster.</Banner>
            </div>
          )}
          {seriesReplaced && (
            <div className="mt-4">
              <Banner tone="success">Series re-placed.</Banner>
            </div>
          )}

          <section className="mt-6">
            <SectionHeading>Upcoming shifts</SectionHeading>
            {upcoming.length === 0 && (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">None scheduled.</p>
            )}

            {orderedCycleIds.map((cycleId) => {
              const cycleRow = cycleById.get(cycleId);
              const cycleRows = cycleUpcoming.get(cycleId) ?? [];
              const activeCycle = openCycleById.get(cycleId);
              const manager = managersByScope.get(cycleId);
              return (
                <div key={cycleId} className="mt-4">
                  <h3 className="text-[15px] font-semibold text-[var(--text)]">
                    {cycleRow ? `Cycle ${cycleRow.name} roster` : "Cycle roster"}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {activeCycle?.shiftSignupsOpenedAt ? (
                      <Tag tone="success">Sign-ups open</Tag>
                    ) : (
                      <Tag tone="neutral">Collecting — sign-ups closed</Tag>
                    )}
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {manager ? `managed by ${manager.memberName}` : "no shift manager selected — this roster stays closed"}
                    </span>
                  </div>
                  {!activeCycle?.shiftSignupsOpenedAt && managedScopeSet.has(cycleId) && (
                    <form action={openCycleShiftSignupsAction} className="mt-2">
                      <input type="hidden" name="cycleId" value={cycleId} />
                      <input type="hidden" name="cycleScope" value={cycleId} />
                      <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                        Open sign-ups for this roster (one-way)
                      </button>
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
                <h3 className="text-[15px] font-semibold text-[var(--text)]">Standing series</h3>
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                  Community-wide, always open.
                  {standingManager
                    ? ` Standing-series management is held by ${standingManager.name}.`
                    : " No standing-series manager is selected — its management stays closed."}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {standingUpcoming.map(({ occurrence, series, signupsOpen }) => (
                    <OccurrenceCard
                      key={occurrence.id}
                      occurrence={occurrence}
                      series={series}
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

          {myPastPendingSignups.length > 0 && (
            <section className="mt-8">
              <SectionHeading>My past shifts</SectionHeading>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Self-reported — mark a shift completed once it&rsquo;s actually happened.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {myPastPendingSignups.map(({ signup, occurrence, series }) => (
                  <div key={signup.id} className={CARD}>
                    <p className="text-[14px] font-medium text-[var(--text)]">{series.title}</p>
                    <p className="mt-1 text-[13px] text-[var(--text-muted)]">{formatRange(occurrence.startsAt, occurrence.endsAt)}</p>
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

          <section className="mt-8">
            <SectionHeading>Create a shift series</SectionHeading>
            {(openCycles.length > 0 || isStandingManager) ? (
              <form action={createShiftSeriesAction} className="mt-3 flex max-w-[500px] flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Where does this series belong? (optional — defaults to a cycle below)</span>
                  <select name="cycleId" defaultValue={openCycles[0]?.id ?? ""} className={INPUT}>
                    {isStandingManager && <option value="">Standing — community-wide</option>}
                    {openCycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        Cycle {c.name}
                        {c.shiftSignupsOpenedAt ? " (slot may need the manager's confirmation)" : " (opens with the roster)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Title</span>
                  <input type="text" name="title" required className={INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Description</span>
                  <textarea name="description" rows={2} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Branch (optional)</span>
                  <select name="branchId" defaultValue="" className={INPUT}>
                    <option value="">No branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Default capacity per occurrence</span>
                  <input type="number" name="defaultCapacity" min={1} required className={`${INPUT} w-fit`} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Rotated from an existing task? (optional)</span>
                  <input type="text" name="sourceTaskId" placeholder="paste the task's ID from its /tasks/… URL" className={INPUT} />
                  <span className="text-[12px] text-[var(--text-muted)]">
                    Placement into a still-collecting cycle is open to any member; once a roster&rsquo;s
                    sign-ups are open, new placements land as proposals for its shift manager to
                    confirm. Standing series can only be added by the standing scope&rsquo;s shift manager.
                  </span>
                </label>
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Create series
                </button>
              </form>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                There&rsquo;s nothing to add a series to — no open cycles to place into, and standing
                series can only be added by the standing scope&rsquo;s shift manager.
              </p>
            )}
          </section>

          {pendingProposals.length > 0 && (
            <section className="mt-8">
              <SectionHeading>Pending proposals</SectionHeading>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Series placed after their cycle&rsquo;s roster opened — confirm the ones you want on it.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {pendingProposals.map(({ series, cycleName }) => (
                  <div key={series.id} className={CARD}>
                    <p className="text-[14px] font-medium text-[var(--text)]">{series.title}</p>
                    <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                      Proposal for Cycle {cycleName}
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

          {myCoordinatedSeriesWithOccurrences.length > 0 && (
            <MySeriesSection
              series={myCoordinatedSeriesWithOccurrences}
              memberNameById={memberNameById}
              cycleNameById={cycleById}
              placementOptions={placementOptions}
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
  branchNameById,
  capacity,
  count,
  iAmSignedUp,
  signupsOpen,
}: {
  occurrence: { id: string; startsAt: Date; endsAt: Date };
  series: { title: string; branchId: string | null; description: string | null };
  branchNameById: Map<string, string>;
  capacity: number;
  count: number;
  iAmSignedUp: boolean;
  signupsOpen: boolean;
}) {
  const full = count >= capacity;
  return (
    <div className={CARD}>
      <p className="text-[14px] font-medium text-[var(--text)]">
        {series.title}
        {series.branchId && (
          <span className="font-normal text-[var(--text-muted)]"> · {branchNameById.get(series.branchId) ?? "—"}</span>
        )}
      </p>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">{formatRange(occurrence.startsAt, occurrence.endsAt)}</p>
      {series.description && <p className="mt-1 text-[13px] text-[var(--text)]">{series.description}</p>}
      <p className="mt-1.5 flex items-center gap-2 text-[13px] text-[var(--text)]">
        {count}/{capacity} signed up
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