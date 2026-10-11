import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { schedulingEntry, schedulingPoll } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError } from "../errors";
import { requirePollInCommunity } from "./crud";

type Member = typeof memberTable.$inferSelect;

export const submitAvailabilityInput = z.object({
  slots: z.array(z.string().datetime()),
});
export type SubmitAvailabilityInput = z.infer<typeof submitAvailabilityInput>;

// "A member can reopen the grid to adjust their own entry" — upserts
// in place. Once a slot is confirmed the poll is done deciding, so
// there's nothing left to submit toward.
export async function submitAvailability(actor: Member, pollId: string, input: SubmitAvailabilityInput) {
  const poll = await requirePollInCommunity(actor, pollId);
  if (poll.confirmedSlotStart) {
    throw new ConflictError("This poll has already resolved a slot");
  }

  const [existing] = await db
    .select()
    .from(schedulingEntry)
    .where(and(eq(schedulingEntry.pollId, pollId), eq(schedulingEntry.memberId, actor.id)));

  if (existing) {
    const [updated] = await db
      .update(schedulingEntry)
      .set({ availableSlots: input.slots, updatedAt: new Date() })
      .where(eq(schedulingEntry.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(schedulingEntry)
    .values({ pollId, memberId: actor.id, availableSlots: input.slots })
    .returning();
  return created;
}

// The viewer's own submission — safe to show back to them (it's
// theirs), used to pre-fill the grid on reopen.
export async function getMyAvailability(actor: Member, pollId: string) {
  await requirePollInCommunity(actor, pollId);
  const [row] = await db
    .select()
    .from(schedulingEntry)
    .where(and(eq(schedulingEntry.pollId, pollId), eq(schedulingEntry.memberId, actor.id)));
  return (row?.availableSlots as string[] | undefined) ?? [];
}

export type AggregateSlot = { slot: string; count: number; qualifies: boolean };

// Who counts as a holder, for a person_plus_n_holders poll (the recruitment
// interview, docs/admission-flow.md §2), and what they have said they are free for
// *standing*, outside this poll. Passed in rather than read here because the
// scheduling module knows nothing about recruitment.
export type HolderContext = {
  /** An open module makes every member a holder. */
  everyone: boolean;
  holderIds: Set<string>;
  /** Each holder's standing availability — one grid the holder fills in and edits, read as it stands rather than copied onto the poll. */
  standing: Map<string, Set<string>>;
};

type PollRow = typeof schedulingPoll.$inferSelect;
type EntryRow = typeof schedulingEntry.$inferSelect;

// "The organizer (or anyone checking in on it) only sees the aggregate overlap, not
// individual raw submissions, until a slot is confirmed" — this never returns who
// submitted what, only a count and whether the slot meets the poll's resolution
// criteria.
//
// A participant's key is memberId, or — for someone who isn't a member — their
// arrival's id. Existing member-only polls are unaffected: every entry's other
// keys are null there.
//
// person_plus_n_holders is the interview (§2): a slot qualifies when the person (or
// both people, for a shared interview) overlaps AND at least N *holders* offered that same slot, N being the lane's
// reports-needed number. Holders are whoever holds the recruitment task right now,
// not a list frozen when the poll was made, and what they offer is read live —
// both their entry on this poll and their standing availability — so a holder who
// was away when the poll was created can come back, fill in their week, and rescue it.
export function computeAggregate(
  poll: PollRow,
  entries: EntryRow[],
  holders: HolderContext | null = null,
): { slots: AggregateSlot[]; submittedCount: number } {
  const participantIdsBySlot = new Map<string, Set<string>>();
  const add = (slot: string, id: string) => {
    const set = participantIdsBySlot.get(slot) ?? new Set<string>();
    set.add(id);
    participantIdsBySlot.set(slot, set);
  };
  for (const e of entries) {
    const participantId = e.memberId ?? e.arrivalId;
    if (!participantId) continue;
    for (const slot of e.availableSlots as string[]) add(slot, participantId);
  }
  if (poll.resolutionMode === "person_plus_n_holders" && holders) {
    for (const [memberId, slots] of holders.standing) {
      for (const slot of slots) add(slot, memberId);
    }
  }

  const slots: AggregateSlot[] = [...participantIdsBySlot.entries()]
    .map(([slot, participantIds]) => {
      let qualifies: boolean;
      if (poll.resolutionMode === "must_overlap") {
        qualifies = poll.requiredParticipantIds.every((id) => participantIds.has(id));
      } else if (poll.resolutionMode === "person_plus_n_holders") {
        // The required participants are the people being interviewed — one, or two who
        // opted into a shared interview (§2, pairing) — and every one of them has to be
        // free; the holders are everyone else who offered the slot and is one now.
        const people = new Set(poll.requiredParticipantIds);
        const isHolder = (id: string) => (holders ? holders.everyone || holders.holderIds.has(id) : true);
        const overlappingHolders = [...participantIds].filter((id) => !people.has(id) && isHolder(id));
        qualifies = [...people].every((id) => participantIds.has(id)) && overlappingHolders.length >= (poll.minAttendance ?? 1);
      } else {
        qualifies = participantIds.size >= (poll.minAttendance ?? 1);
      }
      return { slot, count: participantIds.size, qualifies };
    })
    .sort((a, b) => a.slot.localeCompare(b.slot));

  return { slots, submittedCount: entries.length };
}

export async function getPollAggregate(
  actor: Member,
  pollId: string,
): Promise<{ slots: AggregateSlot[]; submittedCount: number }> {
  const poll = await requirePollInCommunity(actor, pollId);
  const entries = await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, pollId));
  const holders =
    poll.resolutionMode === "person_plus_n_holders"
      ? await (await import("../recruitment/interviews")).loadHolderContext(poll.communityId)
      : null;
  return computeAggregate(poll, entries, holders);
}
