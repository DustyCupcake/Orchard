import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { community, communityInvite, cycle, participation } from "@/db/schema";
import type { community as communityTable, cycle as cycleTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { declarationFromInvite, laneRuleOf, listOpenLanes } from "./admission-lanes";
import { laneHandles, laneHoldsCapacity } from "./lane-rules";

type CycleRow = typeof cycleTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;

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
//   door       — the cycle's own applicationsOpen / invitesOpen /
//                interviewsOpen flag (docs/joining-admission-plan.md
//                §2.3/J3 — the third one is what finally makes the
//                interview stage a door rather than a side effect).
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

  const heldCount = await countCapacityHolds(communityId, cycleId);
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


// An *outstanding* invite holds a place in a capped event when the lane it
// resolves to in that event admits straight away (docs/admission-flow.md §6):
// the issued-but-unspent invite is a promise of a place, so it counts against
// the room the same as someone already coming. An invite whose lane runs a
// check or a process holds nothing — nobody has committed the room yet. An
// invite whose lane is no longer open in the event is held rather than spent,
// and holds nothing either.
export async function countCapacityHolds(communityId: string, cycleId: string): Promise<number> {
  const lanes = (await listOpenLanes(communityId, cycleId)).map(laneRuleOf);
  if (!lanes.some(laneHoldsCapacity)) return 0;
  const outstanding = await db
    .select({
      inviterThinksGoodFit: communityInvite.inviterThinksGoodFit,
      inviterKnowsPersonally: communityInvite.inviterKnowsPersonally,
    })
    .from(communityInvite)
    .where(
      and(
        eq(communityInvite.communityId, communityId),
        eq(communityInvite.cycleId, cycleId),
        isNull(communityInvite.redeemedAt),
        isNull(communityInvite.revokedAt),
        or(isNull(communityInvite.expiresAt), gt(communityInvite.expiresAt, new Date())),
      ),
    );
  return outstanding.filter((invite) => {
    const declaration = declarationFromInvite(invite);
    const lane = lanes.find((l) => laneHandles(l, declaration));
    return lane ? laneHoldsCapacity(lane) : false;
  }).length;
}
