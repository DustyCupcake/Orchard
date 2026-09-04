import type { ContributionCategory, ContributionCategoryAverage } from "@/lib/contribution";
import { effortSummary } from "@/lib/format";

const BUCKET_LABELS = { completed: "Completed", active: "Active", future: "Future signed-up" } as const;

function formatAverage(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

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
            <div className="mt-2 flex flex-wrap gap-6">
              {(["completed", "active", "future"] as const).map((key) => {
                const bucket = cat[key];
                const avgBucket = avg?.[key];
                return (
                  <div key={key}>
                    <div className="text-[13px] font-medium text-[var(--text)]">{BUCKET_LABELS[key]}</div>
                    <div className="text-[12px] text-[var(--text-muted)]">
                      {bucket.count} task{bucket.count === 1 ? "" : "s"}
                      {bucket.hours > 0 ? ` · ${bucket.hours}h/week` : ""}
                      {avgBucket && (
                        <span>
                          {" "}
                          (avg {formatAverage(avgBucket.count)}
                          {avgBucket.hours > 0 ? ` · ${formatAverage(avgBucket.hours)}h/week` : ""})
                        </span>
                      )}
                    </div>
                    {bucket.tasks.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[12px] text-[var(--accent-1)]">tasks</summary>
                        <ul className="mt-1 flex flex-col gap-0.5 text-[12px] text-[var(--text)]">
                          {bucket.tasks.map((t) => (
                            <li key={t.id}>
                              {t.title}{" "}
                              <span className="text-[var(--text-muted)]">
                                ({t.branchName} · {effortSummary(t.effort, t.effortMagnitude)})
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
              {cat.shiftCompletions.count > 0 && (
                <div>
                  <div className="text-[13px] font-medium text-[var(--text)]">Shift completions</div>
                  <div className="text-[12px] text-[var(--text-muted)]">
                    {cat.shiftCompletions.count} shift{cat.shiftCompletions.count === 1 ? "" : "s"}
                    {avg && avg.shiftCompletions.count > 0 && (
                      <span> (avg {formatAverage(avg.shiftCompletions.count)})</span>
                    )}
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[12px] text-[var(--accent-1)]">shifts</summary>
                    <ul className="mt-1 flex flex-col gap-0.5 text-[12px] text-[var(--text)]">
                      {cat.shiftCompletions.completions.map((c) => (
                        <li key={c.id}>
                          {c.seriesTitle}{" "}
                          <span className="text-[var(--text-muted)]">
                            ({new Date(c.occurrenceStartsAt).toLocaleDateString()})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
