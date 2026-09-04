import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { task, taskDependency } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { requireNotOnsiteLockedForCommunity } from "../onsite-mode";
import { requireTaskInCommunity } from "./shared";

type Member = typeof memberTable.$inferSelect;

export const addTaskDependencyInput = z.object({ dependsOnTaskId: z.string().uuid() });
export type AddTaskDependencyInput = z.infer<typeof addTaskDependencyInput>;

export async function listTaskDependencies(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);
  return db
    .select({ dependsOnTaskId: taskDependency.dependsOnTaskId, title: task.title, status: task.status })
    .from(taskDependency)
    .innerJoin(task, eq(taskDependency.dependsOnTaskId, task.id))
    .where(eq(taskDependency.taskId, taskId));
}

// Walks depends-on edges starting from `startId`, true the moment it
// reaches `targetId`. Used only to answer "would adding taskId -> X
// close a loop" — a plain BFS, same "just do the obvious scan" posture
// this codebase's other small-graph checks already take (e.g.
// requirements.ts's countEligibleMembers).
async function dependsOnTransitively(startId: string, targetId: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const rows = await db
      .select({ dependsOnTaskId: taskDependency.dependsOnTaskId })
      .from(taskDependency)
      .where(eq(taskDependency.taskId, current));
    for (const row of rows) queue.push(row.dependsOnTaskId);
  }
  return false;
}

export async function addTaskDependency(actor: Member, taskId: string, dependsOnTaskId: string) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);
  await requireTaskInCommunity(actor, taskId);
  await requireTaskInCommunity(actor, dependsOnTaskId);

  if (taskId === dependsOnTaskId) {
    throw new AppError("A task can't depend on itself");
  }

  const [existing] = await db
    .select()
    .from(taskDependency)
    .where(and(eq(taskDependency.taskId, taskId), eq(taskDependency.dependsOnTaskId, dependsOnTaskId)));
  if (existing) {
    throw new ConflictError("This dependency already exists");
  }

  // If dependsOnTaskId already (transitively) depends on taskId, adding
  // this edge would close a loop no task in it could ever finish out
  // of — see finishTask's own dependency check in lifecycle.ts.
  if (await dependsOnTransitively(dependsOnTaskId, taskId)) {
    throw new ConflictError("That would create a circular dependency");
  }

  const [created] = await db.insert(taskDependency).values({ taskId, dependsOnTaskId }).returning();
  return created;
}

export async function removeTaskDependency(actor: Member, taskId: string, dependsOnTaskId: string) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);
  await requireTaskInCommunity(actor, taskId);

  const deleted = await db
    .delete(taskDependency)
    .where(and(eq(taskDependency.taskId, taskId), eq(taskDependency.dependsOnTaskId, dependsOnTaskId)))
    .returning();
  if (deleted.length === 0) {
    throw new NotFoundError("Dependency not found");
  }
}
