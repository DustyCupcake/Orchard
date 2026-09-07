import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member, shiftSignup } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  effectiveCapacity,
  isShiftCoordinator,
  listMySignupsWithOccurrence,
  listOccurrencesForSeries,
  listShiftSeries,
  listUpcomingShiftOccurrences,
} from "@/lib/shifts";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import {
  createShiftSeriesAction,
  markShiftSignupCompletedAction,
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
// one-shot claim/finish lifecycle.
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
  } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "shifts");

  const [upcoming, mySignups, allSeries, branches] = await Promise.all([
    moduleOn ? listUpcomingShiftOccurrences(viewing) : Promise.resolve([]),
    moduleOn ? listMySignupsWithOccurrence(viewing) : Promise.resolve([]),
    moduleOn ? listShiftSeries(viewing, { includeArchived: true }) : Promise.resolve([]),
    moduleOn ? listBranches(viewing) : Promise.resolve([]),
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

          <section className="mt-6">
            <SectionHeading>Upcoming shifts</SectionHeading>
            {upcoming.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None scheduled.</p>}
            <div className="mt-3 flex flex-col gap-2">
              {upcoming.map(({ occurrence, series }) => {
                const capacity = effectiveCapacity(occurrence, series);
                const count = countByOccurrenceId.get(occurrence.id) ?? 0;
                const full = count >= capacity;
                const iAmSignedUp = mySignedUpOccurrenceIds.has(occurrence.id);
                return (
                  <div key={occurrence.id} className={CARD}>
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
                          <button type="submit" disabled={full} className={BUTTON_PRIMARY}>
                            Sign up
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
            <form action={createShiftSeriesAction} className="mt-3 flex max-w-[500px] flex-col gap-2">
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
                  If set, whoever currently holds that task can also manage this series, alongside
                  you as its creator.
                </span>
              </label>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Create series
              </button>
            </form>
          </section>

          {myCoordinatedSeriesWithOccurrences.length > 0 && (
            <MySeriesSection series={myCoordinatedSeriesWithOccurrences} memberNameById={memberNameById} />
          )}
        </>
      )}
    </main>
  );
}
