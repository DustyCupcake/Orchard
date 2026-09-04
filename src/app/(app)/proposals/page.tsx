import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { listProposals } from "@/lib/proposals";
import { listTasks } from "@/lib/tasks";
import { isAdmin, listTiers } from "@/lib/settings";
import { allowsMultipleGrants, listGrantsWithTaskInfo, type PermissionModuleKey } from "@/lib/permissions";
import { Banner } from "@/components/ui/kit";
import ProposalCard from "./ProposalCard";

export const dynamic = "force-dynamic";

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string; status?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, submitted, status } = await searchParams;

  const canGrantPermissions = await isAdmin(viewing);
  const [proposals, branches, members, tiers, communityTasksRaw, communityGrants] = await Promise.all([
    listProposals(viewing, { status }),
    db.select().from(branch).where(eq(branch.communityId, viewing.communityId)),
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
    listTiers(viewing),
    listTasks(viewing),
    canGrantPermissions ? listGrantsWithTaskInfo(viewing.communityId) : Promise.resolve([]),
  ]);
  const communityTasks = communityTasksRaw.map((t) => ({ id: t.id, title: t.title }));

  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  // A brand-new proposal task can't already hold anything itself, so
  // "granted elsewhere" here just means "granted at all" — every
  // single-cardinality module with an existing grantee gets the same
  // "checking this moves it here" warning the settings panel and the
  // task detail view both show (docs/development-plan.md's Phase 64).
  const elsewhereHolderByModule: Partial<Record<PermissionModuleKey, string>> = {};
  for (const g of communityGrants) {
    if (!allowsMultipleGrants(g.moduleKey)) {
      elsewhereHolderByModule[g.moduleKey] = g.title;
    }
  }

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Proposals</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        The review queue —{" "}
        <Link href="/propose" className="text-[var(--accent-1)] hover:underline">
          propose a task
        </Link>
        , and any member can complete and activate one onto the board (there&rsquo;s no
        coordinator role gating this yet).
      </p>

      {submitted && <div className="mt-4"><Banner tone="success">Proposal submitted — thank you!</Banner></div>}
      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      {proposals.length === 0 && <p className="mt-6 text-[13px] text-[var(--text-muted)]">Nothing here.</p>}

      <div className="mt-6">
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            branches={branches}
            tiers={tiers}
            communityTasks={communityTasks}
            submitterName={memberNameById.get(p.submittedBy) ?? "—"}
            suggestedMemberName={
              p.suggestedMemberId ? (memberNameById.get(p.suggestedMemberId) ?? "—") : null
            }
            canGrantPermissions={canGrantPermissions}
            elsewhereHolderByModule={elsewhereHolderByModule}
          />
        ))}
      </div>
    </main>
  );
}
