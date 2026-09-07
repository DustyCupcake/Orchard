import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getWikiPage, listWikiPages } from "@/lib/wiki-pages";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, Tag } from "@/components/ui/kit";
import { editWikiPageAction, markDuplicateAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WikiPageDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;

  const { page, revisions, alsoAskedAs } = await getWikiPage(viewing, id);
  const [branchRow, otherPages, members] = await Promise.all([
    page.branchId ? db.select().from(branch).where(eq(branch.id, page.branchId)).then((r) => r[0]) : null,
    listWikiPages(viewing),
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
  ]);
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));
  const currentContent = revisions[0]?.content ?? null;
  const duplicateCandidates = otherPages.filter((p) => p.id !== page.id);

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <Link href="/documentation" className="text-[13px] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to Documentation
      </Link>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <h1 className="mt-2 flex items-center gap-2 text-[32px] font-semibold leading-tight text-[var(--text)]">
        {page.title}
        {page.questionPending && <Tag tone="warning">unanswered</Tag>}
      </h1>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">{branchRow?.name ?? "General"}</p>

      {alsoAskedAs.length > 0 && (
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Also asked as: {alsoAskedAs.map((p) => p.title).join(", ")}
        </p>
      )}

      <section className="mt-6">
        {currentContent ? (
          <div className={CARD}>
            <p className="whitespace-pre-wrap text-[13px] text-[var(--text)]">{currentContent}</p>
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
              Last edited by {memberNameById.get(revisions[0].editedBy) ?? "—"} on{" "}
              {new Date(revisions[0].editedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--text-muted)]">
            No answer yet — be the first to write one up, or mark this as a duplicate of an
            existing page below.
          </p>
        )}

        <form action={editWikiPageAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="pageId" value={page.id} />
          <textarea
            name="content"
            rows={5}
            required
            defaultValue={currentContent ?? ""}
            placeholder={page.questionPending ? "Write the answer…" : "Edit the page…"}
            className={INPUT}
          />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            {page.questionPending ? "Post answer" : "Save edit"}
          </button>
        </form>

        {revisions.length > 1 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
              Revision history ({revisions.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
              {revisions.slice(1).map((rev) => (
                <li key={rev.id}>
                  {memberNameById.get(rev.editedBy) ?? "—"} —{" "}
                  {new Date(rev.editedAt).toLocaleString()}: {rev.content}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {page.questionPending && duplicateCandidates.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
            This already exists elsewhere — mark as a duplicate
          </summary>
          <form action={markDuplicateAction} className="mt-2 flex gap-2">
            <input type="hidden" name="pageId" value={page.id} />
            <select name="duplicateOfPageId" required defaultValue="" className={INPUT}>
              <option value="" disabled>
                Which page already answers this?
              </option>
              {duplicateCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button type="submit" className={BUTTON_SECONDARY}>
              Mark as duplicate
            </button>
          </form>
        </details>
      )}
    </main>
  );
}
