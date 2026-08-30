import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, cycleType } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

export const createCycleTypeInput = z.object({
  name: z.string().min(1),
  defaultSourceCycleId: z.string().uuid().nullable().optional(),
});
export type CreateCycleTypeInput = z.infer<typeof createCycleTypeInput>;

export const updateCycleTypeInput = createCycleTypeInput.partial();
export type UpdateCycleTypeInput = z.infer<typeof updateCycleTypeInput>;

// defaultSourceCycleId is a non-FK pointer (see src/db/schema/cycle-
// type.ts's own comment) — validated here the same way Community's own
// task/form pointers are validated in src/lib/settings/community.ts,
// since the database itself has no FK to enforce it.
async function requireCycleInCommunity(communityId: string, cycleId: string) {
  const [row] = await db
    .select({ id: cycle.id })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found in your community");
  }
}

export async function listCycleTypes(actor: Member) {
  return db.select().from(cycleType).where(eq(cycleType.communityId, actor.communityId)).orderBy(cycleType.name);
}

export async function createCycleType(actor: Member, input: CreateCycleTypeInput) {
  if (input.defaultSourceCycleId) {
    await requireCycleInCommunity(actor.communityId, input.defaultSourceCycleId);
  }

  const [created] = await db
    .insert(cycleType)
    .values({
      communityId: actor.communityId,
      name: input.name,
      defaultSourceCycleId: input.defaultSourceCycleId ?? null,
    })
    .returning();
  return created;
}

export async function updateCycleType(actor: Member, cycleTypeId: string, input: UpdateCycleTypeInput) {
  if (input.defaultSourceCycleId) {
    await requireCycleInCommunity(actor.communityId, input.defaultSourceCycleId);
  }

  const [updated] = await db
    .update(cycleType)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.defaultSourceCycleId !== undefined && { defaultSourceCycleId: input.defaultSourceCycleId }),
    })
    .where(and(eq(cycleType.id, cycleTypeId), eq(cycleType.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Cycle type not found");
  }
  return updated;
}

export async function deleteCycleType(actor: Member, cycleTypeId: string) {
  const [existing] = await db
    .select({ id: cycleType.id })
    .from(cycleType)
    .where(and(eq(cycleType.id, cycleTypeId), eq(cycleType.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Cycle type not found");
  }

  const [inUse] = await db.select({ id: cycle.id }).from(cycle).where(eq(cycle.cycleTypeId, cycleTypeId)).limit(1);
  if (inUse) {
    throw new ConflictError("Cycles still reference this type — untag them first");
  }

  await db.delete(cycleType).where(eq(cycleType.id, cycleTypeId));
}
