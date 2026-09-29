import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, cycleType, taskPack } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requireNotOnsiteLockedForCommunity } from "../onsite-mode";
import { recordSettingChanges } from "./history";

type Member = typeof memberTable.$inferSelect;

export const createCycleTypeInput = z.object({
  name: z.string().min(1),
  defaultSourceCycleId: z.string().uuid().nullable().optional(),
  defaultPackId: z.string().uuid().nullable().optional(),
});
export type CreateCycleTypeInput = z.infer<typeof createCycleTypeInput>;

export const updateCycleTypeInput = createCycleTypeInput.partial();
export type UpdateCycleTypeInput = z.infer<typeof updateCycleTypeInput>;

// defaultSourceCycleId/defaultPackId are both non-FK pointers (see
// src/db/schema/cycle-type.ts's own comment) — validated here the same
// way Community's own task/form pointers are validated in
// src/lib/settings/community.ts, since the database itself has no FK
// to enforce either.
async function requireCycleInCommunity(communityId: string, cycleId: string) {
  const [row] = await db
    .select({ id: cycle.id })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Event not found in your community");
  }
}

async function requirePackInCommunity(communityId: string, packId: string) {
  const [row] = await db
    .select({ id: taskPack.id })
    .from(taskPack)
    .where(and(eq(taskPack.id, packId), eq(taskPack.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Task Pack not found in your community");
  }
}

export async function listCycleTypes(actor: Member) {
  return db.select().from(cycleType).where(eq(cycleType.communityId, actor.communityId)).orderBy(cycleType.name);
}

export async function createCycleType(actor: Member, input: CreateCycleTypeInput) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);
  if (input.defaultSourceCycleId) {
    await requireCycleInCommunity(actor.communityId, input.defaultSourceCycleId);
  }
  if (input.defaultPackId) {
    await requirePackInCommunity(actor.communityId, input.defaultPackId);
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(cycleType)
      .values({
        communityId: actor.communityId,
        name: input.name,
        defaultSourceCycleId: input.defaultSourceCycleId ?? null,
        defaultPackId: input.defaultPackId ?? null,
      })
      .returning();
    await recordSettingChanges(tx, {
      actor,
      entity: "cycle_type",
      action: "created",
      entityId: created.id,
      entityLabel: created.name,
      current: {},
      changes: {
        name: created.name,
        // Both pointers are null on a plain new event type, and "default
        // source: nothing" is a statement about a setting nobody set.
        ...(created.defaultSourceCycleId !== null && {
          defaultSourceCycleId: created.defaultSourceCycleId,
        }),
        ...(created.defaultPackId !== null && { defaultPackId: created.defaultPackId }),
      },
    });
    return created;
  });
}

export async function updateCycleType(actor: Member, cycleTypeId: string, input: UpdateCycleTypeInput) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);
  if (input.defaultSourceCycleId) {
    await requireCycleInCommunity(actor.communityId, input.defaultSourceCycleId);
  }
  if (input.defaultPackId) {
    await requirePackInCommunity(actor.communityId, input.defaultPackId);
  }

  const existing = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(cycleType)
      .where(and(eq(cycleType.id, cycleTypeId), eq(cycleType.communityId, actor.communityId)));
    if (!before) {
      throw new NotFoundError("Event type not found");
    }

    const [row] = await tx
      .update(cycleType)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.defaultSourceCycleId !== undefined && { defaultSourceCycleId: input.defaultSourceCycleId }),
        ...(input.defaultPackId !== undefined && { defaultPackId: input.defaultPackId }),
      })
      .where(and(eq(cycleType.id, cycleTypeId), eq(cycleType.communityId, actor.communityId)))
      .returning();

    await recordSettingChanges(tx, {
      actor,
      entity: "cycle_type",
      action: "updated",
      entityId: cycleTypeId,
      entityLabel: row.name,
      current: before,
      changes: input,
    });
    return row;
  });
  return existing;
}

export async function deleteCycleType(actor: Member, cycleTypeId: string) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);

  const [existing] = await db
    .select({ id: cycleType.id, name: cycleType.name })
    .from(cycleType)
    .where(and(eq(cycleType.id, cycleTypeId), eq(cycleType.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Event type not found");
  }

  const [inUse] = await db.select({ id: cycle.id }).from(cycle).where(eq(cycle.cycleTypeId, cycleTypeId)).limit(1);
  if (inUse) {
    throw new ConflictError("Events still reference this type — untag them first");
  }

  await db.transaction(async (tx) => {
    await tx.delete(cycleType).where(eq(cycleType.id, cycleTypeId));
    await recordSettingChanges(tx, {
      actor,
      entity: "cycle_type",
      action: "deleted",
      entityId: cycleTypeId,
      entityLabel: existing.name,
      current: existing,
      changes: { name: null },
    });
  });
}
