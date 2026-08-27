import Link from "next/link";
import type { requirement as requirementTable } from "@/db/schema";
import { describeRequirement } from "@/lib/tasks";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import {
  claimAction,
  finishAction,
  parkAction,
  releaseAction,
  resumeAction,
  withdrawRequestAction,
} from "./actions";

type Assignment = { taskId: string; memberId: string; memberName: string; isShadow: boolean };
type Requirement = typeof requirementTable.$inferSelect;
type Task = {
  id: string;
  title: string;
  description: string;
  status: string;
  capacity: number | null;
  openness: string;
  effort: string;
  effortMagnitude: unknown;
  nextCheckinAt: Date | null;
  waitingNote: string | null;
  critical: boolean;
  attentionLevel: string;
};

export default function TaskCard({
  task,
  assignments,
  requirements,
  unmetRequirements,
  tierNames,
  branchName,
  currentMemberId,
  myPendingRequestId,
}: {
  task: Task;
  assignments: Assignment[];
  requirements: Requirement[];
  unmetRequirements: Requirement[];
  tierNames: Map<string, string>;
  branchName: string;
  currentMemberId: string;
  myPendingRequestId: string | null;
}) {
  // A shadow isn't a real holder — doesn't count toward capacity, isn't
  // who "Held by" means — see docs/spec.md's "Shadow slots & succession"
  // and lifecycle.ts's assignmentCount(), which excludes them the same way.
  const realAssignments = assignments.filter((a) => !a.isShadow);
  const shadowAssignments = assignments.filter((a) => a.isShadow);
  const holds = realAssignments.some((a) => a.memberId === currentMemberId);
  const shadowing = shadowAssignments.some((a) => a.memberId === currentMemberId);
  const hasRoom = task.capacity === null || realAssignments.length < task.capacity;
  const unmetIds = new Set(unmetRequirements.map((r) => r.id));
  const eligible = unmetRequirements.length === 0;

  // Joining an already-held task under `request`/`coordination_approved`
  // openness creates a pending request instead of an instant claim —
  // see docs/spec.md's "Request to join". Mirrors the same branch
  // claimOrRequestToJoin() takes server-side, purely for the button
  // label; the server is what actually enforces it.
  const requestGated = task.openness === "request" || task.openness === "coordination_approved";
  const joiningRequiresRequest =
    task.status === "claimed" && realAssignments.length > 0 && requestGated;
  // community_endorsed never claims through the ordinary Claim/Request
  // button at all — see the task detail page's "Candidacy" section
  // (expressCandidacy/endorseCandidacy), a genuinely different flow
  // (put yourself forward, others endorse) that doesn't fit a single
  // button the way the other three openness values do.
  const isCommunityEndorsed = task.openness === "community_endorsed";

  const canAct =
    !isCommunityEndorsed &&
    !shadowing &&
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    eligible &&
    !myPendingRequestId;
  const canClaim = canAct && !joiningRequiresRequest;
  const canRequest = canAct && joiningRequiresRequest;
  const blockedByRequirements =
    !isCommunityEndorsed &&
    !shadowing &&
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    !eligible &&
    !myPendingRequestId;
  // Shadowing only makes sense once someone's actually doing the task —
  // see shadows.ts's claimAsShadow(), which enforces the same rule
  // server-side. Not excluded for community_endorsed: shadowing is
  // orthogonal to openness, nothing about learning alongside a current
  // holder depends on how they got the task.
  const canShadow = !holds && !shadowing && (task.status === "claimed" || task.status === "waiting");
  const attention = ATTENTION_STYLES[task.attentionLevel];

  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderLeft: attention ? `4px solid ${attention.borderColor}` : "1px solid #ccc",
        borderRadius: 6,
        padding: "0.75rem",
        marginBottom: "0.75rem",
        background: task.critical ? "#fff6f6" : "white",
      }}
    >
      <strong>
        <Link href={`/tasks/${task.id}`} style={{ color: "inherit" }}>
          {task.title}
        </Link>
      </strong>
      {task.critical && <span style={{ color: "crimson" }}> · critical</span>}
      {attention && (
        <span style={{ color: attention.color, fontWeight: 600 }}> · ⚠ {attention.label}</span>
      )}
      <div style={{ fontSize: "0.85rem", color: "#666" }}>
        {branchName} · {effortSummary(task.effort, task.effortMagnitude)} · {realAssignments.length}
        {task.capacity !== null ? `/${task.capacity}` : ""} held
      </div>
      {task.description && <p style={{ fontSize: "0.9rem" }}>{task.description}</p>}
      {realAssignments.length > 0 && (
        <p style={{ fontSize: "0.85rem" }}>
          Held by: {realAssignments.map((a) => a.memberName).join(", ")}
        </p>
      )}
      {shadowAssignments.length > 0 && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>
          Shadowed by: {shadowAssignments.map((a) => a.memberName).join(", ")}
        </p>
      )}
      {task.status === "waiting" && (
        <p style={{ fontSize: "0.85rem" }}>
          Next check-in: {task.nextCheckinAt ? new Date(task.nextCheckinAt).toLocaleDateString() : "—"}
          {task.waitingNote && ` — ${task.waitingNote}`}
        </p>
      )}

      {requirements.length > 0 && (
        <ul style={{ fontSize: "0.8rem", margin: "0.4rem 0", paddingLeft: "1.1rem" }}>
          {requirements.map((r) => (
            <li key={r.id} style={{ color: unmetIds.has(r.id) ? "crimson" : "#2a7a2a" }}>
              {describeRequirement(r, tierNames)}
              {unmetIds.has(r.id) ? " (not met)" : " (met)"}
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        {(canClaim || canRequest) && (
          <form action={claimAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <button type="submit">{canRequest ? "Request to join" : "Claim"}</button>
          </form>
        )}
        {myPendingRequestId && (
          <>
            <span style={{ fontSize: "0.85rem", color: "#666" }}>Request pending</span>
            <form action={withdrawRequestAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="requestId" value={myPendingRequestId} />
              <button type="submit">Withdraw</button>
            </form>
          </>
        )}
        {blockedByRequirements && (
          <span style={{ fontSize: "0.85rem", color: "crimson" }}>
            Not eligible — see requirements above
          </span>
        )}
        {isCommunityEndorsed && !holds && (
          <Link href={`/tasks/${task.id}`} style={{ fontSize: "0.85rem" }}>
            Put yourself forward or endorse a candidate →
          </Link>
        )}
        {canShadow && (
          <Link href={`/tasks/${task.id}`} style={{ fontSize: "0.85rem" }}>
            Shadow this task →
          </Link>
        )}
        {shadowing && (
          <>
            <span style={{ fontSize: "0.85rem", color: "#666" }}>Shadowing</span>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit">Stop shadowing</button>
            </form>
          </>
        )}

        {task.status === "claimed" && holds && (
          <>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit">Release</button>
            </form>
            <form action={finishAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit">Finish</button>
            </form>
          </>
        )}

        {task.status === "waiting" && holds && (
          <>
            <form action={resumeAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit">Resume</button>
            </form>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit">Release</button>
            </form>
          </>
        )}
      </div>

      {task.status === "claimed" && holds && (
        <form
          action={parkAction}
          style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: "0.5rem" }}
        >
          <input type="hidden" name="taskId" value={task.id} />
          <input type="date" name="nextCheckinAt" required style={{ padding: "0.25rem" }} />
          <input
            type="text"
            name="waitingNote"
            placeholder="waiting on…"
            style={{ padding: "0.25rem", flex: 1 }}
          />
          <button type="submit">Park</button>
        </form>
      )}
    </div>
  );
}
