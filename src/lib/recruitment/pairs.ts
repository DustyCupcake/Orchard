import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  community,
  formResponse,
  member,
  memberIdentity,
  recruitmentDecision,
  recruitmentPair,
  schedulingPoll,
} from "@/db/schema";
import type { member as memberTable, recruitmentPair as recruitmentPairTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { sendNominationSupportRequestEmail } from "../mailer";
import { generateToken } from "../token";
import { getCommunityRow, requireRecruitmentTaskHolder } from "./access";
import { isMediationMember } from "./mediation";

type Member = typeof memberTable.$inferSelect;
type PairRow = typeof recruitmentPairTable.$inferSelect;

// "Who are you sticking with" (docs/joining-admission-plan.md §2.8,
// work-plan step 6). J9 is the constraint everything here obeys: a pair
// is a *fact*, recorded and shown to humans, and the platform decides
// nothing whatsoever from it. No lane reads a pairing, no capacity count
// changes, no decision rule can name it. The one thing a pair changes is
// the shared interview below — and even that is offered, not applied.

// ---------------------------------------------------------------------------
// Naming someone
// ---------------------------------------------------------------------------

export const namePairingInput = z.object({
  // A public applicant names the people they are coming with; a member
  // creating an invite names the members they think also know the
  // invitee (the "poke" half of §2.4). Both are the same row: one
  // person, pointed at another.
  nomineeMemberIds: z.array(z.string().uuid()).max(20).default([]),
  // For the inviter's poke: members to notify with the support link.
  // Deliberately a separate list from nomineeMemberIds because a poke is
  // "please look at this link" and a pairing is "I am coming with this
  // person" — they look alike in a form and mean opposite things, and
  // conflating them would broadcast the nominee's existence to everyone
  // the inviter happened to list.
  pokeMemberIds: z.array(z.string().uuid()).max(20).default([]),
  cycleId: z.string().uuid().nullable().optional(),
  firstResponseId: z.string().uuid().nullable().optional(),
});
export type NamePairingInput = z.infer<typeof namePairingInput>;

// §2.4's poke: the inviter names members they think also know the
// invitee, and those members each get an email carrying the support
// link. Best-effort in the same way every other send in this codebase
// is — a member with no email on file, or a mailer that isn't
// configured, must never fail the invite that was being created. The
// inviter always gets the link back to hand over by hand, which is the
// other half of §2.4's "share a link" option and the reason a failed
// send is a nuisance rather than a loss.
export async function pokeMembersForSupport(input: {
  communityId: string;
  communityName: string;
  askerId: string;
  askerName: string;
  nomineeLabel: string | null;
  supportUrl: string;
  windowHours: number;
  memberIds: string[];
}): Promise<{ poked: string[]; undeliverable: string[] }> {
  if (input.memberIds.length === 0) return { poked: [], undeliverable: [] };
  const recipients = await db
    .select({ id: member.id, name: member.name, email: memberIdentity.loginEmail })
    .from(member)
    .leftJoin(memberIdentity, eq(memberIdentity.memberId, member.id))
    .where(
      and(
        eq(member.communityId, input.communityId),
        inArray(member.id, input.memberIds),
        ne(member.id, input.askerId),
      ),
    );
  // Deduplicated by member: leftJoin over memberIdentity can produce a
  // second row for a member with two identities, and "you've been asked
  // to support this person" arriving twice is worse than arriving once.
  const byMember = new Map<string, { name: string; email: string | null }>();
  for (const r of recipients) {
    if (!byMember.has(r.id)) byMember.set(r.id, { name: r.name, email: r.email });
  }

  const poked: string[] = [];
  const undeliverable: string[] = [];
  for (const [memberId, person] of byMember) {
    if (!person.email) {
      undeliverable.push(memberId);
      continue;
    }
    try {
      await sendNominationSupportRequestEmail(person.email, {
        askerName: input.askerName,
        nomineeLabel: input.nomineeLabel,
        supportUrl: input.supportUrl,
        windowHours: input.windowHours,
        onBehalfOfCommunity: false,
      });
      poked.push(memberId);
    } catch {
      undeliverable.push(memberId);
    }
  }
  return { poked, undeliverable };
}

// §2.8 — the namer's "who are you sticking with". Returns one pair row
// per named person; a named member gets a pair (their support view is
// the same link), a named non-member gets a pair whose link is the
// application, pre-paired when they use it.
//
// Takes {communityId, memberId} rather than a Member because the namer
// is very often *not* a member: a public applicant naming the people
// they are coming with is the plan's own example, and that applicant has
// no Member row because they haven't joined yet. The only two facts
// needed are which community this is and who is doing the naming.
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
    if (isMember && opts.requireMember) {
      // "A member who opens it can second the nomination" is the
      // support view, not a pairing — the pairing row for a member is
      // only meaningful for a *manual* link between two applicants
      // (§2.8's third bullet), and a live member is always the support
      // view's job.
      continue;
    }
    const [pair] = await db
      .insert(recruitmentPair)
      .values({
        communityId: namer.communityId,
        cycleId: input.cycleId ?? null,
        token: generateToken(),
        requestedById: namer.memberId,
        firstResponseId: input.firstResponseId ?? null,
        secondMemberId: isMember ? memberId : null,
        // A member who never acts on the link is a dormant row, not a
        // pending application, so it starts settled rather than waiting
        // for somebody who already exists.
        status: isMember ? "accepted" : "awaiting_applicant",
        resolvedAt: isMember ? new Date() : null,
      })
      .returning();
    created.push(pair);
  }
  return created;
}

// §2.8 — the mediation/recruitment team's manual link. Same row, but
// with no link to send in the first place: the team already knows both
// people, so the pairing starts at the only interesting point, "waiting
// for the namer to confirm this is who they meant".
export const manualPairInput = z.object({
  firstResponseId: z.string().uuid(),
  secondResponseId: z.string().uuid(),
  cycleId: z.string().uuid().nullable().optional(),
});
export type ManualPairInput = z.infer<typeof manualPairInput>;

export async function linkApplicationsManually(actor: Member, input: ManualPairInput) {
  // §2.8 names the mediation/recruitment team for this, and the two are
  // the same authority in practice: a community that separated them has
  // one of the two do it, and a community that merged them has one task
  // doing both. Requiring either is what stops an ordinary member from
  // declaring that two strangers are arriving together.
  if (!(await isRecruitmentOrMediationHolder(actor))) {
    throw new ForbiddenError("Only the recruitment or mediation team can link two applications by hand");
  }
  if (input.firstResponseId === input.secondResponseId) {
    throw new AppError("An application can't be paired with itself");
  }
  const rows = await db
    .select({ id: formResponse.id, cycleId: formResponse.cycleId })
    .from(formResponse)
    .where(inArray(formResponse.id, [input.firstResponseId, input.secondResponseId]));
  if (rows.length !== 2) {
    throw new NotFoundError("One of those applications doesn't exist");
  }
  const [pair] = await db
    .insert(recruitmentPair)
    .values({
      communityId: actor.communityId,
      cycleId: input.cycleId ?? rows.find((r) => r.id === input.firstResponseId)?.cycleId ?? null,
      token: generateToken(),
      requestedById: actor.id,
      firstResponseId: input.firstResponseId,
      secondResponseId: input.secondResponseId,
      status: "awaiting_accept",
    })
    .returning();
  return pair;
}

async function isRecruitmentOrMediationHolder(actor: Member) {
  const { isRecruitmentTaskHolder } = await import("./access");
  return (await isRecruitmentTaskHolder(actor)) || (await isMediationMember(actor));
}

// ---------------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------------

export type PairingLink = {
  pair: PairRow;
  communityName: string;
  namerName: string;
  namedMemberName: string | null;
  // Which side of the fork this particular viewer is on. The token is
  // shared, so this is the whole branching decision §2.4 asks for.
  view: "accept" | "apply" | "already_member" | "resolved";
};

export async function getPairingByToken(token: string): Promise<PairingLink | null> {
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.token, token));
  if (!pair) return null;
  const [communityRow] = await db
    .select({ name: community.name })
    .from(community)
    .where(eq(community.id, pair.communityId));
  const people = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(
      inArray(
        member.id,
        [pair.requestedById, pair.secondMemberId].filter((v): v is string => Boolean(v)),
      ),
    );
  const names = new Map(people.map((p) => [p.id, p.name]));
  return {
    pair,
    communityName: communityRow?.name ?? "the community",
    namerName: names.get(pair.requestedById) ?? "Someone",
    namedMemberName: pair.secondMemberId ? (names.get(pair.secondMemberId) ?? null) : null,
    view:
      pair.status === "declined" || pair.status === "accepted"
        ? "resolved"
        : pair.secondMemberId
          ? "already_member"
          : pair.status === "awaiting_accept"
            ? "accept"
            : "apply",
  };
}

// The accept-the-pairing link, and the only write a recipient of one
// makes. Public: the person accepting is a member (the namer), but the
// lib is session-agnostic and the page does the session check, the same
// split every other public-page-plus-server-action pair in this codebase
// uses.
export async function acceptPairing(actor: Member, token: string) {
  const found = await getPairingByToken(token);
  if (!found) {
    throw new NotFoundError("That pairing link isn't valid");
  }
  if (found.pair.communityId !== actor.communityId) {
    throw new ForbiddenError("That pairing link belongs to another community");
  }
  if (found.pair.requestedById !== actor.id) {
    throw new ForbiddenError("Only the person who named the other can confirm the pairing");
  }
  if (found.pair.status === "declined") {
    throw new ConflictError("This pairing has already been turned down");
  }
  if (found.pair.status === "accepted") {
    return found.pair;
  }
  const [updated] = await db
    .update(recruitmentPair)
    .set({ status: "accepted", resolvedAt: new Date() })
    .where(and(eq(recruitmentPair.id, found.pair.id), eq(recruitmentPair.status, "awaiting_accept")))
    .returning();
  if (!updated) {
    throw new ConflictError("This pairing has already been settled");
  }
  return updated;
}

export async function declinePairing(actor: Member, token: string) {
  const found = await getPairingByToken(token);
  if (!found) {
    throw new NotFoundError("That pairing link isn't valid");
  }
  if (found.pair.requestedById !== actor.id) {
    throw new ForbiddenError("Only the person who named the other can turn the pairing down");
  }
  const [updated] = await db
    .update(recruitmentPair)
    .set({ status: "declined", resolvedAt: new Date() })
    .where(
      and(
        eq(recruitmentPair.id, found.pair.id),
        inArray(recruitmentPair.status, ["awaiting_applicant", "awaiting_accept"]),
      ),
    )
    .returning();
  return updated ?? null;
}

// Called from submitRecruitmentApplication: someone used the pairing
// link, so the pair is no longer waiting for an applicant. Deliberately
// *not* accepted here — the namer still confirms, which is what §2.8's
// "the linked party receives an accept-the-pairing link" is for.
export async function attachApplicantToPairing(token: string, formResponseId: string, cycleId: string | null) {
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.token, token));
  if (!pair) {
    throw new NotFoundError("That pairing link isn't valid");
  }
  if (pair.secondResponseId) {
    throw new ConflictError("This pairing link has already been used");
  }
  const [updated] = await db
    .update(recruitmentPair)
    .set({ secondResponseId: formResponseId, cycleId: cycleId ?? pair.cycleId, status: "awaiting_accept" })
    .where(and(eq(recruitmentPair.id, pair.id), isNull(recruitmentPair.secondResponseId)))
    .returning();
  if (!updated) {
    throw new ConflictError("This pairing link has already been used");
  }
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
  namer: { memberId: string; name: string } | null;
  namedMember: { memberId: string; name: string } | null;
  firstApplicationSubmittedAt: Date | null;
  secondApplicationSubmittedAt: Date | null;
  // "not_applicable" is its own value rather than being folded into
  // "settled", because a pair where the named person is an existing
  // member can never share an interview — there is only one applicant —
  // and a community reading this list later should be able to tell that
  // apart from a pair that was never offered one.
  sharedCall: "not_offered" | "not_applicable" | "offered" | "accepted" | "declined" | "settled";
};

// Everyone's pairs, newest first, for the /recruitment hub's pairing
// panel. Holder-scoped the same way the pipeline is: a cycle-placed
// holder sees only their own cycle's pairs.
export async function listPairings(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const { listHeldRecruitmentScopes } = await import("./access");
  const held = await listHeldRecruitmentScopes(actor);
  const rows = await db
    .select()
    .from(recruitmentPair)
    .where(eq(recruitmentPair.communityId, actor.communityId))
    .orderBy(desc(recruitmentPair.createdAt));
  const visible = rows.filter((r) => held.has(null) || (r.cycleId !== null && held.has(r.cycleId)));
  if (visible.length === 0) return [];

  const memberIds = new Set<string>();
  for (const r of visible) {
    memberIds.add(r.requestedById);
    if (r.secondMemberId) memberIds.add(r.secondMemberId);
  }
  const responseIds = visible.flatMap((r) => [r.firstResponseId, r.secondResponseId]).filter((v): v is string => Boolean(v));

  const people = memberIds.size
    ? await db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, [...memberIds]))
    : [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const responses = responseIds.length
    ? await db
        .select({ id: formResponse.id, submittedAt: formResponse.submittedAt })
        .from(formResponse)
        .where(inArray(formResponse.id, responseIds))
    : [];
  const submittedAt = new Map(responses.map((r) => [r.id, r.submittedAt]));

  return visible.map(
    (r): PairRecord => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      namer: { memberId: r.requestedById, name: names.get(r.requestedById) ?? "A member" },
      namedMember: r.secondMemberId
        ? { memberId: r.secondMemberId, name: names.get(r.secondMemberId) ?? "A member" }
        : null,
      firstApplicationSubmittedAt: r.firstResponseId ? (submittedAt.get(r.firstResponseId) ?? null) : null,
      secondApplicationSubmittedAt: r.secondResponseId ? (submittedAt.get(r.secondResponseId) ?? null) : null,
      sharedCall: describeSharedCallState(r),
    }),
  );
}

function describeSharedCallState(r: PairRow): PairRecord["sharedCall"] {
  if (r.sharedCallAcceptedAt) return "accepted";
  if (r.sharedCallDeclinedAt) return "declined";
  if (r.sharedCallOfferedAt) return "offered";
  if (r.secondMemberId) return "not_applicable";
  if (r.status === "accepted" && r.secondResponseId) return "not_offered";
  return "settled";
}

// ---------------------------------------------------------------------------
// The shared interview (§2.8)
// ---------------------------------------------------------------------------

// A shared interview is a small extension of the existing intro-call
// machinery rather than a new stage: a must-overlap poll whose required
// participants are the evaluators *and both applicants*. It is offered,
// never applied, and only when all three of the plan's conditions hold —
// the lane asks for an interview, the interview door is open for the
// event, and both sides have actually reached the point of having an
// interview. A poll confirmed with only one applicant in it would be the
// "automatic" version of this that §2.8 explicitly rules out.
export type SharedInterviewOffer = {
  pairId: string;
  token: string;
  applicantSubmittedAt: { first: Date | null; second: Date | null };
  pollId: string;
  pollTitle: string;
};

// A pair is offerable when three of the plan's conditions hold and the
// fourth is a question rather than a fact: the lane asks for an
// interview (checked when the *second* side's decision is reached —
// see answerSharedInterviewOffer's caller, which only reaches here for a
// pair whose second side is on a lane with interviewRequired), the
// interview door is open for the event, and both sides have actually
// reached the interview stage.
//
// "Reached the stage" is deliberately narrow: exactly one of the two
// decisions has a poll of its own, and the other has none. Merging two
// existing interviews is a different operation from sharing one, and
// quietly re-pointing somebody's already-scheduled call at a new grid
// is not something to do behind their back.
export async function listSharedInterviewOffers(actor: Member): Promise<SharedInterviewOffer[]> {
  await requireRecruitmentTaskHolder(actor);
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.recruitmentInterviewsOpen) return [];
  const { listHeldRecruitmentScopes } = await import("./access");
  const held = await listHeldRecruitmentScopes(actor);

  const pairs = await db
    .select()
    .from(recruitmentPair)
    .where(
      and(
        eq(recruitmentPair.communityId, actor.communityId),
        eq(recruitmentPair.status, "accepted"),
        isNull(recruitmentPair.sharedCallOfferedAt),
        isNull(recruitmentPair.sharedCallAcceptedAt),
      ),
    );
  const offers: SharedInterviewOffer[] = [];
  for (const pair of pairs) {
    if (!pair.firstResponseId || !pair.secondResponseId) continue;
    if (!(held.has(null) || (pair.cycleId !== null && held.has(pair.cycleId)))) continue;
    if (pair.cycleId) {
      const { canScheduleInterview } = await import("./joining");
      if (!(await canScheduleInterview(actor.communityId, pair.cycleId))) continue;
    }
    const decisions = await db
      .select()
      .from(recruitmentDecision)
      .where(inArray(recruitmentDecision.formResponseId, [pair.firstResponseId, pair.secondResponseId]));
    if (decisions.length !== 2) continue;
    const withPoll = decisions.filter((d) => d.introCallPollId);
    const withoutPoll = decisions.filter((d) => !d.introCallPollId);
    if (withPoll.length !== 1 || withoutPoll.length !== 1) continue;
    const [poll] = await db
      .select({ id: schedulingPoll.id, title: schedulingPoll.title })
      .from(schedulingPoll)
      .where(eq(schedulingPoll.id, withPoll[0].introCallPollId!));
    if (!poll) continue;
    const responses = await db
      .select({ id: formResponse.id, submittedAt: formResponse.submittedAt })
      .from(formResponse)
      .where(inArray(formResponse.id, [pair.firstResponseId, pair.secondResponseId]));
    const submittedAt = new Map(responses.map((r) => [r.id, r.submittedAt]));
    offers.push({
      pairId: pair.id,
      token: pair.token,
      applicantSubmittedAt: {
        first: submittedAt.get(pair.firstResponseId) ?? null,
        second: submittedAt.get(pair.secondResponseId) ?? null,
      },
      pollId: poll.id,
      pollTitle: poll.title,
    });
  }
  return offers;
}

export const sharedInterviewInput = z.object({
  pairId: z.string().uuid(),
  accept: z.boolean(),
  note: z.string().max(500).optional(),
});
export type SharedInterviewInput = z.infer<typeof sharedInterviewInput>;

// The opt-in. Accepting merges the two applicants onto one poll; the
// poll is a must_overlap one already, so the pair's availability has to
// actually intersect before a slot confirms — which is §2.8's "their
// schedules align" doing real work rather than being a hope.
export async function answerSharedInterviewOffer(actor: Member, input: SharedInterviewInput) {
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.id, input.pairId));
  if (!pair || pair.communityId !== actor.communityId) {
    throw new NotFoundError("Pairing not found");
  }
  if (pair.status !== "accepted") {
    throw new ConflictError("This pairing hasn't been confirmed yet");
  }
  if (!pair.firstResponseId || !pair.secondResponseId) {
    throw new ConflictError("Both sides need an application before there is an interview to share");
  }
  if (!input.accept) {
    const [updated] = await db
      .update(recruitmentPair)
      .set({ sharedCallOfferedAt: pair.sharedCallOfferedAt ?? new Date(), sharedCallDeclinedAt: new Date() })
      .where(and(eq(recruitmentPair.id, pair.id), isNull(recruitmentPair.sharedCallDeclinedAt)))
      .returning();
    return { declined: true, pair: updated ?? pair };
  }
  const [updated] = await db
    .update(recruitmentPair)
    .set({ sharedCallOfferedAt: pair.sharedCallOfferedAt ?? new Date(), sharedCallAcceptedAt: new Date() })
    .where(and(eq(recruitmentPair.id, pair.id), isNull(recruitmentPair.sharedCallAcceptedAt)))
    .returning();
  if (!updated) {
    throw new ConflictError("You've already answered this offer");
  }
  const poll = await shareIntroCall(updated);
  return { declined: false, pair: updated, poll };
}
// Points the second applicant's decision at the first's poll and adds
// them to its required participants, so both have to submit availability
// and the poll can only confirm on a slot that suits all of them. The
// second side's own intro-call token is minted here so their
// /intro-call/<token> page resolves to the shared poll.
async function shareIntroCall(pair: PairRow) {
  const decisions = await db
    .select()
    .from(recruitmentDecision)
    .where(
      inArray(recruitmentDecision.formResponseId, [pair.firstResponseId!, pair.secondResponseId!]),
    );
  const withPoll = decisions.find((d) => d.introCallPollId);
  const withoutPoll = decisions.find((d) => !d.introCallPollId);
  if (!withPoll?.introCallPollId || !withoutPoll) {
    throw new ConflictError("Both sides need their own intro call scheduled before they can share one");
  }
  const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, withPoll.introCallPollId));
  if (!poll) {
    throw new NotFoundError("That interview no longer exists");
  }
  if (!poll.requiredParticipantIds.includes(withoutPoll.formResponseId)) {
    await db
      .update(schedulingPoll)
      .set({ requiredParticipantIds: [...poll.requiredParticipantIds, withoutPoll.formResponseId] })
      .where(eq(schedulingPoll.id, poll.id));
  }
  const [updated] = await db
    .update(recruitmentDecision)
    .set({ introCallPollId: poll.id, introCallToken: generateToken() })
    .where(eq(recruitmentDecision.id, withoutPoll.id))
    .returning();
  return { pollId: poll.id, token: updated?.introCallToken ?? null };
}

// Whether the token is one a pairing link handed out and the person
// opening it is a *different* applicant, i.e. the "apply, pre-paired
// with the namer" branch of §2.4. The invitation branch is the support
// view (src/lib/recruitment/support.ts), not this.
export async function resolvePairingForApplication(token: string) {
  const [pair] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.token, token));
  if (!pair) return null;
  if (pair.secondResponseId || pair.status === "declined" || pair.status === "accepted") {
    return null;
  }
  return pair;
}
