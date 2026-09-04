import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import {
  listDistinctTags,
  listMyPendingJoinRequests,
  listTasksWithAssignments,
  tierNameLookup,
} from "@/lib/tasks";
import { listCoordinationBranchIds, isCoordinationHolder } from "@/lib/coordination";
import { canInitiateCycle } from "@/lib/cycles";
import { getCurrentCycle } from "@/lib/profile-questions";
import { listTaskFitSuggestions } from "@/lib/onboarding";
import BranchFilter from "./BranchFilter";
import TagFilter from "./TagFilter";
import TaskCard from "./TaskCard";
import { Tag, Banner, BUTTON_SECONDARY, BUTTON_PRIMARY } from "@/components/ui/kit";
import { bulkClaimAction, exportSelectedTasksAsPackAction } from "./actions";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { status: "unclaimed", label: "Unclaimed" },
  { status: "claimed", label: "Claimed" },
  { status: "waiting", label: "Waiting" },
  { status: "done", label: "Done" },
] as const;

// "The main task view" — most of the rest of the Tasks nav group's
// destinations are reachable from here as buttons, with the sidebar's
// own expandable sub-list as the alternate way to get there.
const HUB_LINKS = [
  { href: "/propose", label: "Propose a task" },
  { href: "/proposals", label: "Proposals" },
  { href: "/contribution", label: "My contribution" },
  { href: "/input-rounds", label: "Input rounds" },
] as const;
const COORDINATOR_HUB_LINKS = [
  { href: "/coordination", label: "Coordination" },
  { href: "/escalation", label: "Escalation" },
] as const;

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    branchId?: string;
    tag?: string;
    fit?: string;
    error?: string;
    notice?: string;
    done?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { branchId, tag, fit, error, notice, done } = await searchParams;
  // "A Done confirmation gains a 'you might also like' strip" — see
  // docs/development-plan.md's Phase 56 and src/lib/onboarding.ts's
  // listTaskFitSuggestions, the exact same tag-overlap heuristic
  // onboarding's own first-login suggestions use, just excluding the
  // task that was just finished rather than reusing it as an anchor.
  const relatedToFinished = done ? await listTaskFitSuggestions(viewing, { excludeTaskId: done, limit: 3 }) : [];
  const sortByFit = fit === "1";

  const [branches, tasks, tierNames, myPendingRequests, allTags, coordinationBranchIds, canExport, currentCycle, isCoordinator] =
    await Promise.all([
      db.select().from(branch).where(eq(branch.communityId, viewing.communityId)),
      listTasksWithAssignments(viewing, { branchId, tag, sortByFit }),
      tierNameLookup(viewing.communityId),
      listMyPendingJoinRequests(viewing),
      listDistinctTags(viewing),
      listCoordinationBranchIds(viewing),
      canInitiateCycle(viewing),
      getCurrentCycle(viewing.communityId),
      isCoordinationHolder(viewing, null),
    ]);
  // Export only ever targets the current cycle — same "the current
  // one" scoping /participation's own whole-cycle export uses — so a
  // selected task belonging to a different (or no) cycle is silently
  // excluded server-side rather than guessed at here.
  const exportableInView = currentCycle ? tasks.filter((t) => t.cycleId === currentCycle.id) : [];

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
    <main className="mx-auto max-w-[1180px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Board</h1>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}
      {notice && <div className="mt-4"><Banner tone="success">{notice}</Banner></div>}

      {done && (
        <div className="mt-4"><Banner tone="success">
          <p className="font-medium">Marked as done.</p>
          {relatedToFinished.length > 0 && (
            <>
              <p className="mb-1 mt-2 text-[12px] font-medium opacity-80">You might also like:</p>
              <ul className="flex flex-col gap-0.5">
                {relatedToFinished.map((t) => (
                  <li key={t.id} className="text-[13px]">
                    <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>{" "}
                    <span className="opacity-70">({t.branchName})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Banner></div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {HUB_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={BUTTON_SECONDARY}>
            {l.label}
          </Link>
        ))}
        {isCoordinator &&
          COORDINATOR_HUB_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={BUTTON_SECONDARY}>
              {l.label}
            </Link>
          ))}
      </div>

      {branches.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <BranchFilter branches={branches} selectedBranchId={branchId} />
          {allTags.length > 0 && <TagFilter tags={allTags} selectedTag={tag} branchId={branchId} />}
          <Link
            href={fitToggleHref}
            className={sortByFit ? "text-[13px] font-medium text-[var(--accent-1)]" : "text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"}
          >
            {sortByFit ? "✓ Sorted by what fits me" : "Sort by what fits me"}
          </Link>
        </div>
      )}

      {branches.length === 0 && (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          No branches yet — this Community&rsquo;s branches (and its first tasks) still need to be
          set up, which isn&rsquo;t built yet (that&rsquo;s Phase 9).
        </p>
      )}

      {bulkClaimable.length > 1 && (
        <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
            Bulk claim ({bulkClaimable.length} eligible in this view)
          </summary>
          <form action={bulkClaimAction} className="mt-3 flex flex-col gap-2">
            {bulkClaimable.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="taskIds" value={t.id} defaultChecked />
                {t.title} <span className="text-[var(--text-muted)]">({branchNameById.get(t.branchId) ?? "—"})</span>
              </label>
            ))}
            <button type="submit" className={`${BUTTON_PRIMARY} mt-1 w-fit`}>
              Claim selected
            </button>
          </form>
        </details>
      )}

      {canExport && exportableInView.length > 0 && (
        <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
            Export selected as a Task Pack ({exportableInView.length} in this view)
          </summary>
          <form action={exportSelectedTasksAsPackAction} className="mt-3 flex max-w-[420px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={currentCycle!.id} />
            <label className="flex flex-col gap-1 text-[13px] text-[var(--text-muted)]">
              Pack name
              <input
                type="text"
                name="name"
                required
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
              />
            </label>
            {exportableInView.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="taskIds" value={t.id} defaultChecked />
                {t.title} <span className="text-[var(--text-muted)]">({branchNameById.get(t.branchId) ?? "—"})</span>
              </label>
            ))}
            <button type="submit" className={`${BUTTON_PRIMARY} mt-1 w-fit`}>
              Export selected
            </button>
          </form>
        </details>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.status);
          return (
            <div key={col.status}>
              <div className="mb-3 flex items-center gap-2 border-b border-[var(--border)] pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  {col.label}
                </span>
                <Tag>{colTasks.length}</Tag>
              </div>
              {colTasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  assignments={t.assignments}
                  requirements={t.requirements}
                  unmetRequirements={t.unmetRequirements}
                  groupCoverage={t.groupCoverage}
                  tierNames={tierNames}
                  branchName={branchNameById.get(t.branchId) ?? "—"}
                  currentMemberId={viewing.id}
                  myPendingRequestId={myPendingRequests.get(t.id) ?? null}
                  isCoordinationHolderForBranch={coordinationBranchIds.has(t.branchId)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </main>
  );
}
