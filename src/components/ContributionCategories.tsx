import type { ContributionCategory } from "@/lib/contribution";
import { effortSummary } from "@/lib/format";

const BUCKET_LABELS = { completed: "Completed", active: "Active", future: "Future signed-up" } as const;

export default function ContributionCategories({ categories }: { categories: ContributionCategory[] }) {
  if (categories.length === 0) {
    return <p style={{ color: "#666" }}>No task assignments yet.</p>;
  }

  return (
    <>
      {categories.map((cat) => (
        <div
          key={cat.name}
          style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem", marginBottom: "0.75rem" }}
        >
          <h3 style={{ marginTop: 0 }}>{cat.name}</h3>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            {(["completed", "active", "future"] as const).map((key) => {
              const bucket = cat[key];
              return (
                <div key={key}>
                  <strong>{BUCKET_LABELS[key]}</strong>
                  <div style={{ fontSize: "0.85rem", color: "#666" }}>
                    {bucket.count} task{bucket.count === 1 ? "" : "s"}
                    {bucket.hours > 0 ? ` · ${bucket.hours}h/week` : ""}
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
          </div>
        </div>
      ))}
    </>
  );
}
