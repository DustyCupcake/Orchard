import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { communityInvite, cycle, JOINING_LANE_KINDS, participation } from "@/db/schema";
import type { cycle as cycleTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { getJoinLaneRulesForContext, laneRedemptionKind, redemptionKindForInvite } from "./joining-lanes";

type CycleRow = typeof cycleTable.$inferSelect;

// The per-cycle joining state docs/cycle-scope-remediation-plan.md §4.3
// (work-plan step 8c) describes: does this cycle's door admit a
// specific kind of newcomer right now? Three independent gates compose
// it —
//
//   period     — the joining period is open: from the close of the
//                returning-priority window (`returningWindowClosesAt`,
//                existing members declare first) or the cycle's start
//                if none, until `joiningWindowClosesAt` (null = until
//                the cycle closes). A closed cycle's period is never
//                open.
//   door       — the cycle's own applicationsOpen / invitesOpen flag.
//   capacity   — a set capacity that comingCount already fills
//                ("recruitment opens against whatever capacity
//                remains"): the *displayed* number stays un-clamped
//                per spec's "not a special case"; the *door gate* is
//                the policy. Direct-lane issues count too: an
//                *outstanding* invite whose lane resolves to the direct
//                path holds a capacity slot until redeemed, revoked, or
//                expired (docs/joining-admission-plan.md §2/§4.1), so
//                issued-but-unspent slots fill the room as well.
export type CycleJoiningState = {
  cycle: CycleRow;
  periodOpen: boolean;
  atCapacity: boolean;
  applicationsOpen: boolean;
  invitesOpen: boolean;
  comingCount: number;
  holds: number;
  capacity: number | null;
  remainingCapacity: number | null;
};

export async function getCycleJoiningState(communityId: string, cycleId: string): Promise<CycleJoiningState> {
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found in your community");
  }

  const comingRows = await db
    .select({ id: participation.id })
    .from(participation)
    .where(and(eq(participation.cycleId, cycleId), eq(participation.status, "coming")));
  const comingCount = comingRows.length;
  const now = new Date();

  // §4.3/8d + docs/joining-admission-plan.md §2/§4.1 — an *outstanding*
  // invite holds a capacity slot only when its lane resolves to the
  // direct path (basic verification with no process). The lane is fixed
  // at creation by the inviter's marks; the rule is the cycle's own
  // `joining_lane` row, else the community-wide one. Any lane that
  // routes through the evaluated application holds nothing, and if no
  // lane in this context resolves direct there is nothing to count at
  // all — skip the invite query entirely.
  let heldCount = 0;
  const laneRules = await getJoinLaneRulesForContext(communityId, cycleId);
  if (JOINING_LANE_KINDS.some((lane) => laneRedemptionKind(laneRules.get(lane)!) === "direct")) {
    const outstanding = await db
      .select({
        id: communityInvite.id,
        inviterThinksGoodFit: communityInvite.inviterThinksGoodFit,
        inviterKnowsPersonally: communityInvite.inviterKnowsPersonally,
      })
      .from(communityInvite)
      .where(
        and(
          eq(communityInvite.cycleId, cycleId),
          isNull(communityInvite.redeemedAt),
          isNull(communityInvite.revokedAt),
          or(isNull(communityInvite.expiresAt), gt(communityInvite.expiresAt, now)),
        ),
      );
    heldCount = outstanding.filter((row) => redemptionKindForInvite(row, laneRules) === "direct").length;
  }
  const usedCapacity = comingCount + heldCount;
  const atCapacity = row.capacity !== null && usedCapacity >= row.capacity;

  const periodStartsAt = row.returningWindowClosesAt ?? row.startedAt;
  const periodOpen =
    !row.closedAt && (!periodStartsAt || now >= periodStartsAt) && (!row.joiningWindowClosesAt || now <= row.joiningWindowClosesAt);

  return {
    cycle: row,
    periodOpen,
    atCapacity,
    applicationsOpen: periodOpen && row.applicationsOpen && !atCapacity,
    invitesOpen: periodOpen && row.invitesOpen && !atCapacity,
    comingCount,
    holds: heldCount,
    capacity: row.capacity,
    remainingCapacity: row.capacity === null ? null : row.capacity - usedCapacity,
  };
}