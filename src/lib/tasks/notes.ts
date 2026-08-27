import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { taskComment, taskResource, taskWikiRevision } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireTaskInCommunity } from "./shared";

type Member = typeof memberTable.$inferSelect;

// Wiki summary — one evolving block per task, editable by any member.
// "Current" is just the most recent revision; the full history stays
// visible so an edit is a new row, never a silent overwrite.
export const addWikiRevisionInput = z.object({ content: z.string().min(1) });
export type AddWikiRevisionInput = z.infer<typeof addWikiRevisionInput>;

export async function addWikiRevision(
  actor: Member,
  taskId: string,
  input: AddWikiRevisionInput,
) {
  await requireTaskInCommunity(actor, taskId);
  const [created] = await db
    .insert(taskWikiRevision)
    .values({ taskId, content: input.content, editedBy: actor.id })
    .returning();
  return created;
}

export async function listWikiRevisions(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);
  return db
    .select()
    .from(taskWikiRevision)
    .where(eq(taskWikiRevision.taskId, taskId))
    .orderBy(desc(taskWikiRevision.editedAt));
}

// Comments — a simple open thread, anyone can post, chronological.
export const addCommentInput = z.object({ body: z.string().min(1) });
export type AddCommentInput = z.infer<typeof addCommentInput>;

export async function addComment(actor: Member, taskId: string, input: AddCommentInput) {
  await requireTaskInCommunity(actor, taskId);
  const [created] = await db
    .insert(taskComment)
    .values({ taskId, memberId: actor.id, body: input.body })
    .returning();
  return created;
}

export async function listComments(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);
  return db.select().from(taskComment).where(eq(taskComment.taskId, taskId)).orderBy(taskComment.createdAt);
}

// Resources — links only, no native file storage (see docs/architecture.md).
export const addResourceInput = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  tag: z.string().nullable().optional(),
});
export type AddResourceInput = z.infer<typeof addResourceInput>;

export async function addResource(actor: Member, taskId: string, input: AddResourceInput) {
  await requireTaskInCommunity(actor, taskId);
  const [created] = await db
    .insert(taskResource)
    .values({ taskId, addedBy: actor.id, label: input.label, url: input.url, tag: input.tag ?? null })
    .returning();
  return created;
}

export async function listResources(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);
  return db
    .select()
    .from(taskResource)
    .where(eq(taskResource.taskId, taskId))
    .orderBy(taskResource.createdAt);
}

// Convenience for the task detail view — one community check instead of
// three redundant ones from calling each list function separately.
export async function getTaskNotes(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);

  const [wikiRevisions, comments, resources] = await Promise.all([
    db
      .select()
      .from(taskWikiRevision)
      .where(eq(taskWikiRevision.taskId, taskId))
      .orderBy(desc(taskWikiRevision.editedAt)),
    db.select().from(taskComment).where(eq(taskComment.taskId, taskId)).orderBy(taskComment.createdAt),
    db.select().from(taskResource).where(eq(taskResource.taskId, taskId)).orderBy(taskResource.createdAt),
  ]);

  return { wikiRevisions, comments, resources };
}
