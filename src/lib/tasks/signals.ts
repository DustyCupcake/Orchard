import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { task, taskSignal } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { requireCoordinationHolder } from "../coordination";
import { requireTaskInCommunity } from "./shared";

type Member = typeof memberTable.$inferSelect;

export const createSignalInput = z.object({
  kind: z.enum(["stalled", "might_need_help", "something_feels_off", "worth_a_look"]),
});
export type CreateSignalInput = z.infer<typeof createSignalInput>;

// A lightweight, closed-choice-only flag any member can raise on any
// task — see docs/spec.md's "Anonymous task signal". Deliberately
// records nothing about who sent it, not even for this function's own
// use — there's no memberId parameter to store because the whole
// point is that the row itself carries no trace back to a sender.
export async function createSignal(actor: Member, taskId: string, input: CreateSignalInput) {
  await requireTaskInCommunity(actor, taskId);
  const [created] = await db
    .insert(taskSignal)
    .values({ taskId, kind: input.kind })
    .returning();
  return created;
}

// "It lands with the task owner or coordinator as a quiet nudge to
// look" — visibility is restricted to that branch's coordination
// holders, not the task's own holders (an owner could plausibly be who
// a "something feels off" signal is about) and not the wider
// community.
export async function listSignals(actor: Member, taskId: string) {
  const [taskRow] = await db.select().from(task).where(eq(task.id, taskId));
  if (!taskRow || taskRow.communityId !== actor.communityId) {
    throw new NotFoundError("Task not found");
  }
  await requireCoordinationHolder(actor, taskRow.branchId);

  return db
    .select()
    .from(taskSignal)
    .where(eq(taskSignal.taskId, taskId))
    .orderBy(desc(taskSignal.createdAt));
}

export async function resolveSignal(actor: Member, taskId: string, signalId: string) {
  const [taskRow] = await db.select().from(task).where(eq(task.id, taskId));
  if (!taskRow || taskRow.communityId !== actor.communityId) {
    throw new NotFoundError("Task not found");
  }
  await requireCoordinationHolder(actor, taskRow.branchId);

  const [updated] = await db
    .update(taskSignal)
    .set({ resolvedAt: new Date() })
    .where(
      and(eq(taskSignal.id, signalId), eq(taskSignal.taskId, taskId), isNull(taskSignal.resolvedAt)),
    )
    .returning();
  if (!updated) {
    throw new NotFoundError("Open signal not found");
  }
  return updated;
}
