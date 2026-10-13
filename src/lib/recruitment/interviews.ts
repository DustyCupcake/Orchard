import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, member, schedulingEntry, schedulingPoll, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { listGrantingTaskIds } from "../permissions";
import { sendInterviewConfirmedEmail, sendInterviewInviteEmail } from "../mailer";
import { getEventTimeZone } from "../cycles/time-zone";
import { formatInstant } from "../dates";
import { createPoll } from "../scheduling-polls/crud";
import { computeAggregate, type HolderContext } from "../scheduling-polls/availability";
import { admissionLink } from "./admission";
import { getOpenCheck } from "./community-check";
import { describeRecruitmentAuthority, requireRecruitmentScopeForCycle } from "./access";
import { canScheduleInterview } from "./joining";
import { loadStandingSlots } from "./standing-availability";

type Member = typeof memberTable.$inferSelect;
type Arrival = typeof admission.$inferSelect;
type Poll = typeof schedulingPoll.$inferSelect;

// docs/plans/admission-flow.md §2, "Interview". The interview is a step with the same
// standing as the application, and it comes *before* the decision. A lane that
// asks for one gets a scheduling poll for each arrival as they enter; the person
// paints when they are free, the recruitment holders offer their own availability
// (standing, or on this poll), and a slot qualifies when the person overlaps and at
// least N holders — N being the lane's reports-needed — offered that same slot.
//
// No job picks the slot. A holder is pointed at a poll with qualifying slots and
// chooses one, because two qualifying slots are a human judgement about which time
// actually suits, and any holder may confirm, not only the poll's organizer. The
// interviewers are whoever offered the confirmed slot, read back off the entries at
// that moment — which is what lets the set stay open rather than freezing a list of
// names to know afterwards who they were.

const INTERVIEW_WINDOW_DAYS = 14;
const SLOT_MS = 30 * 60_000;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Who is a holder right now, and what each has offered standing (docs §2: read live, never copied). */
export async function loadHolderContext(communityId: string): Promise<HolderContext> {
  const authority = await describeRecruitmentAuthority(communityId);
  const holderIds = new Set(authority.holders.map((h) => h.memberId));
  const standing = await loadStandingSlots(communityId, authority.open ? undefined : [...holderIds]);
  return { everyone: authority.open, holderIds, standing };
}

async function loadArrival(arrivalId: string): Promise<Arrival> {
  const [row] = await db.select().from(admission).where(eq(admission.id, arrivalId));
  if (!row) throw new NotFoundError("Arrival not found");
  return row;
}

const inFlight = (a: Arrival) => !a.admittedMemberId && !a.declinedAt && !a.withdrawnAt;

/**
 * Make the arrival's interview poll, if its lane asks for one and nothing stops it.
 * Idempotent, and safe to call whenever something that could unblock it happens:
 * the interviews door is open for the context (§6: a closed one *holds* the arrival
 * at this step rather than skipping it), and there is a recruitment task to file the
 * poll under and a holder to organize it (a poll needs a branch and a real
 * organizer; with an open module and no granting task there is nowhere honest to put
 * one, which the recruitment hub reports rather than papering over).
 */
export async function ensureInterviewPoll(arrivalId: string): Promise<Poll | null> {
  const arrival = await loadArrival(arrivalId);
  if (arrival.interviewPollId) {
    const [existing] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, arrival.interviewPollId));
    return existing ?? null;
  }
  if (!arrival.requiredInterview || !inFlight(arrival)) return null;
  // A person must have entered the interview's own step: with an application on
  // the lane, that is once it has been sent (an arrival made from one always has);
  // and while a community check is holding the arrival the conversation waits for
  // the window to end — a check lane has none of its own, but mediation can ask for
  // one, and then it is arranged once the application it is about has arrived.
  if (await getOpenCheck(arrival.id)) return null;
  if (arrival.requiredApplication && !arrival.applicationSubmittedAt) return null;
  if (!(await canScheduleInterview(arrival.communityId, arrival.cycleId))) return null;

  const grantingTaskIds = await listGrantingTaskIds(arrival.communityId, "recruitment");
  if (grantingTaskIds.length === 0) return null;
  const [granting] = await db.select().from(task).where(inArray(task.id, grantingTaskIds)).limit(1);
  if (!granting) return null;
  const authority = await describeRecruitmentAuthority(arrival.communityId);
  const organizerId = authority.holders[0]?.memberId;
  if (!organizerId) return null;
  const [organizer] = await db.select().from(member).where(eq(member.id, organizerId));
  if (!organizer) return null;

  const now = new Date();
  const poll = await createPoll(organizer, {
    branchId: granting.branchId,
    title: `Interview: ${arrival.name}`,
    resolutionMode: "person_plus_n_holders",
    // N holders, read live. The person is the one required participant.
    minAttendance: Math.max(1, arrival.reportsNeeded ?? 1),
    requiredParticipantIds: [arrival.id],
    rangeStart: isoDate(now),
    rangeEnd: isoDate(new Date(now.getTime() + INTERVIEW_WINDOW_DAYS * 86_400_000)),
  });

  // Claimed with a guard, so two callers racing to make it can't leave two polls
  // (the loser's is left unreferenced — a harmless orphan, and rare).
  const [claimed] = await db
    .update(admission)
    .set({ interviewPollId: poll.id })
    .where(and(eq(admission.id, arrival.id), isNull(admission.interviewPollId)))
    .returning();
  if (!claimed) {
    const [winner] = await db.select().from(admission).where(eq(admission.id, arrival.id));
    const [existing] = winner?.interviewPollId
      ? await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, winner.interviewPollId))
      : [];
    return existing ?? null;
  }

  try {
    const [communityRow] = await db.select({ name: community.name }).from(community).where(eq(community.id, arrival.communityId));
    await sendInterviewInviteEmail(arrival.email, {
      name: arrival.name,
      communityName: communityRow?.name ?? "the community",
      statusUrl: admissionLink(arrival.token),
    });
  } catch (err) {
    console.error("[interview] could not send the invitation email", err);
  }
  return poll;
}

/** The door reopened: anyone held at the interview step gets their poll. */
export async function ensureInterviewPollsFor(communityId: string): Promise<number> {
  const waiting = await db
    .select({ id: admission.id })
    .from(admission)
    .where(
      and(
        eq(admission.communityId, communityId),
        eq(admission.requiredInterview, true),
        isNull(admission.interviewPollId),
        isNull(admission.admittedMemberId),
        isNull(admission.declinedAt),
        isNull(admission.withdrawnAt),
      ),
    );
  let made = 0;
  for (const row of waiting) if (await ensureInterviewPoll(row.id)) made++;
  return made;
}

// ---------------------------------------------------------------------------
// The person's side
// ---------------------------------------------------------------------------

export async function getInterviewPoll(arrival: Pick<Arrival, "interviewPollId">): Promise<Poll | null> {
  if (!arrival.interviewPollId) return null;
  const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, arrival.interviewPollId));
  return poll ?? null;
}

export async function getInterviewAvailability(arrival: Arrival): Promise<string[]> {
  if (!arrival.interviewPollId) return [];
  const [row] = await db
    .select()
    .from(schedulingEntry)
    .where(and(eq(schedulingEntry.pollId, arrival.interviewPollId), eq(schedulingEntry.arrivalId, arrival.id)));
  return (row?.availableSlots as string[] | undefined) ?? [];
}

/** The person paints when they are free. Blind, like everyone's, and open until a slot is confirmed. */
export async function submitInterviewAvailability(arrival: Arrival, slots: string[]) {
  const poll = await getInterviewPoll(arrival);
  if (!poll) throw new ConflictError("There isn't an interview to choose times for yet");
  if (!inFlight(arrival)) throw new ConflictError("This request has already been settled");
  if (poll.confirmedSlotStart) throw new ConflictError("A time has already been confirmed");
  const [existing] = await db
    .select()
    .from(schedulingEntry)
    .where(and(eq(schedulingEntry.pollId, poll.id), eq(schedulingEntry.arrivalId, arrival.id)));
  if (existing) {
    const [updated] = await db
      .update(schedulingEntry)
      .set({ availableSlots: slots, updatedAt: new Date() })
      .where(eq(schedulingEntry.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(schedulingEntry).values({ pollId: poll.id, arrivalId: arrival.id, availableSlots: slots }).returning();
  return created;
}

// ---------------------------------------------------------------------------
// The holders' side
// ---------------------------------------------------------------------------

export type InterviewState = {
  poll: Poll | null;
  /** Whether the person has said when they're free. */
  personHasOffered: boolean;
  /** Slots where the person overlaps and at least N holders offered the same slot. */
  qualifyingSlots: string[];
  confirmed: { start: Date; end: Date } | null;
  /** Held once its slot has passed, or once an interviewer has said it happened. */
  held: boolean;
};

/** Everything a holder or a list needs to know about an arrival's interview, read live. */
export async function getInterviewState(arrival: Arrival): Promise<InterviewState> {
  const poll = await getInterviewPoll(arrival);
  if (!poll) return { poll: null, personHasOffered: false, qualifyingSlots: [], confirmed: null, held: Boolean(arrival.interviewHeldAt) };
  const entries = await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, poll.id));
  const aggregate = computeAggregate(poll, entries, await loadHolderContext(arrival.communityId));
  const confirmed =
    poll.confirmedSlotStart && poll.confirmedSlotEnd ? { start: poll.confirmedSlotStart, end: poll.confirmedSlotEnd } : null;
  return {
    poll,
    personHasOffered: entries.some((e) => e.arrivalId === arrival.id && (e.availableSlots as string[]).length > 0),
    qualifyingSlots: confirmed ? [] : aggregate.slots.filter((s) => s.qualifies).map((s) => s.slot),
    confirmed,
    held: Boolean(arrival.interviewHeldAt) || Boolean(confirmed && confirmed.end.getTime() <= Date.now()),
  };
}

/**
 * Who took part in the confirmed call: the holders who offered the slot that was
 * confirmed, whether on the poll or standing. Read back at the time, never a list
 * frozen beforehand.
 */
export async function getInterviewers(arrival: Arrival): Promise<Member[]> {
  const poll = await getInterviewPoll(arrival);
  if (!poll?.confirmedSlotStart) return [];
  const slot = poll.confirmedSlotStart.toISOString();
  const ctx = await loadHolderContext(arrival.communityId);
  const entries = await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, poll.id));
  const ids = new Set<string>();
  for (const e of entries) if (e.memberId && (e.availableSlots as string[]).includes(slot)) ids.add(e.memberId);
  for (const [memberId, slots] of ctx.standing) if (slots.has(slot)) ids.add(memberId);
  const holders = [...ids].filter((id) => ctx.everyone || ctx.holderIds.has(id));
  if (holders.length === 0) return [];
  return db.select().from(member).where(and(inArray(member.id, holders), eq(member.communityId, arrival.communityId)));
}

/**
 * Write what the poll says onto the arrival: the call is scheduled when a slot is
 * confirmed, and held once that slot has passed. The facts are written here and
 * nowhere else (§4), and only ever forwards.
 */
export async function syncInterviewFacts(arrivalId: string): Promise<Arrival> {
  const arrival = await loadArrival(arrivalId);
  const poll = await getInterviewPoll(arrival);
  if (!poll?.confirmedSlotStart || !poll.confirmedSlotEnd) return arrival;
  const patch: Partial<typeof admission.$inferInsert> = {};
  if (!arrival.interviewScheduledAt) patch.interviewScheduledAt = poll.confirmedAt ?? new Date();
  if (!arrival.interviewHeldAt && poll.confirmedSlotEnd.getTime() <= Date.now()) patch.interviewHeldAt = poll.confirmedSlotEnd;
  if (Object.keys(patch).length === 0) return arrival;
  const [updated] = await db.update(admission).set(patch).where(eq(admission.id, arrival.id)).returning();
  return updated;
}

/**
 * A holder confirms one of the slots that qualify. Not a job, and not only the
 * poll's organizer: any holder covering this arrival's scope. The slot is re-checked
 * against the poll as it stands this moment — which is what makes nothing copied at
 * match time safe, and why a holder who came back and filled in their week can
 * rescue a poll.
 */
export async function confirmInterview(actor: Member, arrivalId: string, slot: string): Promise<Arrival> {
  const arrival = await loadArrival(arrivalId);
  if (arrival.communityId !== actor.communityId) throw new NotFoundError("Arrival not found");
  await requireRecruitmentScopeForCycle(actor, arrival.cycleId);
  if (!inFlight(arrival)) throw new ConflictError("This request has already been settled");
  const state = await getInterviewState(arrival);
  if (!state.poll) throw new ConflictError("There isn't an interview to confirm yet");
  if (state.poll.confirmedSlotStart) throw new ConflictError("A time has already been confirmed");
  if (!state.qualifyingSlots.includes(slot)) {
    throw new ConflictError("That time doesn't suit the person and enough of the people who'll be on the call");
  }
  const start = new Date(slot);
  await db
    .update(schedulingPoll)
    .set({ confirmedSlotStart: start, confirmedSlotEnd: new Date(start.getTime() + SLOT_MS), confirmedBy: actor.id, confirmedAt: new Date() })
    .where(eq(schedulingPoll.id, state.poll.id));
  await onInterviewConfirmed(state.poll.id);
  return loadArrival(arrivalId);
}

/**
 * Whatever confirmed it — this module, or the scheduling page's own confirm button —
 * the arrival's facts follow and the person is told. Idempotent: the email goes out
 * only when the scheduled fact is first written.
 */
export async function onInterviewConfirmed(pollId: string): Promise<Arrival> {
  // One poll is one person's — or, for a shared interview, two people's: each is
  // brought forward and each told.
  const rows = await db.select().from(admission).where(eq(admission.interviewPollId, pollId));
  if (rows.length === 0) throw new NotFoundError("No interview belongs to that poll");
  let first: Arrival | null = null;
  for (const row of rows) {
    const before = row.interviewScheduledAt;
    const arrival = await syncInterviewFacts(row.id);
    first ??= arrival;
    if (!before && arrival.interviewScheduledAt) {
      const poll = await getInterviewPoll(arrival);
      if (poll?.confirmedSlotStart) {
        try {
          const [communityRow] = await db.select({ name: community.name }).from(community).where(eq(community.id, arrival.communityId));
          await sendInterviewConfirmedEmail(arrival.email, {
            name: arrival.name,
            communityName: communityRow?.name ?? "the community",
            // On the event's clock (the community's when it isn't for one), zone named: an
            // email has no viewer, and "UTC" read as the server's was only right by accident.
            whenText: formatInstant(poll.confirmedSlotStart, await getEventTimeZone(arrival.communityId, arrival.cycleId), "datetime", { zoneName: true }),
            statusUrl: admissionLink(arrival.token),
          });
        } catch (err) {
          console.error("[interview] could not send the confirmation email", err);
        }
      }
    }
  }
  return first!;
}

/** An interviewer says the call happened, without waiting for the slot to pass. */
export async function markInterviewHeld(actor: Member, arrivalId: string): Promise<Arrival> {
  const arrival = await syncInterviewFacts(arrivalId);
  if (arrival.communityId !== actor.communityId) throw new NotFoundError("Arrival not found");
  if (!arrival.interviewScheduledAt) throw new ConflictError("No time has been confirmed for this interview yet");
  const interviewers = await getInterviewers(arrival);
  if (!interviewers.some((m) => m.id === actor.id)) throw new ForbiddenError("Only the people who took part in the interview can say it happened");
  if (arrival.interviewHeldAt) return arrival;
  const [updated] = await db.update(admission).set({ interviewHeldAt: new Date() }).where(eq(admission.id, arrival.id)).returning();
  return updated;
}
