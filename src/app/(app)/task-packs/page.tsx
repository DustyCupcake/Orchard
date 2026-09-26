import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listTaskPacks } from "@/lib/task-packs";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, CARD } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
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
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Task Packs"
        description={
          <>
            A portable, importable bundle of tasks — export an event&rsquo;s task set from{" "}
            <Link href="/participation" className="text-[var(--accent-1)] hover:underline">Participation</Link>, or upload a file someone handed you from
            another deployment below. Import one into a new event from here.
          </>
        }
      />
      {error && <Banner tone="danger">{error}</Banner>}
      {exported && <Banner tone="success">Exported — see it below.</Banner>}
      {imported && <Banner tone="success">Uploaded — see it below.</Banner>}

      <section className="mt-6">
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Upload a pack file</h2>
        <form action={importTaskPackFromFileAction} encType="multipart/form-data" className="mt-3 flex items-center gap-2">
          <input type="file" name="file" accept="application/json,.json" required className="text-[13px] text-[var(--text)]" />
          <button type="submit" className={BUTTON_PRIMARY}>
            Upload
          </button>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Saved packs</h2>
        {active.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing saved yet.</p>}
        <ul className="mt-3 list-none space-y-3 p-0">
          {active.map((p) => (
            <li key={p.id} className={CARD}>
              <strong className="text-[var(--text)]">{p.name}</strong>{" "}
              {p.domainTags.length > 0 && (
                <span className="text-[12px] text-[var(--text-muted)]">({p.domainTags.join(", ")})</span>
              )}
              {p.description && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{p.description}</p>}
              <div className="mt-2 flex items-center gap-3 text-[13px]">
                <Link href={`/task-packs/import/${p.id}`} className="text-[var(--accent-1)] hover:underline">Import into a new event</Link>
                <a href={`/api/task-packs/${p.id}/download`} className="text-[var(--accent-1)] hover:underline">Download</a>
                <form action={archiveTaskPackAction}>
                  <input type="hidden" name="packId" value={p.id} />
                  <button type="submit" className="cursor-pointer bg-transparent p-0 text-[13px] text-[var(--danger)] hover:underline">
                    Archive
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {archived.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[22px] font-semibold text-[var(--text)]">Archived</h2>
          <ul className="mt-2 list-none p-0">
            {archived.map((p) => (
              <li key={p.id} className="border-b border-[var(--border)] py-2 text-[13px] text-[var(--text-muted)]">
                {p.name}{" "}
                <form action={unarchiveTaskPackAction} className="inline">
                  <input type="hidden" name="packId" value={p.id} />
                  <button type="submit" className={BUTTON_GHOST}>
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
