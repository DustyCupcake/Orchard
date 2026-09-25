import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, phase } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import {
  groupTasksByBranchCoverage,
  groupTasksByPhase,
  listDistinctTags,
  listMyPendingJoinRequests,
  listTasksWithAssignments,
  sortUnclaimedQueue,
  tierNameLookup,
} from "@/lib/tasks";
import {
  listCoordinationScopeIds,
  listCoordinationHoldersForScopes,
  isCoordinationHolder,
} from "@/lib/coordination";
import { listBackstopHoldersForScopes, listBackstopScopesForMember } from "@/lib/backstop";
import { ATTENTION_STYLES } from "@/lib/format";
import { canInitiateCycle, resolveDefaultScopeSegment, resolveViewScopeFromSegment } from "@/lib/cycles";
import { effectiveDateDisplayMode } from "@/lib/dates";
import { listTaskFitSuggestions } from "@/lib/onboarding";
import { getCommunityRow } from "@/lib/recruitment";
import BranchFilter from "./BranchFilter";
import TagFilter from "./TagFilter";
import TaskCard from "./TaskCard";
import PhaseCard from "./PhaseCard";
import BranchCoverageCard from "./BranchCoverageCard";
import FilterSelect from "./FilterSelect";
import { Tag, Banner, BUTTON_SECONDARY, BUTTON_PRIMARY, ATTENTION_TONE } from "@/components/ui/kit";
import ActionMenu from "@/components/ui/ActionMenu";
import BulkClaimSelect from "@/components/tasks/BulkClaimSelect";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { exportSelectedTasksAsPackAction } from "./actions";

type BoardTask = Awaited<ReturnType<typeof listTasksWithAssignments>>[number];

export const dynamic = "force-dynamic";

const VIEWS = ["unclaimed", "kanban", "phase", "coverage"] as const;
type BoardView = (typeof VIEWS)[number];
const VIEW_LABEL: Record<BoardView, string> = { unclaimed: "Unclaimed", kanban: "Kanban", phase: "By phase", coverage: "Branch coverage" };

const COLUMNS = [
  { status: "unclaimed", label: "Unclaimed" },
  { status: "claimed", label: "Claimed" },
  { status: "waiting", label: "Waiting" },
  { status: "done", label: "Done" },
] as const;

const STATUS_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.status, c.label])) as Record<string, string>;

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
    hideCycleless?: string;
    view?: string;
    attention?: string;
    phaseId?: string;
    duration?: string;
    hasSlots?: string;
    assignedToMe?: string;
    dueWithin?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const {
    branchId, tag, fit, error, notice, done, hideCycleless, view,
    attention, phaseId, duration, hasSlots, assignedToMe, dueWithin,
  } = await searchParams;
  const hidingCycleless = hideCycleless === "1";
  // "A Done confirmation gains a 'you might also like' strip" — see
  // docs/development-plan.md's Phase 56 and src/lib/onboarding.ts's
  // listTaskFitSuggestions, the exact same tag-overlap heuristic
  // onboarding's own first-login suggestions use, just excluding the
  // task that was just finished rather than reusing it as an anchor.
  const relatedToFinished = done ? await listTaskFitSuggestions(viewing, { excludeTaskId: done, limit: 3 }) : [];
  const sortByFit = fit === "1";

  // The board's own cycle scope (docs/development-plan.md's Phase 67)
  // — the same off-URL resolution Messages/Contribution/the task
  // detail page already read, since the board isn't itself under
  // /[cycleScope]/. "active" resolves to every cycle the member is
  // actually coming to (the switcher's own aggregate definition);
  // narrowed to one specific — open or closed — cycle when the
  // switcher is pointed at it.
  const activeScopeSegment = await resolveDefaultScopeSegment(viewing);
  const activeScope = await resolveViewScopeFromSegment(viewing, activeScopeSegment);
  const scopeCycleIds = activeScope
    ? activeScope.kind === "aggregate"
      ? activeScope.cycles.map((c) => c.id)
      : [activeScope.cycle.id]
    : [];

  const [
    branches,
    tasks,
    tierNames,
    myPendingRequests,
    allTags,
    coordinationScope,
    canExport,
    isCoordinator,
    communityRow,
    phases,
    backstopHolders,
    myBackstopScopes,
  ] = await Promise.all([
    db.select().from(branch).where(eq(branch.communityId, viewing.communityId)),
    listTasksWithAssignments(viewing, {
      branchId,
      tag,
      sortByFit,
      cycleScope: { cycleIds: scopeCycleIds, hideCycleless: hidingCycleless },
    }),
    tierNameLookup(viewing.communityId),
    listMyPendingJoinRequests(viewing),
    listDistinctTags(viewing),
    listCoordinationScopeIds(viewing),
    canInitiateCycle(viewing),
    isCoordinationHolder(viewing, null),
    getCommunityRow(viewing.communityId),
    scopeCycleIds.length === 0 ? Promise.resolve([]) : db.select().from(phase).where(inArray(phase.cycleId, scopeCycleIds)),
    listBackstopHoldersForScopes(
      viewing.communityId,
      hidingCycleless ? scopeCycleIds : [...scopeCycleIds, null],
    ),
    listBackstopScopesForMember(viewing),
  ]);

  // §5.3 (docs/cycle-scope-remediation-plan.md) — resolve coordination
  // from both dimensions: the viewer's own coverage (branch column OR
  // cycle row) drives the per-task markers and actions, and the
  // covering holder per scope in view feeds the task cards'
  // "Coordinated by {name}" tag for every viewer.
  const coordHolders = await listCoordinationHoldersForScopes(
    viewing.communityId,
    branches.map((b) => b.id),
    scopeCycleIds,
  );
  const isCoordinationHolderForTask = (t: BoardTask) =>
    coordinationScope.branchIds.has(t.branchId) ||
    (t.cycleId !== null && coordinationScope.cycleIds.has(t.cycleId));
  const coordinationNameFor = (t: BoardTask) =>
    coordHolders.byBranch.get(t.branchId)?.memberName ??
    (t.cycleId === null ? null : coordHolders.byCycle.get(t.cycleId)?.memberName ?? null);

  // "By phase" only makes sense once there's a real phase spine to show
  // — otherwise every task lands in one "No phase" card, no better than
  // kanban. Falls back to kanban server-side rather than rendering a
  // degenerate view if `view=phase` is requested anyway (e.g. a stale
  // bookmark from when phases were on).
  const phaseViewAvailable = communityRow.phasesEnabled && phases.length > 0;
  const dateDisplayMode = effectiveDateDisplayMode(viewing, communityRow);
  const visibleViews = VIEWS.filter((v) => {
    if (v === "phase") return phaseViewAvailable;
    return true;
  });
  const activeView: BoardView = visibleViews.includes(view as BoardView) ? (view as BoardView) : "unclaimed";
  // Export only ever targets one real cycle — same "the current one"
  // scoping /participation's own whole-cycle export always used, now
  // reading the switcher's own resolved single-cycle state instead of
  // getCurrentCycle()'s old community-wide heuristic. Unavailable
  // (not guessed at) while the switcher is narrowed to the multi-cycle
  // aggregate — the same "ambiguous, ask, don't guess" posture Phase
  // 65 already established for Budget/Event scheduling/Spatial
  // planning.
  const exportCycle = activeScope?.kind === "single" ? activeScope.cycle : null;
  const exportableInView = exportCycle ? tasks.filter((t) => t.cycleId === exportCycle.id) : [];

  // Advanced filters — applied in-memory over the already-fetched task
  // list, not pushed into listTasksWithAssignments's SQL. Each filter
  // is independent; they combine with AND logic.
  const now = new Date();
  const filteredTasks = tasks.filter((t) => {
    if (attention && t.attentionLevel !== attention) return false;
    if (phaseId && t.phaseId !== phaseId) return false;
    if (duration && t.effort !== "one_off") return false; // duration bucket only for one-off
    if (duration && (t.effortMagnitude as { duration?: string })?.duration !== duration) return false;
    if (hasSlots === "1") {
      const held = t.assignments.filter((a) => !a.isShadow).length;
      const cap = t.capacity ?? 1;
      if (held >= cap) return false;
    }
    if (assignedToMe === "1" && !t.assignments.some((a) => a.memberId === viewing.id && !a.isShadow)) return false;
    if (dueWithin) {
      const days = parseInt(dueWithin, 10);
      if (!t.deadlineDate) return false;
      const deadline = new Date(t.deadlineDate);
      const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      if (deadline > cutoff) return false;
    }
    return true;
  });

  // Shared query-preserving link builder for the fit/cycle-less/view
  // toggles below — a plain link, same "no client JS needed for
  // something a link can do" posture as everywhere else this codebase
  // avoids it. Each toggle only overrides its own param, carrying the
  // others through unchanged.
  function boardHref(overrides: {
    fit?: boolean;
    hideCycleless?: boolean;
    view?: BoardView;
    attention?: string | null;
    phaseId?: string | null;
    duration?: string | null;
    hasSlots?: boolean;
    assignedToMe?: boolean;
    dueWithin?: string | null;
  }) {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (tag) params.set("tag", tag);
    const nextFit = overrides.fit ?? sortByFit;
    const nextHideCycleless = overrides.hideCycleless ?? hidingCycleless;
    const nextView = overrides.view ?? activeView;
    const nextAttention = overrides.attention !== undefined ? overrides.attention : attention;
    const nextPhaseId = overrides.phaseId !== undefined ? overrides.phaseId : phaseId;
    const nextDuration = overrides.duration !== undefined ? overrides.duration : duration;
    const nextHasSlots = overrides.hasSlots ?? (hasSlots === "1");
    const nextAssignedToMe = overrides.assignedToMe ?? (assignedToMe === "1");
    const nextDueWithin = overrides.dueWithin !== undefined ? overrides.dueWithin : dueWithin;
    if (nextFit) params.set("fit", "1");
    if (nextHideCycleless) params.set("hideCycleless", "1");
    if (nextView !== "kanban") params.set("view", nextView);
    if (nextAttention) params.set("attention", nextAttention);
    if (nextPhaseId) params.set("phaseId", nextPhaseId);
    if (nextDuration) params.set("duration", nextDuration);
    if (nextHasSlots) params.set("hasSlots", "1");
    if (nextAssignedToMe) params.set("assignedToMe", "1");
    if (nextDueWithin) params.set("dueWithin", nextDueWithin);
    const query = params.toString();
    return query ? `/board?${query}` : "/board";
  }
  const fitToggleHref = boardHref({ fit: !sortByFit });
  const cyclelessToggleHref = boardHref({ hideCycleless: !hidingCycleless });
  const viewTabs = visibleViews.map((v) => ({ key: v, label: VIEW_LABEL[v] }));
  const phaseGroups = activeView === "phase" ? groupTasksByPhase(filteredTasks, phases) : [];
  const branchCoverageGroups = activeView === "coverage" ? groupTasksByBranchCoverage(filteredTasks, branches, coordinationScope.branchIds) : [];
  const phaseEndDateById = new Map(
    phases.map((p) => [p.id, p.endDate] as const).filter(([, d]) => d !== null) as Array<readonly [string, string]>,
  );
  const unclaimedQueue = sortUnclaimedQueue(
    filteredTasks.filter((t) => t.status === "unclaimed"),
    phaseEndDateById,
  );

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  // "Select and claim with exceptions" — bulk-claimable means an
  // unclaimed, Requirement-eligible, non-community_endorsed task within
  // the current filter. Self-assign-confirmation-gated tasks stay
  // selectable (defaulted on, like everything else) — they just fail
  // individually in the summary if actually claimed that way, same as
  // any other per-task failure, rather than silently skipping the check.
  const bulkClaimable = filteredTasks.filter(
    (t) => t.status === "unclaimed" && t.openness !== "community_endorsed" && t.unmetRequirements.length === 0,
  );

  // §5.5 (docs/cycle-scope-remediation-plan.md) backstop surfaces:
  // scopes in view that have a filled backstop mark their unclaimed
  // criticals "Backstop: {name}" (still open and claimable by anyone,
  // D5), and the scope's own backstop sees their scopes' critical tasks
  // as a duty segment. Nothing new is computed — this is the already-
  // loaded task/attention state rendered for one more role.
  const backstopNameFor = (t: BoardTask) =>
    t.critical && t.status === "unclaimed" ? (backstopHolders.get(t.cycleId)?.memberName ?? null) : null;
  const myVisibleBackstopScopes = new Set(
    myBackstopScopes.filter((c) => (c === null ? !hidingCycleless : scopeCycleIds.includes(c))),
  );
  const isDutyHolder = myVisibleBackstopScopes.size > 0;
  const dutyTasks = isDutyHolder
    ? tasks.filter((t) => t.critical && myVisibleBackstopScopes.has(t.cycleId))
    : [];

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Board"
        actions={
          <>
            <Link href="/propose" className={BUTTON_PRIMARY}>
              Propose a task
            </Link>
            <ActionMenu>
              {HUB_LINKS.map((l) => (
                <Link key={l.href} href={l.href}>
                  {l.label}
                </Link>
              ))}
              {isCoordinator &&
                COORDINATOR_HUB_LINKS.map((l) => (
                  <Link key={l.href} href={l.href}>
                    {l.label}
                  </Link>
                ))}
            </ActionMenu>
          </>
        }
        tabs={
          viewTabs.length > 1 ? (
            <Tabs tabs={viewTabs} active={activeView} hrefFor={(v) => boardHref({ view: v })} />
          ) : undefined
        }
      />

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

      {branches.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <BranchFilter branches={branches} selectedBranchId={branchId} />
          {allTags.length > 0 && <TagFilter tags={allTags} selectedTag={tag} />}
          <Link
            href={fitToggleHref}
            className={sortByFit ? "text-[13px] font-medium text-[var(--accent-1)]" : "text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"}
          >
            {sortByFit ? "✓ Sorted by what fits me" : "Sort by what fits me"}
          </Link>
          <Link
            href={cyclelessToggleHref}
            className={hidingCycleless ? "text-[13px] font-medium text-[var(--accent-1)]" : "text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"}
          >
            {hidingCycleless ? "✓ Hiding not-cycle-scoped tasks" : "Hide not-cycle-scoped tasks"}
          </Link>
        </div>
      )}

      {branches.length === 0 && (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          No branches yet — a current Admins holder can set up this Community&rsquo;s branches (and
          its first tasks) from the Settings screen.
        </p>
      )}

      {bulkClaimable.length > 1 && (
        <BulkClaimSelect claimable={bulkClaimable} branchNameById={branchNameById} />
      )}

      {canExport && !exportCycle && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Narrow the cycle switcher to one specific cycle to export a Task Pack — exporting
          doesn&rsquo;t guess which cycle you mean while it&rsquo;s scoped to &ldquo;All active
          cycles&rdquo;.
        </p>
      )}

      {canExport && exportCycle && exportableInView.length > 0 && (
        <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
            Export selected as a Task Pack ({exportableInView.length} in this view)
          </summary>
          <form action={exportSelectedTasksAsPackAction} className="mt-3 flex max-w-[420px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={exportCycle.id} />
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

      {/* Advanced filters — collapsed by default, in-memory over fetched list */}
      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
          Advanced filters
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <FilterSelect
            value={attention}
            param="attention"
            placeholder="Any attention"
            options={[
              { value: "soft", label: "Soft flag" },
              { value: "hard", label: "Hard flag" },
              { value: "escalated", label: "Escalated" },
            ]}
          />

          {phases.length > 0 && (
            <FilterSelect
              value={phaseId}
              param="phaseId"
              placeholder="Any phase"
              options={phases.map((p) => ({ value: p.id, label: p.name }))}
            />
          )}

          <FilterSelect
            value={duration}
            param="duration"
            placeholder="Any duration"
            options={[
              { value: "few_hours", label: "Few hours" },
              { value: "half_day", label: "Half day" },
              { value: "full_day", label: "Full day" },
              { value: "multi_day", label: "Multi-day" },
            ]}
          />

          <Link
            href={boardHref({ hasSlots: hasSlots !== "1" })}
            className={hasSlots === "1" ? "text-[13px] font-medium text-[var(--accent-1)]" : "text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"}
          >
            {hasSlots === "1" ? "✓ Has open slots" : "Has open slots"}
          </Link>

          <Link
            href={boardHref({ assignedToMe: assignedToMe !== "1" })}
            className={assignedToMe === "1" ? "text-[13px] font-medium text-[var(--accent-1)]" : "text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"}
          >
            {assignedToMe === "1" ? "✓ Assigned to me" : "Assigned to me"}
          </Link>

          <FilterSelect
            value={dueWithin}
            param="dueWithin"
            placeholder="Any deadline"
            options={[
              { value: "7", label: "Due within 7 days" },
              { value: "14", label: "Due within 14 days" },
              { value: "30", label: "Due within 30 days" },
            ]}
          />

          {(attention || phaseId || duration || hasSlots === "1" || assignedToMe === "1" || dueWithin) && (
            <Link href={boardHref({ attention: null, phaseId: null, duration: null, hasSlots: false, assignedToMe: false, dueWithin: null })} className="text-[13px] text-[var(--text-muted)] hover:text-[var(--danger)]">
              Clear all
            </Link>
          )}
        </div>
      </details>

      {isDutyHolder && (
        <section className="mt-6 rounded-[var(--radius-md)] border border-[var(--border)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
            <h2 className="text-[15px] font-semibold text-[var(--text)]">Backstop duty</h2>
            <span className="text-[12px] text-[var(--text-muted)]">
              The critical tasks your backstop covers — you&rsquo;re the named party responsible until each is moving.
            </span>
          </div>
          {dutyTasks.length === 0 && (
            <p className="mt-3 text-[13px] text-[var(--text-muted)]">No critical tasks in your scope right now.</p>
          )}
          <ul className="mt-3 flex flex-col gap-2">
            {dutyTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/tasks/${t.id}`}
                  className="text-[13px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
                >
                  {t.title}
                </Link>
                <Tag>{STATUS_LABEL[t.status] ?? t.status}</Tag>
                {t.attentionLevel !== "ok" && (
                  <Tag tone={ATTENTION_TONE[t.attentionLevel] ?? "neutral"}>
                    {ATTENTION_STYLES[t.attentionLevel]?.label ?? t.attentionLevel}
                  </Tag>
                )}
                {t.assignments.length === 0 && (
                  <span className="text-[12px] text-[var(--text-muted)]">
                    unclaimed — claimable by anyone
                    {backstopNameFor(t) ? `, backstop: ${backstopNameFor(t)}` : ""}
                  </span>
                )}
                {t.assignments.length > 0 && (
                  <span className="text-[12px] text-[var(--text-muted)]">
                    held by {t.assignments.map((a) => a.memberName).join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeView === "unclaimed" && (
        <div className="mt-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Attention queue
            </span>
            <Tag>{unclaimedQueue.length}</Tag>
          </div>
          {unclaimedQueue.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No unclaimed tasks in this scope — the queue is clear.
            </p>
          ) : (
            <ul className="space-y-3">
              {unclaimedQueue.map((t) => (
                <li key={t.id}>
                  <TaskCard
                    task={t}
                    assignments={t.assignments}
                    requirements={t.requirements}
                    unmetRequirements={t.unmetRequirements}
                    groupCoverage={t.groupCoverage}
                    tierNames={tierNames}
                    branchName={branchNameById.get(t.branchId) ?? "—"}
                    currentMemberId={viewing.id}
                    myPendingRequestId={myPendingRequests.get(t.id) ?? null}
                    isCoordinationHolderForTask={isCoordinationHolderForTask(t)}
                    coordinationName={coordinationNameFor(t)}
                    backstopName={backstopNameFor(t)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeView === "kanban" && (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.status);
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
                    isCoordinationHolderForTask={isCoordinationHolderForTask(t)}
                    coordinationName={coordinationNameFor(t)}
                    backstopName={backstopNameFor(t)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {activeView === "phase" && (
        <div className="mt-6">
          {phaseGroups.map((group) => (
            <PhaseCard
              key={group.name}
              group={group}
              dateDisplayMode={dateDisplayMode}
              tierNames={tierNames}
              branchNameById={branchNameById}
              currentMemberId={viewing.id}
              myPendingRequests={myPendingRequests}
              isCoordinationHolderForTask={isCoordinationHolderForTask}
              coordinationNameFor={coordinationNameFor}
              backstopNameFor={backstopNameFor}
            />
          ))}
        </div>
      )}

      {activeView === "coverage" && (
        <div className="mt-6">
          {branchCoverageGroups.map((group) => (
            <BranchCoverageCard
              key={group.branchId}
              group={group}
              tierNames={tierNames}
              branchNameById={branchNameById}
              currentMemberId={viewing.id}
              myPendingRequests={myPendingRequests}
              isCoordinationHolderForTask={isCoordinationHolderForTask}
              coordinationNameFor={coordinationNameFor}
              backstopNameFor={backstopNameFor}
            />
          ))}
        </div>
      )}
    </main>
  );
}
