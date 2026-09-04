import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { listPolls } from "@/lib/scheduling-polls";
import { Tag, BUTTON_PRIMARY } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

// "When can enough of the right people actually meet" — see
// docs/spec.md's "Scheduling polls".
export default async function SchedulingPollsPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const [polls, branches] = await Promise.all([
    listPolls(viewing),
    db.select().from(branch).where(eq(branch.communityId, viewing.communityId)),
  ]);
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Scheduling polls</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Blind availability — you only ever see the aggregate, never who submitted what, until a
        slot is confirmed.
      </p>
      <Link href="/scheduling-polls/new" className={`${BUTTON_PRIMARY} mt-4 inline-block w-fit`}>
        Open a poll
      </Link>

      {polls.length === 0 && <p className="mt-6 text-[13px] text-[var(--text-muted)]">None yet.</p>}
      <div className="mt-6">
        {polls.map((p) => (
          <div
            key={p.id}
            className="mb-2 flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5"
          >
            <Link href={`/scheduling-polls/${p.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
              {p.title}
            </Link>
            <span className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--text-muted)]">
              {branchNameById.get(p.branchId) ?? "—"}
              {p.confirmedSlotStart ? (
                <Tag tone="success">confirmed {new Date(p.confirmedSlotStart).toLocaleDateString()}</Tag>
              ) : (
                <Tag>not yet resolved</Tag>
              )}
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
