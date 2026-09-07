import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { emergencyAccessLog, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getVisibleContactMethods, listEmergencyOnlyContactMethods } from "@/lib/contact-methods";
import { getMostRecentActivation } from "@/lib/emergency-access";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { activateEmergencyAccessAction, addEmergencyAccessExplanationAction } from "./actions";

type EmergencyAccessLogRow = typeof emergencyAccessLog.$inferSelect;

export const dynamic = "force-dynamic";

// A fresh activation stays "live" on this page for a few minutes so a
// slow page load or a follow-up explanation edit doesn't need a second
// real activation — after that it's gone, same as the rest of this
// flow: it's a real logged act each time, not a standing unlock.
const ACTIVATION_WINDOW_MS = 5 * 60 * 1000;

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ activated?: string; error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  if (id === viewing.id) {
    redirect("/profile");
  }
  const { activated, error } = await searchParams;

  const [target] = await db
    .select({ id: member.id, name: member.name, communityId: member.communityId })
    .from(member)
    .where(eq(member.id, id));

  if (!target || target.communityId !== viewing.communityId) {
    return (
      <main className="mx-auto max-w-[480px] px-6 py-10 md:px-12 md:py-14">
        <Link href="/members" className="text-[13px] font-medium text-[var(--accent-1)] hover:underline">
          ← Back to members
        </Link>
        <div className="mt-4">
          <Banner tone="danger">Member not found.</Banner>
        </div>
      </main>
    );
  }

  const visibleMethods = await getVisibleContactMethods(viewing, target.id);

  // Reveal emergency-only methods only right after a real, fresh
  // activation this member just performed — proven by a recent
  // EmergencyAccessLog row, never by anything carried in the URL
  // itself (the redirect after activating only ever passes a plain
  // `activated=1` marker, not the contact values).
  let revealedMethods: Awaited<ReturnType<typeof listEmergencyOnlyContactMethods>> = [];
  let recentLog: EmergencyAccessLogRow | null = null;
  if (activated === "1") {
    const mostRecent = await getMostRecentActivation(viewing, target.id);
    if (mostRecent && Date.now() - mostRecent.activatedAt.getTime() < ACTIVATION_WINDOW_MS) {
      recentLog = mostRecent;
      revealedMethods = await listEmergencyOnlyContactMethods(target.id);
    }
  }

  return (
    <main className="mx-auto max-w-[480px] px-6 py-10 md:px-12 md:py-14">
      <Link href="/members" className="text-[13px] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to members
      </Link>
      <h1 className="mt-2 text-[32px] font-semibold leading-tight text-[var(--text)]">{target.name}</h1>
      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Contact methods</h2>
        {visibleMethods.length === 0 && (
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing visible to you right now.</p>
        )}
        <ul className="mt-2 flex flex-col gap-1">
          {visibleMethods.map((m) => (
            <li key={m.id} className="text-[13px] text-[var(--text)]">
              {m.type}: {m.value}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Emergency access</h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Any member can activate this to reveal {target.name}&rsquo;s emergency-only contact info
          when it&rsquo;s genuinely needed. Both of you are notified, and every activation is
          logged — see your <Link href="/dashboard" className="text-[var(--accent-1)] hover:underline">Dashboard</Link> for recent activity.
        </p>

        {recentLog && (
          <div className="mt-3">
            <Banner tone="success">
              <p className="font-medium">Revealed just now:</p>
              {revealedMethods.length === 0 ? (
                <p className="mt-1 opacity-80">{target.name} hasn&rsquo;t set any emergency-only method.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {revealedMethods.map((m) => (
                    <li key={m.id}>
                      {m.type}: {m.value}
                    </li>
                  ))}
                </ul>
              )}
              <form action={addEmergencyAccessExplanationAction} className="mt-2">
                <input type="hidden" name="targetMemberId" value={target.id} />
                <input type="hidden" name="logId" value={recentLog.id} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Explanation (can be added or edited any time)</span>
                  <input type="text" name="explanation" defaultValue={recentLog.explanation ?? ""} className={INPUT} />
                </label>
                <button type="submit" className={`${BUTTON_PRIMARY} mt-2 w-fit`}>
                  Save explanation
                </button>
              </form>
            </Banner>
          </div>
        )}

        <form action={activateEmergencyAccessAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="targetMemberId" value={target.id} />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Why (optional — can be added after the fact instead)</span>
            <input type="text" name="explanation" className={INPUT} />
          </label>
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Activate emergency access
          </button>
        </form>
      </section>
    </main>
  );
}
