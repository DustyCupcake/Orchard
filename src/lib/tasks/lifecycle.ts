import { and, count, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { task, taskAssignment, taskDependency } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getUnmetRequirements, describeRequirement } from "./requirements";

type Member = typeof memberTable.$inferSelect;

// Locks the task row for the duration of the transaction — the lifecycle
// endpoints can run concurrently (two people claiming the last slot at
// once), so every transition reads its starting state through this.
async function loadTaskForUpdate(tx: Tx, taskId: string, communityId: string) {
  const [row] = await tx
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, communityId)))
    .for("update");
  if (!row) {
    throw new NotFoundError("Task not found");
  }
  return row;
}

async function requireHolds(tx: Tx, taskId: string, memberId: string) {
  const [row] = await tx
    .select()
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, memberId)));
  if (!row) {
    throw new ForbiddenError("You don't hold this task");
  }
}

async function assignmentCount(tx: Tx, taskId: string) {
  const [row] = await tx
    .select({ value: count() })
    .from(taskAssignment)
    .where(eq(taskAssignment.taskId, taskId));
  return row.value;
}

export async function claimTask(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "unclaimed" && current.status !== "claimed") {
      throw new ConflictError(`Cannot claim a task that is ${current.status}`);
    }

    const [existing] = await tx
      .select()
      .from(taskAssignment)
      .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, actor.id)));
    if (existing) {
      throw new ConflictError("You already hold this task");
    }

    if (current.capacity !== null) {
      const held = await assignmentCount(tx, taskId);
      if (held >= current.capacity) {
        throw new ConflictError("Task is at capacity");
      }
    }

    const unmet = await getUnmetRequirements(tx, actor, taskId);
    if (unmet.length > 0) {
      const summary = unmet.map((r) => describeRequirement(r)).join("; ");
      throw new ForbiddenError(`You don't meet this task's requirements: ${summary}`);
    }

    await tx.insert(taskAssignment).values({ taskId, memberId: actor.id });

    const [updated] = await tx
      .update(task)
      .set({ status: "claimed", statusChangedAt: new Date(), attentionLevel: "ok" })
      .where(eq(task.id, taskId))
      .returning();
    return updated;
  });
}

export async function releaseTask(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "claimed" && current.status !== "waiting") {
      throw new ConflictError(`Cannot release a task that is ${current.status}`);
    }

    const deleted = await tx
      .delete(taskAssignment)
      .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, actor.id)))
      .returning();
    if (deleted.length === 0) {
      throw new ForbiddenError("You don't hold this task");
    }

    const remaining = await assignmentCount(tx, taskId);
    if (remaining === 0) {
      const [updated] = await tx
        .update(task)
        .set({
          status: "unclaimed",
          nextCheckinAt: null,
          waitingNote: null,
          statusChangedAt: new Date(),
          attentionLevel: "ok",
        })
        .where(eq(task.id, taskId))
        .returning();
      return updated;
    }
    return current;
  });
}

export async function parkTask(
  actor: Member,
  taskId: string,
  input: { nextCheckinAt: Date; waitingNote?: string | null },
) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "claimed") {
      throw new ConflictError(`Cannot park a task that is ${current.status}`);
    }
    await requireHolds(tx, taskId, actor.id);

    const [updated] = await tx
      .update(task)
      .set({
        status: "waiting",
        nextCheckinAt: input.nextCheckinAt,
        waitingNote: input.waitingNote ?? null,
        statusChangedAt: new Date(),
        attentionLevel: "ok",
      })
      .where(eq(task.id, taskId))
      .returning();
    return updated;
  });
}

export async function resumeTask(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "waiting") {
      throw new ConflictError(`Cannot resume a task that is ${current.status}`);
    }
    await requireHolds(tx, taskId, actor.id);

    const [updated] = await tx
      .update(task)
      .set({
        status: "claimed",
        nextCheckinAt: null,
        waitingNote: null,
        statusChangedAt: new Date(),
        attentionLevel: "ok",
      })
      .where(eq(task.id, taskId))
      .returning();
    return updated;
  });
}

export async function finishTask(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "claimed") {
      throw new ConflictError(`Cannot finish a task that is ${current.status}`);
    }
    await requireHolds(tx, taskId, actor.id);

    const deps = await tx
      .select({ status: task.status })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.dependsOnTaskId, task.id))
      .where(eq(taskDependency.taskId, taskId));
    const openCount = deps.filter((d) => d.status !== "done").length;
    if (openCount > 0) {
      throw new ConflictError(
        `Cannot finish: ${openCount} dependency task(s) not yet done`,
      );
    }

    const [updated] = await tx
      .update(task)
      .set({ status: "done", statusChangedAt: new Date(), attentionLevel: "ok" })
      .where(eq(task.id, taskId))
      .returning();
    return updated;
  });
}
