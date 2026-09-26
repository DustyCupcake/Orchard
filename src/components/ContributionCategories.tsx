import Link from "next/link";
import type { ContributionCategory, ContributionCategoryAverage } from "@/lib/contribution";
import { effortSummary } from "@/lib/format";

const BUCKET_LABELS = { completed: "Completed", active: "Active", future: "Future signed-up" } as const;

function formatAverage(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// Each category is a card of stacked bucket blocks, label and figures on
// one line with the task list underneath — always visible, not behind a
// "tasks" disclosure. This page exists to answer "what am I carrying,"
// and a summary line the reader has to click to learn which tasks are
// actually in their own hands was the opposite of that.
export default function ContributionCategories({
  categories,
  averages,
}: {
  categories: ContributionCategory[];
  averages?: ContributionCategoryAverage[] | null;
}) {
  if (categories.length === 0) {
    return <p className="text-[13px] text-[var(--text-muted)]">No task assignments yet.</p>;
  }

  const averageByName = new Map((averages ?? []).map((a) => [a.name, a] as const));

  return (
    <>
      {categories.map((cat) => {
        const avg = averageByName.get(cat.name);
        return (
          <div key={cat.name} className="mb-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <h3 className="text-[15px] font-semibold text-[var(--text)]">{cat.name}</h3>
            <div className="mt-2 flex flex-col">
              {(["active", "future", "completed"] as const).map((key) => {
                const bucket = cat[key];
                if (bucket.count === 0) return null;
                const avgBucket = avg?.[key];
                return (
                  <div key={key} className="border-t border-[var(--border)] py-2 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                      <span className="text-[13px] font-medium text-[var(--text)]">{BUCKET_LABELS[key]}</span>
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {bucket.count} task{bucket.count === 1 ? "" : "s"}
                        {bucket.hours > 0 ? ` · ${bucket.hours}h/week` : ""}
                        {avgBucket && (
                          <span>
                            {" "}
                            (avg {formatAverage(avgBucket.count)}
                            {avgBucket.hours > 0 ? ` · ${formatAverage(avgBucket.hours)}h/week` : ""})
                          </span>
                        )}
                      </span>
                    </div>
                    <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
                      {bucket.tasks.map((t) => (
                        <li key={t.id}>
                          <Link
                            href={`/tasks/${t.id}`}
                            className="font-medium text-[var(--text)] hover:text-[var(--accent-1)] hover:underline"
                          >
                            {t.title}
                          </Link>{" "}
                          <span className="text-[12px] text-[var(--text-muted)]">
                            ({t.branchName} · {effortSummary(t.effort, t.effortMagnitude)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {cat.shiftCompletions.count > 0 && (
                <div className="border-t border-[var(--border)] py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <span className="text-[13px] font-medium text-[var(--text)]">Shift completions</span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {cat.shiftCompletions.count} shift{cat.shiftCompletions.count === 1 ? "" : "s"}
                      {avg && avg.shiftCompletions.count > 0 && (
                        <span> (avg {formatAverage(avg.shiftCompletions.count)})</span>
                      )}
                    </span>
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
                    {cat.shiftCompletions.completions.map((c) => (
                      <li key={c.id}>
                        {c.seriesTitle}{" "}
                        <span className="text-[12px] text-[var(--text-muted)]">
                          ({new Date(c.occurrenceStartsAt).toLocaleDateString()})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
