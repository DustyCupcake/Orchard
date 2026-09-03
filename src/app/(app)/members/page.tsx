import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext, isSupportHolder } from "@/lib/view-as";
import { activateViewAsAction } from "./actions";

export const dynamic = "force-dynamic";

// Core, not module-gated — every Community needs some version of a
// member directory to reach another member's visible contact methods
// or activate Emergency access (see docs/spec.md's "Member contact &
// privacy" and docs/development-plan.md's Phase 46). Plain name list;
// each member's own visible-to-you methods live on /members/[id].
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing, viewAs } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }
  const { error } = await searchParams;

  // "View as" triggers reflect the *real* member's own Support-holder
  // status, and only show at all when nothing's currently being viewed
  // as — starting a second View-as session mid-session isn't a case
  // this phase supports (see src/lib/view-as.ts).
  const canActivateViewAs = !viewAs && (await isSupportHolder(real));

  const members = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(eq(member.communityId, viewing.communityId))
    .orderBy(member.name);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Members</h1>
      {error && (
        <p style={{ color: "#b91c1c", fontSize: "0.85rem" }}>{error}</p>
      )}
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        Contact info shown per member follows their own visibility choice. Emergency-only methods
        stay hidden here — see each member&rsquo;s own page for Emergency access.
      </p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {members.map((m) => (
          <li
            key={m.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              padding: "0.4rem 0",
              borderBottom: "1px solid #eee",
            }}
          >
            {m.id === viewing.id ? (
              <Link href="/profile" style={{ color: "inherit" }}>
                {m.name} (you)
              </Link>
            ) : (
              <Link href={`/members/${m.id}`} style={{ color: "inherit" }}>
                {m.name}
              </Link>
            )}
            {canActivateViewAs && m.id !== real.id && (
              <form action={activateViewAsAction}>
                <input type="hidden" name="targetMemberId" value={m.id} />
                <button
                  type="submit"
                  style={{
                    fontSize: "0.75rem",
                    color: "#5b21b6",
                    background: "none",
                    border: "1px solid #ddd6fe",
                    borderRadius: 4,
                    padding: "0.15rem 0.5rem",
                    cursor: "pointer",
                  }}
                >
                  View as
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
