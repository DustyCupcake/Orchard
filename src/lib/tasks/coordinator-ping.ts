import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { coordinatorPing, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { requireCoordinationHolder } from "../coordination";

type Member = typeof memberTable.$inferSelect;

// "Any task owner can trigger a conversation with their branch
// coordinator via one button, no categorization required up front" —
// see docs/spec.md's "Talk to my coordinator". Only a current (real,
// non-shadow) holder can ping — this is the owner routing a
// conversation about their own task, not a general contact-coordinator
// form.
export async function pingCoordinator(actor: Member, taskId: string) {
  const [taskRow] = await db.select().from(task).where(eq(task.id, taskId));
  if (!taskRow || taskRow.communityId !== actor.communityId) {
    throw new NotFoundError("Task not found");
  }

  const [holds] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .where(
      and(
        eq(taskAssignment.taskId, taskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  if (!holds) {
    throw new ForbiddenError("Only a current holder can ping their coordinator about this task");
  }

  const [created] = await db
    .insert(coordinatorPing)
    .values({ taskId, requestedBy: actor.id })
    .returning();
  return created;
}

// Visible to the task's branch coordination holders, same audience as
// task signals — this is the "[Member] would like to talk about
// [task]" notification itself.
export async function listPings(actor: Member, taskId: string) {
  const [taskRow] = await db.select().from(task).where(eq(task.id, taskId));
  if (!taskRow || taskRow.communityId !== actor.communityId) {
    throw new NotFoundError("Task not found");
  }
  await requireCoordinationHolder(actor, taskRow.branchId);

  return db
    .select()
    .from(coordinatorPing)
    .where(eq(coordinatorPing.taskId, taskId))
    .orderBy(desc(coordinatorPing.createdAt));
}

export async function resolvePing(actor: Member, taskId: string, pingId: string) {
  const [taskRow] = await db.select().from(task).where(eq(task.id, taskId));
  if (!taskRow || taskRow.communityId !== actor.communityId) {
    throw new NotFoundError("Task not found");
  }
  await requireCoordinationHolder(actor, taskRow.branchId);

  const [updated] = await db
    .update(coordinatorPing)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        eq(coordinatorPing.id, pingId),
        eq(coordinatorPing.taskId, taskId),
        isNull(coordinatorPing.resolvedAt),
      ),
    )
    .returning();
  if (!updated) {
    throw new NotFoundError("Open ping not found");
  }
  return updated;
}

// The requester's own view — "you asked to talk" confirmation on the
// task detail page, without needing coordination-holder access.
export async function listMyPings(actor: Member, taskId: string) {
  return db
    .select()
    .from(coordinatorPing)
    .where(and(eq(coordinatorPing.taskId, taskId), eq(coordinatorPing.requestedBy, actor.id)))
    .orderBy(desc(coordinatorPing.createdAt));
}
