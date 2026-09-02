import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import {
  getParentTaskSummary,
  getTask,
  getTaskNotes,
  getUnmetRequirements,
  listCandidacies,
  listJoinRequests,
  listMyEndorsements,
  listMyPings,
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
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
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
} from "./actions";

const SIGNAL_LABELS: Record<string, string> = {
  stalled: "looks stalled",
  might_need_help: "owner might need help",
  something_feels_off: "something feels off",
  worth_a_look: "worth a coordinator look",
};

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;

  const taskRow = await getTask(currentMember, id);
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
    myPings,
    communityMembers,
    questions,
    communityRow,
    milestones,
    cyclePhases,
  ] = await Promise.all([
    db.select().from(branch).where(eq(branch.id, taskRow.branchId)).then((r) => r[0]),
    getTaskNotes(currentMember, id),
    listRequirements(currentMember, id),
    getUnmetRequirements(db, currentMember, id),
    tierNameLookup(currentMember.communityId),
    listSubtasks(currentMember, id),
    taskRow.parentTaskId ? getParentTaskSummary(currentMember, taskRow.parentTaskId) : null,
    listBranches(currentMember),
    listJoinRequests(currentMember, id),
    isCommunityEndorsed ? listCandidacies(currentMember, id) : [],
    isCoordinationHolder(currentMember, taskRow.branchId),
    isAuthorizedToWaive(currentMember, taskRow.branchId, id),
    listMyPings(currentMember, id),
    db.select().from(member).where(eq(member.communityId, currentMember.communityId)),
    listTaskQuestions(currentMember, id),
    getCommunity(currentMember),
    listTaskMilestones(currentMember, id),
    taskRow.cycleId
      ? getCycle(currentMember, taskRow.cycleId).then((c) => c.phases)
      : Promise.resolve([]),
  ]);
  const shiftsModuleOn = isModuleEnabled(communityRow, "shifts");
  const myEndorsements = isCommunityEndorsed
    ? await listMyEndorsements(
        currentMember,
        candidacies.map((c) => c.id),
      )
    : new Set<string>();
  // Signals and pings are only visible to that branch's coordination
  // holders — see docs/spec.md's "Anonymous task signal" and "Talk to
  // my coordinator" (Coordination mechanics) — checked up front instead
  // of relying on listSignals()/listPings() throwing, matching how
  // canApproveRequests is checked elsewhere on this page.
  const [signals, pings] = isCoordHolderForBranch
    ? await Promise.all([listSignals(currentMember, id), listPings(currentMember, id)])
    : [[], []];

  // A shadow isn't a real holder — see lifecycle.ts's assignmentCount(),
  // which excludes shadow rows for the same reason (docs/spec.md's
  // "Shadow slots & succession": doesn't count toward capacity, isn't
  // who "Held by" means).
  const realAssignments = taskRow.assignments.filter((a) => !a.isShadow);
  const shadowAssignments = taskRow.assignments.filter((a) => a.isShadow);
  const myAssignment = taskRow.assignments.find((a) => a.memberId === currentMember.id);
  const holdsTask = realAssignments.some((a) => a.memberId === currentMember.id);
  const isShadowing = myAssignment?.isShadow === true;
  const canShadow =
    !holdsTask && !isShadowing && (taskRow.status === "claimed" || taskRow.status === "waiting");
  const requestGated = taskRow.openness === "request" || taskRow.openness === "coordination_approved";
  const coordinationHolders = taskRow.assignments.filter((a) => a.isCoordinationSlot);
  const canApproveRequests =
    holdsTask &&
    (taskRow.openness !== "coordination_approved" ||
      coordinationHolders.length === 0 ||
      coordinationHolders.some((a) => a.memberId === currentMember.id));
  const pendingRequests = joinRequests.filter((r) => r.status === "pending");
  const resolvedRequests = joinRequests.filter((r) => r.status !== "pending");
  const myRequest = joinRequests.find((r) => r.memberId === currentMember.id);

  const browseWindowOpen = Boolean(
    taskRow.browsePeriodEnd && taskRow.browsePeriodEnd.getTime() > Date.now(),
  );
  const myCandidacy = candidacies.find((c) => c.memberId === currentMember.id);
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

  // communityMembers (fetched above for the waive/suggest selects)
  // already covers every member who could plausibly show up by name
  // anywhere on this page — no need for a second, narrower lookup.
  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));

  const unmetIds = new Set(unmetRequirements.map((r) => r.id));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <p>
        <Link href="/board" style={{ color: "inherit" }}>
          ← Back to board
        </Link>
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h1>
        {taskRow.title}
        {taskRow.critical && <span style={{ color: "crimson" }}> · critical</span>}
        {ATTENTION_STYLES[taskRow.attentionLevel] && (
          <span
            style={{ color: ATTENTION_STYLES[taskRow.attentionLevel].color, fontWeight: 600 }}
          >
            {" "}
            · ⚠ {ATTENTION_STYLES[taskRow.attentionLevel].label}
          </span>
        )}
      </h1>
      <div style={{ fontSize: "0.9rem", color: "#666" }}>
        {branchRow?.name ?? "—"} · {effortSummary(taskRow.effort, taskRow.effortMagnitude)} ·{" "}
        {taskRow.status} · {realAssignments.length}
        {taskRow.capacity !== null ? `/${taskRow.capacity}` : ""} held
      </div>
      {parentTask && (
        <p style={{ fontSize: "0.85rem" }}>
          Part of{" "}
          <Link href={`/tasks/${parentTask.id}`} style={{ color: "inherit" }}>
            {parentTask.title}
          </Link>
        </p>
      )}
      {realAssignments.length > 0 && (
        <p>
          Held by:{" "}
          {realAssignments.map((a) => memberNameById.get(a.memberId) ?? "—").join(", ")}
        </p>
      )}
      {shadowAssignments.length > 0 && (
        <p style={{ color: "#666" }}>
          Shadowed by:{" "}
          {shadowAssignments.map((a) => memberNameById.get(a.memberId) ?? "—").join(", ")}
        </p>
      )}
      {realAssignments
        .filter((a) => a.gateWaivedBy)
        .map((a) => (
          <p key={a.memberId} style={{ fontSize: "0.85rem", color: "#a15c00" }}>
            {memberNameById.get(a.memberId) ?? "—"}&rsquo;s requirement was waived by{" "}
            {memberNameById.get(a.gateWaivedBy!) ?? "—"}: {a.gateWaivedReason}
          </p>
        ))}
      {taskRow.description && <p>{taskRow.description}</p>}

      {canShadow && (
        <form action={claimAsShadowAction} style={{ marginBottom: "0.5rem" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit">Shadow this task</button>
        </form>
      )}
      {isShadowing && (
        <form action={stopShadowingAction} style={{ marginBottom: "0.5rem" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <span style={{ fontSize: "0.85rem", color: "#666", marginRight: "0.5rem" }}>
            You&rsquo;re shadowing this task.
          </span>
          <button type="submit">Stop shadowing</button>
        </form>
      )}

      {holdsTask && (
        <form action={setOutgoingAction} style={{ marginBottom: "0.5rem" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="hidden" name="outgoing" value={(!myAssignment?.isOutgoing).toString()} />
          <button type="submit">
            {myAssignment?.isOutgoing
              ? "Unmark as outgoing"
              : "Mark yourself as outgoing (not continuing next cycle)"}
          </button>
        </form>
      )}
      {myAssignment?.isOutgoing && notes.wikiRevisions.length === 0 && (
        <p style={{ color: "crimson", fontSize: "0.9rem" }}>
          You&rsquo;ve marked yourself as outgoing on this task — this is the best moment to write
          up the wiki summary below before handing it off, while it&rsquo;s still fresh.
        </p>
      )}

      {holdsTask && shiftsModuleOn && (
        <form action={rotateIntoShiftAction} style={{ marginBottom: "0.5rem" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit">Rotate this task into a shift</button>
          <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "#666" }}>
            Genuinely unloved? Turn it into a recurring shift others can sign up for — this task
            stays exactly as it is, untouched.
          </span>
        </form>
      )}

      {canPingCoordinator && (
        <form action={pingCoordinatorAction} style={{ marginBottom: "0.5rem" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <button type="submit">Talk to my coordinator</button>
        </form>
      )}
      {myOpenPing && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          You&rsquo;ve asked to talk to your coordinator about this task — pending.
        </p>
      )}

      {requirements.length > 0 && (
        <ul style={{ fontSize: "0.85rem" }}>
          {requirements.map((r) => (
            <li key={r.id} style={{ color: unmetIds.has(r.id) ? "crimson" : "#2a7a2a" }}>
              {describeRequirement(r, tierNames)}
              {unmetIds.has(r.id) ? " (not met)" : " (met)"}
            </li>
          ))}
        </ul>
      )}

      {needsSelfAssignConfirmation && (
        <section
          style={{
            marginTop: "1rem",
            border: "1px solid #e0a840",
            borderRadius: 6,
            padding: "0.75rem",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>
            You coordinate this branch — are you sure there isn&rsquo;t someone with just the
            skills for this?
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
            <form action={confirmClaimAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit">Yes, I&rsquo;ll take it</button>
            </form>
            <form action={suggestSomeoneAction} style={{ display: "flex", gap: "0.4rem" }}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <select name="memberId" defaultValue="" style={{ padding: "0.3rem" }}>
                <option value="" disabled>
                  Suggest someone…
                </option>
                {communityMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button type="submit">Suggest</button>
            </form>
            <form action={flagForGroupAction}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit">Flag for the group</button>
            </form>
          </div>
        </section>
      )}

      {canWaive && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
            Waive a requirement and claim for someone
          </summary>
          <form
            action={waiveAndClaimAction}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              marginTop: "0.5rem",
              maxWidth: 400,
            }}
          >
            <input type="hidden" name="taskId" value={taskRow.id} />
            <select name="memberId" required defaultValue="" style={{ padding: "0.4rem" }}>
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
              style={{ padding: "0.4rem" }}
            />
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Waive and claim
            </button>
          </form>
        </details>
      )}

      {isCommunityEndorsed && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Candidacy</h2>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Needs {taskRow.endorsementThreshold} endorsement
            {taskRow.endorsementThreshold === 1 ? "" : "s"} to confirm · browse window{" "}
            {taskRow.browsePeriodEnd
              ? browseWindowOpen
                ? `closes ${taskRow.browsePeriodEnd.toLocaleString()}`
                : `closed ${taskRow.browsePeriodEnd.toLocaleString()}`
              : "not set"}
          </p>

          {openCandidacies.length === 0 && resolvedCandidacies.length === 0 && (
            <p style={{ color: "#666" }}>Nobody has put themselves forward yet.</p>
          )}

          {openCandidacies.map((c) => (
            <div key={c.id} style={{ marginBottom: "0.5rem" }}>
              <p style={{ margin: 0 }}>
                {memberNameById.get(c.memberId) ?? "—"} — {c.endorsementCount}/
                {taskRow.endorsementThreshold} endorsements
              </p>
              {c.memberId === currentMember.id && (
                <form action={withdrawCandidacyAction} style={{ marginTop: "0.25rem" }}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="candidacyId" value={c.id} />
                  <button type="submit">Withdraw</button>
                </form>
              )}
              {c.memberId !== currentMember.id && myEndorsements.has(c.id) && (
                <span style={{ fontSize: "0.85rem", color: "#666" }}>You&rsquo;ve endorsed this</span>
              )}
              {c.memberId !== currentMember.id && !myEndorsements.has(c.id) && browseWindowOpen && (
                <form action={endorseCandidacyAction} style={{ marginTop: "0.25rem" }}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="candidacyId" value={c.id} />
                  <button type="submit">Endorse</button>
                </form>
              )}
            </div>
          ))}

          {resolvedCandidacies.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                Resolved candidacies ({resolvedCandidacies.length})
              </summary>
              <ul style={{ fontSize: "0.8rem" }}>
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
            <form action={expressCandidacyAction} style={{ marginTop: "0.75rem" }}>
              <input type="hidden" name="taskId" value={taskRow.id} />
              <button type="submit">Put yourself forward</button>
            </form>
          )}
        </section>
      )}

      {myRequest && myRequest.status === "pending" && (
        <p style={{ fontSize: "0.85rem" }}>
          You&rsquo;ve asked to join this task — pending.
          <form
            action={withdrawJoinRequestAction}
            style={{ display: "inline", marginLeft: "0.5rem" }}
          >
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="requestId" value={myRequest.id} />
            <button type="submit">Withdraw</button>
          </form>
        </p>
      )}
      {myRequest && myRequest.status === "declined" && (
        <p style={{ fontSize: "0.85rem" }}>
          Your request to join was declined
          {myRequest.declineReason ? `: ${myRequest.declineReason}` : "."}
        </p>
      )}

      {(pendingRequests.length > 0 || resolvedRequests.length > 0) && requestGated && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Join requests</h2>
          {pendingRequests.length === 0 && <p style={{ color: "#666" }}>None pending.</p>}
          {pendingRequests.map((r) => (
            <div key={r.id} style={{ marginBottom: "0.5rem" }}>
              <p style={{ margin: 0 }}>
                {memberNameById.get(r.memberId) ?? "—"} asked to join —{" "}
                {new Date(r.requestedAt).toLocaleString()}
              </p>
              {canApproveRequests && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                  <form action={acceptJoinRequestAction}>
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <button type="submit">Accept</button>
                  </form>
                  <form
                    action={declineJoinRequestAction}
                    style={{ display: "flex", gap: "0.5rem" }}
                  >
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <input
                      type="text"
                      name="reason"
                      placeholder="reason (optional)"
                      style={{ padding: "0.3rem" }}
                    />
                    <button type="submit">Decline</button>
                  </form>
                </div>
              )}
            </div>
          ))}

          {resolvedRequests.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                Resolved requests ({resolvedRequests.length})
              </summary>
              <ul style={{ fontSize: "0.8rem" }}>
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

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Signal something</h2>
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          A quiet, anonymous nudge to that branch&rsquo;s coordination — no detail required, and
          nothing here says it was you.
        </p>
        <form action={createSignalAction} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <select name="kind" defaultValue="worth_a_look" style={{ padding: "0.4rem" }}>
            {Object.entries(SIGNAL_LABELS).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
          <button type="submit">Send signal</button>
        </form>

        {isCoordHolderForBranch && (
          <div style={{ marginTop: "0.75rem" }}>
            {openSignals.length === 0 && <p style={{ color: "#666" }}>No open signals.</p>}
            {openSignals.map((s) => (
              <div key={s.id} style={{ marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.9rem" }}>
                  {SIGNAL_LABELS[s.kind] ?? s.kind} —{" "}
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>{" "}
                <form action={resolveSignalAction} style={{ display: "inline" }}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="signalId" value={s.id} />
                  <button type="submit">Dismiss</button>
                </form>
              </div>
            ))}
            {resolvedSignals.length > 0 && (
              <details style={{ marginTop: "0.5rem" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                  Dismissed signals ({resolvedSignals.length})
                </summary>
                <ul style={{ fontSize: "0.8rem" }}>
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
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Talk-to-coordinator pings</h2>
          {openPings.length === 0 && <p style={{ color: "#666" }}>None open.</p>}
          {openPings.map((p) => (
            <div key={p.id} style={{ marginBottom: "0.4rem" }}>
              <span style={{ fontSize: "0.9rem" }}>
                {memberNameById.get(p.requestedBy) ?? "—"} would like to talk about this task —{" "}
                {new Date(p.createdAt).toLocaleString()}
              </span>{" "}
              <form action={resolvePingAction} style={{ display: "inline" }}>
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input type="hidden" name="pingId" value={p.id} />
                <button type="submit">Mark resolved</button>
              </form>
            </div>
          ))}
          {resolvedPings.length > 0 && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                Resolved pings ({resolvedPings.length})
              </summary>
              <ul style={{ fontSize: "0.8rem" }}>
                {resolvedPings.map((p) => (
                  <li key={p.id}>{memberNameById.get(p.requestedBy) ?? "—"}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {(subtasks.length > 0 || holdsTask) && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Subtasks</h2>
          {subtasks.length === 0 && <p style={{ color: "#666" }}>None broken off yet.</p>}
          {subtasks.length > 0 && (
            <ul>
              {subtasks.map((s) => (
                <li key={s.id}>
                  <Link href={`/tasks/${s.id}`} style={{ color: "inherit" }}>
                    {s.title}
                  </Link>{" "}
                  <span style={{ color: "#666", fontSize: "0.85rem" }}>({s.status})</span>
                </li>
              ))}
            </ul>
          )}

          {holdsTask && (
            <details style={{ marginTop: "0.5rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
                Split off a subtask
              </summary>
              <form
                action={splitSubtaskAction}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  marginTop: "0.75rem",
                }}
              >
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input
                  type="text"
                  name="title"
                  required
                  placeholder="Title"
                  style={{ padding: "0.4rem" }}
                />
                <textarea
                  name="description"
                  rows={2}
                  placeholder="Description"
                  style={{ padding: "0.4rem" }}
                />

                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                  <select name="branchId" defaultValue={taskRow.branchId} style={{ padding: "0.4rem" }}>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>

                  <select name="effort" required defaultValue={taskRow.effort} style={{ padding: "0.4rem" }}>
                    <option value="one_off">One-off</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="owns_a_thing">Owns-a-thing</option>
                  </select>

                  <select name="duration" defaultValue="few_hours" style={{ padding: "0.4rem" }}>
                    <option value="under_hour">Under an hour</option>
                    <option value="few_hours">A few hours</option>
                    <option value="half_day">Half a day</option>
                    <option value="multi_day">Multi-day</option>
                  </select>
                  <span style={{ fontSize: "0.8rem", color: "#666" }}>(if one-off)</span>

                  <input
                    type="number"
                    name="hoursPerWeek"
                    placeholder="hours/week"
                    min={0}
                    style={{ padding: "0.4rem", width: "8rem" }}
                  />
                  <span style={{ fontSize: "0.8rem", color: "#666" }}>(if ongoing/owns-a-thing)</span>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <label>
                    Capacity:{" "}
                    <input
                      type="number"
                      name="capacity"
                      defaultValue={1}
                      min={1}
                      style={{ padding: "0.4rem", width: "5rem" }}
                    />
                  </label>
                  <label>
                    <input type="checkbox" name="critical" /> Critical
                  </label>
                </div>

                <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
                  Split off
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      <hr style={{ margin: "2rem 0" }} />
      <p style={{ color: "#666", fontSize: "0.85rem" }}>
        The description above is the goal, not the method. Everything below is optional notes on
        how it&rsquo;s actually been done — never mistaken for the instructions.
      </p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Wiki summary</h2>
        {notes.wikiRevisions.length > 0 ? (
          <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem" }}>
            <p style={{ whiteSpace: "pre-wrap" }}>{notes.wikiRevisions[0].content}</p>
            <p style={{ fontSize: "0.8rem", color: "#666" }}>
              Last edited by {memberNameById.get(notes.wikiRevisions[0].editedBy) ?? "—"} on{" "}
              {new Date(notes.wikiRevisions[0].editedAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p style={{ color: "#666" }}>Nothing written up yet.</p>
        )}

        <form
          action={editWikiAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}
        >
          <input type="hidden" name="taskId" value={taskRow.id} />
          <textarea
            name="content"
            rows={4}
            required
            defaultValue={notes.wikiRevisions[0]?.content ?? ""}
            placeholder="What's worked, what to watch out for, where the good deal was..."
            style={{ padding: "0.5rem" }}
          />
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Save wiki edit
          </button>
        </form>

        {notes.wikiRevisions.length > 1 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>
              Revision history ({notes.wikiRevisions.length})
            </summary>
            <ul style={{ fontSize: "0.8rem" }}>
              {notes.wikiRevisions.slice(1).map((rev) => (
                <li key={rev.id}>
                  {memberNameById.get(rev.editedBy) ?? "—"} —{" "}
                  {new Date(rev.editedAt).toLocaleString()}: {rev.content}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Comments</h2>
        {notes.comments.length === 0 && <p style={{ color: "#666" }}>No comments yet.</p>}
        {notes.comments.map((c) => (
          <div key={c.id} style={{ marginBottom: "0.5rem" }}>
            <div style={{ fontSize: "0.8rem", color: "#666" }}>
              {memberNameById.get(c.memberId) ?? "—"} — {new Date(c.createdAt).toLocaleString()}
            </div>
            <p style={{ margin: 0 }}>{c.body}</p>
          </div>
        ))}

        <form action={addCommentAction} style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input
            type="text"
            name="body"
            required
            placeholder="Add a comment…"
            style={{ padding: "0.4rem", flex: 1 }}
          />
          <button type="submit">Post</button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Resources</h2>
        {notes.resources.length === 0 && <p style={{ color: "#666" }}>No resources linked yet.</p>}
        <ul>
          {notes.resources.map((r) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                {r.label}
              </a>
              {r.tag && <span style={{ color: "#666" }}> — {r.tag}</span>}
            </li>
          ))}
        </ul>

        <form
          action={addResourceAction}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}
        >
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="label" required placeholder="Label" style={{ padding: "0.4rem" }} />
          <input
            type="url"
            name="url"
            required
            placeholder="https://…"
            style={{ padding: "0.4rem", flex: 1 }}
          />
          <input
            type="text"
            name="tag"
            placeholder="tag (optional)"
            style={{ padding: "0.4rem" }}
          />
          <button type="submit">Add</button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Milestones</h2>
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          A current holder adds/edits/removes these directly; anyone else&rsquo;s addition shows
          immediately but lands pending until a holder confirms or rejects it (an unclaimed task
          confirms immediately either way).
        </p>
        {milestones.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
        {milestones.map((m) => (
          <div
            key={m.id}
            style={{
              border: "1px solid #ccc",
              borderRadius: 6,
              padding: "0.6rem",
              marginBottom: "0.5rem",
            }}
          >
            <strong>{m.label}</strong>
            {m.status === "pending" && (
              <span style={{ color: "#b8860b" }}>
                {" "}
                · pending — proposed by {memberNameById.get(m.proposedBy) ?? "—"}
              </span>
            )}
            <div style={{ fontSize: "0.85rem", color: "#666" }}>
              {m.resolvedDate ?? "unresolved"}
              {m.drifted && <span style={{ color: "#b8860b" }}> · drifted from its anchor</span>}
            </div>

            {holdsTask && (
              <>
                <form
                  action={updateMilestoneAction}
                  style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem" }}
                >
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="milestoneId" value={m.id} />
                  <MilestoneDateFields milestone={m} phases={cyclePhases} />
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="submit">Save</button>
                  </div>
                </form>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                  {m.status === "pending" && (
                    <form action={confirmMilestoneAction}>
                      <input type="hidden" name="taskId" value={taskRow.id} />
                      <input type="hidden" name="milestoneId" value={m.id} />
                      <button type="submit">Confirm</button>
                    </form>
                  )}
                  <form action={deleteMilestoneAction}>
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="milestoneId" value={m.id} />
                    <button type="submit">{m.status === "pending" ? "Reject" : "Remove"}</button>
                  </form>
                </div>
              </>
            )}
          </div>
        ))}

        <h3 style={{ fontSize: "1rem", marginTop: "1rem" }}>Add a milestone</h3>
        <form
          action={addMilestoneAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 420 }}
        >
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="label" required placeholder="Label (e.g. Deposit due)" style={{ padding: "0.4rem" }} />
          <MilestoneDateFields phases={cyclePhases} />
          <button type="submit" style={{ width: "fit-content" }}>
            Add
          </button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Questions</h2>
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          Anyone can ask something tied to this task — it queues silently and bundles into the
          next Input round, no ping sent now. Answers stay visible here once the round&rsquo;s open.
        </p>

        {questions.length === 0 && <p style={{ color: "#666" }}>No questions yet.</p>}
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
            <div
              key={q.id}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
            >
              <strong>{q.text}</strong>{" "}
              <span style={{ fontSize: "0.8rem", color: "#666" }}>
                {q.status === "queued" && "· queued for the next round"}
                {q.status === "open" && (
                  <>
                    ·{" "}
                    <Link href="/input-rounds" style={{ color: "inherit" }}>
                      open in the current round — answer it there
                    </Link>
                  </>
                )}
                {q.status === "closed" && `· closed, ${q.responses.length} response(s)`}
                {q.priority ? " · can't move forward without this" : ""}
                {q.deadline ? ` · needed by ${new Date(q.deadline).toLocaleDateString()}` : ""}
              </span>
              {tally && q.responses.length > 0 && (
                <ul style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                  {tally.map((t) => (
                    <li key={t.option}>
                      {t.option}: {t.count}
                    </li>
                  ))}
                </ul>
              )}
              {!tally && q.responses.length > 0 && (
                <ul style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                  {q.responses.map((r) => (
                    <li key={r.id}>{String(r.value)}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        <form
          action={createQuestionAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem", maxWidth: 500 }}
        >
          <input type="hidden" name="taskId" value={taskRow.id} />
          <input type="text" name="text" required placeholder="Ask something" style={{ padding: "0.4rem" }} />
          <select name="responseType" defaultValue="free_text" style={{ padding: "0.4rem" }}>
            <option value="free_text">Free text</option>
            <option value="single_choice">Single choice</option>
            <option value="multi_choice">Multi choice</option>
          </select>
          <input
            type="text"
            name="options"
            placeholder="options for choice types, comma-separated"
            style={{ padding: "0.4rem" }}
          />
          <label style={{ fontSize: "0.85rem" }}>
            Deadline (optional)
            <input type="date" name="deadline" style={{ padding: "0.4rem", marginLeft: "0.5rem" }} />
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            <input type="checkbox" name="priority" /> Can&rsquo;t move forward without this
          </label>
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
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
    <fieldset style={{ border: "1px solid #eee", borderRadius: 4, padding: "0.5rem" }}>
      <legend style={{ fontSize: "0.85rem" }}>When</legend>
      <label>
        Mode
        <br />
        <select name="dateMode" defaultValue={mode} style={{ padding: "0.4rem", width: "100%" }}>
          <option value="absolute">Absolute date</option>
          <option value="relative_offset">Relative — offset (days from an anchor)</option>
          <option value="relative_percent">Relative — percent (between an anchor&rsquo;s two ends)</option>
        </select>
      </label>
      <label>
        Absolute date (used when mode is Absolute)
        <br />
        <input
          type="date"
          name="absoluteDate"
          defaultValue={milestone?.dateType === "absolute" ? (milestone.absoluteDate ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Anchor (used when mode is relative)
        <br />
        <select
          name="anchor"
          defaultValue={milestone?.anchorType ?? "cycle_start"}
          style={{ padding: "0.4rem" }}
        >
          <option value="phase_start">Phase start</option>
          <option value="phase_end">Phase end</option>
          <option value="cycle_start">Cycle start</option>
          <option value="cycle_end">Cycle end</option>
        </select>
      </label>
      <label>
        Phase (used when anchor is a Phase — blank defaults to this task&rsquo;s own Phase)
        <br />
        <select
          name="milestonePhaseId"
          defaultValue={milestone?.phaseId ?? ""}
          style={{ padding: "0.4rem" }}
        >
          <option value="">This task&rsquo;s own Phase</option>
          {phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Offset days (used when mode is relative offset, and no target date is given below)
        <br />
        <input
          type="number"
          name="offsetDays"
          defaultValue={milestone?.relativeMode === "offset" ? (milestone.offsetDays ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Percent 0-100 (used when mode is relative percent, and no target date is given below)
        <br />
        <input
          type="number"
          min={0}
          max={100}
          name="percent"
          defaultValue={milestone?.relativeMode === "percent" ? (milestone.percent ?? "") : ""}
          style={{ padding: "0.4rem" }}
        />
      </label>
      <label>
        Or drag to this target date (recomputes and persists the offset/percent above)
        <br />
        <input type="date" name="targetDate" style={{ padding: "0.4rem" }} />
      </label>
      {milestone && milestone.resolvedDate && (
        <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.4rem 0 0" }}>
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
