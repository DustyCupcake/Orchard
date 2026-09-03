import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { packPhase, taskPack, taskPackItem } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

export const packManifestInput = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  version: z.string().min(1).optional(),
  domainTags: z.array(z.string()).optional(),
});
export type PackManifestInput = z.infer<typeof packManifestInput>;

export async function listTaskPacks(actor: Member) {
  return db
    .select()
    .from(taskPack)
    .where(eq(taskPack.communityId, actor.communityId))
    .orderBy(taskPack.name);
}

export async function getTaskPack(actor: Member, packId: string) {
  const [pack] = await db
    .select()
    .from(taskPack)
    .where(and(eq(taskPack.id, packId), eq(taskPack.communityId, actor.communityId)));
  if (!pack) {
    throw new NotFoundError("Task Pack not found");
  }

  const phases = await db.select().from(packPhase).where(eq(packPhase.packId, packId)).orderBy(packPhase.order);
  const items = await db.select().from(taskPackItem).where(eq(taskPackItem.packId, packId));
  return { pack, phases, items };
}

// Retiring a pack from the picker without losing it — same posture
// ShiftSeries.archivedAt already established. Never deletes: a Cycle
// may still point at it via sourcePackId.
export async function archiveTaskPack(actor: Member, packId: string) {
  const [updated] = await db
    .update(taskPack)
    .set({ archivedAt: new Date() })
    .where(and(eq(taskPack.id, packId), eq(taskPack.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Task Pack not found");
  }
  return updated;
}

export async function unarchiveTaskPack(actor: Member, packId: string) {
  const [updated] = await db
    .update(taskPack)
    .set({ archivedAt: null })
    .where(and(eq(taskPack.id, packId), eq(taskPack.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Task Pack not found");
  }
  return updated;
}
