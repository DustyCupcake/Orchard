import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listEscalatedTasks } from "@/lib/tasks";
import { isCoordinationHolder } from "@/lib/coordination";
import { Tag, Banner } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

// "Unplaceable tasks surface in a shared 'needs an owner' view visible
// to all coordinators, with cross-branch placement encouraged" — see
// docs/spec.md's Coordination mechanics: Escalation.
export default async function EscalationPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const authorized = await isCoordinationHolder(viewing, null);
  if (!authorized) {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Escalation</h1>
        <div className="mt-4">
          <Banner tone="danger">
            Only a current holder of any branch&rsquo;s coordination-tagged task can see this —
            it&rsquo;s community-wide, not scoped to one branch.
          </Banner>
        </div>
      </main>
    );
  }

  const tasks = await listEscalatedTasks(viewing);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Escalation</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Tasks that have escalated — no owner, past the point staleness/deadline tolerates.
        Cross-branch placement is encouraged: taking one of these is always a visible, deliberate
        act.
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
