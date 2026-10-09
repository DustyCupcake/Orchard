import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { community, communityInvite, cycle, JOINING_LANE_KINDS, participation } from "@/db/schema";
import type { community as communityTable, cycle as cycleTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { getJoinLaneRulesForContext, pathHoldsCapacity, redemptionPathForInvite } from "./joining-lanes";

type CycleRow = typeof cycleTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;

// The per-cycle joining state docs/plans/archive/cycle-scope-remediation-plan.md §4.3
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
//   door       — the cycle's own applicationsOpen / invitesOpen /
//                interviewsOpen flag (docs/plans/archive/joining-admission-plan.md
//                §2.3/J3 — the third one is what finally makes the
//                interview stage a door rather than a side effect).
//   capacity   — a set capacity that comingCount already fills
//                ("recruitment opens against whatever capacity
//                remains"): the *displayed* number stays un-clamped
//                per spec's "not a special case"; the *door gate* is
//                the policy. Direct-lane issues count too: an
//                *outstanding* invite whose lane resolves to the direct
//                path holds a capacity slot until redeemed, revoked, or
//                expired (docs/plans/archive/joining-admission-plan.md §2/§4.1), so
//                issued-but-unspent slots fill the room as well.
export type CycleJoiningState = {
  cycle: CycleRow;
  periodOpen: boolean;
  atCapacity: boolean;
  applicationsOpen: boolean;
  invitesOpen: boolean;
  interviewsOpen: boolean;
  comingCount: number;
  holds: number;
  capacity: number | null;
  remainingCapacity: number | null;
};

// The community-wide door set, for the cycle-less general join
// (D13). `interviewsOpen` joins its two siblings here for the first
// time — a community that has never touched these keeps exactly what it
// had, because the new column defaults true and the only thing that
// reads it is an interview being scheduled.
export type CommunityJoiningDoors = {
  applicationsOpen: boolean;
  invitesOpen: boolean;
  interviewsOpen: boolean;
};

export function communityJoiningDoors(communityRow: CommunityRow): CommunityJoiningDoors {
  return {
    applicationsOpen: communityRow.recruitmentApplicationsOpen,
    invitesOpen: communityRow.recruitmentInvitesOpen,
    interviewsOpen: communityRow.recruitmentInterviewsOpen,
  };
}

export async function getCycleJoiningState(communityId: string, cycleId: string): Promise<CycleJoiningState> {
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Event not found in your community");
  }

  const comingRows = await db
    .select({ id: participation.id })
    .from(participation)
    .where(and(eq(participation.cycleId, cycleId), eq(participation.status, "coming")));
  const comingCount = comingRows.length;
  const now = new Date();

  // §4.3/8d + docs/plans/archive/joining-admission-plan.md §2/§4.1 — an *outstanding*
  // invite holds a capacity slot only when its lane resolves to the
  // direct path. The lane is fixed at creation by the inviter's marks;
  // the rule is the cycle's own `joining_lane` row, else the
  // community-wide one. A nomination is still waiting on people, a
  // consensus window on the community and a process lane on evaluators
  // — none of them has committed the room yet, so none of them holds
  // anything (see pathHoldsCapacity). If no lane in this context
  // resolves direct there is nothing to count at all — skip the invite
  // query entirely.
  let heldCount = 0;
  const laneRules = await getJoinLaneRulesForContext(communityId, cycleId);
  const someLaneHolds = JOINING_LANE_KINDS.some((lane) =>
    pathHoldsCapacity(
      redemptionPathForInvite(
        {
          inviterKnowsPersonally: lane === "invited_knows_personally",
          inviterThinksGoodFit: lane === "invited_good_fit",
        },
        laneRules,
      ),
    ),
  );
  if (someLaneHolds) {
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
    heldCount = outstanding.filter(
      (row) => pathHoldsCapacity(redemptionPathForInvite(row, laneRules)),
    ).length;
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
    interviewsOpen: periodOpen && row.interviewsOpen && !atCapacity,
    comingCount,
    holds: heldCount,
    capacity: row.capacity,
    remainingCapacity: row.capacity === null ? null : row.capacity - usedCapacity,
  };
}

// Whether an interview can be scheduled against a context, right now.
// The one place §2.3's third door is enforced: an intro call is
// scheduled automatically when a decision is reached, so without this
// check "interviews closed" would be a promise the backend broke on its
// own a moment later. The period and capacity are re-read here rather
// than assumed, because the decision that wants the interview may have
// been reached long after the application landed.
export async function canScheduleInterview(communityId: string, cycleId: string | null): Promise<boolean> {
  if (!cycleId) {
    const [communityRow] = await db
      .select({ interviewsOpen: community.recruitmentInterviewsOpen })
      .from(community)
      .where(eq(community.id, communityId));
    return Boolean(communityRow?.interviewsOpen);
  }
  const joining = await getCycleJoiningState(communityId, cycleId);
  return joining.interviewsOpen;
}
