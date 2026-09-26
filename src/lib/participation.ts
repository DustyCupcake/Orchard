import { and, desc, eq, gt, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { communityInvite, cycle, JOINING_LANE_KINDS, participation } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "./errors";
import { syncComputedTiers } from "./settings/tiers";
import { requireCycleOpen } from "./cycles/lifecycle";
import { listOpenCycles } from "./cycles/crud";
import { getJoinLaneRulesForContext, laneRedemptionKind, redemptionKindForInvite } from "./recruitment/joining-lanes";

type Member = typeof memberTable.$inferSelect;

async function requireCycleInCommunity(actor: Member, cycleId: string) {
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Event not found");
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

  // An omitted arrivalDate/departureDate/note leaves whatever is already
  // stored alone; an explicit null still clears it. This is what lets the
  // Dashboard's/Community's one-click status buttons (src/components/
  // EventParticipation.tsx) submit `status` and nothing else without
  // silently wiping the dates and note someone typed into /participation's
  // own full form. Every pre-existing caller parses its form into explicit
  // nulls — the Events form always sends a value, even an empty one, which
  // parses to null — so no existing call site changes behavior, and
  // /api/cycles/[id]/participation still clears on a body that omits them
  // only if it sends them as explicit nulls, same as before.
  const values = {
    status: input.status,
    ...(input.arrivalDate !== undefined && { arrivalDate: input.arrivalDate }),
    ...(input.departureDate !== undefined && { departureDate: input.departureDate }),
    ...(input.note !== undefined && { note: input.note }),
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
// Recruitment is on). Outstanding invite links whose lane resolves to
// the direct path (docs/joining-admission-plan.md §2/§4.1) "hold"
// capacity slots too, so they count against what's left here the same
// way getCycleJoiningState counts them at the door; any lane that
// routes through the evaluated application holds nothing.
export async function getCycleParticipationSummary(actor: Member, cycleId: string) {
  const cycleRow = await requireCycleInCommunity(actor, cycleId);

  const comingRows = await db
    .select({ memberId: participation.memberId })
    .from(participation)
    .where(and(eq(participation.cycleId, cycleId), eq(participation.status, "coming")));
  const comingCount = comingRows.length;

  let holds = 0;
  const laneRules = await getJoinLaneRulesForContext(cycleRow.communityId, cycleId);
  if (JOINING_LANE_KINDS.some((lane) => laneRedemptionKind(laneRules.get(lane)!) === "direct")) {
    const now = new Date();
    const heldRows = await db
      .select({
        id: communityInvite.id,
        inviterThinksGoodFit: communityInvite.inviterThinksGoodFit,
        inviterKnowsPersonally: communityInvite.inviterKnowsPersonally,
      })
      .from(communityInvite)
      .where(
        and(
          eq(communityInvite.cycleId, cycleId),
          eq(communityInvite.communityId, cycleRow.communityId),
          isNull(communityInvite.redeemedAt),
          isNull(communityInvite.revokedAt),
          or(isNull(communityInvite.expiresAt), gt(communityInvite.expiresAt, now)),
        ),
      );
    holds = heldRows.filter((row) => redemptionKindForInvite(row, laneRules) === "direct").length;
  }
  const usedCapacity = comingCount + holds;

  return {
    capacity: cycleRow.capacity,
    comingCount,
    holds,
    remainingCapacity: cycleRow.capacity === null ? null : cycleRow.capacity - usedCapacity,
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

export type OpenEventParticipationCard = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  comingCount: number;
  holds: number;
  remainingCapacity: number | null;
  myStatus: "unknown" | "coming" | "maybe" | "not_coming";
};

// "What's open, and am I in it" — the bulk counterpart to
// getCycleParticipationSummary/getMyParticipation above, for the
// Dashboard's and Community's declare-joining cards
// (src/components/EventParticipation.tsx).
//
// Deliberately assembled from those two per-cycle functions rather than a
// hand-rolled group-by COUNT: outstanding direct-lane invitees "hold"
// capacity slots just like a declaration does (docs/joining-admission-plan.md
// §2/§4.1), so a second counting path here would be a second thing to keep
// honest against the Events page. The query count is bounded by the number
// of open cycles, which is near-always 1 — starting a second one while one's
// already open already takes an explicit confirmation (createCycle).
export async function listOpenEventParticipationCards(actor: Member): Promise<OpenEventParticipationCard[]> {
  const open = await listOpenCycles(actor);
  const cards = await Promise.all(
    open.map(async (c) => {
      const [summary, mine] = await Promise.all([
        getCycleParticipationSummary(actor, c.id),
        getMyParticipation(actor, c.id),
      ]);
      return {
        id: c.id,
        name: c.name,
        startDate: c.startDate,
        endDate: c.endDate,
        capacity: summary.capacity,
        comingCount: summary.comingCount,
        holds: summary.holds,
        remainingCapacity: summary.remainingCapacity,
        myStatus: mine.status,
      };
    }),
  );
  return sortEventsForDisplay(cards);
}

// Display order for the "current and upcoming" cards: soonest first, with
// undated events last (a community that hasn't set dates yet has no
// "upcoming" to speak of), then by name so the order is deterministic
// rather than whatever order rows came back in. listOpenCycles' own
// startedAt-desc order is the right order for an admin list, not this one.
function sortEventsForDisplay(cards: OpenEventParticipationCard[]): OpenEventParticipationCard[] {
  return [...cards].sort((a, b) => {
    if (a.startDate && b.startDate && a.startDate !== b.startDate) {
      return a.startDate < b.startDate ? -1 : 1;
    }
    if (a.startDate && !b.startDate) return -1;
    if (!a.startDate && b.startDate) return 1;
    return a.name.localeCompare(b.name);
  });
}
