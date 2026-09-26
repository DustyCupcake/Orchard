import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { resolveViewScopeFromSegment } from "@/lib/cycles";
import { listEscalatedTasks } from "@/lib/tasks";
import { listCoordinationScopeIds } from "@/lib/coordination";
import { listBackstopScopesForMember } from "@/lib/backstop";
import { Tag, Banner } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

// The real Escalation page (docs/cycle-scope-remediation-plan.md
// §5.3/§5.5): it now lives under /[cycleScope] and gates on the
// view-scope cycle when the community runs cycles, staying
// community-wide for cycle-less ones — the same movement
// /participation and /budget made (Phase 65). A cycle-less
// coordination task (column authority) or the community/evergreen
// backstop keeps the community-wide gate; a cycle-placed coordinator
// or a cycle's backstop reaches their own cycle's segment —
// listEscalatedTasks applies the same intersection to the queue
// itself, so a scoped viewer never sees another cycle's rows (§2.1).
//
// "Unplaceable tasks surface in a shared 'needs an owner' view visible
// to all coordinators, with cross-branch placement encouraged" — see
// docs/spec.md's Coordination mechanics: Escalation.
export default async function CycleScopeEscalationPage({
  params,
}: {
  params: Promise<{ cycleScope: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { cycleScope } = await params;
  const scope = await resolveViewScopeFromSegment(viewing, cycleScope);
  // The [cycleScope] layout above already 404s an unresolvable segment
  // before this page ever renders — this is just satisfying the type.
  if (!scope) redirect("/active/escalation");

  const [coordination, backstopScopes] = await Promise.all([
    listCoordinationScopeIds(viewing),
    listBackstopScopesForMember(viewing),
  ]);
  const scopeCycleIds = scope.kind === "single" ? [scope.cycle.id] : scope.cycles.map((c) => c.id);
  const isCommunityWide = coordination.communityWide || coordination.branchIds.size > 0;
  const isEvergreenBackstop = backstopScopes.includes(null);
  const coversCycle = (cid: string) => coordination.cycleIds.has(cid) || backstopScopes.includes(cid);
  const authorized =
    scope.kind === "single"
      ? isCommunityWide || isEvergreenBackstop || coversCycle(scope.cycle.id)
      : isCommunityWide || isEvergreenBackstop || scopeCycleIds.some(coversCycle);
  const isScopedOnly = !isCommunityWide;

  if (!authorized) {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Escalation</h1>
        <div className="mt-4">
          <Banner tone="danger">
            Only a current coordination holder, or the backstop of a scope, can see this — you&rsquo;re
            viewing an event only its own coordinator (or backstop) reaches. Event-independent coordination
            keeps the community-wide view.
          </Banner>
        </div>
      </main>
    );
  }

  const tasks = await listEscalatedTasks(viewing, scopeCycleIds);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Escalation</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Tasks that have escalated — no owner, past the point staleness/deadline tolerates.
        Cross-branch placement is encouraged: taking one of these is always a visible, deliberate
        act.
        {isScopedOnly && " You see only your own scope\u2019s tasks — the ones you\u2019re accountable for."}
      </p>

      {tasks.length === 0 && (
        <div className="mt-4">
          <Banner tone="success">Nothing escalated right now.</Banner>
        </div>
      )}

      {tasks.length > 0 && (
        <ul className="mt-6">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
              <Link href={`/tasks/${t.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                {t.title}
              </Link>
              <span className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--text-muted)]">
                {t.branchName} · {t.status}
                {t.critical && <Tag tone="danger">critical</Tag>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
