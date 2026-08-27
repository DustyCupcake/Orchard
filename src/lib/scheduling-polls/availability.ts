import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { schedulingEntry } from "@/db/schema";
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

// "The organizer (or anyone checking in on it) only sees the
// aggregate overlap, not individual raw submissions, until a slot is
// confirmed" — this never returns who submitted what, only a count
// and whether the slot meets the poll's resolution criteria.
export async function getPollAggregate(
  actor: Member,
  pollId: string,
): Promise<{ slots: AggregateSlot[]; submittedCount: number }> {
  const poll = await requirePollInCommunity(actor, pollId);

  const entries = await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, pollId));

  const memberIdsBySlot = new Map<string, Set<string>>();
  for (const e of entries) {
    for (const slot of e.availableSlots as string[]) {
      const set = memberIdsBySlot.get(slot) ?? new Set<string>();
      set.add(e.memberId);
      memberIdsBySlot.set(slot, set);
    }
  }

  const slots: AggregateSlot[] = [...memberIdsBySlot.entries()]
    .map(([slot, memberIds]) => {
      const qualifies =
        poll.resolutionMode === "must_overlap"
          ? poll.requiredParticipantIds.every((id) => memberIds.has(id))
          : memberIds.size >= (poll.minAttendance ?? 1);
      return { slot, count: memberIds.size, qualifies };
    })
    .sort((a, b) => a.slot.localeCompare(b.slot));

  return { slots, submittedCount: entries.length };
}
