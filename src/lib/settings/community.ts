import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

export async function getCommunity(actor: Member) {
  const [row] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// Deliberately narrow — per docs/development-plan.md's Phase 9 scope
// ("branches, tiers, and cycle/phase structure"), not the full
// Configuration model. membership_model, branch_membership_model,
// modules_enabled, and the call defaults stay DB-only for now.
export const updateCommunityInput = z.object({
  name: z.string().min(1).optional(),
  cyclesEnabled: z.boolean().optional(),
  phasesEnabled: z.boolean().optional(),
  cycleInitiationTierId: z.string().uuid().nullable().optional(),
});
export type UpdateCommunityInput = z.infer<typeof updateCommunityInput>;

export async function updateCommunity(actor: Member, input: UpdateCommunityInput) {
  if (input.cycleInitiationTierId) {
    const [tierRow] = await db
      .select({ id: tier.id, communityId: tier.communityId })
      .from(tier)
      .where(eq(tier.id, input.cycleInitiationTierId));
    if (!tierRow || tierRow.communityId !== actor.communityId) {
      throw new NotFoundError("Tier not found in your community");
    }
  }

  const [updated] = await db
    .update(community)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.cyclesEnabled !== undefined && { cyclesEnabled: input.cyclesEnabled }),
      ...(input.phasesEnabled !== undefined && { phasesEnabled: input.phasesEnabled }),
      ...(input.cycleInitiationTierId !== undefined && {
        cycleInitiationTierId: input.cycleInitiationTierId,
      }),
    })
    .where(eq(community.id, actor.communityId))
    .returning();

  return updated;
}
