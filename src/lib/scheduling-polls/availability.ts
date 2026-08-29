import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { schedulingEntry, schedulingPoll } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
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

// Public — no actor, no Member row. A not-yet-a-Member participant
// (Phase 34's Recruitment intro call) is tracked by their own
// FormResponse instead — see schema/scheduling-poll.ts's
// schedulingEntry comment. The caller (src/lib/recruitment/
// decisions.ts) is responsible for verifying the formResponseId is
// actually who the caller claims to be (its own token check) before
// ever reaching this function; this function itself only knows "this
// formResponseId submits for this poll," not who's allowed to claim
// that formResponseId.
export async function submitAvailabilityAsApplicant(
  pollId: string,
  formResponseId: string,
  input: SubmitAvailabilityInput,
) {
  const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, pollId));
  if (!poll) {
    throw new NotFoundError("Scheduling poll not found");
  }
  if (poll.confirmedSlotStart) {
    throw new ConflictError("This poll has already resolved a slot");
  }

  const [existing] = await db
    .select()
    .from(schedulingEntry)
    .where(and(eq(schedulingEntry.pollId, pollId), eq(schedulingEntry.formResponseId, formResponseId)));

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
    .values({ pollId, formResponseId, availableSlots: input.slots })
    .returning();
  return created;
}

export async function getApplicantAvailability(pollId: string, formResponseId: string) {
  const [row] = await db
    .select()
    .from(schedulingEntry)
    .where(and(eq(schedulingEntry.pollId, pollId), eq(schedulingEntry.formResponseId, formResponseId)));
  return (row?.availableSlots as string[] | undefined) ?? [];
}

export type AggregateSlot = { slot: string; count: number; qualifies: boolean };

// "The organizer (or anyone checking in on it) only sees the
// aggregate overlap, not individual raw submissions, until a slot is
// confirmed" — this never returns who submitted what, only a count
// and whether the slot meets the poll's resolution criteria.
//
// A participant's key is memberId, or — as of Phase 34 — a not-yet-a-
// Member applicant's own formResponseId when that's what's set instead
// (see schema/scheduling-poll.ts's schedulingEntry comment). Existing
// member-only polls are unaffected: every entry's formResponseId is
// null there, so this always falls through to memberId exactly as
// before. A must_overlap poll's requiredParticipantIds can likewise
// mix real member ids with a linked applicant's formResponseId — it's
// an unconstrained uuid[] already (see the field's own schema
// comment), so this needs no shape change on that side either.
export async function getPollAggregate(
  actor: Member,
  pollId: string,
): Promise<{ slots: AggregateSlot[]; submittedCount: number }> {
  const poll = await requirePollInCommunity(actor, pollId);

  const entries = await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, pollId));

  const participantIdsBySlot = new Map<string, Set<string>>();
  for (const e of entries) {
    const participantId = e.memberId ?? e.formResponseId;
    if (!participantId) continue;
    for (const slot of e.availableSlots as string[]) {
      const set = participantIdsBySlot.get(slot) ?? new Set<string>();
      set.add(participantId);
      participantIdsBySlot.set(slot, set);
    }
  }

  const slots: AggregateSlot[] = [...participantIdsBySlot.entries()]
    .map(([slot, participantIds]) => {
      const qualifies =
        poll.resolutionMode === "must_overlap"
          ? poll.requiredParticipantIds.every((id) => participantIds.has(id))
          : participantIds.size >= (poll.minAttendance ?? 1);
      return { slot, count: participantIds.size, qualifies };
    })
    .sort((a, b) => a.slot.localeCompare(b.slot));

  return { slots, submittedCount: entries.length };
}
