import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { listPolls } from "@/lib/scheduling-polls";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

// "When can enough of the right people actually meet" — see
// docs/spec.md's "Scheduling polls".
export default async function SchedulingPollsPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const [polls, branches] = await Promise.all([
    listPolls(currentMember),
    db.select().from(branch).where(eq(branch.communityId, currentMember.communityId)),
  ]);
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <h1>Scheduling polls</h1>
      <p style={{ color: "#666" }}>
        Blind availability — you only ever see the aggregate, never who submitted what, until a
        slot is confirmed.
      </p>
      <p>
        <Link href="/scheduling-polls/new" style={{ color: "inherit" }}>
          Open a poll →
        </Link>
      </p>

      {polls.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
      {polls.map((p) => (
        <div
          key={p.id}
          style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
        >
          <Link href={`/scheduling-polls/${p.id}`} style={{ color: "inherit", fontWeight: "bold" }}>
            {p.title}
          </Link>{" "}
          <span style={{ fontSize: "0.8rem", color: "#666" }}>
            · {branchNameById.get(p.branchId) ?? "—"} ·{" "}
            {p.confirmedSlotStart
              ? `confirmed for ${new Date(p.confirmedSlotStart).toLocaleString()}`
              : "not yet resolved"}
          </span>
        </div>
      ))}
    </main>
  );
}
