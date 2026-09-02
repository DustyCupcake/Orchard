import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, cycle, cycleType, member, participation, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { requireNotOnsiteLockedForCommunity } from "../onsite-mode";

type Member = typeof memberTable.$inferSelect;

export const createTierInput = z.object({
  name: z.string().min(1),
  // Only "manual" and, as of Phase 40, "cycle_type_count" are
  // functional (see docs/development-plan.md's Phase 2 scope for the
  // original tenure/completion/cohort deferral — still true for those
  // three; nothing built since has picked them up). The other values
  // stay selectable so the schema doesn't have to change later, but
  // nothing reads criterionConfig for them yet.
  criterionType: z.enum(["manual", "tenure", "completion", "cohort", "cycle_type_count"]).optional(),
  criterionConfig: z.record(z.string(), z.unknown()).optional(),
});
export type CreateTierInput = z.infer<typeof createTierInput>;

export const updateTierInput = createTierInput.partial();
export type UpdateTierInput = z.infer<typeof updateTierInput>;

// { cycleTypeId, minCount } — "had Participation `coming` in at least
// minCount Cycles of cycleTypeId." Re-checked here rather than trusting
// createTierInput's generic z.record alone — the same defense-in-depth
// precedent Forms'/Budget's own createForm/submitBudgetProposal already
// established for their own jsonb shapes.
export const cycleTypeCountConfigSchema = z.object({
  cycleTypeId: z.string().uuid(),
  minCount: z.number().int().positive(),
});

async function requireValidCriterionConfig(
  communityId: string,
  criterionType: string | undefined,
  criterionConfig: Record<string, unknown> | undefined,
) {
  if (criterionType !== "cycle_type_count") return;

  const parsed = cycleTypeCountConfigSchema.safeParse(criterionConfig ?? {});
  if (!parsed.success) {
    throw new AppError("A cycle-type-count criterion needs a cycleTypeId and a positive minCount");
  }

  const [row] = await db
    .select({ id: cycleType.id })
    .from(cycleType)
    .where(and(eq(cycleType.id, parsed.data.cycleTypeId), eq(cycleType.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Cycle type not found in your community");
  }
}

export async function listTiers(actor: Member) {
  return db.select().from(tier).where(eq(tier.communityId, actor.communityId)).orderBy(tier.name);
}

export async function createTier(actor: Member, input: CreateTierInput) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);
  await requireValidCriterionConfig(actor.communityId, input.criterionType, input.criterionConfig);

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
  await requireNotOnsiteLockedForCommunity(actor.communityId);

  const [existing] = await db
    .select()
    .from(tier)
    .where(and(eq(tier.id, tierId), eq(tier.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Tier not found");
  }

  const nextCriterionType = input.criterionType ?? existing.criterionType;
  const nextCriterionConfig =
    input.criterionConfig ?? (existing.criterionConfig as Record<string, unknown>);
  await requireValidCriterionConfig(actor.communityId, nextCriterionType, nextCriterionConfig);

  const [updated] = await db
    .update(tier)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.criterionType !== undefined && { criterionType: input.criterionType }),
      ...(input.criterionConfig !== undefined && { criterionConfig: input.criterionConfig }),
    })
    .where(and(eq(tier.id, tierId), eq(tier.communityId, actor.communityId)))
    .returning();
  return updated;
}

export async function deleteTier(actor: Member, tierId: string) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);

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

// How many distinct Cycles of this type the member has had Participation
// `coming` in — the count `cycle_type_count`'s minCount is checked
// against. See docs/spec.md's "Cycle-type-count-based" Tier criterion.
export async function computeCycleTypeCount(memberId: string, cycleTypeId: string): Promise<number> {
  const rows = await db
    .select({ cycleId: participation.cycleId })
    .from(participation)
    .innerJoin(cycle, eq(cycle.id, participation.cycleId))
    .where(
      and(
        eq(participation.memberId, memberId),
        eq(participation.status, "coming"),
        eq(cycle.cycleTypeId, cycleTypeId),
      ),
    );
  return new Set(rows.map((r) => r.cycleId)).size;
}

// Keeps a member's `tierIds` in sync with every `cycle_type_count` Tier
// in their Community — the one criterion type this codebase actually
// computes (see the createTierInput comment above; tenure/completion/
// cohort stay manual-assignment-only). Recomputed and written back
// eagerly whenever the one thing that could move it changes — the
// member's own Participation (called from declareParticipation) — the
// same "cache, recompute on every relevant write" posture Phase 39's
// date model uses, rather than making every ordinary tierIds read
// (task Requirement gating, cycle-initiation eligibility, ...) newly
// async and DB-aware just for this one criterion type. Only ever
// touches tier ids whose criterion is actually cycle_type_count — a
// manually-assigned tier, or one of the other still-inert criterion
// types, is left completely alone.
export async function syncComputedTiers(memberId: string, communityId: string): Promise<void> {
  const cycleTypeCountTiers = await db
    .select()
    .from(tier)
    .where(and(eq(tier.communityId, communityId), eq(tier.criterionType, "cycle_type_count")));
  if (cycleTypeCountTiers.length === 0) return;

  const [memberRow] = await db.select({ tierIds: member.tierIds }).from(member).where(eq(member.id, memberId));
  if (!memberRow) return;

  const nextTierIds = new Set(memberRow.tierIds);
  for (const t of cycleTypeCountTiers) {
    const config = cycleTypeCountConfigSchema.safeParse(t.criterionConfig);
    if (!config.success) continue; // not (yet) validly configured — leave untouched

    const count = await computeCycleTypeCount(memberId, config.data.cycleTypeId);
    if (count >= config.data.minCount) {
      nextTierIds.add(t.id);
    } else {
      nextTierIds.delete(t.id);
    }
  }

  const before = [...memberRow.tierIds].sort();
  const after = [...nextTierIds].sort();
  if (before.length === after.length && before.every((id, i) => id === after[i])) {
    return; // no actual change — skip the write
  }
  await db.update(member).set({ tierIds: after }).where(eq(member.id, memberId));
}

export interface CycleTypeCountProgress {
  tierId: string;
  tierName: string;
  cycleTypeId: string;
  cycleTypeName: string;
  count: number;
  minCount: number;
  held: boolean;
}

// For /profile — lets a member see their own live progress toward every
// cycle_type_count Tier in their Community, not just a binary held/not.
export async function getCycleTypeCountProgress(actor: Member): Promise<CycleTypeCountProgress[]> {
  const cycleTypeCountTiers = await db
    .select()
    .from(tier)
    .where(and(eq(tier.communityId, actor.communityId), eq(tier.criterionType, "cycle_type_count")));
  if (cycleTypeCountTiers.length === 0) return [];

  const cycleTypeIds = cycleTypeCountTiers
    .map((t) => cycleTypeCountConfigSchema.safeParse(t.criterionConfig))
    .filter((r) => r.success)
    .map((r) => r.data.cycleTypeId);
  const cycleTypes =
    cycleTypeIds.length === 0
      ? []
      : await db.select().from(cycleType).where(inArray(cycleType.id, cycleTypeIds));
  const cycleTypeById = new Map(cycleTypes.map((c) => [c.id, c]));

  const progress: CycleTypeCountProgress[] = [];
  for (const t of cycleTypeCountTiers) {
    const config = cycleTypeCountConfigSchema.safeParse(t.criterionConfig);
    if (!config.success) continue;
    const typeRow = cycleTypeById.get(config.data.cycleTypeId);
    if (!typeRow) continue;

    const count = await computeCycleTypeCount(actor.id, config.data.cycleTypeId);
    progress.push({
      tierId: t.id,
      tierName: t.name,
      cycleTypeId: typeRow.id,
      cycleTypeName: typeRow.name,
      count,
      minCount: config.data.minCount,
      held: count >= config.data.minCount,
    });
  }
  return progress;
}
