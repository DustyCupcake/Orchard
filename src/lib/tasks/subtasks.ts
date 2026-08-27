import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { createTask, createTaskInput } from "./crud";

type Member = typeof memberTable.$inferSelect;

// Splitting off a subtask is a unilateral act by any current holder, not
// a request — see docs/spec.md's "Subtasks" section ("the structural
// equivalent of the 'talk to my coordinator' button"). Cycle/phase
// always inherit silently from the parent rather than being exposed as
// their own form fields — no task-creation UI in this codebase picks
// cycle/phase yet (proposal activation doesn't either), so this stays
// consistent rather than being the first to invent that picker. Branch
// is the one field with real precedent (the proposal activation form)
// for being editable in a form shaped like this one.
export const splitSubtaskInput = createTaskInput
  .omit({ parentTaskId: true, cycleId: true, phaseId: true, branchId: true })
  .extend({ branchId: z.string().uuid().optional() });
export type SplitSubtaskInput = z.infer<typeof splitSubtaskInput>;

export async function splitSubtask(actor: Member, parentTaskId: string, input: SplitSubtaskInput) {
  const [parent] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, parentTaskId), eq(task.communityId, actor.communityId)));
  if (!parent) {
    throw new NotFoundError("Task not found");
  }

  const [holds] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, parentTaskId), eq(taskAssignment.memberId, actor.id)));
  if (!holds) {
    throw new ForbiddenError("Only a current holder of this task can split off a subtask");
  }

  return createTask(actor, {
    branchId: input.branchId ?? parent.branchId,
    cycleId: parent.cycleId,
    phaseId: parent.phaseId,
    parentTaskId: parent.id,
    title: input.title,
    description: input.description,
    tags: input.tags,
    effort: input.effort,
    effortMagnitude: input.effortMagnitude,
    capacity: input.capacity,
    openness: input.openness,
    critical: input.critical,
    browsePeriodEnd: input.browsePeriodEnd,
  });
}

export async function listSubtasks(actor: Member, parentTaskId: string) {
  return db
    .select()
    .from(task)
    .where(and(eq(task.parentTaskId, parentTaskId), eq(task.communityId, actor.communityId)))
    .orderBy(task.createdAt);
}

// For the child's "part of [parent]" link — a minimal projection since
// the detail view only needs the parent's title to link to it.
export async function getParentTaskSummary(actor: Member, parentTaskId: string) {
  const [row] = await db
    .select({ id: task.id, title: task.title })
    .from(task)
    .where(and(eq(task.id, parentTaskId), eq(task.communityId, actor.communityId)));
  return row ?? null;
}
