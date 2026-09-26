import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import {
  RESPONSE_TYPES,
  RESPONSE_TYPE_LABELS,
  formatFieldValue,
  isChoiceType,
} from "@/lib/field-shape";
import {
  getGroupCoverageStatus,
  getParentTaskSummary,
  getTask,
  getTaskNotes,
  getUnmetRequirements,
  isAuthorizedToNominate,
  listCandidacies,
  listJoinRequests,
  listMyEndorsements,
  listMyPings,
  listNominationsForTask,
  listPings,
  listRequirements,
  listSignals,
  listSubtasks,
  listTaskDependencies,
  listTaskMilestones,
  listTasks,
  tierNameLookup,
  describeRequirement,
} from "@/lib/tasks";
import { getCommunity, isAdmin, listBranches } from "@/lib/settings";
import {
  allowsMultipleGrants,
  describeGrantScope,
  isMisplacedCommunityGrant,
  listGrantsWithTaskInfo,
  listModuleKeysGrantedByTask,
  PERMISSION_MODULE_LABELS,
  TASK_GRANTABLE_PERMISSION_MODULE_KEYS,
  type PermissionModuleKey,
} from "@/lib/permissions";
import { getCycle, listCycles, resolveCrossCycleContext, scopeLabel } from "@/lib/cycles";
import { isModuleEnabled } from "@/lib/modules";
import { describeBoundaryRecipe, effectiveDateDisplayMode, formatDateLabel } from "@/lib/dates";
import { isShiftManagerForScope } from "@/lib/shifts";
import { switchToLinkedScopeAction } from "@/app/(app)/cycles/scope-actions";
import CopyLinkButton from "@/components/CopyLinkButton";
import EffortFields from "@/components/EffortFields";
import DateModeField, { type DateFieldBase } from "@/components/DateModeField";
import PageHeader from "@/components/ui/PageHeader";
import ActionMenu from "@/components/ui/ActionMenu";
import StatusIcon from "@/components/tasks/StatusIcon";
import { BranchChip, CapacityChip, CycleChip, EffortChip } from "@/components/tasks/MetaChips";
import { listTaskQuestions } from "@/lib/input-rounds";
import { isAuthorizedToWaive, isCoordinationHolder } from "@/lib/coordination";
import { resolveBackstopHolder } from "@/lib/backstop";
import { getAccompaniedMemberId } from "@/lib/recruitment";
import { computeEngagementPattern } from "@/lib/engagement";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import { FlagIcon, QuestionIcon } from "@phosphor-icons/react/dist/ssr";
import { Tag, type Tone, ATTENTION_TONE, Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_GHOST, BUTTON_ICON, CheckField, INPUT } from "@/components/ui/kit";
import {
  acceptJoinRequestAction,
  addCommentAction,
  addDependencyAction,
  addMilestoneAction,
  addRequirementAction,
  addResourceAction,
  checkInTaskAction,
  claimAction,
  claimAsShadowAction,
  confirmClaimAction,
  confirmMilestoneAction,
  createQuestionAction,
  createSignalAction,
  deescalateTaskAction,
  declineJoinRequestAction,
  deleteMilestoneAction,
  deleteRequirementAction,
  editWikiAction,
  endorseCandidacyAction,
  escalateTaskAction,
  expressCandidacyAction,
  finishAction,
  finishWaitingTaskAction,
  flagForGroupAction,
  parkAction,
  pingCoordinatorAction,
  releaseAction,
  removeDependencyAction,
  resnoozeTaskAction,
  resolvePingAction,
  resolveSignalAction,
  resumeAction,
  rotateIntoShiftAction,
  setOutgoingAction,
  splitSubtaskAction,
  stopShadowingAction,
  suggestSomeoneAction,
  updateMilestoneAction,
  updateRequirementAction,
  updateTaskAction,
  updateTaskPermissionGrantsAction,
  waiveAndClaimAction,
  withdrawCandidacyAction,
  withdrawJoinRequestAction,
  nominateForTaskAction,
} from "./actions";

const SIGNAL_LABELS: Record<string, string> = {
  stalled: "looks stalled",
  might_need_help: "owner might need help",
  something_feels_off: "something feels off",
  worth_a_look: "worth a coordinator look",
};

const NOMINATION_STATUS_LABEL: Record<string, string> = {
  pending: "pending response",
  accepted: "confirmed",
  declined: "declined",
  not_now: "not right now",
  expired: "expired — released",
};
const NOMINATION_STATUS_TONE: Record<string, Tone> = {
  pending: "warning",
  accepted: "success",
  declined: "danger",
  not_now: "neutral",
  expired: "danger",
};

const ENGAGEMENT_LABEL: Record<string, string> = {
  noted: "noted",
  soft_flag: "soft flag",
  pattern: "pattern — worth a conversation",
};
const ENGAGEMENT_TONE: Record<string, Tone> = { noted: "neutral", soft_flag: "warning", pattern: "danger" };

// Small heading used throughout for every one of this page's many
// conditionally-rendered sections — different tasks pull in wildly
// different combinations of these (a plain one-off task shows barely
// any; a community_endorsed, coordination-gated, shift-eligible task
// shows nearly all of them) so the section itself, not a fixed layout,
// is what has to carry the visual structure.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// Same zero-JS "?tab= + shared Tabs bar" pattern settings/page.tsx uses
// (src/components/ui/Tabs.tsx) — no client component needed since every
// tab's content is just conditionally rendered server-side off
// The tab bar this page used to have is gone — the task UI grammar
// (docs/design_handoff_conventions/README.md) lays the page out as a
// main column + reference rail, with Notes inline (spec: never behind
// a toggle) and People/Coordination/Subtasks as plain sections gated on
// the same showPeopleTab/showCoordinationTab/showSubtasksTab booleans
// the tabs used. Old ?tab= links are accepted and ignored.

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; scope?: string; tab?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  // `tab` is accepted but ignored — the tab bar is gone (see the note
  // above); old bookmarks still land on the right page.
  const { error, scope: scopeParam } = await searchParams;

  const taskRow = await getTask(viewing, id);
  const isCommunityEndorsed = taskRow.openness === "community_endorsed";
  const [
    branchRow,
    notes,
    requirements,
    unmetRequirements,
    tierNames,
    subtasks,
    parentTask,
    branches,
    joinRequests,
    candidacies,
    isCoordHolderForBranch,
    authorizedToWaive,
    authorizedToNominate,
    myPings,
    communityMembers,
    questions,
    communityRow,
    milestones,
    taskCycle,
    nominations,
    dependencies,
    allCommunityTasks,
  ] = await Promise.all([
    db.select().from(branch).where(eq(branch.id, taskRow.branchId)).then((r) => r[0]),
    getTaskNotes(viewing, id),
    listRequirements(viewing, id),
    getUnmetRequirements(db, viewing, id),
    tierNameLookup(viewing.communityId),
    listSubtasks(viewing, id),
    taskRow.parentTaskId ? getParentTaskSummary(viewing, taskRow.parentTaskId) : null,
    listBranches(viewing),
    listJoinRequests(viewing, id),
    isCommunityEndorsed ? listCandidacies(viewing, id) : [],
    isCoordinationHolder(viewing, { branchId: taskRow.branchId, cycleId: taskRow.cycleId }),
    isAuthorizedToWaive(viewing, { branchId: taskRow.branchId, cycleId: taskRow.cycleId }, id),
    isAuthorizedToNominate(viewing, { id, branchId: taskRow.branchId, cycleId: taskRow.cycleId }),
    listMyPings(viewing, id),
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
    listTaskQuestions(viewing, id),
    getCommunity(viewing),
    listTaskMilestones(viewing, id),
    taskRow.cycleId ? getCycle(viewing, taskRow.cycleId) : Promise.resolve(null),
    listNominationsForTask(viewing, id),
    listTaskDependencies(viewing, id),
    listTasks(viewing),
  ]);
  const cyclePhases = taskCycle?.phases ?? [];
  const dateDisplayMode = effectiveDateDisplayMode(viewing, communityRow);
  const phaseById = new Map(cyclePhases.map((p) => [p.id, p]));
  const milestoneDateLabel = (m: (typeof milestones)[number]) => {
    const parentPhase = m.parentType === "phase" ? phaseById.get(m.phaseId ?? taskRow.phaseId ?? "") : undefined;
    const period =
      m.dateType === "relative" && parentPhase?.startDate && parentPhase.endDate
        ? { name: parentPhase.name, startDate: parentPhase.startDate, endDate: parentPhase.endDate }
        : m.dateType === "relative" && taskCycle?.startDate && taskCycle.endDate
          ? { name: taskCycle.name, startDate: taskCycle.startDate, endDate: taskCycle.endDate, cycleName: taskCycle.name }
          : null;
    return formatDateLabel(m.resolvedDate, dateDisplayMode, period);
  };
  const crossCycle = await resolveCrossCycleContext(viewing, taskCycle, scopeParam ?? null);
  const taskPath = `/tasks/${taskRow.id}`;
  const tierOptions = [...tierNames.entries()].map(([tId, name]) => ({ id: tId, name }));
  const communityTasks = allCommunityTasks
    .filter((t) => t.id !== taskRow.id)
    .map((t) => ({ id: t.id, title: t.title }));
  const dependencyOptions = communityTasks.filter(
    (t) => !dependencies.some((d) => d.dependsOnTaskId === t.id),
  );

  // For the "Edit task" panel's Cycle select — open to any member (same
  // "Requirements/Dependencies are open to any member" posture the
  // comment just below this one describes for the rest of the page),
  // so fetched unconditionally rather than gated behind
  // canGrantPermissions the way the Permissions section's own
  // admin-only cycle list is.
  const allCycles = communityRow.cyclesEnabled ? await listCycles(viewing) : [];

  // "Permissions granted by this task" (docs/development-plan.md's
  // Phase 64) reads/writes the exact same PermissionGrant rows the
  // settings panel's Access & permissions tab does — visibility and
  // the underlying write path are both Admin-only here too, a
  // genuinely stricter gate than the rest of this page's editing
  // surface (Requirements/Dependencies are open to any member; see
  // updateTaskPermissionGrantsAction in ./actions.ts for the server-
  // side enforcement this mirrors).
  const canGrantPermissions = await isAdmin(viewing);
  const [communityGrants, grantedByThisTask] = canGrantPermissions
    ? await Promise.all([
        listGrantsWithTaskInfo(taskRow.communityId),
        listModuleKeysGrantedByTask(taskRow.communityId, taskRow.id),
      ])
    : [[], new Set<PermissionModuleKey>()];
  // The "currently held elsewhere" warning below is keyed against this
  // task's *own* placement (taskRow.cycleId — the one scope read,
  // docs/cycle-scope-remediation-plan.md §2.1): a grant in a different
  // cycle isn't in this task's scope at all, so checking the same
  // module here creates a second, coexisting grant instead of moving
  // it.
  const elsewhereHolderByModule = new Map<PermissionModuleKey, string>();
  for (const g of communityGrants) {
    if (g.taskId === taskRow.id || allowsMultipleGrants(g.moduleKey)) continue;
    if (g.cycleId !== taskRow.cycleId) continue;
    elsewhereHolderByModule.set(g.moduleKey, g.title);
  }

  const groupCoverage = await getGroupCoverageStatus(db, id, requirements);
  const shiftsModuleOn = isModuleEnabled(communityRow, "shifts");
  // D10 (§4.8) — rotateTaskIntoShift creates a *standing* series, which
  // is the standing scope's shift manager's act; holding the source task
  // no longer grants it. Show the action to whoever can actually take it.
  const isStandingShiftManager = shiftsModuleOn && (await isShiftManagerForScope(viewing, null));
  const myEndorsements = isCommunityEndorsed
    ? await listMyEndorsements(
        viewing,
        candidacies.map((c) => c.id),
      )
    : new Set<string>();
  // Signals and pings are only visible to that branch's coordination
  // holders — see docs/spec.md's "Anonymous task signal" and "Talk to
  // my coordinator" (Coordination mechanics) — checked up front instead
  // of relying on listSignals()/listPings() throwing, matching how
  // canApproveRequests is checked elsewhere on this page.
  const [signals, pings] = isCoordHolderForBranch
    ? await Promise.all([listSignals(viewing, id), listPings(viewing, id)])
    : [[], []];

  // A shadow isn't a real holder — see lifecycle.ts's assignmentCount(),
  // which excludes shadow rows for the same reason (docs/spec.md's
  // "Shadow slots & succession": doesn't count toward capacity, isn't
  // who "Held by" means).
  const realAssignments = taskRow.assignments.filter((a) => !a.isShadow);
  const shadowAssignments = taskRow.assignments.filter((a) => a.isShadow);
  const myAssignment = taskRow.assignments.find((a) => a.memberId === viewing.id);
  const holdsTask = realAssignments.some((a) => a.memberId === viewing.id);
  // "The accompanier gets explicit... visibility into the new member's
  // engagement record" — see docs/spec.md's Recruitment and
  // docs/development-plan.md's Phase 52. Only ever resolves to
  // something when this task actually is an Accompaniment task (see
  // getAccompaniedMemberId's own comment) and the viewer currently
  // holds it — access follows the task, same as every other
  // coordination-facing surface here.
  const accompaniedMemberId = holdsTask ? await getAccompaniedMemberId(taskRow.id) : null;
  const accompanimentEngagement = accompaniedMemberId
    ? await computeEngagementPattern(accompaniedMemberId, viewing.communityId)
    : null;
  const isShadowing = myAssignment?.isShadow === true;
  const canShadow =
    !holdsTask && !isShadowing && (taskRow.status === "claimed" || taskRow.status === "waiting");
  const requestGated = taskRow.openness === "request" || taskRow.openness === "coordination_approved";
  const coordinationHolders = taskRow.assignments.filter((a) => a.isCoordinationSlot);
  const canApproveRequests =
    holdsTask &&
    (taskRow.openness !== "coordination_approved" ||
      coordinationHolders.length === 0 ||
      coordinationHolders.some((a) => a.memberId === viewing.id));
  const pendingRequests = joinRequests.filter((r) => r.status === "pending");
  const resolvedRequests = joinRequests.filter((r) => r.status !== "pending");
  const myRequest = joinRequests.find((r) => r.memberId === viewing.id);

  const browseWindowOpen = Boolean(
    taskRow.browsePeriodEnd && taskRow.browsePeriodEnd.getTime() > Date.now(),
  );
  const myCandidacy = candidacies.find((c) => c.memberId === viewing.id);
  const openCandidacies = candidacies.filter((c) => c.status === "open");
  const resolvedCandidacies = candidacies.filter((c) => c.status !== "open");
  const canExpressCandidacy =
    isCommunityEndorsed && browseWindowOpen && !holdsTask && !myCandidacy;

  // Self-assign confirmation check — see docs/spec.md's Coordination
  // mechanics. Mirrors TaskCard.tsx's board-side gating exactly; the
  // server (join-requests.ts's claimOrRequestToJoin) is what actually
  // enforces it either way.
  const hasRoom = taskRow.capacity === null || realAssignments.length < taskRow.capacity;
  const flagged = taskRow.attentionLevel !== "ok";
  const canActBase =
    !isCommunityEndorsed &&
    !isShadowing &&
    !holdsTask &&
    (taskRow.status === "unclaimed" || (taskRow.status === "claimed" && hasRoom)) &&
    unmetRequirements.length === 0 &&
    !(myRequest && myRequest.status === "pending");
  const needsSelfAssignConfirmation =
    canActBase && isCoordHolderForBranch && (taskRow.status === "unclaimed" || flagged);

  const openSignals = signals.filter((s) => !s.resolvedAt);
  const resolvedSignals = signals.filter((s) => s.resolvedAt);
  const openPings = pings.filter((p) => !p.resolvedAt);
  const resolvedPings = pings.filter((p) => p.resolvedAt);
  const myOpenPing = myPings.find((p) => !p.resolvedAt);
  // "Only a current holder can ping their coordinator" — see
  // coordinator-ping.ts's pingCoordinator().
  const canPingCoordinator = holdsTask && !myOpenPing;
  const canWaive =
    authorizedToWaive &&
    requirements.length > 0 &&
    (taskRow.status === "unclaimed" || (taskRow.status === "claimed" && hasRoom));
  // "An existing owner can also nominate a specific person for an open
  // slot" — see docs/spec.md's Multi-slot & collaborative tasks and
  // src/lib/tasks/nominations.ts. Same room check as canWaive/canActBase;
  // never offered on a community_endorsed task (candidacy is the only
  // door there).
  const canNominate =
    authorizedToNominate &&
    !isCommunityEndorsed &&
    (taskRow.status === "unclaimed" || (taskRow.status === "claimed" && hasRoom));

  // communityMembers (fetched above for the waive/suggest selects)
  // already covers every member who could plausibly show up by name
  // anywhere on this page — no need for a second, narrower lookup.
  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));

  const unmetIds = new Set(unmetRequirements.map((r) => r.id));
  const attention = ATTENTION_STYLES[taskRow.attentionLevel];

  // §5.5 — an unclaimed critical names its scope's backstop while
  // staying open and claimable by anyone ("Backstop: {name}" marker,
  // the same one the board's TaskCard renders). Null when the scope has
  // no backstop yet or the task is already being worked.
  const scopeBackstopName =
    taskRow.critical && taskRow.status === "unclaimed"
      ? ((await resolveBackstopHolder(communityRow.id, taskRow.cycleId))?.name ?? null)
      : null;

  const schedulePollHref = `/scheduling-polls/new?branchId=${taskRow.branchId}&title=${encodeURIComponent(taskRow.title)}`;

  // Same visibility condition each section below already gates on —
  // the tab is only offered when its content would actually show
  // something.
  const showPeopleTab =
    isCommunityEndorsed || ((pendingRequests.length > 0 || resolvedRequests.length > 0) && requestGated);
  const showCoordinationTab =
    (!!accompaniedMemberId && !!accompanimentEngagement) ||
    nominations.length > 0 ||
    (isCoordHolderForBranch && (openPings.length > 0 || resolvedPings.length > 0));
  const showSubtasksTab = subtasks.length > 0 || holdsTask;

  // ── Task UI grammar: one primary action in the header ────────────
  // When a contextual nudge panel is showing (attention-flagged claimed,
  // or any waiting state) it carries the state-appropriate actions just
  // below the header, so the header primary is suppressed to avoid
  // duplicating them. Self-assign confirmation likewise lives in its own
  // contextual banner, not the header.
  const nudgePanelShown = holdsTask && (taskRow.status === "waiting" || (taskRow.status === "claimed" && flagged));
  const joiningRequiresRequest = requestGated && taskRow.status === "claimed" && realAssignments.length > 0;
  let primaryHeaderAction: React.ReactNode = null;
  if (!nudgePanelShown && !needsSelfAssignConfirmation) {
    if (canActBase) {
      primaryHeaderAction = (
        <form action={claimAction}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit" className={BUTTON_PRIMARY}>
            {joiningRequiresRequest ? "Request to join" : "Claim"}
          </button>
        </form>
      );
    } else if (holdsTask && taskRow.status === "claimed") {
      primaryHeaderAction = (
        <form action={finishAction}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit" className={BUTTON_PRIMARY}>
            Finish
          </button>
        </form>
      );
    }
  }

  // ⋯ menu contents — the secondary/tertiary actions. Park isn't here:
  // it needs inputs, so it's a disclosure in the Status rail card.
  const menuItems: React.ReactNode[] = [];
  if (canShadow) {
    menuItems.push(
      <form action={claimAsShadowAction}>
        <input type="hidden" name="taskId" value={taskRow.id} />
        <button type="submit">Shadow this task</button>
      </form>,
    );
  }
  if (isShadowing) {
    menuItems.push(
      <form action={stopShadowingAction}>
        <input type="hidden" name="taskId" value={taskRow.id} />
        <button type="submit">Stop shadowing</button>
      </form>,
    );
  }
  if (holdsTask) {
    menuItems.push(
      <form action={setOutgoingAction}>
        <input type="hidden" name="taskId" value={taskRow.id} />
        <input type="hidden" name="outgoing" value={(!myAssignment?.isOutgoing).toString()} />
        <button type="submit">{myAssignment?.isOutgoing ? "Unmark as outgoing" : "Mark yourself as outgoing"}</button>
      </form>,
    );
    if (!flagged && taskRow.status === "claimed") {
      menuItems.push(
        <form action={releaseAction}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit">Release</button>
        </form>,
      );
    }
  }
  if (isStandingShiftManager) {
    menuItems.push(
      <form action={rotateIntoShiftAction}>
        <input type="hidden" name="taskId" value={taskRow.id} />
        <button type="submit">Rotate this task into a shift</button>
      </form>,
    );
  }
  if (canPingCoordinator) {
    menuItems.push(
      <form action={pingCoordinatorAction}>
        <input type="hidden" name="taskId" value={taskRow.id} />
        <button type="submit">Talk to my coordinator</button>
      </form>,
    );
  }
  if (isCoordHolderForBranch) {
    menuItems.push(
      taskRow.attentionLevel !== "escalated" ? (
        <form action={escalateTaskAction}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit">Escalate</button>
        </form>
      ) : (
        <form action={deescalateTaskAction}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit">De-escalate</button>
        </form>
      ),
    );
  }

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-10 md:px-12 md:py-14">
      <Link href="/board" className="text-[13px] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to board
      </Link>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      {crossCycle.linkedScope && (
        <div className="mt-4">
          <Banner tone="warning">
            <p>
              This link was shared while scoped to <strong>{scopeLabel(crossCycle.linkedScope.scope)}</strong> —
              your own current view is <strong>{scopeLabel(crossCycle.activeScope)}</strong>.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <form action={switchToLinkedScopeAction}>
                <input type="hidden" name="scope" value={crossCycle.linkedScope.segment} />
                <input type="hidden" name="returnTo" value={taskPath} />
                <button type="submit" className={BUTTON_PRIMARY}>
                  Switch my view to match
                </button>
              </form>
              <Link href={taskPath} className={BUTTON_SECONDARY}>
                Stay on my view
              </Link>
            </div>
          </Banner>
        </div>
      )}

      {crossCycle.mismatchedObjectCycle && (
        <div className="mt-4">
          <Banner tone="warning">
            This task belongs to <strong>{crossCycle.mismatchedObjectCycle.name}</strong>, outside your current
            view (<strong>{scopeLabel(crossCycle.activeScope)}</strong>).
          </Banner>
        </div>
      )}

      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {taskRow.title}
            {taskRow.critical && <Tag tone="danger">critical</Tag>}
            {attention && <Tag tone={ATTENTION_TONE[taskRow.attentionLevel] ?? "neutral"}>{attention.label}</Tag>}
            {scopeBackstopName && <Tag tone="danger">Backstop: {scopeBackstopName}</Tag>}
          </span>
        }
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <StatusIcon status={taskRow.status} attentionLevel={taskRow.attentionLevel} showLabel />
            <BranchChip name={branchRow?.name ?? "—"} />
            <EffortChip summary={effortSummary(taskRow.effort, taskRow.effortMagnitude)} />
            <CapacityChip held={realAssignments.length} capacity={taskRow.capacity} />
            {communityRow.cyclesEnabled && <CycleChip name={taskCycle ? taskCycle.name : "not event-scoped"} />}
          </div>
        }
        actions={
          <>
            {primaryHeaderAction}
            {menuItems.length > 0 && (
              <ActionMenu>{menuItems.map((item, i) => <span key={i}>{item}</span>)}</ActionMenu>
            )}
            <CopyLinkButton
              path={taskPath}
              scopedPath={`${taskPath}?scope=${crossCycle.activeScopeSegment}`}
              scopedLabel={scopeLabel(crossCycle.activeScope)}
            />
            <Link
              href={schedulePollHref}
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
              title="Find a time"
            >
              <CalendarIcon />
              <span className="hidden sm:inline">Find a time</span>
            </Link>
          </>
        }
      />
      {parentTask && (
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Part of{" "}
          <Link href={`/tasks/${parentTask.id}`} className="font-medium text-[var(--accent-1)] hover:underline">
            {parentTask.title}
          </Link>
        </p>
      )}
      {taskRow.description && <p className="mt-3 text-[14px] text-[var(--text)]">{taskRow.description}</p>}

      {/* Edit task — the only place a task's core details (title,
          description, branch, cycle, phase, effort, capacity, critical,
          tags) and its Requirements/Dependencies management live; kept
          closed by default so the page reads as a status/notes view.
          Any member can adjust these, the same "Requirements/Depen-
          dencies are open to any member" posture this page already
          had — the controls just moved in here. */}
      <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
        <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">Edit task</summary>

        <form action={updateTaskAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="taskId" value={taskRow.id} />
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">Title</span>
            <input type="text" name="title" defaultValue={taskRow.title} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">Description</span>
            <textarea name="description" rows={3} defaultValue={taskRow.description ?? ""} className={INPUT} />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--text-muted)]">Branch</span>
              <select name="branchId" defaultValue={taskRow.branchId} key={taskRow.branchId} className={INPUT}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {communityRow.cyclesEnabled && (
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-[var(--text-muted)]">Event</span>
                <select name="cycleId" defaultValue={taskRow.cycleId ?? ""} key={taskRow.cycleId ?? ""} className={INPUT}>
                  <option value="">No event (unscoped)</option>
                  {allCycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--text-muted)]">Phase</span>
              <select name="phaseId" defaultValue={taskRow.phaseId ?? ""} key={taskRow.phaseId ?? ""} className={INPUT}>
                <option value="">No phase</option>
                {cyclePhases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--text-muted)]">Effort</span>
              <div className="flex flex-wrap items-center gap-2">
                <EffortFields
                  defaultEffort={taskRow.effort}
                  defaultDuration={(taskRow.effortMagnitude as { duration?: string } | null | undefined)?.duration}
                  defaultHoursPerWeek={
                    (taskRow.effortMagnitude as { hours_per_week?: number } | null | undefined)?.hours_per_week
                  }
                />
              </div>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-[var(--text-muted)]">Capacity (blank = uncapped)</span>
              <input type="number" name="capacity" min={1} defaultValue={taskRow.capacity ?? ""} className={`${INPUT} w-24`} />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input type="checkbox" name="critical" defaultChecked={taskRow.critical} /> Critical
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">Tags (comma-separated)</span>
            <input type="text" name="tags" defaultValue={(taskRow.tags ?? []).join(", ")} className={INPUT} />
          </label>

          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Save changes
          </button>
        </form>

        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-[13px] font-medium text-[var(--text)]">Requirements</p>
          {requirements.length === 0 && <p className="mt-1 text-[12px] text-[var(--text-muted)]">None yet.</p>}
          <ul className="mt-2 flex flex-col gap-2">
            {requirements.map((r) => {
              const value = r.value as { tierId?: string; language?: string; taskId?: string; flag?: string };
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--text)]">
                  <span>{describeRequirement(r, tierNames)}</span>
                  <details>
                    <summary className="cursor-pointer text-[12px] text-[var(--accent-1)]">Edit</summary>
                    <form action={updateRequirementAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="taskId" value={taskRow.id} />
                      <input type="hidden" name="requirementId" value={r.id} />
                      <input type="hidden" name="requirementType" value={r.type} />
                      {r.type === "tier" && (
                        <select name="requirementTierId" defaultValue={value.tierId ?? ""} key={value.tierId ?? ""} className={INPUT}>
                          <option value="">Tier…</option>
                          {tierOptions.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {r.type === "language" && (
                        <input type="text" name="requirementLanguage" defaultValue={value.language ?? ""} className={INPUT} />
                      )}
                      {r.type === "completed_task" && (
                        <select name="requirementCompletedTaskId" defaultValue={value.taskId ?? ""} key={value.taskId ?? ""} className={INPUT}>
                          <option value="">Task…</option>
                          {communityTasks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.title}
                            </option>
                          ))}
                        </select>
                      )}
                      {r.type === "custom" && (
                        <input type="text" name="requirementFlag" defaultValue={value.flag ?? ""} className={INPUT} />
                      )}
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Update
                      </button>
                    </form>
                  </details>
                  <form action={deleteRequirementAction}>
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="requirementId" value={r.id} />
                    <button type="submit" className={BUTTON_GHOST}>
                      Remove
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>

          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">Add a requirement</summary>
            <form action={addRequirementAction} className="mt-2 flex max-w-[420px] flex-col gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <div className="flex flex-wrap items-center gap-2">
                <select name="requirementType" required defaultValue="" className={INPUT}>
                  <option value="" disabled>
                    Type…
                  </option>
                  <option value="tier">Tier</option>
                  <option value="language">Language</option>
                  <option value="completed_task">Completed a specific task</option>
                  <option value="custom">Custom flag</option>
                </select>
                <select name="requirementMode" defaultValue="individual_gate" className={INPUT}>
                  <option value="individual_gate">Individual gate</option>
                  <option value="group_coverage">Group coverage</option>
                  <option value="soft_priority">Soft priority</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <select name="requirementTierId" defaultValue="" className={INPUT}>
                  <option value="">Tier…</option>
                  {tierOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                (if type = tier)
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <input type="text" name="requirementLanguage" placeholder="language" className={INPUT} />
                (if type = language)
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <select name="requirementCompletedTaskId" defaultValue="" className={INPUT}>
                  <option value="">Task…</option>
                  {communityTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                (if type = completed task)
              </label>
              <label className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <input type="text" name="requirementFlag" placeholder="custom flag" className={INPUT} />
                (if type = custom)
              </label>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Add
              </button>
            </form>
          </details>
        </div>

        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-[13px] font-medium text-[var(--text)]">Dependencies</p>
          {dependencies.length === 0 && <p className="mt-1 text-[12px] text-[var(--text-muted)]">None.</p>}
          <ul className="mt-2 flex flex-col gap-1.5">
            {dependencies.map((d) => (
              <li key={d.dependsOnTaskId} className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text)]">
                <Link href={`/tasks/${d.dependsOnTaskId}`} className="font-medium text-[var(--accent-1)] hover:underline">
                  {d.title}
                </Link>
                <span className="text-[var(--text-muted)]">({d.status})</span>
                <form action={removeDependencyAction}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="dependsOnTaskId" value={d.dependsOnTaskId} />
                  <button type="submit" className={BUTTON_GHOST}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>

          {dependencyOptions.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">Add dependencies</summary>
              <form action={addDependencyAction} className="mt-2 flex max-w-[420px] flex-col gap-2">
                <input type="hidden" name="taskId" value={taskRow.id} />
                <select name="dependsOnTaskIds" multiple className={`${INPUT} h-32`}>
                  {dependencyOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Add
                </button>
              </form>
            </details>
          )}
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <details className="group">
          <summary
            className={`${BUTTON_ICON} list-none [&::-webkit-details-marker]:hidden`}
            title="Signal something / flag for coordination"
          >
            <FlagIcon size={18} />
          </summary>
          <div className="mt-2 w-[min(90vw,420px)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <p className="text-[13px] font-medium text-[var(--text)]">Signal something</p>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              A quiet, anonymous nudge to that branch&rsquo;s coordination — no detail required, and
              nothing here says it was you.
            </p>
            <form action={createSignalAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <select name="kind" defaultValue="worth_a_look" className={INPUT}>
                {Object.entries(SIGNAL_LABELS).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
              <button type="submit" className={BUTTON_PRIMARY}>
                Send signal
              </button>
            </form>

            {isCoordHolderForBranch && (
              <div className="mt-3">
                {openSignals.length === 0 && <p className="text-[13px] text-[var(--text-muted)]">No open signals.</p>}
                {openSignals.map((s) => (
                  <div key={s.id} className="mb-1.5 flex items-center gap-2 text-[13px] text-[var(--text)]">
                    <span>
                      {SIGNAL_LABELS[s.kind] ?? s.kind} — {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                    <form action={resolveSignalAction}>
                      <input type="hidden" name="taskId" value={taskRow.id} />
                      <input type="hidden" name="signalId" value={s.id} />
                      <button type="submit" className={BUTTON_GHOST}>
                        Dismiss
                      </button>
                    </form>
                  </div>
                ))}
                {resolvedSignals.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
                      Dismissed signals ({resolvedSignals.length})
                    </summary>
                    <ul className="mt-2 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
                      {resolvedSignals.map((s) => (
                        <li key={s.id}>{SIGNAL_LABELS[s.kind] ?? s.kind}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        </details>

        <details className="group">
          <summary
            className={`${BUTTON_ICON} list-none [&::-webkit-details-marker]:hidden`}
            title="Questions"
          >
            <QuestionIcon size={18} />
          </summary>
          <div className="mt-2 w-[min(90vw,520px)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <p className="text-[13px] font-medium text-[var(--text)]">Questions</p>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              Anyone can ask something tied to this task — it queues silently and bundles into the
              next Input round, no ping sent now. Answers stay visible here once the round&rsquo;s open.
            </p>

            {questions.length === 0 && <p className="mt-3 text-[13px] text-[var(--text-muted)]">No questions yet.</p>}
            <div className="mt-3">
              {questions.map((q) => {
                // Answers that aren't any listed option — only reachable
                // when a question has the escape hatch on. Counted as
                // their own row rather than dropped, for the same reason
                // the Assembly tally does it: a member reading
                // "north: 1, south: 0" would otherwise conclude two
                // people hadn't answered when in fact one had, in their
                // own words.
                const otherCount = q.allowOther
                  ? q.responses.filter((r) =>
                      (Array.isArray(r.value) ? r.value : [r.value]).some(
                        (x) => typeof x === "string" && !q.options.includes(x),
                      ),
                    ).length
                  : 0;
                const tally = isChoiceType(q.responseType)
                  ? [
                      ...q.options.map((o) => ({
                        option: o,
                        count: q.responses.filter((r) => {
                          const v = r.value as string | string[];
                          return Array.isArray(v) ? v.includes(o) : v === o;
                        }).length,
                      })),
                      ...(otherCount > 0
                        ? [{ option: "wrote their own answer", count: otherCount }]
                        : []),
                    ]
                  : null;
                return (
                  <div key={q.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
                      <span className="font-medium text-[var(--text)]">{q.text}</span>
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {q.status === "queued" && "queued for the next round"}
                        {q.status === "open" && (
                          <>
                            <Link href="/input-rounds" className="text-[var(--accent-1)] hover:underline">
                              open in the current round — answer it there
                            </Link>
                          </>
                        )}
                        {q.status === "closed" && `closed, ${q.responses.length} response(s)`}
                        {q.priority ? " · can't move forward without this" : ""}
                        {q.deadline ? ` · needed by ${new Date(q.deadline).toLocaleDateString()}` : ""}
                      </span>
                    </p>
                    {tally && q.responses.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
                        {tally.map((t) => (
                          <li key={t.option}>
                            {t.option}: {t.count}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!tally && q.responses.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
                        {q.responses.map((r) => (
                          <li key={r.id}>{formatFieldValue(r.value, q.responseType)}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <form action={createQuestionAction} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <input type="text" name="text" required placeholder="Ask something" className={INPUT} />
              {/* The same six shapes as every other question system, with
                  the labels from src/lib/field-shape.ts rather than a
                  second set of wording here. A task question could
                  always ask three things; now it can ask "when could
                  you do this" or "how many hours" too. */}
              <select name="responseType" defaultValue="text" className={INPUT}>
                {RESPONSE_TYPES.map((rt) => (
                  <option key={rt} value={rt}>
                    {RESPONSE_TYPE_LABELS[rt]}
                  </option>
                ))}
              </select>
              <input type="text" name="options" placeholder="options for choice types, comma-separated" className={INPUT} />
              <input type="hidden" name="multiline" value="on" />
              <label className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
                Deadline (optional)
                <input type="date" name="deadline" className={INPUT} />
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="priority" /> Can&rsquo;t move forward without this
              </label>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Ask
              </button>
            </form>
          </div>
        </details>
      </div>

      {/* Attention nudge actions — what to do when a task "needs attention" */}
      {holdsTask && taskRow.status === "claimed" && taskRow.attentionLevel !== "ok" && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3">
          <p className="text-[13px] font-medium text-[var(--warning)]">
            This task is flagged &ldquo;{ATTENTION_STYLES[taskRow.attentionLevel]?.label ?? taskRow.attentionLevel}&rdquo;
            {taskRow.attentionLevel === "soft" && " — it hasn't moved recently."}
            {taskRow.attentionLevel === "hard" && " — it's been stale for a while."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={checkInTaskAction} className="flex items-center gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <input
                type="text"
                name="note"
                placeholder="Quick update (optional)"
                className={`${INPUT} min-w-0 text-[13px]`}
              />
              <button type="submit" className={BUTTON_PRIMARY}>
                Still on it
              </button>
            </form>
            <form action={parkAction} className="flex items-center gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <input type="date" name="nextCheckinAt" required className={`${INPUT} min-w-0 text-[13px]`} />
              <input
                type="text"
                name="waitingNote"
                placeholder="waiting on…"
                className={`${INPUT} min-w-0 text-[13px]`}
              />
              <button type="submit" className={BUTTON_SECONDARY}>
                Park
              </button>
            </form>
            <form action={finishAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Mark done
              </button>
            </form>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_GHOST}>
                Release
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Waiting nudge actions — all 4 spec'd options directly available */}
      {holdsTask && taskRow.status === "waiting" && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
          <p className="text-[13px] text-[var(--text-muted)]">
            Check-in was {taskRow.nextCheckinAt && taskRow.nextCheckinAt < new Date() ? "due " + taskRow.nextCheckinAt.toLocaleDateString() : "set for " + taskRow.nextCheckinAt?.toLocaleDateString()}
            {taskRow.waitingNote && <> — <em>{taskRow.waitingNote}</em></>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={resumeAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                Resume
              </button>
            </form>
            <form action={finishWaitingTaskAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Mark done
              </button>
            </form>
            <form action={resnoozeTaskAction} className="flex items-center gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <input type="date" name="nextCheckinAt" required className={`${INPUT} min-w-0 text-[13px]`} />
              <input
                type="text"
                name="waitingNote"
                placeholder="New waiting note (optional)"
                className={`${INPUT} min-w-0 text-[13px]`}
              />
              <button type="submit" className={BUTTON_SECONDARY}>
                Re-snooze
              </button>
            </form>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_GHOST}>
                Release
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Contextual strip, continued — coordinator self-assign check.
          Used to render buried below the active tab's content; the task
          UI grammar puts it up here where a coordinator actually sees it
          before claiming. */}
      {needsSelfAssignConfirmation && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-soft)] p-3">
          <p className="text-[13px] font-medium text-[var(--warning)]">
            You coordinate this branch — are you sure there isn&rsquo;t someone with just the
            skills for this?
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={confirmClaimAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                Yes, I&rsquo;ll take it
              </button>
            </form>
            <form action={suggestSomeoneAction} className="flex gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <select name="memberId" defaultValue="" className={INPUT}>
                <option value="" disabled>
                  Suggest someone…
                </option>
                {communityMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button type="submit" className={BUTTON_SECONDARY}>
                Suggest
              </button>
            </form>
            <form action={flagForGroupAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Flag for the group
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Contextual strip — my pending join request */}
      {myRequest && myRequest.status === "pending" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px] text-[var(--text)]">
          <span>You&rsquo;ve asked to join this task — waiting for a holder&rsquo;s response.</span>
          <form action={withdrawJoinRequestAction}>
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="requestId" value={myRequest.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Withdraw
            </button>
          </form>
        </div>
      )}

      {myAssignment?.isOutgoing && notes.wikiRevisions.length === 0 && (
        <p className="mt-2 text-[13px] text-[var(--danger)]">
          You&rsquo;ve marked yourself as outgoing on this task — this is the best moment to write
          up the wiki summary below before handing it off, while it&rsquo;s still fresh.
        </p>
      )}
      {myOpenPing && (
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          You&rsquo;ve asked to talk to your coordinator about this task — pending.
        </p>
      )}

      {/* Two-column layout (task UI grammar): main column + reference
          rail at lg; rail stacks below main on smaller screens. */}
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
      {requirements.length > 0 && (
      <section>
        <SectionHeading>Requirements</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Status only — add, edit, and remove live in the <em>Edit task</em> panel above.
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {requirements.map((r) => {
            const covered = r.mode === "group_coverage" ? (groupCoverage.get(r.id) ?? false) : null;
            const statusColor =
              r.mode === "group_coverage"
                ? covered
                  ? "var(--success)"
                  : "var(--warning)"
                : r.mode === "soft_priority"
                  ? "var(--text-muted)"
                  : unmetIds.has(r.id)
                    ? "var(--danger)"
                    : "var(--success)";
            const statusLabel =
              r.mode === "group_coverage"
                ? covered
                  ? "covered"
                  : "not yet covered"
                : r.mode === "soft_priority"
                  ? "preferred"
                  : unmetIds.has(r.id)
                    ? "not met"
                    : "met";
            return (
              <li key={r.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[13px]">
                <span style={{ color: statusColor }}>
                  {describeRequirement(r, tierNames)} — {statusLabel}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      )}

      {dependencies.length > 0 && (
      <section className="mt-6">
        <SectionHeading>Dependencies</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          This task can&rsquo;t be finished while any of these are still open. Add and remove live
          in the <em>Edit task</em> panel above.
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {dependencies.map((d) => (
            <li key={d.dependsOnTaskId} className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text)]">
              <Link href={`/tasks/${d.dependsOnTaskId}`} className="font-medium text-[var(--accent-1)] hover:underline">
                {d.title}
              </Link>
              <span className="text-[var(--text-muted)]">({d.status})</span>
            </li>
          ))}
        </ul>
      </section>
      )}

      {canGrantPermissions && (
        <details className="mt-6 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
            Permissions granted by this task
          </summary>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Check which module-level access gate(s) whoever currently holds this task should get —
            the identical <code>PermissionGrant</code> rows the settings panel&rsquo;s Access &amp;
            permissions tab edits, grouped there by how far each reaches. A grant&rsquo;s scope comes
            from this task&rsquo;s own placement, so each row below shows what you&rsquo;d be granting
            here. Budget authority is configured only in Settings → Access &amp; permissions.
          </p>
          <form action={updateTaskPermissionGrantsAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            {TASK_GRANTABLE_PERMISSION_MODULE_KEYS.map((moduleKey) => (
              <div key={moduleKey}>
                <CheckField
                  label={PERMISSION_MODULE_LABELS[moduleKey]}
                  name="moduleKeys"
                  value={moduleKey}
                  defaultChecked={grantedByThisTask.has(moduleKey)}
                />
                <p className="ml-6 text-[12px] text-[var(--text-muted)]">
                  {describeGrantScope(moduleKey, taskRow.cycleId, taskCycle?.name ?? null)}
                  {isMisplacedCommunityGrant(moduleKey, taskRow.cycleId) && (
                    <>
                      {" "}
                      &mdash; but this task sits in an event, which contradicts a community-wide role.
                      The grant still counts community-wide.
                    </>
                  )}
                </p>
                {elsewhereHolderByModule.has(moduleKey) && (
                  <p className="ml-6 text-[12px] text-[var(--text-muted)]">
                    Currently held by &ldquo;{elsewhereHolderByModule.get(moduleKey)}&rdquo; — checking this
                    moves it here.
                  </p>
                )}
              </div>
            ))}
            <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
              Save
            </button>
          </form>
        </details>
      )}

      {/* Notes render inline, never tab-gated — spec: "not buried
          behind a toggle, a mode switch, or a different part of the
          app." */}
      <p className="mt-8 text-[13px] text-[var(--text-muted)]">
        The description above is the goal, not the method. Everything here is optional notes on
        how it&rsquo;s actually been done — never mistaken for the instructions.
      </p>

      <section className="mt-4">
        <SectionHeading>Wiki summary</SectionHeading>
        {notes.wikiRevisions.length > 0 ? (
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <p className="whitespace-pre-wrap text-[13px] text-[var(--text)]">{notes.wikiRevisions[0].content}</p>
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
              Last edited by {memberNameById.get(notes.wikiRevisions[0].editedBy) ?? "—"} on{" "}
              {new Date(notes.wikiRevisions[0].editedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Nothing written up yet.</p>
        )}

        <form action={editWikiAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="taskId" value={taskRow.id} />
          <textarea
            name="content"
            rows={4}
            required
            defaultValue={notes.wikiRevisions[0]?.content ?? ""}
            placeholder="What's worked, what to watch out for, where the good deal was..."
            className={INPUT}
          />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Save wiki edit
          </button>
        </form>

        {notes.wikiRevisions.length > 1 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
              Revision history ({notes.wikiRevisions.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-[var(--text)]">
              {notes.wikiRevisions.slice(1).map((rev) => (
                <li key={rev.id}>
                  <span className="text-[var(--text-muted)]">
                    {memberNameById.get(rev.editedBy) ?? "—"} — {new Date(rev.editedAt).toLocaleString()}:
                  </span>{" "}
                  {rev.content}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading>Comments</SectionHeading>
        {notes.comments.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">No comments yet.</p>}
        <div className="mt-2">
          {notes.comments.map((c) => (
            <div key={c.id} className="mb-2">
              <div className="text-[12px] text-[var(--text-muted)]">
                {memberNameById.get(c.memberId) ?? "—"} — {new Date(c.createdAt).toLocaleString()}
              </div>
              <p className="text-[13px] text-[var(--text)]">{c.body}</p>
            </div>
          ))}
        </div>

        <form action={addCommentAction} className="mt-3 flex gap-2">
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="body" required placeholder="Add a comment…" className={`${INPUT} flex-1`} />
          <button type="submit" className={BUTTON_PRIMARY}>
            Post
          </button>
        </form>
      </section>

      <section className="mt-8">
        <SectionHeading>Resources</SectionHeading>
        {notes.resources.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">No resources linked yet.</p>}
        <ul className="mt-2 flex flex-col gap-1">
          {notes.resources.map((r) => (
            <li key={r.id} className="text-[13px]">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--accent-1)] hover:underline">
                {r.label}
              </a>
              {r.tag && <span className="text-[var(--text-muted)]"> — {r.tag}</span>}
            </li>
          ))}
        </ul>

        <form action={addResourceAction} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="label" required placeholder="Label" className={INPUT} />
          <input type="url" name="url" required placeholder="https://…" className={`${INPUT} flex-1`} />
          <input type="text" name="tag" placeholder="tag (optional)" className={INPUT} />
          <button type="submit" className={BUTTON_PRIMARY}>
            Add
          </button>
        </form>
      </section>

      <section className="mt-8">
        <SectionHeading>Milestones</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          A current holder adds/edits/removes these directly; anyone else&rsquo;s addition shows
          immediately but lands pending until a holder confirms or rejects it (an unclaimed task
          confirms immediately either way).
        </p>
        {milestones.length === 0 && <p className="mt-3 text-[13px] text-[var(--text-muted)]">None yet.</p>}
        <div className="mt-3">
          {milestones.map((m) => (
            <div key={m.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text)]">{m.label}</span>
                {m.isDeadline && <Tag tone="accent">deadline</Tag>}
                {m.status === "pending" && (
                  <Tag tone="warning">pending — proposed by {memberNameById.get(m.proposedBy) ?? "—"}</Tag>
                )}
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--text-muted)]" title={milestoneDateLabel(m).exact}>
                <time dateTime={m.resolvedDate ?? undefined} aria-label={milestoneDateLabel(m).exact}>{milestoneDateLabel(m).visible}</time>
              </div>

              {holdsTask && (
                <>
                  <form action={updateMilestoneAction} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="milestoneId" value={m.id} />
                    <MilestoneDateFields
                      milestone={m}
                      phases={cyclePhases}
                      cycleStartDate={taskCycle?.startDate ?? null}
                      cycleEndDate={taskCycle?.endDate ?? null}
                      taskPhaseId={taskRow.phaseId}
                    />
                    <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                      <input type="checkbox" name="isDeadline" defaultChecked={m.isDeadline} />
                      This is the deadline
                    </label>
                    <div className="flex gap-2">
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Save
                      </button>
                    </div>
                  </form>
                  <div className="mt-2 flex gap-2">
                    {m.status === "pending" && (
                      <form action={confirmMilestoneAction}>
                        <input type="hidden" name="taskId" value={taskRow.id} />
                        <input type="hidden" name="milestoneId" value={m.id} />
                        <button type="submit" className={BUTTON_PRIMARY}>
                          Confirm
                        </button>
                      </form>
                    )}
                    <form action={deleteMilestoneAction}>
                      <input type="hidden" name="taskId" value={taskRow.id} />
                      <input type="hidden" name="milestoneId" value={m.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        {m.status === "pending" ? "Reject" : "Remove"}
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <details className="mt-4">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-[var(--accent-1)] hover:underline">
            <PlusIcon /> Add milestone
          </summary>
          <form action={addMilestoneAction} className="mt-2 flex max-w-[420px] flex-col gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="text" name="label" required placeholder="Label (e.g. Deposit due)" className={INPUT} />
            <MilestoneDateFields
              phases={cyclePhases}
              cycleStartDate={taskCycle?.startDate ?? null}
              cycleEndDate={taskCycle?.endDate ?? null}
              taskPhaseId={taskRow.phaseId}
            />
            <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input type="checkbox" name="isDeadline" />
              This is the deadline
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Add
            </button>
          </form>
        </details>
      </section>

      {canWaive && (
        <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
            Waive a requirement and claim for someone
          </summary>
          <form action={waiveAndClaimAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            <select name="memberId" required defaultValue="" className={INPUT}>
              <option value="" disabled>
                Who are you waiving this for?
              </option>
              {communityMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              name="reason"
              required
              placeholder="Reason (required — stays visible on the task afterward)"
              className={INPUT}
            />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Waive and claim
            </button>
          </form>
        </details>
      )}

      {canNominate && (
        <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
            Nominate someone for this task
          </summary>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Claims it for them right away — they get a yes/no/not-now window to confirm or
            release it, no action required if it&rsquo;s a genuine fit.
          </p>
          <form action={nominateForTaskAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            <select name="memberId" required defaultValue="" className={INPUT}>
              <option value="" disabled>
                Who fits this?
              </option>
              {communityMembers
                .filter((m) => !realAssignments.some((a) => a.memberId === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <input type="text" name="message" placeholder="Optional note (why you think this is a fit)" className={INPUT} />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Nominate
            </button>
          </form>
        </details>
      )}

      {showPeopleTab && (
      <>
      {isCommunityEndorsed && (
        <section className="mt-8">
          <SectionHeading>Candidacy</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Needs {taskRow.endorsementThreshold} endorsement
            {taskRow.endorsementThreshold === 1 ? "" : "s"} to confirm · browse window{" "}
            {taskRow.browsePeriodEnd
              ? browseWindowOpen
                ? `closes ${taskRow.browsePeriodEnd.toLocaleString()}`
                : `closed ${taskRow.browsePeriodEnd.toLocaleString()}`
              : "not set"}
          </p>

          {openCandidacies.length === 0 && resolvedCandidacies.length === 0 && (
            <p className="mt-3 text-[13px] text-[var(--text-muted)]">Nobody has put themselves forward yet.</p>
          )}

          <div className="mt-3">
            {openCandidacies.map((c) => (
              <div key={c.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-[13px] text-[var(--text)]">
                  {memberNameById.get(c.memberId) ?? "—"} — {c.endorsementCount}/{taskRow.endorsementThreshold} endorsements
                </p>
                {c.memberId === viewing.id && (
                  <form action={withdrawCandidacyAction} className="mt-2">
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="candidacyId" value={c.id} />
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Withdraw
                    </button>
                  </form>
                )}
                {c.memberId !== viewing.id && myEndorsements.has(c.id) && (
                  <span className="text-[12px] text-[var(--text-muted)]">You&rsquo;ve endorsed this</span>
                )}
                {c.memberId !== viewing.id && !myEndorsements.has(c.id) && browseWindowOpen && (
                  <form action={endorseCandidacyAction} className="mt-2">
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="candidacyId" value={c.id} />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Endorse
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>

          {resolvedCandidacies.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
                Resolved candidacies ({resolvedCandidacies.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-[13px] text-[var(--text)]">
                {resolvedCandidacies.map((c) => (
                  <li key={c.id}>
                    {memberNameById.get(c.memberId) ?? "—"} — {c.status} ({c.endorsementCount}/
                    {taskRow.endorsementThreshold})
                  </li>
                ))}
              </ul>
            </details>
          )}

          {canExpressCandidacy && (
            <form action={expressCandidacyAction} className="mt-3">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                Put yourself forward
              </button>
            </form>
          )}
        </section>
      )}

      {/* The pending-request notice lives in the contextual strip at
          the top now — only the declined outcome stays down here. */}
      {myRequest && myRequest.status === "declined" && (
        <p className="mt-4 text-[13px] text-[var(--text)]">
          Your request to join was declined
          {myRequest.declineReason ? `: ${myRequest.declineReason}` : "."}
        </p>
      )}

      {(pendingRequests.length > 0 || resolvedRequests.length > 0) && requestGated && (
        <section className="mt-8">
          <SectionHeading>Join requests</SectionHeading>
          {pendingRequests.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None pending.</p>}
          <div className="mt-3">
            {pendingRequests.map((r) => (
              <div key={r.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-[13px] text-[var(--text)]">
                  {memberNameById.get(r.memberId) ?? "—"} asked to join — {new Date(r.requestedAt).toLocaleString()}
                </p>
                {canApproveRequests && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <form action={acceptJoinRequestAction}>
                      <input type="hidden" name="taskId" value={taskRow.id} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Accept
                      </button>
                    </form>
                    <form action={declineJoinRequestAction} className="flex gap-2">
                      <input type="hidden" name="taskId" value={taskRow.id} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="text" name="reason" placeholder="reason (optional)" className={INPUT} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Decline
                      </button>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>

          {resolvedRequests.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
                Resolved requests ({resolvedRequests.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-[13px] text-[var(--text)]">
                {resolvedRequests.map((r) => (
                  <li key={r.id}>
                    {memberNameById.get(r.memberId) ?? "—"} — {r.status}
                    {r.status === "declined" && r.declineReason && `: ${r.declineReason}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      </>
      )}

      {showCoordinationTab && (
      <>
      {accompaniedMemberId && accompanimentEngagement && (
        <section className="mt-8">
          <SectionHeading>Engagement record</SectionHeading>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-[var(--text)]">
            {memberNameById.get(accompaniedMemberId) ?? "This member"}
            {accompanimentEngagement.level === "none" ? (
              <Tag tone="success">no open non-responses</Tag>
            ) : (
              <Tag tone={ENGAGEMENT_TONE[accompanimentEngagement.level] ?? "neutral"}>
                {ENGAGEMENT_LABEL[accompanimentEngagement.level] ?? accompanimentEngagement.level} (
                {accompanimentEngagement.openCount} open non-response
                {accompanimentEngagement.openCount === 1 ? "" : "s"})
              </Tag>
            )}
          </p>
        </section>
      )}

      {nominations.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Nominations</SectionHeading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {nominations.map(({ nomination, nomineeName }) => (
              <li key={nomination.id} className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text)]">
                {nomineeName}
                <Tag tone={NOMINATION_STATUS_TONE[nomination.status] ?? "neutral"}>
                  {NOMINATION_STATUS_LABEL[nomination.status] ?? nomination.status}
                </Tag>
                {nomination.status === "pending" && (
                  <span className="text-[var(--text-muted)]">
                    respond by {nomination.respondByDeadline.toLocaleString()}
                  </span>
                )}
                {nomination.message && <span className="text-[var(--text-muted)]">&ldquo;{nomination.message}&rdquo;</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isCoordHolderForBranch && (openPings.length > 0 || resolvedPings.length > 0) && (
        <section className="mt-8">
          <SectionHeading>Talk-to-coordinator pings</SectionHeading>
          {openPings.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None open.</p>}
          <div className="mt-2">
            {openPings.map((p) => (
              <div key={p.id} className="mb-1.5 flex items-center gap-2 text-[13px] text-[var(--text)]">
                <span>
                  {memberNameById.get(p.requestedBy) ?? "—"} would like to talk about this task —{" "}
                  {new Date(p.createdAt).toLocaleString()}
                </span>
                <form action={resolvePingAction}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="pingId" value={p.id} />
                  <button type="submit" className={BUTTON_GHOST}>
                    Mark resolved
                  </button>
                </form>
              </div>
            ))}
          </div>
          {resolvedPings.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
                Resolved pings ({resolvedPings.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
                {resolvedPings.map((p) => (
                  <li key={p.id}>{memberNameById.get(p.requestedBy) ?? "—"}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      </>
      )}

      {showSubtasksTab && (
        <section className="mt-8">
          <SectionHeading>Subtasks</SectionHeading>
          {subtasks.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None broken off yet.</p>}
          {subtasks.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-[13px]">
                  <Link href={`/tasks/${s.id}`} className="font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                    {s.title}
                  </Link>
                  <span className="text-[var(--text-muted)]">({s.status})</span>
                </li>
              ))}
            </ul>
          )}

          {holdsTask && (
            <details className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">Split off a subtask</summary>
              <form action={splitSubtaskAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input type="text" name="title" required placeholder="Title" className={INPUT} />
                <textarea name="description" rows={2} placeholder="Description" className={INPUT} />

                <div className="flex flex-wrap items-center gap-2">
                  <select name="branchId" defaultValue={taskRow.branchId} className={INPUT}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>

                  <EffortFields defaultEffort={taskRow.effort} />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                    Capacity:
                    <input type="number" name="capacity" defaultValue={1} min={1} className={`${INPUT} w-20`} />
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                    <input type="checkbox" name="critical" /> Critical
                  </label>
                </div>

                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Split off
                </button>
              </form>
            </details>
          )}
        </section>
      )}
      </div>{/* end main column */}

      {/* Reference rail — status, people, requirements summary, and the
          quiet admin disclosures. Stacks below the main column under lg. */}
      <aside className="flex flex-col gap-4">
        <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Status</h2>
          <div className="mt-2">
            <StatusIcon status={taskRow.status} attentionLevel={taskRow.attentionLevel} showLabel />
          </div>
          {realAssignments.length > 0 && (
            <p className="mt-2 text-[13px] text-[var(--text)]">
              Held by: {realAssignments.map((a) => memberNameById.get(a.memberId) ?? "—").join(", ")}
            </p>
          )}
          {shadowAssignments.length > 0 && (
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Shadowed by: {shadowAssignments.map((a) => memberNameById.get(a.memberId) ?? "—").join(", ")}
            </p>
          )}
          {realAssignments
            .filter((a) => a.gateWaivedBy)
            .map((a) => (
              <p key={a.memberId} className="mt-1 text-[13px] text-[var(--warning)]">
                {memberNameById.get(a.memberId) ?? "—"}&rsquo;s requirement was waived by{" "}
                {memberNameById.get(a.gateWaivedBy!) ?? "—"}: {a.gateWaivedReason}
              </p>
            ))}
          {taskRow.status === "waiting" && (
            <p className="mt-2 text-[13px] text-[var(--text)]">
              Next check-in: {taskRow.nextCheckinAt ? new Date(taskRow.nextCheckinAt).toLocaleDateString() : "—"}
              {taskRow.waitingNote && <span className="text-[var(--text-muted)]"> — {taskRow.waitingNote}</span>}
            </p>
          )}
          {/* Park is a disclosure, not a menu row — it needs inputs.
              Suppressed while the attention nudge panel is showing (it
              carries its own Park form). */}
          {holdsTask && taskRow.status === "claimed" && !flagged && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
                Park until a check-in date…
              </summary>
              <form action={parkAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input type="date" name="nextCheckinAt" required className={INPUT} />
                <input type="text" name="waitingNote" placeholder="waiting on…" className={INPUT} />
                <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                  Park
                </button>
              </form>
            </details>
          )}
        </section>

        {requirements.length > 0 && (
          <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Requirements
            </h2>
            <ul className="mt-2 flex flex-col gap-1 text-[13px]">
              {requirements.map((r) => {
                const covered = r.mode === "group_coverage" ? (groupCoverage.get(r.id) ?? false) : null;
                const colorClass =
                  r.mode === "group_coverage"
                    ? covered
                      ? "text-[var(--success)]"
                      : "text-[var(--warning)]"
                    : r.mode === "soft_priority"
                      ? "text-[var(--text-muted)]"
                      : unmetIds.has(r.id)
                        ? "text-[var(--danger)]"
                        : "text-[var(--success)]";
                const statusLabel =
                  r.mode === "group_coverage"
                    ? covered
                      ? "covered"
                      : "not yet covered"
                    : r.mode === "soft_priority"
                      ? "helpful, not required"
                      : unmetIds.has(r.id)
                        ? "not met"
                        : "met";
                return (
                  <li key={r.id} className={colorClass}>
                    {describeRequirement(r, tierNames)} — {statusLabel}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        </aside>
      </div>{/* end grid */}

    </main>
  );
}

type MilestoneRow = Awaited<ReturnType<typeof listTaskMilestones>>[number];
type CyclePhaseRow = Awaited<ReturnType<typeof getCycle>>["phases"][number];

const MILESTONE_DATE_FIELD_NAMES: Record<DateFieldBase, string> = {
  mode: "dateMode",
  date: "date",
  parentType: "parentType",
  phaseId: "milestonePhaseId",
};

function MilestoneDateFields({
  milestone,
  phases,
  cycleStartDate,
  cycleEndDate,
  taskPhaseId,
}: {
  milestone?: MilestoneRow;
  phases: CyclePhaseRow[];
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  taskPhaseId: string | null;
}) {
  const taskPhase = taskPhaseId ? phases.find((p) => p.id === taskPhaseId) : undefined;
  const defaultParentType = taskPhase?.startDate || taskPhase?.endDate ? "phase" : "cycle";
  const relativeAllowed = Boolean(cycleStartDate || cycleEndDate || phases.some((p) => p.startDate || p.endDate));
  const parentType = milestone?.parentType ?? defaultParentType;
  const resolvedDate = milestone?.resolvedDate ?? (milestone?.dateType === "absolute" ? milestone.absoluteDate : null);
  // The same prose the phase view uses for its own boundaries — see
  // lib/dates/describe.ts, which is why this isn't a third copy. A
  // milestone row has no cached `date` column (Phase boundaries do), so
  // the resolved date is threaded in under the shared shape's name.
  const recipe =
    milestone && resolvedDate
      ? describeBoundaryRecipe(
          {
            dateType: milestone.dateType,
            date: resolvedDate,
            relativeBasis: milestone.relativeBasis,
            relativeValue: milestone.relativeValue,
          },
          milestone.parentType === "phase" ? "the phase" : "the event",
        )
      : null;

  return (
    <DateModeField
      fieldNames={MILESTONE_DATE_FIELD_NAMES}
      mode={milestone ? (milestone.dateType === "relative" ? "relative" : "absolute") : undefined}
      date={resolvedDate}
      parentType={parentType}
      phaseId={milestone?.phaseId}
      phases={phases}
      phaseSelectDefaultLabel="This task’s own Phase"
      defaultParentType={defaultParentType}
      relativeAllowed={relativeAllowed}
      defaultMode={relativeAllowed ? "relative" : "absolute"}
      relativeHint="The task’s own Phase is the default parent; choose another Phase when this milestone belongs to a different one."
      footer={
        milestone &&
        resolvedDate && (
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            Currently: {resolvedDate}
            {recipe && ` — ${recipe}`}
          </p>
        )
      }
    />
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
