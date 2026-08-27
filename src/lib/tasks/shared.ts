import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

// Shared by crud.ts, requirements.ts, and notes.ts — kept dependency-free
// so none of them need to import from each other just for this check.
export async function requireTaskInCommunity(actor: Member, taskId: string) {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Task not found");
  }
}
