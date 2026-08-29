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
    return <p style={{ color: "#666" }}>No task assignments yet.</p>;
  }

  const averageByName = new Map((averages ?? []).map((a) => [a.name, a] as const));

  return (
    <>
      {categories.map((cat) => {
        const avg = averageByName.get(cat.name);
        return (
          <div
            key={cat.name}
            style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem", marginBottom: "0.75rem" }}
          >
            <h3 style={{ marginTop: 0 }}>{cat.name}</h3>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              {(["completed", "active", "future"] as const).map((key) => {
                const bucket = cat[key];
                const avgBucket = avg?.[key];
                return (
                  <div key={key}>
                    <strong>{BUCKET_LABELS[key]}</strong>
                    <div style={{ fontSize: "0.85rem", color: "#666" }}>
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
                      <details style={{ marginTop: "0.25rem" }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>tasks</summary>
                        <ul style={{ fontSize: "0.8rem", margin: "0.25rem 0 0", paddingLeft: "1.2rem" }}>
                          {bucket.tasks.map((t) => (
                            <li key={t.id}>
                              {t.title} <span style={{ color: "#666" }}>
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
                  <strong>Shift completions</strong>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {cat.shiftCompletions.count} shift{cat.shiftCompletions.count === 1 ? "" : "s"}
                    {avg && avg.shiftCompletions.count > 0 && (
                      <span> (avg {formatAverage(avg.shiftCompletions.count)})</span>
                    )}
                  </div>
                  <details style={{ marginTop: "0.25rem" }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>shifts</summary>
                    <ul style={{ fontSize: "0.8rem", margin: "0.25rem 0 0", paddingLeft: "1.2rem" }}>
                      {cat.shiftCompletions.completions.map((c) => (
                        <li key={c.id}>
                          {c.seriesTitle}{" "}
                          <span style={{ color: "#666" }}>
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
