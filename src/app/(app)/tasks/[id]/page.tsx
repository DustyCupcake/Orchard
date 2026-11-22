import { eq } from "drizzle-orm";
import { getViewerClock } from "@/lib/view-clock";
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
  listResolvableJoinRequestIds,
  listMyEndorsements,
  listMyPings,
  listNominationsForTask,
  listPings,
  listRequirements,
  listSignals,
  listSubtasks,
  listTaskDependencies,
  listTaskMilestones,
  milestoneDayItem,
  tierNameLookup,
  describeRequirement,
  isSelfAssignWorthAskingAbout,
  rankByTagFit,
} from "@/lib/tasks";
import { SUGGESTION_REASON_LABEL, joinReasons, listSuggestionsForTasks } from "@/lib/tasks/suggestions";
import { getCommunity, listBranches } from "@/lib/settings";
import { getCycle, resolveCrossCycleContext, scopeLabel } from "@/lib/cycles";
import { isModuleEnabled } from "@/lib/modules";
import { getDayLabeler } from "@/lib/day-labeler";
import { isShiftManagerForScope } from "@/lib/shifts";
import { switchToLinkedScopeAction } from "@/app/(app)/cycles/scope-actions";
import CopyLinkButton from "@/components/CopyLinkButton";
import EffortFields from "@/components/EffortFields";
import PageHeader from "@/components/ui/PageHeader";
import ActionMenu from "@/components/ui/ActionMenu";
import StatusIcon from "@/components/tasks/StatusIcon";
import { BranchChip, CapacityChip, CycleChip, EffortChip } from "@/components/tasks/MetaChips";
import { listTaskQuestions } from "@/lib/input-rounds";
import { isAuthorizedToWaive, isCoordinationHolder } from "@/lib/coordination";
import { resolveBackstopHolder } from "@/lib/backstop";
import { getAccompaniedMemberId, getAccompaniedView } from "@/lib/accompaniment";
import { computeEngagementPattern } from "@/lib/engagement";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import { FlagIcon, QuestionIcon } from "@phosphor-icons/react/dist/ssr";
import { Tag, type Tone, ATTENTION_TONE, Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_GHOST, BUTTON_ICON, INPUT } from "@/components/ui/kit";
import {
  acceptJoinRequestAction,
  addCommentAction,
  addResourceAction,
  checkInTaskAction,
  claimAction,
  claimAsShadowAction,
  confirmClaimAction,
  confirmMilestoneAction,
  setMilestoneDoneAction,
  createQuestionAction,
  createSignalAction,
  deescalateTaskAction,
  declineJoinRequestAction,
  deleteMilestoneAction,
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
  resnoozeTaskAction,
  resolvePingAction,
  resolveSignalAction,
  resumeAction,
  setOutgoingAction,
  splitSubtaskAction,
  stopShadowingAction,
  waiveAndClaimAction,
  withdrawCandidacyAction,
  withdrawJoinRequestAction,
  nominateForTaskAction,
} from "./actions";
import ClaimGate from "@/components/tasks/ClaimGate";
import SelectField from "@/components/ui/SelectField";
import { requestTime } from "@/lib/request-time";

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
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
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
  searchParams: Promise<{ error?: string; scope?: string; tab?: string; nominate?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const clock = await getViewerClock();

  const { id } = await params;
  // `tab` is accepted but ignored — the tab bar is gone (see the note
  // above); old bookmarks still land on the right page.
  const { error, scope: scopeParam, nominate: nominateParam } = await searchParams;

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
  ]);
  // A milestone's day is written in terms of the task's event and phase
  // (src/lib/dates/day-labeler.ts), or the phase the milestone points at. The
  // page already shows the task's event in its chip, so the label leaves the
  // event's name out; a task with no event has plain dates.
  const labeler = await getDayLabeler();
  const milestoneDateLabel = (m: (typeof milestones)[number]) =>
    labeler.label(m.resolvedDate, milestoneDayItem(m, taskRow), { cycleId: taskRow.cycleId });
  // The task's own check-in date reads the same way: in terms of the task's
  // event and phase, on the viewer's own day.
  const checkInLabel = (at: Date) =>
    labeler.instantLabel(at, clock.timeZone, { cycleId: taskRow.cycleId, phaseId: taskRow.phaseId }, { cycleId: taskRow.cycleId }).visible;
  const crossCycle = await resolveCrossCycleContext(viewing, taskCycle, scopeParam ?? null);
  const taskPath = `/tasks/${taskRow.id}`;

  const groupCoverage = await getGroupCoverageStatus(db, id, requirements);
  const shiftsModuleOn = isModuleEnabled(communityRow, "shifts");
  // D10 (§4.8) — a standing series is the standing scope's shift manager's
  // act; holding the source task no longer grants it. Show the link to the
  // pre-filled "add a shift series" form to whoever can actually take it.
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
  // join-request approval is checked elsewhere on this page.
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
  // docs/plans/development-plan.md's Phase 52. Only ever resolves to
  // something when this task actually is an Accompaniment task (see
  // getAccompaniedMemberId's own comment) and the viewer currently
  // holds it — access follows the task, same as every other
  // coordination-facing surface here.
  const accompaniedMemberId = holdsTask ? await getAccompaniedMemberId(taskRow.id) : null;
  const accompaniedView = holdsTask ? await getAccompaniedView(viewing, taskRow.id) : null;
  const accompanimentEngagement = accompaniedMemberId
    ? await computeEngagementPattern(accompaniedMemberId, viewing.communityId)
    : null;
  const isShadowing = myAssignment?.isShadow === true;
  const canShadow =
    !holdsTask && !isShadowing && (taskRow.status === "claimed" || taskRow.status === "waiting");
  const requestGated = taskRow.openness === "request" || taskRow.openness === "coordination_approved";
  const pendingRequests = joinRequests.filter((r) => r.status === "pending");
  // The same rule acceptJoinRequest enforces, asked per request — see
  // canResolveJoinRequest for who that is on each openness.
  const resolvableRequestIds = await listResolvableJoinRequestIds(viewing, taskRow, pendingRequests);
  const resolvedRequests = joinRequests.filter((r) => r.status !== "pending");
  const myRequest = joinRequests.find((r) => r.memberId === viewing.id);

  const browseWindowOpen = Boolean(
    taskRow.browsePeriodEnd && taskRow.browsePeriodEnd.getTime() > requestTime(),
  );
  const myCandidacy = candidacies.find((c) => c.memberId === viewing.id);
  const openCandidacies = candidacies.filter((c) => c.status === "open");
  const resolvedCandidacies = candidacies.filter((c) => c.status !== "open");
  const canExpressCandidacy =
    isCommunityEndorsed && browseWindowOpen && !holdsTask && !myCandidacy;

  const hasRoom = taskRow.capacity === null || realAssignments.length < taskRow.capacity;
  // D3 (docs/plans/task-interface-plan.md) — the "Who's on it" section
  // renders empty slots as first-class rows so a gap is visible without
  // arithmetic. A done task has no gap to show; an uncapped task has no
  // countable empties, just room.
  const emptySlotCount =
    taskRow.capacity !== null && taskRow.status !== "done"
      ? Math.max(taskRow.capacity - realAssignments.length, 0)
      : 0;
  const flagged = taskRow.attentionLevel !== "ok";
  // A parked (waiting) task can be joined or asked about like a claimed one
  // — someone who knows they'd unblock it should be able to say so — and
  // joining never changes the parking (performClaimInTx).
  const joinable =
    taskRow.status === "unclaimed" ||
    ((taskRow.status === "claimed" || taskRow.status === "waiting") && hasRoom);
  const canActBase =
    !isCommunityEndorsed &&
    !isShadowing &&
    !holdsTask &&
    joinable &&
    unmetRequirements.length === 0 &&
    !(myRequest && myRequest.status === "pending");
  // Whether the *button* opens the coordinator's self-assign ask, rather
  // than the banner that used to replace the button outright — see
  // components/tasks/ClaimGate.tsx. Same predicate, same server-side
  // enforcement (join-requests.ts's claimOrRequestToJoin); what changed
  // is that the ask is now something the coordinator triggers by trying
  // to claim, instead of something they're shown for merely looking.
  const claimIsGated = canActBase && isCoordHolderForBranch && isSelfAssignWorthAskingAbout(taskRow);

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
    joinable;
  // "An existing owner can also nominate a specific person for an open
  // slot" — see docs/spec.md's Multi-slot & collaborative tasks and
  // src/lib/tasks/nominations.ts. D5 (docs/plans/task-interface-plan.md)
  // widened the offer: any non-endorsed, non-done task, waiting ones
  // included, with no room check — at capacity the nomination itself
  // raises the count by one, which the form states before confirming.
  // community_endorsed stays excluded (candidacy is the only door there).
  const canNominate =
    authorizedToNominate &&
    !isCommunityEndorsed &&
    taskRow.status !== "done";
  const nominateAddsSlot =
    taskRow.capacity !== null && realAssignments.length >= taskRow.capacity;

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
  // something. Join requests used to be part of this wrapper; they
  // moved into "Who's on it" (docs/plans/task-interface-plan.md D3),
  // leaving the candidacy flow and the declined notice here.
  const showPeopleTab = isCommunityEndorsed || myRequest?.status === "declined";
  const showCoordinationTab =
    (!!accompaniedMemberId && !!accompanimentEngagement) ||
    nominations.length > 0 ||
    (isCoordHolderForBranch && (openPings.length > 0 || resolvedPings.length > 0));
  const showSubtasksTab = subtasks.length > 0 || holdsTask;

  // The people a coordinator can ask about this task, ordered by how many
  // of its tags they carry (spec's "suggest a person (tag-matches
  // surfaced)"). Ranked, never filtered — a member sharing no tags is
  // still offerable, just further down, because matching is deferred as
  // real automation (src/lib/tasks/fit.ts).
  const ranked = rankByTagFit(
    communityMembers
      .filter((m) => m.id !== viewing.id && !realAssignments.some((a) => a.memberId === m.id))
      .map((m) => ({ id: m.id, name: m.name, tags: m.tags })),
    taskRow.tags,
  );
  // People who were suggested for this task, with the reason, come first: they are the people
  // with a reason to be asked, and the reason is what makes asking easy to say. Not a ranking
  // of who is best, and everyone else is still offered below them.
  const suggestedForTask = (await listSuggestionsForTasks([taskRow.id])).get(taskRow.id) ?? [];
  const suggestedById = new Map(suggestedForTask.map((p) => [p.memberId, p]));
  const askCandidates = [
    ...ranked.filter((m) => suggestedById.has(m.id)),
    ...ranked.filter((m) => !suggestedById.has(m.id)),
  ].map((m) => {
    const suggested = suggestedById.get(m.id);
    return { ...m, label: suggested ? `${m.name} — ${joinReasons(suggested.reasons, SUGGESTION_REASON_LABEL)}` : m.name };
  });

  // ── Task UI grammar: one primary action in the header ────────────
  // When a contextual nudge panel is showing (attention-flagged claimed,
  // or any waiting state) it carries the state-appropriate actions just
  // below the header, so the header primary is suppressed to avoid
  // duplicating them.
  const nudgePanelShown = holdsTask && (taskRow.status === "waiting" || (taskRow.status === "claimed" && flagged));
  const joiningRequiresRequest =
    requestGated &&
    (taskRow.status === "claimed" || taskRow.status === "waiting") &&
    realAssignments.length > 0;
  let primaryHeaderAction: React.ReactNode = null;
  if (!nudgePanelShown) {
    if (canActBase) {
      // A coordinator claiming their own unclaimed/flagged task gets the
      // Claim button as usual; the button opens the "is there someone
      // better suited" dialog rather than being withheld behind one.
      primaryHeaderAction = (
        <ClaimGate
          taskId={taskRow.id}
          claimLabel={joiningRequiresRequest ? "Request to join" : "Claim"}
          gated={claimIsGated}
          confirmClaimAction={claimIsGated ? confirmClaimAction : claimAction}
          alternatives={
            claimIsGated && canNominate ? (
              <form action={nominateForTaskAction} className="flex flex-col gap-2">
                <input type="hidden" name="taskId" value={taskRow.id} />
                <label className="flex flex-col gap-1">
                  <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                    Ask someone else instead
                  </span>
                  <select name="memberId" required defaultValue="" className={INPUT}>
                    <option value="" disabled>
                      Who fits this?
                    </option>
                    {askCandidates.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  type="text"
                  name="message"
                  placeholder="Why you think this is a fit (optional)"
                  className={INPUT}
                />
                <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
                  Ask them
                </button>
              </form>
            ) : null
          }
          flagForm={
            taskRow.attentionLevel !== "escalated" ? (
              <form action={flagForGroupAction}>
                <input type="hidden" name="taskId" value={taskRow.id} />
                <button type="submit" className={`${BUTTON_SECONDARY} self-start`}>
                  Flag it for the group
                </button>
              </form>
            ) : null
          }
        />
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

  // ⋯ menu contents — the secondary/tertiary actions, plus the way to
  // the edit screen (docs/plans/task-interface-plan.md D2: all config
  // editing lives there, not on this page). Park isn't here: it needs
  // inputs, so it's a disclosure in the Status rail card.
  const menuItems: React.ReactNode[] = [
    <Link key="edit" href={`${taskPath}/edit`}>Edit task…</Link>,
  ];
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
      <Link href={`/shifts?compose=1&fromTask=${taskRow.id}`}>Make this a recurring shift…</Link>,
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
      <Link href="/board" className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline">
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
            <CapacityChip held={realAssignments.length} capacity={taskRow.capacity} critical={taskRow.critical} />
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
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 text-[length:var(--text-meta)] text-[var(--text-muted)] hover:text-[var(--text)]"
              title="Find a time"
            >
              <CalendarIcon />
              <span className="hidden sm:inline">Find a time</span>
            </Link>
          </>
        }
      />
      {parentTask && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Part of{" "}
          <Link href={`/tasks/${parentTask.id}`} className="font-medium text-[var(--accent-1)] hover:underline">
            {parentTask.title}
          </Link>
        </p>
      )}
      {taskRow.description && <p className="mt-3 text-[length:var(--text-body)] text-[var(--text)]">{taskRow.description}</p>}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <details className="group">
          <summary
            className={`${BUTTON_ICON} list-none [&::-webkit-details-marker]:hidden`}
            title="Signal something / flag for coordination"
          >
            <FlagIcon size={18} />
          </summary>
          <div className="mt-2 w-[min(90vw,420px)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">Signal something</p>
            <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
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
                {openSignals.length === 0 && <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">No open signals.</p>}
                {openSignals.map((s) => (
                  <div key={s.id} className="mb-1.5 flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                    <span>
                      {SIGNAL_LABELS[s.kind] ?? s.kind} — {clock.date(s.createdAt)}
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
                    <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">
                      Dismissed signals ({resolvedSignals.length})
                    </summary>
                    <ul className="mt-2 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text)]">
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
            <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">Questions</p>
            <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              Anyone can ask something tied to this task — it queues silently and bundles into the
              next Input round, no ping sent now. Answers stay visible here once the round&rsquo;s open.
            </p>

            {questions.length === 0 && <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">No questions yet.</p>}
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
                    <p className="flex flex-wrap items-center gap-1.5 text-[length:var(--text-body)]">
                      <span className="font-medium text-[var(--text)]">{q.text}</span>
                      <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
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
                        {q.deadline ? ` · needed by ${clock.date(q.deadline)}` : ""}
                      </span>
                    </p>
                    {tally && q.responses.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text)]">
                        {tally.map((t) => (
                          <li key={t.option}>
                            {t.option}: {t.count}
                          </li>
                        ))}
                      </ul>
                    )}
                    {!tally && q.responses.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text)]">
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
              <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                Deadline (optional)
                <input type="date" name="deadline" className={INPUT} />
              </label>
              <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
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
          <p className="text-[length:var(--text-body)] font-medium text-[var(--warning)]">
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
                className={`${INPUT} min-w-0 text-[length:var(--text-body)]`}
              />
              <button type="submit" className={BUTTON_PRIMARY}>
                Still on it
              </button>
            </form>
            <form action={parkAction} className="flex items-center gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <input type="date" name="nextCheckinAt" required className={`${INPUT} min-w-0 text-[length:var(--text-body)]`} />
              <input
                type="text"
                name="waitingNote"
                placeholder="waiting on…"
                className={`${INPUT} min-w-0 text-[length:var(--text-body)]`}
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
          <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
            Check-in was {taskRow.nextCheckinAt && taskRow.nextCheckinAt < new Date() ? "due " + checkInLabel(taskRow.nextCheckinAt) : "set for " + (taskRow.nextCheckinAt ? checkInLabel(taskRow.nextCheckinAt) : "—")}
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
              <input type="date" name="nextCheckinAt" required className={`${INPUT} min-w-0 text-[length:var(--text-body)]`} />
              <input
                type="text"
                name="waitingNote"
                placeholder="New waiting note (optional)"
                className={`${INPUT} min-w-0 text-[length:var(--text-body)]`}
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

      {/* Contextual strip — my pending join request */}
      {myRequest && myRequest.status === "pending" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[length:var(--text-body)] text-[var(--text)]">
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
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--danger)]">
          You&rsquo;ve marked yourself as outgoing on this task — this is the best moment to write
          up the wiki summary below before handing it off, while it&rsquo;s still fresh.
        </p>
      )}
      {myOpenPing && (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          You&rsquo;ve asked to talk to your coordinator about this task — pending.
        </p>
      )}

      {/* Two-column layout (task UI grammar): main column + reference
          rail at lg; rail stacks below main on smaller screens. */}
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0">
      {/* Who's on it — D3 (docs/plans/task-interface-plan.md): slots as
          first-class rows, the empty ones rendered too, so a staffing
          gap is visible without arithmetic. Also the one home for the
          slot-management actions — join requests, nominate, waive —
          which used to be scattered in disclosures further down. */}
      <section>
        <SectionHeading>Who&rsquo;s on it</SectionHeading>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {taskRow.capacity !== null
            ? `${realAssignments.length} of ${taskRow.capacity} slot${taskRow.capacity === 1 ? "" : "s"} filled`
            : `${realAssignments.length} holder${realAssignments.length === 1 ? "" : "s"} — uncapped`}
          {shadowAssignments.length > 0 &&
            ` · ${shadowAssignments.length} shadow${shadowAssignments.length === 1 ? "" : "s"}`}
        </p>

        <ul className="mt-2 flex flex-col gap-1.5">
          {realAssignments.map((a) => (
            <li key={a.memberId} className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <span aria-hidden="true" className="text-[var(--text)]">●</span>
              <span className="font-medium">{memberNameById.get(a.memberId) ?? "—"}</span>
              {a.isOutgoing && <Tag tone="warning">outgoing</Tag>}
              {a.gateWaivedBy && (
                <span className="text-[length:var(--text-meta)] text-[var(--warning)]">
                  requirement waived by {memberNameById.get(a.gateWaivedBy) ?? "—"}: {a.gateWaivedReason}
                </span>
              )}
            </li>
          ))}
          {Array.from({ length: emptySlotCount }, (_, i) => (
            <li key={`empty-${i}`} className="flex items-center gap-2 text-[length:var(--text-body)]">
              <span
                aria-hidden="true"
                className={taskRow.critical || taskRow.status === "unclaimed" ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}
              >
                ○
              </span>
              <span
                className={
                  taskRow.critical || taskRow.status === "unclaimed"
                    ? "font-medium text-[var(--danger)]"
                    : "text-[var(--text-muted)]"
                }
              >
                Open slot
              </span>
            </li>
          ))}
        </ul>

        {shadowAssignments.length > 0 && (
          <div className="mt-3">
            <p className="text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Learning alongside — shadows don&rsquo;t count toward capacity
            </p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {shadowAssignments.map((a) => (
                <li key={a.memberId} className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                  <span aria-hidden="true">◐</span>
                  {memberNameById.get(a.memberId) ?? "—"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(pendingRequests.length > 0 || resolvedRequests.length > 0) && requestGated && (
          <div className="mt-4">
            <p className="text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Join requests
            </p>
            {pendingRequests.length === 0 && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">None pending.</p>}
            <div className="mt-2">
              {pendingRequests.map((r) => (
                <div key={r.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p className="text-[length:var(--text-body)] text-[var(--text)]">
                    {memberNameById.get(r.memberId) ?? "—"} asked to join — {clock.dateTime(r.requestedAt)}
                  </p>
                  {resolvableRequestIds.has(r.id) && (
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
                <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">
                  Resolved requests ({resolvedRequests.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1 text-[length:var(--text-body)] text-[var(--text)]">
                  {resolvedRequests.map((r) => (
                    <li key={r.id}>
                      {memberNameById.get(r.memberId) ?? "—"} — {r.status}
                      {r.status === "declined" && r.declineReason && `: ${r.declineReason}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {canNominate && (
          // Rendered open when the board's "Ask someone about a slot…" link
          // brings you here (?nominate=1). The URL fragment alone isn't enough:
          // a browser only opens a closed <details> for a fragment on a full
          // page load, not on Next's client-side navigation, which is how that
          // link is almost always followed. The server deciding it also means
          // there is no open-attribute mismatch to hydrate around.
          <details open={nominateParam === "1"} className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--text)]">
              Nominate someone for this task
            </summary>
            <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              Claims it for them right away — they get a yes/no/not-now window to confirm or
              release it, no action required if it&rsquo;s a genuine fit.
            </p>
            {nominateAddsSlot && (
              <p className="mt-1 text-[length:var(--text-meta)] text-[var(--warning)]">
                This task is full — nominating adds a slot ({taskRow.capacity} →{" "}
                {(taskRow.capacity ?? 0) + 1}) before claiming them.
              </p>
            )}
            {taskRow.status === "waiting" && (
              <p className="mt-1 text-[length:var(--text-meta)] text-[var(--warning)]">
                This task is parked — they&rsquo;ll join it still parked, and can resume it once they&rsquo;ve looked it over.
              </p>
            )}
            {/* People suggested for this task, and why (src/lib/tasks/suggestions.ts): a proposer's
                pick, a newcomer's inviter and the people who met them. The coordinator is the one
                deciding whom to ask, and this is the door that acts on it. */}
            {suggestedForTask.length > 0 && taskRow.status === "unclaimed" && (
              <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
                Suggested:{" "}
                {suggestedForTask.map((p, i) => (
                  <span key={p.memberId}>
                    {i > 0 && "; "}
                    <span className="font-medium">{p.name}</span>{" "}
                    <span className="text-[var(--text-muted)]">({joinReasons(p.reasons, SUGGESTION_REASON_LABEL)})</span>
                  </span>
                ))}
                .
              </p>
            )}
            {/* id="nominate": the board card's "Ask someone about a slot…" link
                targets this form (/tasks/[id]#nominate). The id sits on the form,
                not the <details>, because fragment navigation opens the closed
                disclosures that *contain* its target, not the target itself. */}
            <form id="nominate" action={nominateForTaskAction} className="mt-3 flex max-w-[400px] scroll-mt-24 flex-col gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <select name="memberId" required defaultValue="" className={INPUT}>
                <option value="" disabled>
                  Who fits this?
                </option>
                {askCandidates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
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

        {canWaive && (
          <details className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--text)]">
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
      </section>

      {requirements.length > 0 && (
      <section className="mt-8">
        <SectionHeading>Requirements</SectionHeading>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Status only — add, edit, and remove live on the{" "}
          <Link href={`${taskPath}/edit`} className="text-[var(--accent-1)] hover:underline">
            edit screen
          </Link>
          .
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
              <li key={r.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-[length:var(--text-body)]">
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
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          This task can&rsquo;t be finished while any of these are still open. Add and remove live on
          the{" "}
          <Link href={`${taskPath}/edit`} className="text-[var(--accent-1)] hover:underline">
            edit screen
          </Link>
          .
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {dependencies.map((d) => (
            <li key={d.dependsOnTaskId} className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <Link href={`/tasks/${d.dependsOnTaskId}`} className="font-medium text-[var(--accent-1)] hover:underline">
                {d.title}
              </Link>
              <span className="text-[var(--text-muted)]">({d.status})</span>
            </li>
          ))}
        </ul>
      </section>
      )}

      {/* Notes render inline, never tab-gated — spec: "not buried
          behind a toggle, a mode switch, or a different part of the
          app." */}
      <p className="mt-8 text-[length:var(--text-body)] text-[var(--text-muted)]">
        The description above is the goal, not the method. Everything here is optional notes on
        how it&rsquo;s actually been done — never mistaken for the instructions.
      </p>

      <section className="mt-4">
        <SectionHeading>Wiki summary</SectionHeading>
        {notes.wikiRevisions.length > 0 ? (
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <p className="whitespace-pre-wrap text-[length:var(--text-body)] text-[var(--text)]">{notes.wikiRevisions[0].content}</p>
            <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              Last edited by {memberNameById.get(notes.wikiRevisions[0].editedBy) ?? "—"} on{" "}
              {clock.dateTime(notes.wikiRevisions[0].editedAt)}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">Nothing written up yet.</p>
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
            <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">
              Revision history ({notes.wikiRevisions.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 text-[length:var(--text-body)] text-[var(--text)]">
              {notes.wikiRevisions.slice(1).map((rev) => (
                <li key={rev.id}>
                  <span className="text-[var(--text-muted)]">
                    {memberNameById.get(rev.editedBy) ?? "—"} — {clock.dateTime(rev.editedAt)}:
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
        {notes.comments.length === 0 && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">No comments yet.</p>}
        <div className="mt-2">
          {notes.comments.map((c) => (
            <div key={c.id} className="mb-2">
              <div className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                {memberNameById.get(c.memberId) ?? "—"} — {clock.dateTime(c.createdAt)}
              </div>
              <p className="text-[length:var(--text-body)] text-[var(--text)]">{c.body}</p>
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
        {notes.resources.length === 0 && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">No resources linked yet.</p>}
        <ul className="mt-2 flex flex-col gap-1">
          {notes.resources.map((r) => (
            <li key={r.id} className="text-[length:var(--text-body)]">
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
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          A current holder marks these done and confirms or rejects proposed ones here; adding,
          editing and removing live on the{" "}
          <Link href={`${taskPath}/edit`} className="text-[var(--accent-1)] hover:underline">
            edit screen
          </Link>
          . Anyone&rsquo;s addition shows immediately but lands pending until a holder confirms it (an
          unclaimed task confirms immediately either way).
        </p>
        {milestones.length === 0 && <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">None yet.</p>}
        <div className="mt-3">
          {milestones.map((m) => (
            <div key={m.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{m.label}</span>
                {m.isDeadline && <Tag tone="accent">deadline</Tag>}
                {m.checkIn && <Tag tone="neutral">check-in</Tag>}
                {m.completedAt && <Tag tone="success">done {clock.date(m.completedAt)}</Tag>}
                {m.status === "pending" && (
                  <Tag tone="warning">pending — proposed by {memberNameById.get(m.proposedBy) ?? "—"}</Tag>
                )}
              </div>
              <div className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]" title={milestoneDateLabel(m).exact}>
                <time dateTime={m.resolvedDate ?? undefined} aria-label={milestoneDateLabel(m).exact}>{milestoneDateLabel(m).visible}</time>
              </div>

              {holdsTask && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <form action={setMilestoneDoneAction}>
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="milestoneId" value={m.id} />
                    <input type="hidden" name="done" value={m.completedAt ? "false" : "true"} />
                    <button type="submit" className={BUTTON_SECONDARY}>
                      {m.completedAt ? "Not done after all" : "Mark done"}
                    </button>
                  </form>
                  {m.status === "pending" && (
                    <>
                      <form action={confirmMilestoneAction}>
                        <input type="hidden" name="taskId" value={taskRow.id} />
                        <input type="hidden" name="milestoneId" value={m.id} />
                        <button type="submit" className={BUTTON_PRIMARY}>
                          Confirm
                        </button>
                      </form>
                      <form action={deleteMilestoneAction}>
                        <input type="hidden" name="taskId" value={taskRow.id} />
                        <input type="hidden" name="milestoneId" value={m.id} />
                        <button type="submit" className={BUTTON_SECONDARY}>
                          Reject
                        </button>
                      </form>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {showPeopleTab && (
      <>
      {isCommunityEndorsed && (
        <section className="mt-8">
          <SectionHeading>Candidacy</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Needs {taskRow.endorsementThreshold} endorsement
            {taskRow.endorsementThreshold === 1 ? "" : "s"} to confirm · browse window{" "}
            {taskRow.browsePeriodEnd
              ? browseWindowOpen
                ? `closes ${clock.deadline(taskRow.browsePeriodEnd)}`
                : `closed ${clock.deadline(taskRow.browsePeriodEnd)}`
              : "not set"}
          </p>

          {openCandidacies.length === 0 && resolvedCandidacies.length === 0 && (
            <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">Nobody has put themselves forward yet.</p>
          )}

          <div className="mt-3">
            {openCandidacies.map((c) => (
              <div key={c.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <p className="text-[length:var(--text-body)] text-[var(--text)]">
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
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">You&rsquo;ve endorsed this</span>
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
              <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">
                Resolved candidacies ({resolvedCandidacies.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-[length:var(--text-body)] text-[var(--text)]">
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
          the top now — only the declined outcome stays down here. The
          requests themselves moved into "Who's on it" (D3). */}
      {myRequest && myRequest.status === "declined" && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text)]">
          Your request to join was declined
          {myRequest.declineReason ? `: ${myRequest.declineReason}` : "."}
        </p>
      )}
      </>
      )}

      {showCoordinationTab && (
      <>
      {accompaniedMemberId && accompanimentEngagement && (
        <section className="mt-8">
          <SectionHeading>Engagement record</SectionHeading>
          <p className="mt-2 flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
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

      {accompaniedView && (
        <section className="mt-8">
          <SectionHeading>What {accompaniedView.name} has chosen to share</SectionHeading>
          <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            You always see how they&rsquo;re getting on with what they&rsquo;ve taken on (above). Anything more is theirs to
            choose, only for you, and starts again from nothing if someone else takes over.
          </p>
          <dl className="mt-3 flex flex-col gap-3">
            <div>
              <dt className="text-[length:var(--text-body)] font-medium text-[var(--text)]">Working style</dt>
              <dd className="text-[length:var(--text-body)] text-[var(--text)]">
                {accompaniedView.axes === null ? (
                  <span className="text-[var(--text-muted)]">Not shared.</span>
                ) : accompaniedView.axes.length === 0 ? (
                  <span className="text-[var(--text-muted)]">Shared, but they haven&rsquo;t placed themselves on any scale yet.</span>
                ) : (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {accompaniedView.axes.map((a) => (
                      <li key={a.axis}>
                        {a.axis}: <span className="text-[var(--text-muted)]">{a.position}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[length:var(--text-body)] font-medium text-[var(--text)]">Contribution overview</dt>
              <dd className="text-[length:var(--text-body)] text-[var(--text)]">
                {accompaniedView.contribution === null ? (
                  <span className="text-[var(--text-muted)]">Not shared.</span>
                ) : accompaniedView.contribution.length === 0 ? (
                  <span className="text-[var(--text-muted)]">Shared, and there is nothing yet.</span>
                ) : (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {accompaniedView.contribution.map((c) => (
                      <li key={c.category}>
                        {c.category}: <span className="text-[var(--text-muted)]">{c.done} done, {c.inHand} in hand
                        {c.ahead > 0 && `, ${c.ahead} ahead`}
                        {c.shifts > 0 && `, ${c.shifts} shift${c.shifts === 1 ? "" : "s"} completed`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {accompaniedView.answers !== null && (
              <div>
                <dt className="text-[length:var(--text-body)] font-medium text-[var(--text)]">Answers shared with you</dt>
                <dd className="text-[length:var(--text-body)] text-[var(--text)]">
                  {accompaniedView.answers.length === 0 ? (
                    <span className="text-[var(--text-muted)]">Shared, and there is nothing they have said yes to yet.</span>
                  ) : (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {accompaniedView.answers.map((a) => (
                        <li key={a.question}>
                          {a.question}: <span className="text-[var(--text-muted)]">{a.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {nominations.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Nominations</SectionHeading>
          <ul className="mt-2 flex flex-col gap-1.5">
            {nominations.map(({ nomination, nomineeName }) => (
              <li key={nomination.id} className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                {nomineeName}
                <Tag tone={NOMINATION_STATUS_TONE[nomination.status] ?? "neutral"}>
                  {NOMINATION_STATUS_LABEL[nomination.status] ?? nomination.status}
                </Tag>
                {nomination.status === "pending" && (
                  <span className="text-[var(--text-muted)]">
                    respond by {clock.deadline(nomination.respondByDeadline)}
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
          {openPings.length === 0 && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">None open.</p>}
          <div className="mt-2">
            {openPings.map((p) => (
              <div key={p.id} className="mb-1.5 flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                <span>
                  {memberNameById.get(p.requestedBy) ?? "—"} would like to talk about this task —{" "}
                  {clock.dateTime(p.createdAt)}
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
              <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">
                Resolved pings ({resolvedPings.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text)]">
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
          <SectionHeading>
            Subtasks
            {subtasks.length > 0 && (
              <span className="text-[length:var(--text-body)] font-normal text-[var(--text-muted)]">
                {" "}· {subtasks.filter((s) => s.status === "done").length} of {subtasks.length} done
              </span>
            )}
          </SectionHeading>
          {subtasks.length === 0 && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">None broken off yet.</p>}
          {subtasks.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {subtasks.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-[length:var(--text-body)]">
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
              <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--text)]">Split off a subtask</summary>
              <form action={splitSubtaskAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input type="text" name="title" required placeholder="Title" className={INPUT} />
                <textarea name="description" rows={2} placeholder="Description" className={INPUT} />

                <div className="flex flex-wrap items-center gap-2">
                  <SelectField name="branchId" defaultValue={taskRow.branchId} className={INPUT}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </SelectField>

                  <EffortFields defaultEffort={taskRow.effort} />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[length:var(--text-body)] text-[var(--text-muted)]">
                    Capacity:
                    <input type="number" name="capacity" defaultValue={1} min={1} className={`${INPUT} w-20`} />
                  </label>
                  <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
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

      {/* Reference rail — the compact status/people summary and the
          requirements summary. Stacks below the main column under lg.
          The full slot rows (with waived notes and outgoing tags) are
          the main column's "Who's on it" section (D3). */}
      <aside className="flex flex-col gap-4">
        <section className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Status</h2>
          <div className="mt-2">
            <StatusIcon status={taskRow.status} attentionLevel={taskRow.attentionLevel} showLabel />
          </div>
          {realAssignments.length > 0 && (
            <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
              Held by: {realAssignments.map((a) => memberNameById.get(a.memberId) ?? "—").join(", ")}
            </p>
          )}
          {shadowAssignments.length > 0 && (
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
              Shadowed by: {shadowAssignments.map((a) => memberNameById.get(a.memberId) ?? "—").join(", ")}
            </p>
          )}
          {taskRow.status === "waiting" && (
            <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
              Next check-in: {taskRow.nextCheckinAt ? checkInLabel(taskRow.nextCheckinAt) : "—"}
              {taskRow.waitingNote && <span className="text-[var(--text-muted)]"> — {taskRow.waitingNote}</span>}
            </p>
          )}
          {/* Park is a disclosure, not a menu row — it needs inputs.
              Suppressed while the attention nudge panel is showing (it
              carries its own Park form). */}
          {holdsTask && taskRow.status === "claimed" && !flagged && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[length:var(--text-meta)] font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
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
            <h2 className="text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              Requirements
            </h2>
            <ul className="mt-2 flex flex-col gap-1 text-[length:var(--text-body)]">
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

