import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { community, communityInvite, cycle, participation } from "@/db/schema";
import type { cycle as cycleTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { declarationFromInvite, laneRuleOf, listOpenLanes } from "./admission-lanes";
import { laneHandles, laneHoldsCapacity } from "./lane-rules";

type CycleRow = typeof cycleTable.$inferSelect;

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
// resolves to in that event admits straight away (docs/plans/admission-flow.md §6):
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

// Where a person is trying to get in, which decides which doors matter.
//   invite_created  — a member is making an invitation link
//   invite_redeemed — somebody is opening one
//   application     — somebody is sending an application (`withInvite`: with an invite behind it)
export type EntryVia = "invite_created" | "invite_redeemed" | "application";

// docs/plans/admission-flow.md §6: every door is checked where it matters, and doors
// govern *entering* — a closed one stops new entries and says so, and a person
// already in the funnel carries on. This is the one place that is decided, for
// the three ways in, so creating an invite, opening it and sending an
// application can never disagree about whether the door is open (redemption
// used to check none of them).
//
// Returns the sentence to show, or null when the way is clear. Three things
// worth knowing about what it does *not* refuse:
//   - the interviews door. A closed one holds an arrival at the interview step;
//     it never turns someone away at the entrance, and never skips the step.
//   - an invite whose lane admits at once when the event is full. That invite
//     is already holding its place (it is counted in the room), so refusing it
//     for the room it is itself using would make it impossible to ever redeem.
//     Capacity is checked again at admission, which is the moment a place is
//     actually taken.
//   - an invite that has been issued and whose door has since closed is not
//     revoked: it is refused here, with a message, and works again when the
//     door reopens or it expires.
export async function entryRefusal(input: {
  communityId: string;
  cycleId: string | null;
  lane: { applicationRequired: boolean; interviewRequired: boolean; verification: "none" | "community_check" };
  via: EntryVia;
  withInvite?: boolean;
}): Promise<string | null> {
  const { via } = input;
  const needsInviteDoor = via !== "application" || Boolean(input.withInvite);
  const needsApplicationDoor = via === "application" || input.lane.applicationRequired;
  const admitsAtOnce =
    input.lane.verification === "none" && !input.lane.applicationRequired && !input.lane.interviewRequired;

  if (input.cycleId) {
    const joining = await getCycleJoiningState(input.communityId, input.cycleId);
    if (!joining.periodOpen) {
      return via === "application" ? "Applications for this event aren't open right now" : "This event's joining period isn't open";
    }
    const holdsItsOwnPlace = via === "invite_redeemed" && admitsAtOnce;
    if (joining.atCapacity && !holdsItsOwnPlace) {
      return via === "application"
        ? "This event is full — no capacity left for new applications"
        : "This event is full — no capacity left for new joins";
    }
    if (needsInviteDoor && !joining.cycle.invitesOpen) return "Invites for this event are closed";
    if (needsApplicationDoor && !joining.cycle.applicationsOpen) return "Applications for this event are closed";
    return null;
  }

  const [communityRow] = await db.select().from(community).where(eq(community.id, input.communityId));
  if (!communityRow) throw new NotFoundError("Community not found");
  if (needsInviteDoor && !communityRow.recruitmentInvitesOpen) {
    return "This community isn't accepting invite-based joins right now";
  }
  if (needsApplicationDoor && !communityRow.recruitmentApplicationsOpen) {
    return "This community isn't accepting applications right now";
  }
  return null;
}
