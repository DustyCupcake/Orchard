import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listWikiPages, listTaskWikiIndex } from "@/lib/wiki-pages";
import { listBranches } from "@/lib/settings";
import { BUTTON_PRIMARY, Tag } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

export default async function DocumentationPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const [pages, taskWikiGroups, branches] = await Promise.all([
    listWikiPages(viewing),
    listTaskWikiIndex(viewing),
    listBranches(viewing),
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
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Documentation</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        General reference, platform how-to, camp policy or lore, and FAQs that don&rsquo;t belong
        to any single task — plus a browsable index of every task&rsquo;s own wiki content below.
      </p>

      <div className="mt-4">
        <Link href="/documentation/new" className={BUTTON_PRIMARY}>
          New page
        </Link>
      </div>

      {branchGroups.length === 0 && <p className="mt-6 text-[13px] text-[var(--text-muted)]">No pages yet.</p>}

      {branchGroups.map((group) => (
        <section key={group.key} className="mt-6">
          <SectionHeading>{group.name}</SectionHeading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {group.pages.map((p) => (
              <li key={p.id} className="text-[13px]">
                <Link href={`/documentation/${p.id}`} className="font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {p.title}
                </Link>
                {p.questionPending && (
                  <span className="ml-1.5">
                    <Tag tone="warning">unanswered</Tag>
                  </span>
                )}
                {p.latestRevision && (
                  <span className="text-[var(--text-muted)]">
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

      <hr className="my-10 border-[var(--border)]" />

      <SectionHeading>Task wiki index</SectionHeading>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        A read-only view over every task&rsquo;s current wiki summary — nothing new stored here,
        just a way to browse by branch instead of digging into individual task cards.
      </p>

      {taskWikiGroups.length === 0 && <p className="mt-3 text-[13px] text-[var(--text-muted)]">No task wikis written up yet.</p>}

      {taskWikiGroups.map((group) => (
        <section key={group.branchId} className="mt-4">
          <h3 className="text-[15px] font-medium text-[var(--text)]">{group.branchName}</h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {group.entries.map((e) => (
              <li key={e.taskId} className="text-[13px]">
                <Link href={`/tasks/${e.taskId}`} className="font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {e.taskTitle}
                </Link>
                <span className="text-[var(--text-muted)]">
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
