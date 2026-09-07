import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listBranches } from "@/lib/settings";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { createWikiPageAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewWikiPagePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;
  const branches = await listBranches(viewing);

  return (
    <main className="mx-auto max-w-[520px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">New page</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Leave the content blank to post it as an open question instead — it&rsquo;ll sit flagged
        as unanswered until someone fills one in.
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <form action={createWikiPageAction} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Title (or the question, if you don&rsquo;t have an answer yet)</span>
          <input type="text" name="title" required className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Branch (optional — leave unset for general/platform knowledge)</span>
          <select name="branchId" defaultValue="" className={INPUT}>
            <option value="">General</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Content (optional)</span>
          <textarea name="content" rows={6} className={INPUT} />
        </label>

        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Create page
        </button>
      </form>
    </main>
  );
}
