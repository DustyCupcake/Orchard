import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";

export const dynamic = "force-dynamic";

// Core, not module-gated — every Community needs some version of a
// member directory to reach another member's visible contact methods
// or activate Emergency access (see docs/spec.md's "Member contact &
// privacy" and docs/development-plan.md's Phase 46). Plain name list;
// each member's own visible-to-you methods live on /members/[id].
export default async function MembersPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const members = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(eq(member.communityId, currentMember.communityId))
    .orderBy(member.name);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Members</h1>
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        Contact info shown per member follows their own visibility choice. Emergency-only methods
        stay hidden here — see each member&rsquo;s own page for Emergency access.
      </p>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {members.map((m) => (
          <li key={m.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee" }}>
            {m.id === currentMember.id ? (
              <Link href="/profile" style={{ color: "inherit" }}>
                {m.name} (you)
              </Link>
            ) : (
              <Link href={`/members/${m.id}`} style={{ color: "inherit" }}>
                {m.name}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
