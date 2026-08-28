import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, member, task, taskWikiRevision, wikiPage, wikiPageRevision } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

async function requireWikiPageInCommunity(actor: Member, pageId: string) {
  const [row] = await db
    .select()
    .from(wikiPage)
    .where(and(eq(wikiPage.id, pageId), eq(wikiPage.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Wiki page not found");
  }
  return row;
}

async function requireBranchInCommunity(actor: Member, branchId: string) {
  const [row] = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Branch not found in your community");
  }
}

// A page can be created with just a question and no body (questionPending
// stays true until a real revision is written or it's resolved as a
// duplicate) or with real content up front, same low-friction posting as
// everything else here — see docs/spec.md's Documentation module.
export const createWikiPageInput = z.object({
  title: z.string().min(1),
  branchId: z.string().uuid().nullable().optional(),
  content: z.string().min(1).nullable().optional(),
});
export type CreateWikiPageInput = z.infer<typeof createWikiPageInput>;

export async function createWikiPage(actor: Member, input: CreateWikiPageInput) {
  if (input.branchId) {
    await requireBranchInCommunity(actor, input.branchId);
  }

  const [created] = await db
    .insert(wikiPage)
    .values({
      communityId: actor.communityId,
      branchId: input.branchId ?? null,
      title: input.title,
      createdBy: actor.id,
      questionPending: !input.content,
    })
    .returning();

  if (input.content) {
    await db.insert(wikiPageRevision).values({
      pageId: created.id,
      content: input.content,
      editedBy: actor.id,
    });
  }

  return created;
}

// Wiki summary — open to edit by any member, the same shape as
// TaskWikiRevision. Writing a page's first real revision is also what
// answers a pending FAQ (see docs/spec.md's "at which point it's an
// ordinary published page").
export const addWikiPageRevisionInput = z.object({ content: z.string().min(1) });
export type AddWikiPageRevisionInput = z.infer<typeof addWikiPageRevisionInput>;

export async function addWikiPageRevision(
  actor: Member,
  pageId: string,
  input: AddWikiPageRevisionInput,
) {
  const page = await requireWikiPageInCommunity(actor, pageId);

  const [created] = await db
    .insert(wikiPageRevision)
    .values({ pageId, content: input.content, editedBy: actor.id })
    .returning();

  if (page.questionPending) {
    await db.update(wikiPage).set({ questionPending: false }).where(eq(wikiPage.id, pageId));
  }

  return created;
}

export async function listWikiPageRevisions(actor: Member, pageId: string) {
  await requireWikiPageInCommunity(actor, pageId);
  return db
    .select()
    .from(wikiPageRevision)
    .where(eq(wikiPageRevision.pageId, pageId))
    .orderBy(desc(wikiPageRevision.editedAt));
}

// Resolving as a duplicate: the question stays findable, but drops out
// of the main browse index and shows up on the canonical page as "also
// asked as..." — see docs/spec.md's "Resolving as a duplicate."
export const markWikiPageDuplicateInput = z.object({ duplicateOfPageId: z.string().uuid() });
export type MarkWikiPageDuplicateInput = z.infer<typeof markWikiPageDuplicateInput>;

export async function markWikiPageDuplicate(
  actor: Member,
  pageId: string,
  input: MarkWikiPageDuplicateInput,
) {
  await requireWikiPageInCommunity(actor, pageId);
  if (input.duplicateOfPageId === pageId) {
    throw new NotFoundError("A page can't be a duplicate of itself");
  }
  await requireWikiPageInCommunity(actor, input.duplicateOfPageId);

  const [updated] = await db
    .update(wikiPage)
    .set({ duplicateOfPageId: input.duplicateOfPageId, questionPending: false })
    .where(eq(wikiPage.id, pageId))
    .returning();
  return updated;
}

// The main browse index — every page that isn't a resolved duplicate of
// another, each with its current (latest) revision if it has one.
// Optionally scoped to one branch; pass undefined for every page,
// including general (branchId null) ones.
export async function listWikiPages(actor: Member, filterBranchId?: string) {
  const conditions = [eq(wikiPage.communityId, actor.communityId), isNull(wikiPage.duplicateOfPageId)];
  if (filterBranchId) {
    conditions.push(eq(wikiPage.branchId, filterBranchId));
  }

  const pages = await db
    .select()
    .from(wikiPage)
    .where(and(...conditions))
    .orderBy(desc(wikiPage.createdAt));

  const latestByPage = new Map<string, { content: string; editedBy: string; editedAt: Date } | null>();
  for (const p of pages) {
    const [latest] = await db
      .select()
      .from(wikiPageRevision)
      .where(eq(wikiPageRevision.pageId, p.id))
      .orderBy(desc(wikiPageRevision.editedAt))
      .limit(1);
    latestByPage.set(p.id, latest ?? null);
  }

  return pages.map((p) => ({ ...p, latestRevision: latestByPage.get(p.id) ?? null }));
}

export async function getWikiPage(actor: Member, pageId: string) {
  const page = await requireWikiPageInCommunity(actor, pageId);
  const revisions = await listWikiPageRevisions(actor, pageId);
  const alsoAskedAs = await db
    .select()
    .from(wikiPage)
    .where(and(eq(wikiPage.duplicateOfPageId, pageId), eq(wikiPage.communityId, actor.communityId)));
  return { page, revisions, alsoAskedAs };
}

// The read-only index over task wikis — no new storage, just every
// task's current wiki revision grouped by branch. See docs/spec.md's
// "The index over task wikis is a view, not new storage."
export async function listTaskWikiIndex(actor: Member) {
  const tasks = await db
    .select({ id: task.id, title: task.title, branchId: task.branchId, branchName: branch.name })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(eq(task.communityId, actor.communityId));

  const entries: {
    taskId: string;
    taskTitle: string;
    branchId: string;
    branchName: string;
    content: string;
    editedByName: string;
    editedAt: Date;
  }[] = [];

  for (const t of tasks) {
    const [latest] = await db
      .select({
        content: taskWikiRevision.content,
        editedAt: taskWikiRevision.editedAt,
        editedByName: member.name,
      })
      .from(taskWikiRevision)
      .innerJoin(member, eq(taskWikiRevision.editedBy, member.id))
      .where(eq(taskWikiRevision.taskId, t.id))
      .orderBy(desc(taskWikiRevision.editedAt))
      .limit(1);
    if (latest) {
      entries.push({
        taskId: t.id,
        taskTitle: t.title,
        branchId: t.branchId,
        branchName: t.branchName,
        content: latest.content,
        editedByName: latest.editedByName,
        editedAt: latest.editedAt,
      });
    }
  }

  const byBranch = new Map<string, { branchName: string; entries: typeof entries }>();
  for (const e of entries) {
    if (!byBranch.has(e.branchId)) {
      byBranch.set(e.branchId, { branchName: e.branchName, entries: [] });
    }
    byBranch.get(e.branchId)!.entries.push(e);
  }

  return Array.from(byBranch.entries()).map(([branchId, v]) => ({
    branchId,
    branchName: v.branchName,
    entries: v.entries,
  }));
}
