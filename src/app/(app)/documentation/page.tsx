import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { listWikiPages, listTaskWikiIndex } from "@/lib/wiki-pages";
import { listBranches } from "@/lib/settings";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function DocumentationPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const [pages, taskWikiGroups, branches] = await Promise.all([
    listWikiPages(currentMember),
    listTaskWikiIndex(currentMember),
    listBranches(currentMember),
  ]);
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  const pagesByBranch = new Map<string, typeof pages>();
  for (const p of pages) {
    const key = p.branchId ?? "__general__";
    if (!pagesByBranch.has(key)) pagesByBranch.set(key, []);
    pagesByBranch.get(key)!.push(p);
  }
  const branchGroups = Array.from(pagesByBranch.entries()).map(([key, groupPages]) => ({
    key,
    name: key === "__general__" ? "General" : branchNameById.get(key) ?? "—",
    pages: groupPages,
  }));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 720 }}>
      <Nav memberName={currentMember.name} />
      <h1>Documentation</h1>
      <p style={{ color: "#666" }}>
        General reference, platform how-to, camp policy or lore, and FAQs that don&rsquo;t belong
        to any single task — plus a browsable index of every task&rsquo;s own wiki content below.
      </p>

      <p>
        <Link href="/documentation/new" style={{ color: "inherit" }}>
          + New page
        </Link>
      </p>

      {branchGroups.length === 0 && <p style={{ color: "#666" }}>No pages yet.</p>}

      {branchGroups.map((group) => (
        <section key={group.key} style={{ marginTop: "1.5rem" }}>
          <h2>{group.name}</h2>
          <ul>
            {group.pages.map((p) => (
              <li key={p.id}>
                <Link href={`/documentation/${p.id}`} style={{ color: "inherit" }}>
                  {p.title}
                </Link>
                {p.questionPending && <span style={{ color: "#a15c00" }}> · unanswered</span>}
                {p.latestRevision && (
                  <span style={{ color: "#666", fontSize: "0.85rem" }}>
                    {" "}
                    — {p.latestRevision.content.slice(0, 80)}
                    {p.latestRevision.content.length > 80 ? "…" : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <hr style={{ margin: "2.5rem 0" }} />

      <h2>Task wiki index</h2>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        A read-only view over every task&rsquo;s current wiki summary — nothing new stored here,
        just a way to browse by branch instead of digging into individual task cards.
      </p>

      {taskWikiGroups.length === 0 && <p style={{ color: "#666" }}>No task wikis written up yet.</p>}

      {taskWikiGroups.map((group) => (
        <section key={group.branchId} style={{ marginTop: "1rem" }}>
          <h3>{group.branchName}</h3>
          <ul>
            {group.entries.map((e) => (
              <li key={e.taskId}>
                <Link href={`/tasks/${e.taskId}`} style={{ color: "inherit" }}>
                  {e.taskTitle}
                </Link>
                <span style={{ color: "#666", fontSize: "0.85rem" }}>
                  {" "}
                  — {e.content.slice(0, 80)}
                  {e.content.length > 80 ? "…" : ""} (by {e.editedByName})
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
