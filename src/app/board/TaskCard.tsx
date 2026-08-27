import Link from "next/link";
import type { requirement as requirementTable } from "@/db/schema";
import { describeRequirement } from "@/lib/tasks";
import { ATTENTION_STYLES, effortSummary } from "@/lib/format";
import { claimAction, finishAction, parkAction, releaseAction, resumeAction } from "./actions";

type Assignment = { taskId: string; memberId: string; memberName: string };
type Requirement = typeof requirementTable.$inferSelect;
type Task = {
  id: string;
  title: string;
  description: string;
  status: string;
  capacity: number | null;
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
}: {
  task: Task;
  assignments: Assignment[];
  requirements: Requirement[];
  unmetRequirements: Requirement[];
  tierNames: Map<string, string>;
  branchName: string;
  currentMemberId: string;
}) {
  const holds = assignments.some((a) => a.memberId === currentMemberId);
  const hasRoom = task.capacity === null || assignments.length < task.capacity;
  const unmetIds = new Set(unmetRequirements.map((r) => r.id));
  const eligible = unmetRequirements.length === 0;

  const canClaim =
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    eligible;
  const blockedByRequirements =
    (task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) &&
    !eligible;
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
        {branchName} · {effortSummary(task.effort, task.effortMagnitude)} · {assignments.length}
        {task.capacity !== null ? `/${task.capacity}` : ""} held
      </div>
      {task.description && <p style={{ fontSize: "0.9rem" }}>{task.description}</p>}
      {assignments.length > 0 && (
        <p style={{ fontSize: "0.85rem" }}>
          Held by: {assignments.map((a) => a.memberName).join(", ")}
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
        {canClaim && (
          <form action={claimAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <button type="submit">Claim</button>
          </form>
        )}
        {blockedByRequirements && (
          <span style={{ fontSize: "0.85rem", color: "crimson" }}>
            Not eligible — see requirements above
          </span>
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
