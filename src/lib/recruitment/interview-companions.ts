import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, interviewCompanion, member, schedulingPoll } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { inviterOf } from "./community-check";

type Member = typeof memberTable.$inferSelect;
type Arrival = typeof admission.$inferSelect;
export type CompanionStatus = (typeof interviewCompanion.$inferSelect)["status"];

// docs/plans/accompaniment-plan.md §6. The person who invited an applicant can be at their interview,
// if the applicant would like that and the inviter would. A courtesy to the applicant, so the applicant
// is the one who asks, nobody on the team does, and it changes nothing about how they are assessed: a
// companion is not an interviewer, files no report, and does not count toward the holders a slot needs.

const inFlight = (a: Arrival) => !a.admittedMemberId && !a.declinedAt && !a.withdrawnAt;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export type InviterOffer = { memberId: string; firstName: string; status: CompanionStatus | null };

/**
 * The inviter the person may ask to join their interview, and where that stands: null when there is no
 * one to ask (nobody invited them, or the inviter is no longer a member), or the community has turned
 * the offer off and nobody was asked before it was.
 */
export async function getInviterOffer(arrival: Arrival): Promise<InviterOffer | null> {
  const inviterId = await inviterOf(arrival);
  if (!inviterId) return null;
  const [inviter] = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(and(eq(member.id, inviterId), eq(member.communityId, arrival.communityId)));
  if (!inviter) return null;
  const [row] = await db
    .select({ status: interviewCompanion.status })
    .from(interviewCompanion)
    .where(and(eq(interviewCompanion.arrivalId, arrival.id), eq(interviewCompanion.memberId, inviter.id)));
  const [communityRow] = await db.select({ offer: community.interviewOfferInviter }).from(community).where(eq(community.id, arrival.communityId));
  if (!row && !communityRow?.offer) return null;
  return { memberId: inviter.id, firstName: firstName(inviter.name), status: row?.status ?? null };
}

/**
 * The person asks whoever invited them to be at their interview. Once: an answer is respected, and asking
 * again is not a way round a no. There has to be an interview to be at, and it must not have happened.
 */
export async function askInviterToJoin(arrivalId: string): Promise<void> {
  const [arrival] = await db.select().from(admission).where(eq(admission.id, arrivalId));
  if (!arrival) throw new NotFoundError("Arrival not found");
  if (!inFlight(arrival)) throw new ConflictError("This request has already been settled");
  if (!arrival.interviewPollId) throw new ConflictError("There isn't an interview to ask them to yet");
  if (arrival.interviewHeldAt) throw new ConflictError("The interview has already happened");
  const offer = await getInviterOffer(arrival);
  if (!offer) throw new ConflictError("There is nobody to ask");
  if (offer.status) throw new ConflictError(`You have already asked ${offer.firstName}`);
  await db.insert(interviewCompanion).values({ arrivalId: arrival.id, memberId: offer.memberId });
}

/**
 * The inviter says yes or no. Either can be changed until the interview has happened (a diary changes),
 * and neither is explained or announced: a no is just a no, and the applicant's page says only that they
 * can't make it this time.
 */
export async function answerCompanionRequest(actor: Member, arrivalId: string, accept: boolean): Promise<void> {
  const [row] = await db
    .select({ id: interviewCompanion.id, held: admission.interviewHeldAt, communityId: admission.communityId })
    .from(interviewCompanion)
    .innerJoin(admission, eq(interviewCompanion.arrivalId, admission.id))
    .where(and(eq(interviewCompanion.arrivalId, arrivalId), eq(interviewCompanion.memberId, actor.id)));
  if (!row || row.communityId !== actor.communityId) throw new NotFoundError("Nobody has asked you to this interview");
  if (row.held) throw new ConflictError("That interview has already happened");
  await db
    .update(interviewCompanion)
    .set({ status: accept ? "accepted" : "declined", answeredAt: new Date() })
    .where(eq(interviewCompanion.id, row.id));
}

export type CompanionRequest = {
  arrivalId: string;
  personName: string;
  status: "requested" | "accepted";
  pollId: string | null;
  confirmedStart: Date | null;
};

/** The interviews this member has been asked to, or has said they'd come to, that haven't happened yet. */
export async function listMyCompanionRequests(actor: Member): Promise<CompanionRequest[]> {
  const rows = await db
    .select({
      arrivalId: admission.id,
      personName: admission.name,
      status: interviewCompanion.status,
      pollId: admission.interviewPollId,
      confirmedStart: schedulingPoll.confirmedSlotStart,
    })
    .from(interviewCompanion)
    .innerJoin(admission, eq(interviewCompanion.arrivalId, admission.id))
    .leftJoin(schedulingPoll, eq(schedulingPoll.id, admission.interviewPollId))
    .where(
      and(
        eq(interviewCompanion.memberId, actor.id),
        ne(interviewCompanion.status, "declined"),
        eq(admission.communityId, actor.communityId),
        isNull(admission.interviewHeldAt),
        isNull(admission.admittedMemberId),
        isNull(admission.declinedAt),
        isNull(admission.withdrawnAt),
      ),
    )
    .orderBy(asc(interviewCompanion.requestedAt));
  return rows.map((r) => ({ ...r, status: r.status as "requested" | "accepted" }));
}

/** Everyone who has said yes to being at an interview on this poll (a shared poll has two people's). */
export async function listAcceptedCompanionIds(pollId: string): Promise<Set<string>> {
  const rows = await db
    .select({ memberId: interviewCompanion.memberId })
    .from(interviewCompanion)
    .innerJoin(admission, eq(interviewCompanion.arrivalId, admission.id))
    .where(and(eq(admission.interviewPollId, pollId), eq(interviewCompanion.status, "accepted")));
  return new Set(rows.map((r) => r.memberId));
}

export type CompanionOfArrival = { memberId: string; name: string; status: CompanionStatus };

/** Who was asked about this person's interview, and what they said. For the people booking it. */
export async function listCompanionsOfArrival(arrivalId: string): Promise<CompanionOfArrival[]> {
  const rows = await db
    .select({ memberId: interviewCompanion.memberId, name: member.name, status: interviewCompanion.status })
    .from(interviewCompanion)
    .innerJoin(member, eq(interviewCompanion.memberId, member.id))
    .where(eq(interviewCompanion.arrivalId, arrivalId))
    .orderBy(asc(interviewCompanion.requestedAt));
  return rows;
}

export async function companionNames(memberIds: string[]): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();
  const rows = await db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, memberIds));
  return new Map(rows.map((r) => [r.id, r.name]));
}
