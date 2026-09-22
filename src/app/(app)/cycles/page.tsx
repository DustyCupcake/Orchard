import { and, desc, eq, ilike, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cycle } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { BUTTON_PRIMARY, INPUT } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

// The nav switcher's "Other" search — a closed cycle deliberately never
// appears in the default "all active cycles" aggregate (docs/
// development-plan.md's Phase 65), so this is how one gets reached at
// all. A plain server-rendered GET form, not a live-search widget —
// this codebase keeps its client-JS exceptions short (Scheduling
// polls' drag grid, the board's tag filter), and a third one isn't
// warranted for what's just a name match. Community-scoped, not under
// /[cycleScope]/ itself — finding a closed cycle isn't itself scoped
// to one.
export default async function CyclesSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const results = query
    ? await db
        .select()
        .from(cycle)
        .where(
          and(eq(cycle.communityId, viewing.communityId), isNotNull(cycle.closedAt), ilike(cycle.name, `%${query}%`)),
        )
        .orderBy(desc(cycle.closedAt))
    : [];

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Find a closed cycle"
        description="A closed cycle stays fully reachable, read-only — it just never appears in the nav switcher's default view."
      />
      <form method="get" className="mt-4 flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search closed cycles by name…"
          className={`${INPUT} flex-1`}
        />
        <button type="submit" className={BUTTON_PRIMARY}>
          Search
        </button>
      </form>

      {query && results.length === 0 && <p className="mt-4 text-[13px] text-[var(--text-muted)]">No closed cycle matches.</p>}
      {results.length > 0 && (
        <ul className="mt-4 space-y-2 text-[13px]">
          {results.map((c) => (
            <li key={c.id} className="text-[var(--text)]">
              <a href={`/${c.id}/participation`} className="text-[var(--accent-1)] hover:underline">{c.name}</a>
              {c.closedAt && (
                <span className="text-[var(--text-muted)]"> — closed {new Date(c.closedAt).toLocaleDateString()}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
