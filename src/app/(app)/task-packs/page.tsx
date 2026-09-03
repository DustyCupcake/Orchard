import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listTaskPacks } from "@/lib/task-packs";
import { archiveTaskPackAction, importTaskPackFromFileAction, unarchiveTaskPackAction } from "./actions";

export const dynamic = "force-dynamic";

// The Community's own saved-pack library — see docs/spec.md's Task
// Pack ("packs round-trip as a plain file... not a hosted registry")
// and docs/development-plan.md's Phase 55. Exporting happens from
// /participation (against a specific cycle); this page is where a
// saved pack gets managed afterward — downloaded to hand to another
// deployment, uploaded from one handed to you, archived, or picked up
// to actually start a new cycle from (see /task-packs/import/[id]).
export default async function TaskPacksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; exported?: string; imported?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }
  const { error, exported, imported } = await searchParams;

  const packs = await listTaskPacks(viewing);
  const active = packs.filter((p) => !p.archivedAt);
  const archived = packs.filter((p) => p.archivedAt);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <h1>Task Packs</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {exported && <p style={{ color: "#2a7a2a" }}>Exported — see it below.</p>}
      {imported && <p style={{ color: "#2a7a2a" }}>Uploaded — see it below.</p>}
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        A portable, importable bundle of tasks — export a cycle&rsquo;s task set from{" "}
        <Link href="/participation">Participation</Link>, or upload a file someone handed you from
        another deployment below. Import one into a new cycle from here.
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Upload a pack file</h2>
        <form action={importTaskPackFromFileAction} encType="multipart/form-data" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="file" name="file" accept="application/json,.json" required />
          <button type="submit" style={{ padding: "0.4rem 1rem" }}>
            Upload
          </button>
        </form>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Saved packs</h2>
        {active.length === 0 && <p style={{ color: "#666" }}>Nothing saved yet.</p>}
        <ul style={{ listStyle: "none", padding: 0 }}>
          {active.map((p) => (
            <li key={p.id} style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem", marginBottom: "0.75rem" }}>
              <strong>{p.name}</strong>{" "}
              {p.domainTags.length > 0 && (
                <span style={{ color: "#666", fontSize: "0.8rem" }}>({p.domainTags.join(", ")})</span>
              )}
              {p.description && <p style={{ color: "#666", margin: "0.25rem 0" }}>{p.description}</p>}
              <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.85rem", marginTop: "0.4rem" }}>
                <Link href={`/task-packs/import/${p.id}`}>Import into a new cycle</Link>
                <a href={`/api/task-packs/${p.id}/download`}>Download</a>
                <form action={archiveTaskPackAction}>
                  <input type="hidden" name="packId" value={p.id} />
                  <button type="submit" style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: 0 }}>
                    Archive
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {archived.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Archived</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {archived.map((p) => (
              <li key={p.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee", color: "#666" }}>
                {p.name}{" "}
                <form action={unarchiveTaskPackAction} style={{ display: "inline" }}>
                  <input type="hidden" name="packId" value={p.id} />
                  <button type="submit" style={{ fontSize: "0.85rem" }}>
                    Unarchive
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
