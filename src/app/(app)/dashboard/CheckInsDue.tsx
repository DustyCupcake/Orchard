import Link from "next/link";
import type { member as memberTable } from "@/db/schema";
import { listMyCheckInsDue } from "@/lib/accompaniment";
import { formatExactDate } from "@/lib/dates";
import { BUTTON_SECONDARY, Tag } from "@/components/ui/kit";
import { completeCheckInAction } from "./actions";

type Member = typeof memberTable.$inferSelect;

// docs/plans/accompaniment-plan.md §5. The check-ins this member is due to make on someone they
// accompany: the date has come and nobody has said it's done. Derived live from the task's
// milestones and shown on their own dashboard; nothing is sent, and nothing is held against them
// if one sits. Says nothing when there is nothing due.
export default async function CheckInsDue({ viewing }: { viewing: Member }) {
  const due = await listMyCheckInsDue(viewing);
  if (due.length === 0) return null;
  return (
    <section className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-5">
      <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Time to check in</h2>
      <ul className="mt-2 flex flex-col gap-3">
        {due.map((c) => (
          <li key={c.milestoneId} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[length:var(--text-body)] text-[var(--text)]">
              <strong>{c.newcomerName}</strong>: {c.label}{" "}
              <span className="text-[var(--text-muted)]">
                ({c.overdue ? `was due ${formatExactDate(c.date)}` : "due today"})
              </span>{" "}
              {c.overdue && <Tag tone="warning">overdue</Tag>}
            </p>
            <div className="flex items-center gap-2">
              <Link href={`/tasks/${c.taskId}`} className="text-[length:var(--text-body)] text-[var(--accent-1)] hover:underline">
                Open the task
              </Link>
              <form action={completeCheckInAction}>
                <input type="hidden" name="milestoneId" value={c.milestoneId} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  Done
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
