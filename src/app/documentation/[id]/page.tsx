import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getWikiPage, listWikiPages } from "@/lib/wiki-pages";
import Nav from "@/components/Nav";
import { editWikiPageAction, markDuplicateAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function WikiPageDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;

  const { page, revisions, alsoAskedAs } = await getWikiPage(currentMember, id);
  const [branchRow, otherPages, members] = await Promise.all([
    page.branchId ? db.select().from(branch).where(eq(branch.id, page.branchId)).then((r) => r[0]) : null,
    listWikiPages(currentMember),
    db.select().from(member).where(eq(member.communityId, currentMember.communityId)),
  ]);
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));
  const currentContent = revisions[0]?.content ?? null;
  const duplicateCandidates = otherPages.filter((p) => p.id !== page.id);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <p>
        <Link href="/documentation" style={{ color: "inherit" }}>
          ← Back to Documentation
        </Link>
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h1>
        {page.title}
        {page.questionPending && <span style={{ color: "#a15c00" }}> · unanswered</span>}
      </h1>
      <div style={{ fontSize: "0.9rem", color: "#666" }}>{branchRow?.name ?? "General"}</div>

      {alsoAskedAs.length > 0 && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          Also asked as: {alsoAskedAs.map((p) => p.title).join(", ")}
        </p>
      )}

      <section style={{ marginTop: "1.5rem" }}>
        {currentContent ? (
          <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem" }}>
            <p style={{ whiteSpace: "pre-wrap" }}>{currentContent}</p>
            <p style={{ fontSize: "0.8rem", color: "#666" }}>
              Last edited by {memberNameById.get(revisions[0].editedBy) ?? "—"} on{" "}
              {new Date(revisions[0].editedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p style={{ color: "#666" }}>
            No answer yet — be the first to write one up, or mark this as a duplicate of an
            existing page below.
          </p>
        )}

        <form
          action={editWikiPageAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}
        >
          <input type="hidden" name="pageId" value={page.id} />
          <textarea
            name="content"
            rows={5}
            required
            defaultValue={currentContent ?? ""}
            placeholder={page.questionPending ? "Write the answer…" : "Edit the page…"}
            style={{ padding: "0.5rem" }}
          />
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            {page.questionPending ? "Post answer" : "Save edit"}
          </button>
        </form>

        {revisions.length > 1 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
              Revision history ({revisions.length})
            </summary>
            <ul style={{ fontSize: "0.8rem" }}>
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
        <details style={{ marginTop: "1.5rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            This already exists elsewhere — mark as a duplicate
          </summary>
          <form
            action={markDuplicateAction}
            style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}
          >
            <input type="hidden" name="pageId" value={page.id} />
            <select name="duplicateOfPageId" required defaultValue="" style={{ padding: "0.4rem" }}>
              <option value="" disabled>
                Which page already answers this?
              </option>
              {duplicateCandidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button type="submit">Mark as duplicate</button>
          </form>
        </details>
      )}
    </main>
  );
}
