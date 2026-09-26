import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getCommunitySnapshot } from "@/lib/dashboard";
import ActionMenu from "@/components/ui/ActionMenu";
import PageHeader from "@/components/ui/PageHeader";
import { Banner, BUTTON_PRIMARY } from "@/components/ui/kit";
import { EventParticipationCards } from "@/components/EventParticipation";
import CommunityIndicators from "@/components/CommunityIndicators";
import CommunityAssembliesSection from "./CommunityAssembliesSection";
import { declareEventStatusAction } from "./actions";
import { listCommunityIndicators } from "@/lib/profile-questions/indicators";

export const dynamic = "force-dynamic";

// The Community group's hub (nav-config.ts's "Community" headerIsLink →
// /community) — the group's own destination row plus the same snapshot
// stats the Dashboard feed already computes, the board's role for
// Tasks. The directory itself stays at /members; this is the single
// community-wide landing surface.
const HUB_LINKS = [
  { href: "/members", label: "Members" },
  { href: "/assemblies", label: "Assemblies" },
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

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [communityRow, snapshot, indicatorResult] = await Promise.all([
    getCommunity(viewing),
    getCommunitySnapshot(viewing),
    // Loaded here rather than inside getCommunitySnapshot: an indicator
    // is a ProfileQuestion aggregate, and folding it into the dashboard
    // snapshot would put profile-question reads behind every Dashboard
    // render for a card only two pages show. No scope on this page —
    // /community isn't under /[cycleScope], so it has no event view to
    // narrow to, and every indicator here describes every member.
    listCommunityIndicators(viewing),
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

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

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

      <EventParticipationCards viewing={viewing} action={declareEventStatusAction} />

      <CommunityIndicators
        scope={indicatorResult.scope}
        indicators={indicatorResult.indicators}
      />

      <CommunityAssembliesSection viewing={viewing} />

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