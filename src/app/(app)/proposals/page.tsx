import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { listProposals } from "@/lib/proposals";
import ProposalCard from "./ProposalCard";

export const dynamic = "force-dynamic";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string; status?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error, submitted, status } = await searchParams;

  const [proposals, branches, members] = await Promise.all([
    listProposals(currentMember, { status }),
    db.select().from(branch).where(eq(branch.communityId, currentMember.communityId)),
    db.select().from(member).where(eq(member.communityId, currentMember.communityId)),
  ]);

  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Proposals</h1>
      <p style={{ color: "#666" }}>
        The review queue — anyone can{" "}
        <a href="/propose" style={{ color: "inherit" }}>
          propose a task
        </a>
        , and any member can complete and activate one onto the board (there&rsquo;s no
        coordinator role gating this yet).
      </p>

      {submitted && <p style={{ color: "#2a7a2a" }}>Proposal submitted — thank you!</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {proposals.length === 0 && <p style={{ color: "#666" }}>Nothing here.</p>}

      {proposals.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          branches={branches}
          submitterName={memberNameById.get(p.submittedBy) ?? "—"}
          suggestedMemberName={
            p.suggestedMemberId ? (memberNameById.get(p.suggestedMemberId) ?? "—") : null
          }
        />
      ))}
    </main>
  );
}
