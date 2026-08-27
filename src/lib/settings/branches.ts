import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

// The three call-default fields are nullable — null means "inherit
// the Community's own default" (see docs/spec.md's "Defaults live per
// Branch, with a Community-level fallback"), so they need to
// distinguish "leave unset" from "explicitly false", unlike a plain
// optional boolean would.
const nullableTriState = z.union([z.boolean(), z.null()]).optional();

export const createBranchInput = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  defaultCallHasAgenda: nullableTriState,
  defaultCallNeedsSummary: nullableTriState,
  defaultCallRequireRead: nullableTriState,
});
export type CreateBranchInput = z.infer<typeof createBranchInput>;

export const updateBranchInput = createBranchInput.partial();
export type UpdateBranchInput = z.infer<typeof updateBranchInput>;

export async function listBranches(actor: Member) {
  return db.select().from(branch).where(eq(branch.communityId, actor.communityId)).orderBy(branch.name);
}

// No Admins yet (per MVP scope) — any authenticated member can define
// the Community's branches, same as every other settings surface here.
export async function createBranch(actor: Member, input: CreateBranchInput) {
  const [created] = await db
    .insert(branch)
    .values({
      communityId: actor.communityId,
      name: input.name,
      description: input.description ?? null,
      defaultCallHasAgenda: input.defaultCallHasAgenda ?? null,
      defaultCallNeedsSummary: input.defaultCallNeedsSummary ?? null,
      defaultCallRequireRead: input.defaultCallRequireRead ?? null,
    })
    .returning();
  return created;
}

export async function updateBranch(actor: Member, branchId: string, input: UpdateBranchInput) {
  const [updated] = await db
    .update(branch)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.defaultCallHasAgenda !== undefined && { defaultCallHasAgenda: input.defaultCallHasAgenda }),
      ...(input.defaultCallNeedsSummary !== undefined && {
        defaultCallNeedsSummary: input.defaultCallNeedsSummary,
      }),
      ...(input.defaultCallRequireRead !== undefined && {
        defaultCallRequireRead: input.defaultCallRequireRead,
      }),
    })
    .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Branch not found");
  }
  return updated;
}

export async function deleteBranch(actor: Member, branchId: string) {
  const [existing] = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Branch not found");
  }

  const [inUse] = await db.select({ id: task.id }).from(task).where(eq(task.branchId, branchId)).limit(1);
  if (inUse) {
    throw new ConflictError("Tasks still reference this branch — reassign or remove them first");
  }

  await db.delete(branch).where(eq(branch.id, branchId));
}
