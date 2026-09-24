import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, participation } from "@/db/schema";
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
//                the policy.
export type CycleJoiningState = {
  cycle: CycleRow;
  periodOpen: boolean;
  atCapacity: boolean;
  applicationsOpen: boolean;
  invitesOpen: boolean;
  comingCount: number;
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
  const atCapacity = row.capacity !== null && comingCount >= row.capacity;
  const now = new Date();

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
    capacity: row.capacity,
    remainingCapacity: row.capacity === null ? null : row.capacity - comingCount,
  };
}