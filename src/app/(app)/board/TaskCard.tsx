import Link from "next/link";
import type { requirement as requirementTable } from "@/db/schema";
import { describeRequirement } from "@/lib/tasks";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import { Tag, ATTENTION_TONE, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_GHOST, INPUT } from "@/components/ui/kit";
import {
  claimAction,
  finishAction,
  parkAction,
  releaseAction,
  resumeAction,
  withdrawRequestAction,
} from "./actions";

const ATTENTION_BORDER_VAR: Record<string, string> = {
  soft: "var(--warning)",
  hard: "var(--danger)",
  escalated: "var(--danger)",
};

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
  groupCoverage,
  tierNames,
  branchName,
  currentMemberId,
  myPendingRequestId,
  isCoordinationHolderForBranch,
}: {
  task: Task;
  assignments: Assignment[];
  requirements: Requirement[];
  unmetRequirements: Requirement[];
  groupCoverage: Map<string, boolean>;
  tierNames: Map<string, string>;
  branchName: string;
  currentMemberId: string;
  myPendingRequestId: string | null;
  isCoordinationHolderForBranch: boolean;
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

  // "When anyone with placement authority tries to self-assign a
  // flagged or unclaimed task" — see docs/spec.md's Coordination
  // mechanics: self-assign confirmation check. Only for someone who
  // currently does this task's branch's coordination; server-enforced
  // in join-requests.ts's claimOrRequestToJoin(), this just routes the
  // button to the task page's confirmation block instead of an instant
  // submit, so the check can't be silently skipped by clicking Claim.
  const needsSelfAssignConfirmation =
    isCoordinationHolderForBranch && (task.status === "unclaimed" || task.attentionLevel !== "ok");

  const canAct =
    !isCommunityEndorsed &&
    !shadowing &&
    !needsSelfAssignConfirmation &&
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    eligible &&
    !myPendingRequestId;
  const canClaim = canAct && !joiningRequiresRequest;
  const canRequest = canAct && joiningRequiresRequest;
  const needsConfirmationLink =
    !isCommunityEndorsed &&
    !shadowing &&
    needsSelfAssignConfirmation &&
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    eligible &&
    !myPendingRequestId;
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
      className="mb-3 rounded-[var(--radius-md)] border p-3"
      style={{
        borderColor: "var(--border)",
        borderLeft: `3px solid ${attention ? ATTENTION_BORDER_VAR[task.attentionLevel] : "var(--border)"}`,
        background: task.critical ? "var(--danger-soft)" : "var(--surface)",
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={`/tasks/${task.id}`} className="text-[14px] font-semibold text-[var(--text)] hover:text-[var(--accent-1)]">
          {task.title}
        </Link>
        {task.critical && <Tag tone="danger">critical</Tag>}
        {attention && <Tag tone={ATTENTION_TONE[task.attentionLevel] ?? "neutral"}>{attention.label}</Tag>}
      </div>
      <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
        {branchName} · {effortSummary(task.effort, task.effortMagnitude)} · {realAssignments.length}
        {task.capacity !== null ? `/${task.capacity}` : ""} held
      </div>
      {task.description && <p className="mt-1.5 text-[13px] text-[var(--text)]">{task.description}</p>}
      {realAssignments.length > 0 && (
        <p className="mt-1.5 text-[12px] text-[var(--text)]">
          Held by: {realAssignments.map((a) => a.memberName).join(", ")}
        </p>
      )}
      {shadowAssignments.length > 0 && (
        <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
          Shadowed by: {shadowAssignments.map((a) => a.memberName).join(", ")}
        </p>
      )}
      {task.status === "waiting" && (
        <p className="mt-1.5 text-[12px] text-[var(--text)]">
          Next check-in: {task.nextCheckinAt ? new Date(task.nextCheckinAt).toLocaleDateString() : "—"}
          {task.waitingNote && ` — ${task.waitingNote}`}
        </p>
      )}

      {requirements.length > 0 && (
        <ul className="my-1.5 flex flex-col gap-0.5 text-[12px]">
          {requirements.map((r) => {
            // Three modes, three different lines — see docs/spec.md's
            // Requirement. individual_gate is a personal met/not-met
            // gate (unmetRequirements, computed for this viewer only);
            // group_coverage is a standing team-wide status line, never
            // gated on who's looking; soft_priority never gates or
            // flags anything, purely informational.
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

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(canClaim || canRequest) && (
          <form action={claimAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <button type="submit" className={BUTTON_PRIMARY}>
              {canRequest ? "Request to join" : "Claim"}
            </button>
          </form>
        )}
        {myPendingRequestId && (
          <>
            <span className="text-[12px] text-[var(--text-muted)]">Request pending</span>
            <form action={withdrawRequestAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="requestId" value={myPendingRequestId} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Withdraw
              </button>
            </form>
          </>
        )}
        {blockedByRequirements && (
          <span className="text-[12px] text-[var(--danger)]">Not eligible — see requirements above</span>
        )}
        {needsConfirmationLink && (
          <Link href={`/tasks/${task.id}`} className="text-[12px] font-medium text-[var(--accent-1)] hover:underline">
            {joiningRequiresRequest ? "Request to join" : "Claim"} (confirm on task page) →
          </Link>
        )}
        {isCommunityEndorsed && !holds && (
          <Link href={`/tasks/${task.id}`} className="text-[12px] font-medium text-[var(--accent-1)] hover:underline">
            Put yourself forward or endorse a candidate →
          </Link>
        )}
        {canShadow && (
          <Link href={`/tasks/${task.id}`} className="text-[12px] font-medium text-[var(--accent-1)] hover:underline">
            Shadow this task →
          </Link>
        )}
        {shadowing && (
          <>
            <span className="text-[12px] text-[var(--text-muted)]">Shadowing</span>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Stop shadowing
              </button>
            </form>
          </>
        )}

        {task.status === "claimed" && holds && (
          <>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Release
              </button>
            </form>
            <form action={finishAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                Finish
              </button>
            </form>
          </>
        )}

        {task.status === "waiting" && holds && (
          <>
            <form action={resumeAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className={BUTTON_PRIMARY}>
                Resume
              </button>
            </form>
            <form action={releaseAction}>
              <input type="hidden" name="taskId" value={task.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Release
              </button>
            </form>
          </>
        )}
      </div>

      {task.status === "claimed" && holds && (
        <form action={parkAction} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="date" name="nextCheckinAt" required className={INPUT} />
          <input type="text" name="waitingNote" placeholder="waiting on…" className={`${INPUT} flex-1`} />
          <button type="submit" className={BUTTON_GHOST}>
            Park
          </button>
        </form>
      )}
    </div>
  );
}
