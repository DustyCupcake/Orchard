import { notFound, redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { resolveViewScopeFromSegment } from "@/lib/cycles";

export const dynamic = "force-dynamic";

// Resolves the [cycleScope] segment once for whichever child page
// (/participation, /budget — the only two moved under it, see
// docs/development-plan.md's Phase 65) is actually being rendered.
// resolveViewScopeFromSegment is wrapped in React's cache(), so the
// child page's own call for the identical (actor, segment) pair below
// this is a cache hit, not a second DB round trip. An unresolvable
// segment (a malformed value, or a real cycle id from another
// community) 404s — reachable only by hand-typing/bookmarking a bad
// URL, not through any link this app itself renders.
export default async function CycleScopeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ cycleScope: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { cycleScope } = await params;
  const scope = await resolveViewScopeFromSegment(viewing, cycleScope);
  if (!scope) {
    notFound();
  }

  return (
    <>
      {scope.kind === "single" && scope.cycle.closedAt && (
        <div
          style={{
            background: "#fff3cd",
            borderBottom: "1px solid #ffe69c",
            padding: "0.6rem 1rem",
            textAlign: "center",
            fontSize: "0.85rem",
            color: "#664d03",
          }}
        >
          This cycle is closed — read-only. Closed {new Date(scope.cycle.closedAt).toLocaleDateString()}.
        </div>
      )}
      {children}
    </>
  );
}
