import { claimAction, finishAction, parkAction, releaseAction, resumeAction } from "./actions";

type Assignment = { taskId: string; memberId: string; memberName: string };
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
};

function effortSummary(effort: string, magnitude: unknown) {
  if (magnitude && typeof magnitude === "object") {
    const m = magnitude as Record<string, unknown>;
    if (typeof m.hours_per_week === "number") return `${m.hours_per_week}h/week`;
    if (typeof m.duration === "string") return m.duration.replace(/_/g, " ");
  }
  return effort.replace(/_/g, " ");
}

export default function TaskCard({
  task,
  assignments,
  branchName,
  currentMemberId,
}: {
  task: Task;
  assignments: Assignment[];
  branchName: string;
  currentMemberId: string;
}) {
  const holds = assignments.some((a) => a.memberId === currentMemberId);
  const hasRoom = task.capacity === null || assignments.length < task.capacity;

  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderRadius: 6,
        padding: "0.75rem",
        marginBottom: "0.75rem",
        background: task.critical ? "#fff6f6" : "white",
      }}
    >
      <strong>{task.title}</strong>
      {task.critical && <span style={{ color: "crimson" }}> · critical</span>}
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

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        {(task.status === "unclaimed" || (task.status === "claimed" && !holds && hasRoom)) && (
          <form action={claimAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <button type="submit">Claim</button>
          </form>
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
