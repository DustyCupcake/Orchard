import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

export const createTierInput = z.object({
  name: z.string().min(1),
  // Only "manual" is functional right now (see docs/development-plan.md's
  // Phase 2 scope — tenure/completion/cohort/cycle_type_count criteria
  // computation is deferred past MVP). The other values are still
  // selectable so the schema doesn't have to change later, but nothing
  // reads criterionConfig for them yet.
  criterionType: z.enum(["manual", "tenure", "completion", "cohort", "cycle_type_count"]).optional(),
  criterionConfig: z.record(z.string(), z.unknown()).optional(),
});
export type CreateTierInput = z.infer<typeof createTierInput>;

export const updateTierInput = createTierInput.partial();
export type UpdateTierInput = z.infer<typeof updateTierInput>;

export async function listTiers(actor: Member) {
  return db.select().from(tier).where(eq(tier.communityId, actor.communityId)).orderBy(tier.name);
}

export async function createTier(actor: Member, input: CreateTierInput) {
  const [created] = await db
    .insert(tier)
    .values({
      communityId: actor.communityId,
      name: input.name,
      criterionType: input.criterionType ?? "manual",
      criterionConfig: input.criterionConfig ?? {},
    })
    .returning();
  return created;
}

export async function updateTier(actor: Member, tierId: string, input: UpdateTierInput) {
  const [updated] = await db
    .update(tier)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.criterionType !== undefined && { criterionType: input.criterionType }),
      ...(input.criterionConfig !== undefined && { criterionConfig: input.criterionConfig }),
    })
    .where(and(eq(tier.id, tierId), eq(tier.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Tier not found");
  }
  return updated;
}

export async function deleteTier(actor: Member, tierId: string) {
  const [existing] = await db
    .select({ id: tier.id })
    .from(tier)
    .where(and(eq(tier.id, tierId), eq(tier.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Tier not found");
  }

  const [communityRow] = await db
    .select({ cycleInitiationTierId: community.cycleInitiationTierId })
    .from(community)
    .where(eq(community.id, actor.communityId));
  if (communityRow?.cycleInitiationTierId === tierId) {
    throw new ConflictError(
      "This tier gates cycle initiation — change that setting before deleting it",
    );
  }

  await db.delete(tier).where(eq(tier.id, tierId));
}
