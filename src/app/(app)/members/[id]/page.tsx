import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { emergencyAccessLog, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getVisibleContactMethods, listEmergencyOnlyContactMethods } from "@/lib/contact-methods";
import { getMostRecentActivation } from "@/lib/emergency-access";
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
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
        <p>
          <Link href="/members" style={{ color: "inherit" }}>
            ← Back to members
          </Link>
        </p>
        <p style={{ color: "crimson" }}>Member not found.</p>
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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <p>
        <Link href="/members" style={{ color: "inherit" }}>
          ← Back to members
        </Link>
      </p>
      <h1>{target.name}</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <section style={{ marginTop: "1rem" }}>
        <h2>Contact methods</h2>
        {visibleMethods.length === 0 && (
          <p style={{ color: "#666" }}>Nothing visible to you right now.</p>
        )}
        <ul>
          {visibleMethods.map((m) => (
            <li key={m.id}>
              {m.type}: {m.value}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Emergency access</h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Any member can activate this to reveal {target.name}&rsquo;s emergency-only contact info
          when it&rsquo;s genuinely needed. Both of you are notified, and every activation is
          logged — see your <Link href="/dashboard">Dashboard</Link> for recent activity.
        </p>

        {recentLog && (
          <div
            style={{
              border: "1px solid #2a7a2a",
              borderRadius: 6,
              padding: "0.6rem",
              marginBottom: "0.75rem",
            }}
          >
            <strong>Revealed just now:</strong>
            {revealedMethods.length === 0 ? (
              <p style={{ color: "#666" }}>{target.name} hasn&rsquo;t set any emergency-only method.</p>
            ) : (
              <ul>
                {revealedMethods.map((m) => (
                  <li key={m.id}>
                    {m.type}: {m.value}
                  </li>
                ))}
              </ul>
            )}
            <form action={addEmergencyAccessExplanationAction} style={{ marginTop: "0.5rem" }}>
              <input type="hidden" name="targetMemberId" value={target.id} />
              <input type="hidden" name="logId" value={recentLog.id} />
              <label style={{ display: "block", fontSize: "0.8rem" }}>
                Explanation (can be added or edited any time)
                <br />
                <input
                  type="text"
                  name="explanation"
                  defaultValue={recentLog.explanation ?? ""}
                  style={{ padding: "0.4rem", width: "100%" }}
                />
              </label>
              <button type="submit" style={{ marginTop: "0.4rem" }}>
                Save explanation
              </button>
            </form>
          </div>
        )}

        <form action={activateEmergencyAccessAction}>
          <input type="hidden" name="targetMemberId" value={target.id} />
          <label style={{ display: "block", fontSize: "0.85rem" }}>
            Why (optional — can be added after the fact instead)
            <br />
            <input type="text" name="explanation" style={{ padding: "0.4rem", width: "100%" }} />
          </label>
          <button type="submit" style={{ marginTop: "0.5rem" }}>
            Activate emergency access
          </button>
        </form>
      </section>
    </main>
  );
}
