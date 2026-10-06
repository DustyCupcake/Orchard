import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listWikiPages, listTaskWikiIndex } from "@/lib/wiki-pages";
import { listBranches } from "@/lib/settings";
import { BUTTON_PRIMARY, Tag } from "@/components/ui/kit";

// The Library: three kinds of thing to read, kept as three sections
// rather than merged into one list.
//
//   1. Orchard documentation — about the tool itself. Static, read
//      only, authored in src/lib/docs/content/. This section was added
//      after the other two and sits first, because a member who
//      doesn't yet know how any of this works isn't helped by a list
//      of camp policy they can't interpret yet.
//   2. Community pages — the community's own wiki, the original
//      Library. Any member can write one.
//   3. The task wiki index — a read-only view over knowledge that
//      already lives on tasks. No new storage.
//
// Keeping them separate is the point. A community's own notes and the
// tool's documentation are not the same thing, they aren't written by
// the same people, and they have opposite permissions: the first two
// sections below are writable by any member, this one can't be edited
// or deleted by anyone using it. Merging them would mean a page about
// how a control behaves sitting in the same list as a page about where
// to buy timber.

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
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
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Library</h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
        How Orchard works, your community&rsquo;s own reference and policy, and an index of
        everything the tasks themselves have written down.
      </p>

      <div className="mt-4">
        <Link href="/documentation/new" className={BUTTON_PRIMARY}>
          New page
        </Link>
      </div>

      <section className="mt-8">
        <SectionHeading>Orchard documentation</SectionHeading>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          How the tool works, how to use it, and why it behaves the way it does — including the
          reasoning behind the controls that don&rsquo;t explain themselves.
        </p>
        <p className="mt-2 text-[length:var(--text-body)]">
          <Link
            href="/documentation/orchard"
            className="font-medium text-[var(--accent-1)] hover:underline"
          >
            Read it →
          </Link>
        </p>
      </section>

      <hr className="my-8 border-[var(--border)]" />

      <section>
        <SectionHeading>Community pages</SectionHeading>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Your own reference material, camp policy or lore, and FAQs that don&rsquo;t belong to any
          single task. Anyone can write one, and a question with no answer yet is a perfectly
          normal way for a page to start.
        </p>

        {branchGroups.length === 0 && (
          <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">No pages yet.</p>
        )}

        {branchGroups.map((group) => (
          <div key={group.key} className="mt-4">
            <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{group.name}</h3>
            <ul className="mt-1.5 flex flex-col gap-1">
              {group.pages.map((p) => (
                <li key={p.id} className="text-[length:var(--text-body)]">
                  <Link
                    href={`/documentation/${p.id}`}
                    className="font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
                  >
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
          </div>
        ))}
      </section>

      <hr className="my-8 border-[var(--border)]" />

      <section>
        <SectionHeading>Task wiki index</SectionHeading>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          A read-only view over every task&rsquo;s current wiki summary — nothing new stored here,
          just a way to browse by branch instead of digging into individual task cards.
        </p>

        {taskWikiGroups.length === 0 && (
          <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">No task wikis written up yet.</p>
        )}

        {taskWikiGroups.map((group) => (
          <div key={group.branchId} className="mt-4">
            <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{group.branchName}</h3>
            <ul className="mt-1.5 flex flex-col gap-1">
              {group.entries.map((e) => (
                <li key={e.taskId} className="text-[length:var(--text-body)]">
                  <Link
                    href={`/tasks/${e.taskId}`}
                    className="font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
                  >
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
          </div>
        ))}
      </section>
    </main>
  );
}
