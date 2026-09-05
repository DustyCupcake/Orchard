import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, participation } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "./errors";
import { syncComputedTiers } from "./settings/tiers";
import { requireCycleOpen } from "./cycles/lifecycle";

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
  const cycleRow = await requireCycleInCommunity(actor, cycleId);
  requireCycleOpen(cycleRow);

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

  let result;
  if (existing) {
    const [updated] = await db
      .update(participation)
      .set(values)
      .where(eq(participation.id, existing.id))
      .returning();
    result = updated;
  } else {
    const [created] = await db
      .insert(participation)
      .values({ cycleId, memberId: actor.id, ...values })
      .returning();
    result = created;
  }

  // A status change is the only thing that could move a
  // cycle_type_count Tier's count — see docs/development-plan.md's
  // Phase 40 and src/lib/settings/tiers.ts's syncComputedTiers.
  await syncComputedTiers(actor.id, actor.communityId);

  return result;
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

// "Every open cycle this member has declared Participation `coming`
// for" — the nav switcher's own aggregate definition
// (docs/development-plan.md's Phase 65). Every existing caller of
// getMyParticipation above resolves one cycle first; this is the bulk
// counterpart that doesn't exist yet.
export async function listComingCycleIds(actor: Member): Promise<string[]> {
  const rows = await db
    .select({ cycleId: participation.cycleId })
    .from(participation)
    .innerJoin(cycle, eq(cycle.id, participation.cycleId))
    .where(
      and(
        eq(participation.memberId, actor.id),
        eq(cycle.communityId, actor.communityId),
        isNull(cycle.closedAt),
        eq(participation.status, "coming"),
      ),
    );
  return rows.map((r) => r.cycleId);
}

// "Which open cycle has THIS member actually declared coming/maybe/
// not_coming to" — distinct from the nav's own view-scope resolvers
// (src/lib/cycles/view-scope.ts): a member glancing at a different
// cycle in their nav should never stop seeing their own outstanding
// profile questions (docs/development-plan.md's Phase 65). Most-
// recently-started wins if a member has somehow declared on more than
// one open cycle. Falls back to the community's single open cycle when
// this member has declared on nothing at all — reproduces the old
// community-wide heuristic exactly for the overwhelmingly common
// single-cycle case; only returns null when there's genuinely nothing
// to resolve (0 or 2+ open cycles and no real declaration).
export async function getMemberDeclaredCycleId(actor: Member): Promise<string | null> {
  const [declared] = await db
    .select({ cycleId: participation.cycleId })
    .from(participation)
    .innerJoin(cycle, eq(cycle.id, participation.cycleId))
    .where(
      and(
        eq(participation.memberId, actor.id),
        eq(cycle.communityId, actor.communityId),
        isNull(cycle.closedAt),
        ne(participation.status, "unknown"),
      ),
    )
    .orderBy(desc(cycle.startedAt))
    .limit(1);
  if (declared) return declared.cycleId;

  const openCycles = await db
    .select({ id: cycle.id })
    .from(cycle)
    .where(and(eq(cycle.communityId, actor.communityId), isNull(cycle.closedAt)));
  return openCycles.length === 1 ? openCycles[0].id : null;
}
