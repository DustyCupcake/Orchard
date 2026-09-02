import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member, shiftSignup } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
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
  const currentMember = await getCurrentMember();
  if (!currentMember) {
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

  const communityRow = await getCommunity(currentMember);
  const moduleOn = isModuleEnabled(communityRow, "shifts");

  const [upcoming, mySignups, allSeries, branches] = await Promise.all([
    moduleOn ? listUpcomingShiftOccurrences(currentMember) : Promise.resolve([]),
    moduleOn ? listMySignupsWithOccurrence(currentMember) : Promise.resolve([]),
    moduleOn ? listShiftSeries(currentMember, { includeArchived: true }) : Promise.resolve([]),
    moduleOn ? listBranches(currentMember) : Promise.resolve([]),
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
      allSeries.map(async (s) => ((await isShiftCoordinator(currentMember, s)) ? s : null)),
    )
  ).filter((s): s is (typeof allSeries)[number] => s !== null);

  const myCoordinatedSeriesWithOccurrences = await Promise.all(
    myCoordinatedSeries.map(async (s) => {
      const occurrences = await listOccurrencesForSeries(currentMember, s.id);
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
          (await db.select().from(member).where(eq(member.communityId, currentMember.communityId))).map(
            (m) => [m.id, m.name] as const,
          ),
        )
      : new Map<string, string>();

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 760 }}>
      <h1>Shifts</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {seriesCreated && <p style={{ color: "#2a7a2a" }}>Series created.</p>}
          {signedUp && <p style={{ color: "#2a7a2a" }}>You&rsquo;re signed up.</p>}
          {withdrawn && <p style={{ color: "#2a7a2a" }}>Withdrawn.</p>}
          {occurrencesGenerated && <p style={{ color: "#2a7a2a" }}>Occurrences generated.</p>}
          {archived && <p style={{ color: "#2a7a2a" }}>Series archived.</p>}
          {unarchived && <p style={{ color: "#2a7a2a" }}>Series unarchived.</p>}
          {markedCompleted && <p style={{ color: "#2a7a2a" }}>Marked completed.</p>}
          {markedNoShow && <p style={{ color: "#2a7a2a" }}>Marked no-show.</p>}

          <section style={{ marginTop: "1rem" }}>
            <h2>Upcoming shifts</h2>
            {upcoming.length === 0 && <p style={{ color: "#666" }}>None scheduled.</p>}
            {upcoming.map(({ occurrence, series }) => {
              const capacity = effectiveCapacity(occurrence, series);
              const count = countByOccurrenceId.get(occurrence.id) ?? 0;
              const full = count >= capacity;
              const iAmSignedUp = mySignedUpOccurrenceIds.has(occurrence.id);
              return (
                <div
                  key={occurrence.id}
                  style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                >
                  <strong>{series.title}</strong>
                  {series.branchId && <> · {branchNameById.get(series.branchId) ?? "—"}</>}
                  <p style={{ margin: "0.2rem 0", fontSize: "0.85rem", color: "#666" }}>
                    {formatRange(occurrence.startsAt, occurrence.endsAt)}
                  </p>
                  {series.description && <p style={{ margin: "0.2rem 0" }}>{series.description}</p>}
                  <p style={{ margin: "0.2rem 0", fontSize: "0.85rem" }}>
                    {count}/{capacity} signed up{full && !iAmSignedUp && " · full"}
                  </p>
                  {iAmSignedUp ? (
                    <form action={withdrawFromShiftAction}>
                      <input type="hidden" name="occurrenceId" value={occurrence.id} />
                      <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                        Withdraw
                      </button>
                    </form>
                  ) : (
                    <form action={signUpForShiftAction}>
                      <input type="hidden" name="occurrenceId" value={occurrence.id} />
                      <button type="submit" disabled={full} style={{ padding: "0.3rem 0.6rem" }}>
                        Sign up
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </section>

          {myPastPendingSignups.length > 0 && (
            <section style={{ marginTop: "2rem" }}>
              <h2>My past shifts</h2>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                Self-reported — mark a shift completed once it&rsquo;s actually happened.
              </p>
              {myPastPendingSignups.map(({ signup, occurrence, series }) => (
                <div
                  key={signup.id}
                  style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                >
                  <strong>{series.title}</strong>
                  <p style={{ margin: "0.2rem 0", fontSize: "0.85rem", color: "#666" }}>
                    {formatRange(occurrence.startsAt, occurrence.endsAt)}
                  </p>
                  <form action={markShiftSignupCompletedAction}>
                    <input type="hidden" name="signupId" value={signup.id} />
                    <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                      Mark completed
                    </button>
                  </form>
                </div>
              ))}
            </section>
          )}

          <section style={{ marginTop: "2rem" }}>
            <h2>Create a shift series</h2>
            <form
              action={createShiftSeriesAction}
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 500 }}
            >
              <label>
                Title
                <br />
                <input type="text" name="title" required style={{ padding: "0.4rem", width: "100%" }} />
              </label>
              <label>
                Description
                <br />
                <textarea name="description" rows={2} style={{ padding: "0.4rem", width: "100%" }} />
              </label>
              <label>
                Branch (optional)
                <br />
                <select name="branchId" defaultValue="" style={{ padding: "0.4rem", width: "100%" }}>
                  <option value="">No branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Default capacity per occurrence
                <br />
                <input
                  type="number"
                  name="defaultCapacity"
                  min={1}
                  required
                  style={{ padding: "0.4rem" }}
                />
              </label>
              <label>
                Rotated from an existing task? (optional)
                <br />
                <input
                  type="text"
                  name="sourceTaskId"
                  placeholder="paste the task's ID from its /tasks/… URL"
                  style={{ padding: "0.4rem", width: "100%" }}
                />
                <br />
                <span style={{ fontSize: "0.8rem", color: "#666" }}>
                  If set, whoever currently holds that task can also manage this series, alongside
                  you as its creator.
                </span>
              </label>
              <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
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
