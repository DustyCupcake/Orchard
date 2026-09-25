import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getCommunitySnapshot } from "@/lib/dashboard";
import ActionMenu from "@/components/ui/ActionMenu";
import PageHeader from "@/components/ui/PageHeader";
import { BUTTON_PRIMARY } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

// The Community group's hub (nav-config.ts's "Community" headerIsLink →
// /community) — the group's own destination row plus the same snapshot
// stats the Dashboard feed already computes, the board's role for
// Tasks. Pass 1 shell: real hub links + at-a-glance counts; the deeper
// community dashboard surface lands in the hub-bodied follow-up pass.
const HUB_LINKS = [
  { href: "/members", label: "Members" },
  { href: "/assemblies", label: "Assemblies" },
  { href: "/participation", label: "Events" },
  { href: "/settings", label: "Settings" },
] as const;

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="text-[22px] font-semibold leading-tight text-[var(--text)]">{value}</div>
      <div className="mt-1 text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
    </div>
  );
}

export default async function CommunityPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const [communityRow, snapshot] = await Promise.all([
    getCommunity(viewing),
    getCommunitySnapshot(viewing),
  ]);
  const recruitmentOn = isModuleEnabled(communityRow, "recruitment");

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Community"
        description="The people and the shared rhythms of this community — who's here, who's coming, and the circle that holds it together."
        actions={
          <>
            {recruitmentOn && (
              <Link href="/invites" className={BUTTON_PRIMARY}>
                Invite a member
              </Link>
            )}
            <ActionMenu>
              {HUB_LINKS.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
            </ActionMenu>
          </>
        }
      />

      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Active members"
          value={snapshot.activeMemberCount.general === null ? "—" : snapshot.activeMemberCount.general}
        />
        <Stat label="Branches" value={snapshot.branchSpread.length} />
        <Stat
          label="On-track branches"
          value={snapshot.branchHealth.filter((b) => b.status === "on_track").length}
        />
        <Stat label="Tiers" value={snapshot.tierCounts.length} />
      </div>

      {snapshot.tierCounts.length > 0 && (
        <div className="mt-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tiers</h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {snapshot.tierCounts.map((t) => (
              <li key={t.id} className="flex items-center justify-between border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
                <span className="text-[var(--text)]">{t.name}</span>
                <span className="text-[var(--text-muted)]">{t.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}