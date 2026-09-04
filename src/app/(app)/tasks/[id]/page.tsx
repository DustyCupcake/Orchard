import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
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
  listTaskMilestones,
  tierNameLookup,
  describeRequirement,
} from "@/lib/tasks";
import { getCommunity, listBranches } from "@/lib/settings";
import { getCycle } from "@/lib/cycles";
import { isModuleEnabled } from "@/lib/modules";
import { listTaskQuestions } from "@/lib/input-rounds";
import { isAuthorizedToWaive, isCoordinationHolder } from "@/lib/coordination";
import { getAccompaniedMemberId } from "@/lib/recruitment";
import { computeEngagementPattern } from "@/lib/engagement";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import { Tag, type Tone, ATTENTION_TONE, Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_GHOST, INPUT, LABEL } from "@/components/ui/kit";
import {
  acceptJoinRequestAction,
  addCommentAction,
  addMilestoneAction,
  addResourceAction,
  claimAsShadowAction,
  confirmClaimAction,
  confirmMilestoneAction,
  createQuestionAction,
  createSignalAction,
  declineJoinRequestAction,
  deleteMilestoneAction,
  editWikiAction,
  endorseCandidacyAction,
  expressCandidacyAction,
  flagForGroupAction,
  pingCoordinatorAction,
  resolvePingAction,
  resolveSignalAction,
  rotateIntoShiftAction,
  setOutgoingAction,
  splitSubtaskAction,
  stopShadowingAction,
  suggestSomeoneAction,
  updateMilestoneAction,
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

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;

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
    cyclePhases,
    nominations,
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
    isCoordinationHolder(viewing, taskRow.branchId),
    isAuthorizedToWaive(viewing, taskRow.branchId, id),
    isAuthorizedToNominate(viewing, { id, branchId: taskRow.branchId }),
    listMyPings(viewing, id),
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
    listTaskQuestions(viewing, id),
    getCommunity(viewing),
    listTaskMilestones(viewing, id),
    taskRow.cycleId
      ? getCycle(viewing, taskRow.cycleId).then((c) => c.phases)
      : Promise.resolve([]),
    listNominationsForTask(viewing, id),
  ]);
  const groupCoverage = await getGroupCoverageStatus(db, id, requirements);
  const shiftsModuleOn = isModuleEnabled(communityRow, "shifts");
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

  const schedulePollHref = `/scheduling-polls/new?branchId=${taskRow.branchId}&title=${encodeURIComponent(taskRow.title)}`;

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <Link href="/board" className="text-[13px] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to board
      </Link>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">{taskRow.title}</h1>
        {taskRow.critical && <Tag tone="danger">critical</Tag>}
        {attention && <Tag tone={ATTENTION_TONE[taskRow.attentionLevel] ?? "neutral"}>{attention.label}</Tag>}
      </div>
      <div className="mt-1 text-[13px] text-[var(--text-muted)]">
        {branchRow?.name ?? "—"} · {effortSummary(taskRow.effort, taskRow.effortMagnitude)} ·{" "}
        {taskRow.status} · {realAssignments.length}
        {taskRow.capacity !== null ? `/${taskRow.capacity}` : ""} held
      </div>
      {parentTask && (
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Part of{" "}
          <Link href={`/tasks/${parentTask.id}`} className="font-medium text-[var(--accent-1)] hover:underline">
            {parentTask.title}
          </Link>
        </p>
      )}
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
      {taskRow.description && <p className="mt-3 text-[14px] text-[var(--text)]">{taskRow.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canShadow && (
          <form action={claimAsShadowAction}>
            <input type="hidden" name="taskId" value={taskRow.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Shadow this task
            </button>
          </form>
        )}
        {isShadowing && (
          <form action={stopShadowingAction} className="flex items-center gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            <span className="text-[13px] text-[var(--text-muted)]">You&rsquo;re shadowing this task.</span>
            <button type="submit" className={BUTTON_SECONDARY}>
              Stop shadowing
            </button>
          </form>
        )}
        {holdsTask && (
          <form action={setOutgoingAction}>
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="outgoing" value={(!myAssignment?.isOutgoing).toString()} />
            <button type="submit" className={BUTTON_SECONDARY}>
              {myAssignment?.isOutgoing ? "Unmark as outgoing" : "Mark yourself as outgoing"}
            </button>
          </form>
        )}
        {holdsTask && shiftsModuleOn && (
          <form action={rotateIntoShiftAction}>
            <input type="hidden" name="taskId" value={taskRow.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Rotate this task into a shift
            </button>
          </form>
        )}
        {canPingCoordinator && (
          <form action={pingCoordinatorAction}>
            <input type="hidden" name="taskId" value={taskRow.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Talk to my coordinator
            </button>
          </form>
        )}
        {/* Pre-fills this task's branch — see /scheduling-polls/new's own
            searchParams handling. Offered on every task rather than
            trying to guess which ones "need" a poll; there's no signal
            on Task to condition it on. */}
        <Link href={schedulePollHref} className={BUTTON_SECONDARY}>
          Schedule a poll
        </Link>
      </div>
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

      {requirements.length > 0 && (
        <ul className="mt-4 flex flex-col gap-0.5 text-[13px]">
          {requirements.map((r) => {
            if (r.mode === "group_coverage") {
              const covered = groupCoverage.get(r.id) ?? false;
              return (
                <li key={r.id} style={{ color: covered ? "var(--success)" : "var(--warning)" }}>
                  {describeRequirement(r, tierNames)} — {covered ? "covered" : "not yet covered"}
                </li>
              );
            }
            if (r.mode === "soft_priority") {
              return (
                <li key={r.id} className="text-[var(--text-muted)]">
                  {describeRequirement(r, tierNames)} (preferred)
                </li>
              );
            }
            return (
              <li key={r.id} style={{ color: unmetIds.has(r.id) ? "var(--danger)" : "var(--success)" }}>
                {describeRequirement(r, tierNames)}
                {unmetIds.has(r.id) ? " (not met)" : " (met)"}
              </li>
            );
          })}
        </ul>
      )}

      {needsSelfAssignConfirmation && (
        <section className="mt-6 rounded-[var(--radius-md)] p-3.5" style={{ background: "var(--warning-soft)", border: "1px solid var(--warning-border)" }}>
          <p className="text-[14px] font-medium" style={{ color: "var(--warning)" }}>
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
        </section>
      )}

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

      {myRequest && myRequest.status === "pending" && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--text)]">
          You&rsquo;ve asked to join this task — pending.
          <form action={withdrawJoinRequestAction}>
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="requestId" value={myRequest.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Withdraw
            </button>
          </form>
        </p>
      )}
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

      <section className="mt-8">
        <SectionHeading>Signal something</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
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
      </section>

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

      {(subtasks.length > 0 || holdsTask) && (
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

                  <select name="effort" required defaultValue={taskRow.effort} className={INPUT}>
                    <option value="one_off">One-off</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="owns_a_thing">Owns-a-thing</option>
                  </select>

                  <select name="duration" defaultValue="few_hours" className={INPUT}>
                    <option value="under_hour">Under an hour</option>
                    <option value="few_hours">A few hours</option>
                    <option value="half_day">Half a day</option>
                    <option value="multi_day">Multi-day</option>
                  </select>
                  <span className="text-[12px] text-[var(--text-muted)]">(if one-off)</span>

                  <input type="number" name="hoursPerWeek" placeholder="hours/week" min={0} className={`${INPUT} w-32`} />
                  <span className="text-[12px] text-[var(--text-muted)]">(if ongoing/owns-a-thing)</span>
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

      <div className="my-9 h-px bg-[var(--border)]" />
      <p className="text-[13px] text-[var(--text-muted)]">
        The description above is the goal, not the method. Everything below is optional notes on
        how it&rsquo;s actually been done — never mistaken for the instructions.
      </p>

      <section className="mt-6">
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
                {m.status === "pending" && (
                  <Tag tone="warning">pending — proposed by {memberNameById.get(m.proposedBy) ?? "—"}</Tag>
                )}
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                {m.resolvedDate ?? "unresolved"}
                {m.drifted && <span style={{ color: "var(--warning)" }}> · drifted from its anchor</span>}
              </div>

              {holdsTask && (
                <>
                  <form action={updateMilestoneAction} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="milestoneId" value={m.id} />
                    <MilestoneDateFields milestone={m} phases={cyclePhases} />
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

        <h3 className="mt-4 text-[15px] font-medium text-[var(--text)]">Add a milestone</h3>
        <form action={addMilestoneAction} className="mt-2 flex max-w-[420px] flex-col gap-2">
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="label" required placeholder="Label (e.g. Deposit due)" className={INPUT} />
          <MilestoneDateFields phases={cyclePhases} />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Add
          </button>
        </form>
      </section>

      <section className="mt-8">
        <SectionHeading>Questions</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Anyone can ask something tied to this task — it queues silently and bundles into the
          next Input round, no ping sent now. Answers stay visible here once the round&rsquo;s open.
        </p>

        {questions.length === 0 && <p className="mt-3 text-[13px] text-[var(--text-muted)]">No questions yet.</p>}
        <div className="mt-3">
          {questions.map((q) => {
            const tally =
              q.responseType !== "free_text"
                ? q.options.map((o) => ({
                    option: o,
                    count: q.responses.filter((r) => {
                      const v = r.value as string | string[];
                      return Array.isArray(v) ? v.includes(o) : v === o;
                    }).length,
                  }))
                : null;
            return (
              <div key={q.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
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
                      <li key={r.id}>{String(r.value)}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <form action={createQuestionAction} className="mt-3 flex max-w-[500px] flex-col gap-2">
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="text" required placeholder="Ask something" className={INPUT} />
          <select name="responseType" defaultValue="free_text" className={INPUT}>
            <option value="free_text">Free text</option>
            <option value="single_choice">Single choice</option>
            <option value="multi_choice">Multi choice</option>
          </select>
          <input type="text" name="options" placeholder="options for choice types, comma-separated" className={INPUT} />
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
      </section>
    </main>
  );
}

type MilestoneRow = Awaited<ReturnType<typeof listTaskMilestones>>[number];
type CyclePhaseRow = Awaited<ReturnType<typeof getCycle>>["phases"][number];

const ANCHOR_LABEL: Record<string, string> = {
  phase_start: "a Phase's start",
  phase_end: "a Phase's end",
  cycle_start: "the Cycle's start",
  cycle_end: "the Cycle's end",
};

// Shared by the "add" form (no `milestone`, all fields blank) and each
// existing milestone's own "edit" form (prefilled from it) — mirrors
// src/app/participation/page.tsx's PhaseBoundaryFields, generalized to
// the 4-way phase-or-cycle anchor plus an optional Phase override.
function MilestoneDateFields({ milestone, phases }: { milestone?: MilestoneRow; phases: CyclePhaseRow[] }) {
  const mode =
    !milestone || milestone.dateType === "absolute" ? "absolute" : `relative_${milestone.relativeMode}`;

  return (
    <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <legend className="px-1 text-[12px] text-[var(--text-muted)]">When</legend>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Mode</span>
          <select name="dateMode" defaultValue={mode} className={INPUT}>
            <option value="absolute">Absolute date</option>
            <option value="relative_offset">Relative — offset (days from an anchor)</option>
            <option value="relative_percent">Relative — percent (between an anchor&rsquo;s two ends)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Absolute date (used when mode is Absolute)</span>
          <input
            type="date"
            name="absoluteDate"
            defaultValue={milestone?.dateType === "absolute" ? (milestone.absoluteDate ?? "") : ""}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Anchor (used when mode is relative)</span>
          <select name="anchor" defaultValue={milestone?.anchorType ?? "cycle_start"} className={INPUT}>
            <option value="phase_start">Phase start</option>
            <option value="phase_end">Phase end</option>
            <option value="cycle_start">Cycle start</option>
            <option value="cycle_end">Cycle end</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Phase (used when anchor is a Phase — blank defaults to this task&rsquo;s own Phase)</span>
          <select name="milestonePhaseId" defaultValue={milestone?.phaseId ?? ""} className={INPUT}>
            <option value="">This task&rsquo;s own Phase</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Offset days (used when mode is relative offset, and no target date is given below)</span>
          <input
            type="number"
            name="offsetDays"
            defaultValue={milestone?.relativeMode === "offset" ? (milestone.offsetDays ?? "") : ""}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Percent 0-100 (used when mode is relative percent, and no target date is given below)</span>
          <input
            type="number"
            min={0}
            max={100}
            name="percent"
            defaultValue={milestone?.relativeMode === "percent" ? (milestone.percent ?? "") : ""}
            className={INPUT}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Or drag to this target date (recomputes and persists the offset/percent above)</span>
          <input type="date" name="targetDate" className={INPUT} />
        </label>
      </div>
      {milestone && milestone.resolvedDate && (
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">
          Currently: {milestone.resolvedDate}
          {milestone.dateType === "relative" && milestone.anchorType && (
            <>
              {" — "}
              {milestone.relativeMode === "offset"
                ? `${milestone.offsetDays} day(s) from ${ANCHOR_LABEL[milestone.anchorType]}`
                : `${milestone.percent}% of the way through ${milestone.anchorType.startsWith("phase") ? "the Phase" : "the Cycle"}`}
            </>
          )}
        </p>
      )}
    </fieldset>
  );
}
