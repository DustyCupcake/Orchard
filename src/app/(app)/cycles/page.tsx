import { and, desc, eq, ilike, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cycle } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";

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
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Find a closed cycle</h1>
      <p style={{ color: "#666" }}>
        A closed cycle stays fully reachable, read-only — it just never appears in the nav
        switcher&rsquo;s default view.
      </p>
      <form method="get" style={{ display: "flex", gap: "0.5rem" }}>
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search closed cycles by name…"
          style={{ padding: "0.4rem", flex: 1 }}
        />
        <button type="submit" style={{ padding: "0.4rem 1rem" }}>
          Search
        </button>
      </form>

      {query && results.length === 0 && <p style={{ color: "#666", marginTop: "1rem" }}>No closed cycle matches.</p>}
      {results.length > 0 && (
        <ul style={{ marginTop: "1rem" }}>
          {results.map((c) => (
            <li key={c.id}>
              <a href={`/${c.id}/participation`}>{c.name}</a>
              {c.closedAt && (
                <span style={{ color: "#666" }}> — closed {new Date(c.closedAt).toLocaleDateString()}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
