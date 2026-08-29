import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, participation } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

async function requireCycleInCommunity(actor: Member, cycleId: string) {
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found");
  }
  return row;
}

export const declareParticipationInput = z.object({
  status: z.enum(["unknown", "coming", "maybe", "not_coming"]),
  arrivalDate: z.string().min(1).nullable().optional(),
  departureDate: z.string().min(1).nullable().optional(),
  note: z.string().nullable().optional(),
});
export type DeclareParticipationInput = z.infer<typeof declareParticipationInput>;

// "Resubmittable as plans change" — upserts in place, the same
// select-then-update-or-insert posture Assemblies' submitAssemblyResponse
// / Budget's submitBudgetVote already use.
export async function declareParticipation(actor: Member, cycleId: string, input: DeclareParticipationInput) {
  await requireCycleInCommunity(actor, cycleId);

  const values = {
    status: input.status,
    arrivalDate: input.arrivalDate ?? null,
    departureDate: input.departureDate ?? null,
    note: input.note ?? null,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select()
    .from(participation)
    .where(and(eq(participation.cycleId, cycleId), eq(participation.memberId, actor.id)));

  if (existing) {
    const [updated] = await db
      .update(participation)
      .set(values)
      .where(eq(participation.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(participation)
    .values({ cycleId, memberId: actor.id, ...values })
    .returning();
  return created;
}

// Default `unknown` shape for a member who hasn't declared anything
// yet — no row is materialized until they actually submit, so a first
// visit to /participation isn't itself a write.
export async function getMyParticipation(actor: Member, cycleId: string) {
  const [row] = await db
    .select()
    .from(participation)
    .where(and(eq(participation.cycleId, cycleId), eq(participation.memberId, actor.id)));
  return (
    row ?? {
      id: null,
      cycleId,
      memberId: actor.id,
      status: "unknown" as const,
      arrivalDate: null,
      departureDate: null,
      note: null,
      updatedAt: null,
    }
  );
}

// Remaining capacity is the plain difference, not clamped at zero —
// spec is explicit that hitting zero (or going past it) early "isn't a
// special case," just a real, visible number like any other limit here.
// The returning-priority window is purely time-computed from
// returningWindowClosesAt, the same no-scheduler-job pattern Assemblies'
// computeAssemblyPhase already established — null when the Community
// hasn't set one (most communities never will, per spec, unless
// Recruitment is on).
export async function getCycleParticipationSummary(actor: Member, cycleId: string) {
  const cycleRow = await requireCycleInCommunity(actor, cycleId);

  const comingRows = await db
    .select({ memberId: participation.memberId })
    .from(participation)
    .where(and(eq(participation.cycleId, cycleId), eq(participation.status, "coming")));
  const comingCount = comingRows.length;

  return {
    capacity: cycleRow.capacity,
    comingCount,
    remainingCapacity: cycleRow.capacity === null ? null : cycleRow.capacity - comingCount,
    returningWindowClosesAt: cycleRow.returningWindowClosesAt,
    returningWindowOpen: cycleRow.returningWindowClosesAt
      ? new Date() < cycleRow.returningWindowClosesAt
      : null,
  };
}
