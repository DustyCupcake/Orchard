import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { communityInvite, cycle, participation } from "@/db/schema";
import type { cycle as cycleTable } from "@/db/schema";
import { NotFoundError } from "../errors";

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
//                the policy. As of §4.3/8d an *outstanding* direct
//                invite holds a capacity slot until redeemed, revoked,
//                or expired, so outstanding direct-mode invites count
//                against this too — the door shuts once issued-but-
//                unspent slots fill the room as well.
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

  // §4.3/8d — outstanding direct invites hold a capacity slot until
  // redeemed, revoked, or expired. Count the currently-held ones (valid
  // = not redeemed/revoked, and not yet past expiry) when this cycle
  // sits in direct mode; a referral-mode cycle's invites hold nothing.
  // Mode-following, never snapshotted — an invite means what its
  // cycle's mode says at any given read.
  let heldCount = 0;
  if (row.joiningInviteMode === "direct") {
    const holds = await db
      .select({ id: communityInvite.id })
      .from(communityInvite)
      .where(
        and(
          eq(communityInvite.cycleId, cycleId),
          isNull(communityInvite.redeemedAt),
          isNull(communityInvite.revokedAt),
          or(isNull(communityInvite.expiresAt), gt(communityInvite.expiresAt, now)),
        ),
      );
    heldCount = holds.length;
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