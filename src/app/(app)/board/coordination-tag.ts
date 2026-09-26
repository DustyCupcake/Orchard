import type { listTasksWithAssignments } from "@/lib/tasks";

type BoardTask = Awaited<ReturnType<typeof listTasksWithAssignments>>[number];

// "Coordinated by {name}" is an *attention* signal — "somebody needs to
// act on this, and here's who" — not a restatement of the viewer's
// coordination coverage. Those two were the same predicate, and because
// column semantics mean a cycle-less branch_coordination task covers its
// whole branch across every cycle, one branch-wide coordinator ended up
// stamping their name on every task in the branch. The tag carried no
// information on the ~100% of tasks that were simply covered, and
// buried the handful it was for.
//
// Coverage itself is unchanged and still available: it is what gates the
// Escalate action and self-assign confirmation on the card
// (isCoordinationHolderForTask). This predicate only decides whether to
// *name* somebody.
//
// The population is the same two sets that name a responsible party
// anywhere else in the app:
//   - attentionLevel "escalated" — the escalation queue, i.e. the work
//     coordination exists to clear (listEscalatedTasks).
//   - critical and unclaimed — backstop.ts's duty segment, and the exact
//     trigger of the "Backstop: {name}" tag sitting next to it on the
//     same card.
// Both are opt-in to being visible this way; a community that hasn't
// named a coordinator for the scope simply sees no tag, which is the
// honest answer rather than a name on everything.
export function needsNamedCoordinator(task: Pick<BoardTask, "attentionLevel" | "critical" | "status">): boolean {
  return task.attentionLevel === "escalated" || (task.critical && task.status === "unclaimed");
}
