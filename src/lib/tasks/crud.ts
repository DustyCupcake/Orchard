import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, member, requirement, task, taskAssignment, taskDependency } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getUnmetRequirements } from "./requirements";

type Member = typeof memberTable.$inferSelect;

export const createTaskInput = z.object({
  branchId: z.string().uuid(),
  cycleId: z.string().uuid().nullable().optional(),
  phaseId: z.string().uuid().nullable().optional(),
  parentTaskId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  effort: z.enum(["one_off", "ongoing", "owns_a_thing"]),
  effortMagnitude: z.record(z.string(), z.unknown()),
  capacity: z.number().int().positive().nullable().optional(),
  openness: z
    .enum(["open", "request", "coordination_approved", "community_endorsed"])
    .optional(),
  critical: z.boolean().optional(),
  browsePeriodEnd: z.string().datetime().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskInput>;

export const updateTaskInput = createTaskInput
  .omit({ parentTaskId: true })
  .partial();
export type UpdateTaskInput = z.infer<typeof updateTaskInput>;

// createdByMemberId defaults to the actor — the one exception is
// activating a proposal, where the task should credit whoever originally
// proposed it, not whoever happened to activate it (see
// src/lib/proposals/crud.ts).
export async function createTask(
  actor: Member,
  input: CreateTaskInput,
  createdByMemberId?: string,
) {
  const [branchRow] = await db
    .select()
    .from(branch)
    .where(and(eq(branch.id, input.branchId), eq(branch.communityId, actor.communityId)));
  if (!branchRow) {
    throw new NotFoundError("Branch not found in your community");
  }

  const [created] = await db
    .insert(task)
    .values({
      communityId: actor.communityId,
      branchId: input.branchId,
      cycleId: input.cycleId ?? null,
      phaseId: input.phaseId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      title: input.title,
      description: input.description ?? "",
      tags: input.tags ?? [],
      effort: input.effort,
      effortMagnitude: input.effortMagnitude,
      capacity: input.capacity === undefined ? 1 : input.capacity,
      openness: input.openness ?? "request",
      critical: input.critical ?? false,
      browsePeriodEnd: input.browsePeriodEnd ? new Date(input.browsePeriodEnd) : null,
      createdBy: createdByMemberId ?? actor.id,
    })
    .returning();

  return created;
}

export async function listTasks(
  actor: Member,
  filters: { branchId?: string; status?: string; cycleId?: string } = {},
) {
  const conditions = [eq(task.communityId, actor.communityId)];
  if (filters.branchId) conditions.push(eq(task.branchId, filters.branchId));
  if (filters.cycleId) conditions.push(eq(task.cycleId, filters.cycleId));
  if (filters.status) {
    conditions.push(eq(task.status, filters.status as (typeof task.status.enumValues)[number]));
  }

  return db
    .select()
    .from(task)
    .where(and(...conditions))
    .orderBy(task.title);
}

// Board-shaped: each task comes back with who currently holds it, for
// rendering "Claimed by ..." and deciding which action buttons to show.
export async function listTasksWithAssignments(
  actor: Member,
  filters: { branchId?: string; status?: string; cycleId?: string } = {},
) {
  const tasks = await listTasks(actor, filters);
  if (tasks.length === 0) {
    return [];
  }

  const assignments = await db
    .select({
      taskId: taskAssignment.taskId,
      memberId: taskAssignment.memberId,
      memberName: member.name,
    })
    .from(taskAssignment)
    .innerJoin(member, eq(taskAssignment.memberId, member.id))
    .where(
      inArray(
        taskAssignment.taskId,
        tasks.map((t) => t.id),
      ),
    );

  const assignmentsByTask = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByTask.get(a.taskId) ?? [];
    list.push(a);
    assignmentsByTask.set(a.taskId, list);
  }

  const allRequirements = await db
    .select()
    .from(requirement)
    .where(
      inArray(
        requirement.taskId,
        tasks.map((t) => t.id),
      ),
    );
  const requirementsByTask = new Map<string, typeof allRequirements>();
  for (const r of allRequirements) {
    const list = requirementsByTask.get(r.taskId) ?? [];
    list.push(r);
    requirementsByTask.set(r.taskId, list);
  }

  return Promise.all(
    tasks.map(async (t) => ({
      ...t,
      assignments: assignmentsByTask.get(t.id) ?? [],
      requirements: requirementsByTask.get(t.id) ?? [],
      unmetRequirements: requirementsByTask.has(t.id)
        ? await getUnmetRequirements(db, actor, t.id)
        : [],
    })),
  );
}

export async function getTask(actor: Member, taskId: string) {
  const [row] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Task not found");
  }

  const assignments = await db
    .select()
    .from(taskAssignment)
    .where(eq(taskAssignment.taskId, taskId));

  return { ...row, assignments };
}

export async function updateTask(actor: Member, taskId: string, input: UpdateTaskInput) {
  const [existing] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Task not found");
  }

  if (input.branchId && input.branchId !== existing.branchId) {
    const [branchRow] = await db
      .select()
      .from(branch)
      .where(and(eq(branch.id, input.branchId), eq(branch.communityId, actor.communityId)));
    if (!branchRow) {
      throw new NotFoundError("Branch not found in your community");
    }
  }

  const [updated] = await db
    .update(task)
    .set({
      ...(input.branchId !== undefined && { branchId: input.branchId }),
      ...(input.cycleId !== undefined && { cycleId: input.cycleId }),
      ...(input.phaseId !== undefined && { phaseId: input.phaseId }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.tags !== undefined && { tags: input.tags }),
      ...(input.effort !== undefined && { effort: input.effort }),
      ...(input.effortMagnitude !== undefined && { effortMagnitude: input.effortMagnitude }),
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.openness !== undefined && { openness: input.openness }),
      ...(input.critical !== undefined && { critical: input.critical }),
      ...(input.browsePeriodEnd !== undefined && {
        browsePeriodEnd: input.browsePeriodEnd ? new Date(input.browsePeriodEnd) : null,
      }),
    })
    .where(eq(task.id, taskId))
    .returning();

  return updated;
}

// Conservative on purpose: this domain treats tasks as durable records
// (see docs/spec.md — nothing in the lifecycle actually deletes a task,
// only claims/releases/finishes it), so delete only allows removing a
// task nobody has ever claimed and nothing else references.
export async function deleteTask(actor: Member, taskId: string) {
  const [existing] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Task not found");
  }
  if (existing.createdBy !== actor.id) {
    throw new ForbiddenError("Only the task's creator can delete it");
  }
  if (existing.status !== "unclaimed") {
    throw new ConflictError("Only an unclaimed task can be deleted — release it first");
  }

  const [referencedBy] = await db
    .select({ id: task.id })
    .from(task)
    .where(or(eq(task.parentTaskId, taskId), eq(task.clonedFromTaskId, taskId)))
    .limit(1);
  if (referencedBy) {
    throw new ConflictError("Another task references this one and would be orphaned");
  }

  const [dependedOn] = await db
    .select({ taskId: taskDependency.taskId })
    .from(taskDependency)
    .where(eq(taskDependency.dependsOnTaskId, taskId))
    .limit(1);
  if (dependedOn) {
    throw new ConflictError("Another task depends on this one");
  }

  await db.delete(task).where(eq(task.id, taskId));
}
