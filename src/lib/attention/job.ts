import { eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { community, phase, task, taskDependency } from "@/db/schema";
import { computeAttentionLevel } from "./compute";

// Recomputes attention_level for every not-done task across every
// Community, writing back only the rows whose level actually changed.
// Called on a schedule (see src/instrumentation.ts) and, for
// verification, from POST /api/attention/recompute.
export async function recomputeAttentionLevels(): Promise<{ checked: number; updated: number }> {
  const communities = await db.select().from(community);
  const communityById = new Map(communities.map((c) => [c.id, c]));

  const tasks = await db
    .select({
      id: task.id,
      communityId: task.communityId,
      status: task.status,
      critical: task.critical,
      createdAt: task.createdAt,
      statusChangedAt: task.statusChangedAt,
      nextCheckinAt: task.nextCheckinAt,
      attentionLevel: task.attentionLevel,
      // date columns come back as "YYYY-MM-DD" strings in Drizzle by
      // default (unlike timestamp columns, which are real Dates).
      phaseEndDate: phase.endDate,
    })
    .from(task)
    .leftJoin(phase, eq(task.phaseId, phase.id))
    .where(ne(task.status, "done"));

  if (tasks.length === 0) {
    return { checked: 0, updated: 0 };
  }

  const depRows = await db
    .select({ taskId: taskDependency.taskId, dependsOnStatus: task.status })
    .from(taskDependency)
    .innerJoin(task, eq(taskDependency.dependsOnTaskId, task.id))
    .where(
      inArray(
        taskDependency.taskId,
        tasks.map((t) => t.id),
      ),
    );
  const blockedTaskIds = new Set(
    depRows.filter((d) => d.dependsOnStatus !== "done").map((d) => d.taskId),
  );

  const now = new Date();
  let updated = 0;

  for (const t of tasks) {
    const communityRow = communityById.get(t.communityId);
    if (!communityRow) continue; // orphaned row, shouldn't happen

    const level = computeAttentionLevel(
      {
        status: t.status,
        critical: t.critical,
        createdAt: t.createdAt,
        statusChangedAt: t.statusChangedAt,
        nextCheckinAt: t.nextCheckinAt,
        unblocked: !blockedTaskIds.has(t.id),
        phaseEndDate:
          communityRow.phasesEnabled && t.phaseEndDate ? new Date(t.phaseEndDate) : null,
      },
      { softDays: communityRow.stalenessSoftDays, hardDays: communityRow.stalenessHardDays },
      now,
    );

    if (level !== t.attentionLevel) {
      await db.update(task).set({ attentionLevel: level }).where(eq(task.id, t.id));
      updated++;
    }
  }

  return { checked: tasks.length, updated };
}
