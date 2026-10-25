import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { admission, community, member, recruitmentPair, schedulingEntry, schedulingPoll, task } from "@/db/schema";
import type { member as memberTable, recruitmentPair as recruitmentPairTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { generateToken } from "../token";
import { requireRecruitmentScopeForCycle, requireRecruitmentTaskHolder } from "./access";
import { isMediationMember } from "./mediation";

type Member = typeof memberTable.$inferSelect;
type Arrival = typeof admission.$inferSelect;
type PairRow = typeof recruitmentPairTable.$inferSelect;

// docs/plans/admission-flow.md §2, "Pairing and a shared interview" (J9). A pair is a
// *fact*, recorded and shown to humans: two people are arriving together, or one named
// the other, and the platform decides nothing from it. No lane reads a pairing, no
// capacity count changes, no decision can name it. The one thing a pair changes is the
// shared interview below — and even that is offered, never applied.
//
// It is between **arrivals** (§4), not applications: a lane that asks only for a
// conversation has people to arrive together too. The first arrival is the person who
// made the link (or was named); the second is whoever arrived through it. Who may
// confirm it is deliberately narrow — the namer, or either person when the team linked
// them by hand — because the one thing confirming does is let two people be offered one
// interview.

const inFlight = (a: Pick<Arrival, "admittedMemberId" | "declinedAt" | "withdrawnAt">) =>
  !a.admittedMemberId && !a.declinedAt && !a.withdrawnAt;

async function loadArrival(id: string): Promise<Arrival> {
  const [row] = await db.select().from(admission).where(eq(admission.id, id));
  if (!row) throw new NotFoundError("Arrival not found");
  return row;
}

// ---------------------------------------------------------------------------
// Making a link, from the person's own page
// ---------------------------------------------------------------------------

/**
 * The link a person sends to the one they are applying with, made from their own page.
 * One open link per person: asking again gives the same one back, so a link already sent
 * doesn't go stale. Nothing is created in the funnel until somebody uses it.
 */
export async function createApplyTogetherLink(arrivalToken: string): Promise<PairRow> {
  const [arrival] = await db.select().from(admission).where(eq(admission.token, arrivalToken));
  if (!arrival) throw new NotFoundError("This page isn't valid any more");
  if (!inFlight(arrival)) throw new ConflictError("This request to join has already finished");
  const [open] = await db
    .select()
    .from(recruitmentPair)
    .where(
      and(
        eq(recruitmentPair.firstArrivalId, arrival.id),
        eq(recruitmentPair.status, "awaiting_applicant"),
        isNull(recruitmentPair.secondArrivalId),
        isNull(recruitmentPair.requestedById),
      ),
    );
  if (open) return open;
  const [pair] = await db
    .insert(recruitmentPair)
    .values({
      communityId: arrival.communityId,
      cycleId: arrival.cycleId,
      token: generateToken(),
      firstArrivalId: arrival.id,
      status: "awaiting_applicant",
    })
    .returning();
  return pair;
}

// ---------------------------------------------------------------------------
// Naming someone (an inviter naming members) and linking by hand (the team)
// ---------------------------------------------------------------------------

export const namePairingInput = z.object({
  // A member creating an invite names the members they think also know the invitee.
  nomineeMemberIds: z.array(z.string().uuid()).max(20).default([]),
  // For the inviter's poke: members to notify with the support link. Deliberately a separate
  // list from nomineeMemberIds because a poke is "please look at this link" and a pairing is
  // "I am coming with this person" — they look alike in a form and mean opposite things.
  pokeMemberIds: z.array(z.string().uuid()).max(20).default([]),
  cycleId: z.string().uuid().nullable().optional(),
  firstArrivalId: z.string().uuid().nullable().optional(),
});
export type NamePairingInput = z.infer<typeof namePairingInput>;

/**
 * A member named as somebody the arrival is coming with. A named member's own view is the
 * support link, not a pairing to confirm, so this is a fact recorded as already settled.
 */
export async function createPairings(
  namer: { communityId: string; memberId: string },
  input: NamePairingInput,
  opts: { requireMember: boolean },
): Promise<PairRow[]> {
  if (input.nomineeMemberIds.length === 0) return [];
  const recipients = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.communityId, namer.communityId), inArray(member.id, input.nomineeMemberIds)));
  const known = new Set(recipients.map((r) => r.id));

  const created: PairRow[] = [];
  for (const memberId of input.nomineeMemberIds) {
    if (memberId === namer.memberId) continue;
    const isMember = known.has(memberId);
    // A live member is always the support view's job, not a pairing to confirm.
    if (isMember && opts.requireMember) continue;
    const [pair] = await db
      .insert(recruitmentPair)
      .values({
        communityId: namer.communityId,
        cycleId: input.cycleId ?? null,
        token: generateToken(),
        requestedById: namer.memberId,
        firstArrivalId: input.firstArrivalId ?? null,
        secondMemberId: isMember ? memberId : null,
        // A member who never acts on the link is a dormant row, not a pending application,
        // so it starts settled rather than waiting for somebody who already exists.
        status: isMember ? "accepted" : "awaiting_applicant",
        resolvedAt: isMember ? new Date() : null,
      })
      .returning();
    created.push(pair);
  }
  return created;
}

export const manualPairInput = z.object({
  firstArrivalId: z.string().uuid(),
  secondArrivalId: z.string().uuid(),
});
export type ManualPairInput = z.infer<typeof manualPairInput>;

async function isRecruitmentOrMediationHolder(actor: Member) {
  const { isRecruitmentTaskHolder } = await import("./access");
  return (await isRecruitmentTaskHolder(actor)) || (await isMediationMember(actor));
}

/**
 * The team links two arrivals it knows are coming together. §2.8 names the mediation or
 * recruitment team for this — the same authority in practice — and requiring either is what
 * stops an ordinary member declaring two strangers are arriving together. It starts waiting
 * for one of the two people to confirm it on their own page: the team's word is not theirs.
 */
export async function linkArrivalsManually(actor: Member, input: ManualPairInput) {
  if (!(await isRecruitmentOrMediationHolder(actor))) {
    throw new ForbiddenError("Only the recruitment or mediation team can link two people by hand");
  }
  if (input.firstArrivalId === input.secondArrivalId) throw new AppError("Somebody can't be paired with themselves");
  const [first, second] = await Promise.all([loadArrival(input.firstArrivalId), loadArrival(input.secondArrivalId)]);
  if (first.communityId !== actor.communityId || second.communityId !== actor.communityId) {
    throw new NotFoundError("One of those people isn't in your community");
  }
  if (!inFlight(first) || !inFlight(second)) throw new ConflictError("Both people have to still be in the process");
  const [existing] = await db
    .select({ id: recruitmentPair.id })
    .from(recruitmentPair)
    .where(
      or(
        and(eq(recruitmentPair.firstArrivalId, first.id), eq(recruitmentPair.secondArrivalId, second.id)),
        and(eq(recruitmentPair.firstArrivalId, second.id), eq(recruitmentPair.secondArrivalId, first.id)),
      ),
    );
  if (existing) throw new ConflictError("They're already paired");
  const [pair] = await db
    .insert(recruitmentPair)
    .values({
      communityId: actor.communityId,
      cycleId: first.cycleId ?? second.cycleId,
      token: generateToken(),
      requestedById: actor.id,
      firstArrivalId: first.id,
      secondArrivalId: second.id,
      linkedByTeam: true,
      status: "awaiting_accept",
    })
    .returning();
  return pair;
}

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------

export type PairingLink = {
  pair: PairRow;
  communityName: string;
  namerName: string;
  /** What this link is for right now: apply (nobody has used it), or already used / settled. */
  view: "apply" | "used";
};

export async function getPairingByToken(token: string): Promise<PairingLink | null> {
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.token, token));
  if (!pair) return null;
  const [communityRow] = await db.select({ name: community.name }).from(community).where(eq(community.id, pair.communityId));
  let namerName = "Someone";
  if (pair.firstArrivalId) {
    const [a] = await db.select({ name: admission.name }).from(admission).where(eq(admission.id, pair.firstArrivalId));
    if (a) namerName = a.name;
  } else if (pair.requestedById) {
    const [m] = await db.select({ name: member.name }).from(member).where(eq(member.id, pair.requestedById));
    if (m) namerName = m.name;
  }
  return {
    pair,
    communityName: communityRow?.name ?? "the community",
    namerName,
    view: pair.status === "awaiting_applicant" && !pair.secondArrivalId && !pair.secondMemberId ? "apply" : "used",
  };
}

/** Whether a link can still be used to apply: nobody has, and it hasn't been turned down. */
export async function resolvePairingForApplication(token: string) {
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.token, token));
  if (!pair) return null;
  if (pair.secondArrivalId || pair.secondMemberId || pair.status !== "awaiting_applicant") return null;
  return pair;
}

/**
 * Somebody used the link. Deliberately *not* accepted here — the namer still confirms on
 * their own page, which is what "the linked party confirms the person who arrived is the
 * person they meant" is for.
 */
export async function attachArrivalToPairing(token: string, arrivalId: string) {
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.token, token));
  if (!pair) throw new NotFoundError("That pairing link isn't valid");
  if (pair.secondArrivalId) throw new ConflictError("This pairing link has already been used");
  if (pair.firstArrivalId === arrivalId) throw new AppError("You can't use your own pairing link");
  const [updated] = await db
    .update(recruitmentPair)
    .set({ secondArrivalId: arrivalId, status: "awaiting_accept" })
    .where(and(eq(recruitmentPair.id, pair.id), isNull(recruitmentPair.secondArrivalId)))
    .returning();
  if (!updated) throw new ConflictError("This pairing link has already been used");
  return updated;
}

// ---------------------------------------------------------------------------
// The person's side
// ---------------------------------------------------------------------------

export type MyPairing = {
  id: string;
  status: PairRow["status"];
  /** The other person, once there is one (a member named, or somebody who arrived). */
  otherName: string | null;
  /** The link to send, while nobody has used it. */
  link: string | null;
  /** Whether *this* person is the one who may confirm or turn it down now. */
  canAnswer: boolean;
};

/** Every pair the person is in, for their own page. */
export async function listPairingsForArrival(arrival: Pick<Arrival, "id">, linkFor: (token: string) => string): Promise<MyPairing[]> {
  const rows = await db
    .select()
    .from(recruitmentPair)
    .where(or(eq(recruitmentPair.firstArrivalId, arrival.id), eq(recruitmentPair.secondArrivalId, arrival.id)))
    .orderBy(desc(recruitmentPair.createdAt));
  const out: MyPairing[] = [];
  for (const pair of rows) {
    const iAmFirst = pair.firstArrivalId === arrival.id;
    const otherArrivalId = iAmFirst ? pair.secondArrivalId : pair.firstArrivalId;
    let otherName: string | null = null;
    if (otherArrivalId) {
      const [o] = await db.select({ name: admission.name }).from(admission).where(eq(admission.id, otherArrivalId));
      otherName = o?.name ?? null;
    } else if (iAmFirst && pair.secondMemberId) {
      const [m] = await db.select({ name: member.name }).from(member).where(eq(member.id, pair.secondMemberId));
      otherName = m?.name ?? null;
    }
    out.push({
      id: pair.id,
      status: pair.status,
      otherName,
      link: iAmFirst && pair.status === "awaiting_applicant" && !pair.secondArrivalId && !pair.secondMemberId ? linkFor(pair.token) : null,
      canAnswer: pair.status === "awaiting_accept" && (iAmFirst || pair.linkedByTeam),
    });
  }
  return out;
}

/**
 * Confirm the pairing, or turn it down. The token is the person's own page's: nobody else
 * can answer for them, and only the namer can confirm a link they made (either person, when
 * the team linked them). Declining is a first-class answer, recorded, not a thing you do by
 * not clicking — the pair is still applying separately, nothing about that changes.
 */
export async function answerPairing(arrivalToken: string, pairId: string, accept: boolean) {
  const [arrival] = await db.select().from(admission).where(eq(admission.token, arrivalToken));
  if (!arrival) throw new NotFoundError("This page isn't valid any more");
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.id, pairId));
  if (!pair) throw new NotFoundError("That pairing isn't there any more");
  const mayAnswer = pair.firstArrivalId === arrival.id || (pair.linkedByTeam && pair.secondArrivalId === arrival.id);
  if (!mayAnswer) throw new ForbiddenError("Only the person who made this link can confirm it");
  if (pair.status === "accepted" || pair.status === "declined") throw new ConflictError("This pairing has already been settled");
  if (pair.status !== "awaiting_accept") throw new ConflictError("Nobody has used this link yet, so there's nothing to confirm");
  const [updated] = await db
    .update(recruitmentPair)
    .set({ status: accept ? "accepted" : "declined", resolvedAt: new Date() })
    .where(and(eq(recruitmentPair.id, pair.id), eq(recruitmentPair.status, "awaiting_accept")))
    .returning();
  if (!updated) throw new ConflictError("This pairing has already been settled");
  return updated;
}

// ---------------------------------------------------------------------------
// Pairs as a record (§5.4 / J9)
// ---------------------------------------------------------------------------

export type PairRecord = {
  id: string;
  status: PairRow["status"];
  createdAt: Date;
  resolvedAt: Date | null;
  /** Who made the link or was named first: the person, or the member who named them. */
  namer: { name: string } | null;
  /** The other: a named member, or the person who arrived through the link. */
  other: { name: string } | null;
  linkedByTeam: boolean;
  // "not_applicable" is its own value rather than being folded into "settled", because a pair
  // where the named person is an existing member can never share an interview — there is
  // only one person being interviewed — and a community reading this later should be able to
  // tell that apart from a pair that was never offered one.
  sharedCall: "not_offered" | "not_applicable" | "offered" | "accepted" | "declined" | "settled";
};

/** Everyone's pairs, newest first, for the hub. Scoped like the pipeline: a cycle-placed holder sees their own cycle's. */
export async function listPairings(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const { listHeldRecruitmentScopes } = await import("./access");
  const held = await listHeldRecruitmentScopes(actor);
  const rows = await db.select().from(recruitmentPair).where(eq(recruitmentPair.communityId, actor.communityId)).orderBy(desc(recruitmentPair.createdAt));
  const visible = rows.filter((r) => held.has(null) || (r.cycleId !== null && held.has(r.cycleId)));
  if (visible.length === 0) return [];

  const arrivalIds = visible.flatMap((r) => [r.firstArrivalId, r.secondArrivalId]).filter((v): v is string => Boolean(v));
  const memberIds = visible.flatMap((r) => [r.requestedById, r.secondMemberId]).filter((v): v is string => Boolean(v));
  const arrivals = arrivalIds.length ? await db.select({ id: admission.id, name: admission.name }).from(admission).where(inArray(admission.id, arrivalIds)) : [];
  const people = memberIds.length ? await db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, memberIds)) : [];
  const arrivalName = new Map(arrivals.map((a) => [a.id, a.name]));
  const memberName = new Map(people.map((p) => [p.id, p.name]));

  return visible.map(
    (r): PairRecord => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      namer: r.firstArrivalId
        ? { name: arrivalName.get(r.firstArrivalId) ?? "Someone" }
        : r.requestedById
          ? { name: memberName.get(r.requestedById) ?? "A member" }
          : null,
      other: r.secondArrivalId
        ? { name: arrivalName.get(r.secondArrivalId) ?? "Someone" }
        : r.secondMemberId
          ? { name: memberName.get(r.secondMemberId) ?? "A member" }
          : null,
      linkedByTeam: r.linkedByTeam,
      sharedCall: describeSharedCallState(r),
    }),
  );
}

function describeSharedCallState(r: PairRow): PairRecord["sharedCall"] {
  if (r.sharedCallAcceptedAt) return "accepted";
  if (r.sharedCallDeclinedAt) return "declined";
  if (r.sharedCallOfferedAt) return "offered";
  if (r.secondMemberId) return "not_applicable";
  if (r.status === "accepted" && r.secondArrivalId) return "not_offered";
  return "settled";
}

// ---------------------------------------------------------------------------
// The shared interview (§2)
// ---------------------------------------------------------------------------

// One call, two people. The interview is shared and the recommendation is per person: both
// arrivals sit on one poll whose required participants are both of them, so both have to be
// free in the slot and enough holders have to offer it; and each interviewer then files one
// report for each arrival, each counting its own N. It is offered, never applied — and only
// when both people have an interview of their own still to arrange and neither has been
// booked, because quietly re-pointing somebody's already-booked call is not something to do
// behind their back.
export type SharedInterviewOffer = {
  pairId: string;
  token: string;
  names: { first: string; second: string };
  pollId: string;
  pollTitle: string;
};

async function offerable(pair: PairRow): Promise<{ first: Arrival; second: Arrival } | null> {
  if (pair.status !== "accepted" || !pair.firstArrivalId || !pair.secondArrivalId) return null;
  if (pair.sharedCallOfferedAt || pair.sharedCallAcceptedAt) return null;
  const [first, second] = await Promise.all([loadArrival(pair.firstArrivalId), loadArrival(pair.secondArrivalId)]);
  if (!inFlight(first) || !inFlight(second)) return null;
  if (!first.requiredInterview || !second.requiredInterview) return null;
  if (!first.interviewPollId || !second.interviewPollId || first.interviewPollId === second.interviewPollId) return null;
  if (first.interviewScheduledAt || second.interviewScheduledAt) return null;
  return { first, second };
}

export async function listSharedInterviewOffers(actor: Member): Promise<SharedInterviewOffer[]> {
  await requireRecruitmentTaskHolder(actor);
  const { listHeldRecruitmentScopes } = await import("./access");
  const { canScheduleInterview } = await import("./joining");
  const held = await listHeldRecruitmentScopes(actor);
  const pairs = await db
    .select()
    .from(recruitmentPair)
    .where(and(eq(recruitmentPair.communityId, actor.communityId), eq(recruitmentPair.status, "accepted")));
  const offers: SharedInterviewOffer[] = [];
  for (const pair of pairs) {
    if (!(held.has(null) || (pair.cycleId !== null && held.has(pair.cycleId)))) continue;
    const both = await offerable(pair);
    if (!both) continue;
    if (!(await canScheduleInterview(actor.communityId, both.first.cycleId))) continue;
    const [poll] = await db.select({ id: schedulingPoll.id, title: schedulingPoll.title }).from(schedulingPoll).where(eq(schedulingPoll.id, both.first.interviewPollId!));
    if (!poll) continue;
    offers.push({ pairId: pair.id, token: pair.token, names: { first: both.first.name, second: both.second.name }, pollId: poll.id, pollTitle: poll.title });
  }
  return offers;
}

export const sharedInterviewInput = z.object({
  pairId: z.string().uuid(),
  accept: z.boolean(),
  note: z.string().max(500).optional(),
});
export type SharedInterviewInput = z.infer<typeof sharedInterviewInput>;

/**
 * The opt-in, answered by a recruitment holder covering the pair's scope. It is checked here,
 * on the write: the offer used to be *listed* only to holders while answering it was open to
 * any member who reached the action, so anyone could accept or decline for any pair.
 */
export async function answerSharedInterviewOffer(actor: Member, input: SharedInterviewInput) {
  await requireRecruitmentTaskHolder(actor);
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.id, input.pairId));
  if (!pair || pair.communityId !== actor.communityId) throw new NotFoundError("Pairing not found");
  await requireRecruitmentScopeForCycle(actor, pair.cycleId);
  if (pair.status !== "accepted") throw new ConflictError("This pairing hasn't been confirmed yet");
  if (!pair.firstArrivalId || !pair.secondArrivalId) throw new ConflictError("Both people need to be in the process before there is an interview to share");
  if (pair.sharedCallAcceptedAt || pair.sharedCallDeclinedAt) throw new ConflictError("This offer has already been answered");

  if (!input.accept) {
    const [updated] = await db
      .update(recruitmentPair)
      .set({ sharedCallOfferedAt: pair.sharedCallOfferedAt ?? new Date(), sharedCallDeclinedAt: new Date() })
      .where(and(eq(recruitmentPair.id, pair.id), isNull(recruitmentPair.sharedCallDeclinedAt), isNull(recruitmentPair.sharedCallAcceptedAt)))
      .returning();
    return { declined: true as const, pair: updated ?? pair };
  }

  const both = await offerable({ ...pair, sharedCallOfferedAt: null });
  if (!both) throw new ConflictError("Both people need an interview still to arrange, with neither booked, before they can share one");
  const poll = await shareInterview(actor, both.first, both.second);
  const [updated] = await db
    .update(recruitmentPair)
    .set({ sharedCallOfferedAt: pair.sharedCallOfferedAt ?? new Date(), sharedCallAcceptedAt: new Date() })
    .where(and(eq(recruitmentPair.id, pair.id), isNull(recruitmentPair.sharedCallAcceptedAt)))
    .returning();
  return { declined: false as const, pair: updated ?? pair, pollId: poll.id };
}

// Puts the second person on the first's poll: they become a required participant, so both
// must be free in the slot; whatever times the second had offered move across; and their own
// now-unused poll is removed (its holders' times merged across). The poll is renamed so a
// holder reading it sees whose it is.
async function shareInterview(actor: Member, first: Arrival, second: Arrival) {
  const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, first.interviewPollId!));
  if (!poll) throw new NotFoundError("That interview no longer exists");
  const oldPollId = second.interviewPollId!;
  await db.transaction(async (tx) => {
    await tx
      .update(schedulingPoll)
      .set({
        requiredParticipantIds: poll.requiredParticipantIds.includes(second.id) ? poll.requiredParticipantIds : [...poll.requiredParticipantIds, second.id],
        title: `Interview: ${first.name} and ${second.name}`,
      })
      .where(eq(schedulingPoll.id, poll.id));
    await tx.update(schedulingEntry).set({ pollId: poll.id }).where(and(eq(schedulingEntry.pollId, oldPollId), eq(schedulingEntry.arrivalId, second.id)));
    await tx.update(admission).set({ interviewPollId: poll.id }).where(eq(admission.id, second.id));
    // A holder who had offered times for the second person's call offers them for the shared
    // one too: merged with what they had already offered there, never lost. (Standing
    // availability is read live and needs nothing moved.)
    const heldOld = await tx.select().from(schedulingEntry).where(and(eq(schedulingEntry.pollId, oldPollId)));
    for (const e of heldOld) {
      if (!e.memberId) continue;
      const [onNew] = await tx.select().from(schedulingEntry).where(and(eq(schedulingEntry.pollId, poll.id), eq(schedulingEntry.memberId, e.memberId)));
      const merged = [...new Set([...((onNew?.availableSlots as string[] | undefined) ?? []), ...(e.availableSlots as string[])])];
      if (onNew) await tx.update(schedulingEntry).set({ availableSlots: merged, updatedAt: new Date() }).where(eq(schedulingEntry.id, onNew.id));
      else await tx.insert(schedulingEntry).values({ pollId: poll.id, memberId: e.memberId, availableSlots: merged });
    }
    await tx.delete(schedulingEntry).where(eq(schedulingEntry.pollId, oldPollId));
  });

  // The second person's own poll is now nobody's. Every poll spins up two coordination tasks, so
  // those go first — leaving them would put two unclaimable "facilitate a call that won't happen"
  // tasks on the board — and then the poll. Best-effort: a leftover is untidy, not wrong.
  try {
    const { deleteTask } = await import("../tasks/crud");
    // Only a task's creator may delete it, and the poll's organizer made them.
    const orphaned = await db.select({ id: task.id, createdBy: task.createdBy }).from(task).where(eq(task.sourcePollId, oldPollId));
    for (const t of orphaned) {
      const [creator] = await db.select().from(member).where(eq(member.id, t.createdBy));
      await deleteTask(creator ?? actor, t.id);
    }
    await db.delete(schedulingPoll).where(eq(schedulingPoll.id, oldPollId));
  } catch (err) {
    console.error("[pairing] could not tidy the second person's old poll", err);
  }
  return poll;
}
