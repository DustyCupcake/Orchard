import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import {
  listDistinctTags,
  listMyPendingJoinRequests,
  listTasksWithAssignments,
  tierNameLookup,
} from "@/lib/tasks";
import { listCoordinationBranchIds } from "@/lib/coordination";
import BranchFilter from "./BranchFilter";
import TagFilter from "./TagFilter";
import TaskCard from "./TaskCard";
import { bulkClaimAction } from "./actions";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { status: "unclaimed", label: "Unclaimed" },
  { status: "claimed", label: "Claimed" },
  { status: "waiting", label: "Waiting" },
  { status: "done", label: "Done" },
] as const;

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ branchId?: string; tag?: string; fit?: string; error?: string; notice?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { branchId, tag, fit, error, notice } = await searchParams;
  const sortByFit = fit === "1";

  const [branches, tasks, tierNames, myPendingRequests, allTags, coordinationBranchIds] =
    await Promise.all([
      db.select().from(branch).where(eq(branch.communityId, currentMember.communityId)),
      listTasksWithAssignments(currentMember, { branchId, tag, sortByFit }),
      tierNameLookup(currentMember.communityId),
      listMyPendingJoinRequests(currentMember),
      listDistinctTags(currentMember),
      listCoordinationBranchIds(currentMember),
    ]);

  // Preserves the other filters while toggling fit — a plain link,
  // same "no client JS needed for something a link can do" posture as
  // everywhere else this codebase avoids it.
  const fitToggleHref = (() => {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (tag) params.set("tag", tag);
    if (!sortByFit) params.set("fit", "1");
    const query = params.toString();
    return query ? `/board?${query}` : "/board";
  })();

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  // "Select and claim with exceptions" — bulk-claimable means an
  // unclaimed, Requirement-eligible, non-community_endorsed task within
  // the current filter. Self-assign-confirmation-gated tasks stay
  // selectable (defaulted on, like everything else) — they just fail
  // individually in the summary if actually claimed that way, same as
  // any other per-task failure, rather than silently skipping the check.
  const bulkClaimable = tasks.filter(
    (t) => t.status === "unclaimed" && t.openness !== "community_endorsed" && t.unmetRequirements.length === 0,
  );

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <h1>Board</h1>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {notice && <p style={{ color: "#2a7a2a" }}>{notice}</p>}

      {branches.length > 0 && (
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <BranchFilter branches={branches} selectedBranchId={branchId} />
          {allTags.length > 0 && (
            <TagFilter tags={allTags} selectedTag={tag} branchId={branchId} />
          )}
          <a href={fitToggleHref} style={{ fontSize: "0.9rem" }}>
            {sortByFit ? "✓ Sorted by what fits me" : "Sort by what fits me"}
          </a>
        </div>
      )}

      {branches.length === 0 && (
        <p style={{ color: "#666" }}>
          No branches yet — this Community&rsquo;s branches (and its first tasks) still need to be
          set up, which isn&rsquo;t built yet (that&rsquo;s Phase 9).
        </p>
      )}

      {bulkClaimable.length > 1 && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer" }}>
            Bulk claim ({bulkClaimable.length} eligible in this view)
          </summary>
          <form
            action={bulkClaimAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem" }}
          >
            {bulkClaimable.map((t) => (
              <label key={t.id} style={{ fontSize: "0.9rem" }}>
                <input type="checkbox" name="taskIds" value={t.id} defaultChecked /> {t.title}{" "}
                <span style={{ color: "#666" }}>({branchNameById.get(t.branchId) ?? "—"})</span>
              </label>
            ))}
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Claim selected
            </button>
          </form>
        </details>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginTop: "1.5rem",
          alignItems: "start",
        }}
      >
        {COLUMNS.map((col) => (
          <div key={col.status}>
            <h2 style={{ fontSize: "1rem" }}>
              {col.label} ({tasks.filter((t) => t.status === col.status).length})
            </h2>
            {tasks
              .filter((t) => t.status === col.status)
              .map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  assignments={t.assignments}
                  requirements={t.requirements}
                  unmetRequirements={t.unmetRequirements}
                  groupCoverage={t.groupCoverage}
                  tierNames={tierNames}
                  branchName={branchNameById.get(t.branchId) ?? "—"}
                  currentMemberId={currentMember.id}
                  myPendingRequestId={myPendingRequests.get(t.id) ?? null}
                  isCoordinationHolderForBranch={coordinationBranchIds.has(t.branchId)}
                />
              ))}
          </div>
        ))}
      </div>
    </main>
  );
}
