import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { community, eventProposal, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { cycleScopeCondition } from "./crud";
import type { EventSlot } from "./crud";

type Member = typeof memberTable.$inferSelect;
type EventProposalRow = typeof eventProposal.$inferSelect;

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "Whoever holds this task is the authority" — same access-follows-
// the-task check Forms'/Budget's own isFeedbackReviewHolder/
// isBudgetOwner establish, baked into the review/publish functions
// themselves rather than gated by the caller.
export async function isEventSchedulingOwner(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.eventSchedulingOwnerTaskId) return false;

  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.id, communityRow.eventSchedulingOwnerTaskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function requireEventSchedulingOwner(actor: Member) {
  if (!(await isEventSchedulingOwner(actor))) {
    throw new ForbiddenError("Only the current scheduling-owner task holder can do this");
  }
}

function slotsOverlap(a: EventSlot, b: EventSlot) {
  return new Date(a.startsAt) < new Date(b.endsAt) && new Date(b.startsAt) < new Date(a.endsAt);
}

// "Preferred, or confirmed once set" — a proposal's operative window(s)
// for conflict-checking purposes are its locked-in confirmedSlot if it
// has one, otherwise every slot it's still proposing.
function operativeSlots(p: EventProposalRow): EventSlot[] {
  if (p.confirmedSlot) return [p.confirmedSlot as EventSlot];
  return p.preferredSlots as EventSlot[];
}

// "Overlapping time range + an exact spaceNeeds string match — no
// room-graph or capacity modeling" — docs/development-plan.md's
// resolved interpretation. A blank spaceNeeds on either side never
// conflicts with anything on the space dimension.
function proposalsConflict(a: EventProposalRow, b: EventProposalRow) {
  if (!a.spaceNeeds || !b.spaceNeeds || a.spaceNeeds !== b.spaceNeeds) return false;
  const slotsA = operativeSlots(a);
  const slotsB = operativeSlots(b);
  return slotsA.some((sa) => slotsB.some((sb) => slotsOverlap(sa, sb)));
}

// Scans every non-declined proposal in scope and persists a fresh
// `conflict`/`proposed` status for each not-yet-confirmed one — a
// `confirmed` proposal is locked and never re-flagged (its slot is the
// immovable reference point others get checked against instead). Run
// on every owner review (see review.ts's listEventProposalsForReview)
// rather than on a scheduler tick — "on owner review," per spec,
// and nothing here needs to be live for anyone else in the meantime.
export async function recomputeEventConflicts(actor: Member, cycleId?: string | null) {
  const conditions = [
    eq(eventProposal.communityId, actor.communityId),
    ne(eventProposal.status, "declined"),
    cycleScopeCondition(cycleId),
  ].filter((c) => c !== undefined);

  const all = await db
    .select()
    .from(eventProposal)
    .where(and(...conditions));

  for (const p of all) {
    if (p.status === "confirmed") continue;
    const inConflict = all.some((other) => other.id !== p.id && proposalsConflict(p, other));
    const newStatus = inConflict ? "conflict" : "proposed";
    if (newStatus !== p.status) {
      await db.update(eventProposal).set({ status: newStatus }).where(eq(eventProposal.id, p.id));
    }
  }
}
