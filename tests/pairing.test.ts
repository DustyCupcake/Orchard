import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, member, schedulingEntry, schedulingPoll } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes, POLICY_TWO_OF_TWO } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import { updateCommunity } from "@/lib/settings";
import { submitAvailability } from "@/lib/scheduling-polls";
import {
  confirmInterview,
  getInterviewers,
  getInterviewState,
  recordArrivalDecisionIfReached,
  submitArrivalEvaluation,
  submitInterviewAvailability,
  submitRecruitmentApplication,
  markInterviewHeld,
} from "@/lib/recruitment";
import {
  answerPairing,
  answerSharedInterviewOffer,
  createApplyTogetherLink,
  createPairings,
  linkArrivalsManually,
  listPairings,
  listPairingsForArrival,
  listSharedInterviewOffers,
} from "@/lib/recruitment/pairs";
import { ConflictError, ForbiddenError } from "@/lib/errors";

// docs/plans/admission-flow.md §2, "Pairing and a shared interview". A pair is a fact between two
// *arrivals*; the only thing it can change is one shared interview, which is offered by a
// holder and never applied; and the recommendation stays per person.

const fields = [
  { key: "name", label: "Name", responseType: "text" as const, required: true, isNameField: true },
  { key: "email", label: "Email", responseType: "text" as const, required: true, isEmailField: true },
];

const inDays = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
};

async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, bob, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
  const form = await createForm(alice, { title: "Application", fields });
  await updateCommunity(alice, { recruitmentApplicationFormId: form.id, ...POLICY_TWO_OF_TWO });
  await setLanes(c.id, [{ name: "Open", kind: "public", interviewRequired: true }]);
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  await claimTask(alice, recruitmentTask.id);
  await claimTask(bob, recruitmentTask.id);
  const apply = (name: string, pairingToken?: string) =>
    submitRecruitmentApplication(c.id, { values: { name, email: `${name.toLowerCase()}@example.com` }, pairingToken: pairingToken ?? null });
  const arrival = async (id: string) => (await db.select().from(admission).where(eq(admission.id, id)))[0]!;
  return { ...fixtures, carol, apply, arrival };
}

// Dana made a link from her page, and Eve applied through it.
async function pairedApplicants() {
  const s = await setUp();
  const dana = await s.apply("Dana");
  const link = await createApplyTogetherLink(dana.token);
  const eve = await s.apply("Eve", link.token);
  return { ...s, dana, eve, link };
}

describe("making and using the apply-together link", () => {
  beforeEach(resetDatabase);

  it("gives one open link per person, and the same one again if asked twice", async () => {
    const { apply } = await setUp();
    const dana = await apply("Dana");
    const first = await createApplyTogetherLink(dana.token);
    expect((await createApplyTogetherLink(dana.token)).id).toBe(first.id);
    expect(first).toMatchObject({ status: "awaiting_applicant", firstArrivalId: dana.arrivalId, requestedById: null });
  });

  it("is attached when somebody applies through it, and waits for the namer to confirm", async () => {
    const { dana, eve, link } = await pairedApplicants();
    const mine = await listPairingsForArrival({ id: dana.arrivalId }, (t) => `/pair/${t}`);
    expect(mine).toEqual([expect.objectContaining({ id: link.id, status: "awaiting_accept", otherName: "Eve", link: null, canAnswer: true })]);
    // Eve sees it too, but it isn't hers to confirm.
    const hers = await listPairingsForArrival({ id: eve.arrivalId }, (t) => `/pair/${t}`);
    expect(hers[0]).toMatchObject({ otherName: "Dana", canAnswer: false });
  });

  it("can be used once, and not by the person who made it", async () => {
    const { apply, link } = await pairedApplicants();
    await expect(apply("Fay", link.token)).rejects.toThrow(/isn't valid any more/);
  });

  it("lets only the namer confirm it, once, and records a decline as an answer", async () => {
    const { alice, dana, eve, link } = await pairedApplicants();
    await expect(answerPairing(eve.token, link.id, true)).rejects.toThrow(ForbiddenError);
    await answerPairing(dana.token, link.id, true);
    await expect(answerPairing(dana.token, link.id, false)).rejects.toThrow(ConflictError);
    expect((await listPairings(alice))[0]).toMatchObject({ status: "accepted", namer: { name: "Dana" }, other: { name: "Eve" } });
  });

  it("is only a fact: it changes nothing about either person's path", async () => {
    const { dana, eve, arrival } = await pairedApplicants();
    const a = await arrival(dana.arrivalId);
    const b = await arrival(eve.arrivalId);
    expect(a).toMatchObject({ requiredInterview: true, reportsNeeded: 2, admittedMemberId: null });
    expect(b).toMatchObject({ requiredInterview: true, reportsNeeded: 2, admittedMemberId: null });
  });
});

describe("the team linking two people by hand", () => {
  beforeEach(resetDatabase);

  it("is for the recruitment or mediation team, and either person may confirm it", async () => {
    const { alice, carol, apply } = await setUp();
    const dana = await apply("Dana");
    const eve = await apply("Eve");
    await expect(linkArrivalsManually(carol, { firstArrivalId: dana.arrivalId, secondArrivalId: eve.arrivalId })).rejects.toThrow(ForbiddenError);
    const pair = await linkArrivalsManually(alice, { firstArrivalId: dana.arrivalId, secondArrivalId: eve.arrivalId });
    expect(pair).toMatchObject({ status: "awaiting_accept", linkedByTeam: true, requestedById: alice.id });

    // Eve — the second — can confirm it, because the team linked them; and only once.
    await answerPairing(eve.token, pair.id, true);
    await expect(linkArrivalsManually(alice, { firstArrivalId: eve.arrivalId, secondArrivalId: dana.arrivalId })).rejects.toThrow(/already paired/);
  });

  it("refuses somebody with themselves, a stranger, and somebody who has already finished", async () => {
    const { alice, apply } = await setUp();
    const dana = await apply("Dana");
    await expect(linkArrivalsManually(alice, { firstArrivalId: dana.arrivalId, secondArrivalId: dana.arrivalId })).rejects.toThrow(/themselves/);
    const eve = await apply("Eve");
    await db.update(admission).set({ withdrawnAt: new Date() }).where(eq(admission.id, eve.arrivalId));
    await expect(linkArrivalsManually(alice, { firstArrivalId: dana.arrivalId, secondArrivalId: eve.arrivalId })).rejects.toThrow(/still be in the process/);
  });

  it("records an inviter's named members as settled facts, with no one to confirm", async () => {
    const { alice, bob, community: c, apply } = await setUp();
    const dana = await apply("Dana");
    const pairs = await createPairings({ communityId: c.id, memberId: alice.id }, { nomineeMemberIds: [bob.id], pokeMemberIds: [], firstArrivalId: dana.arrivalId }, { requireMember: false });
    expect(pairs[0]).toMatchObject({ status: "accepted", secondMemberId: bob.id, firstArrivalId: dana.arrivalId });
    expect((await listPairings(alice))[0].sharedCall).toBe("not_applicable");
  });
});

describe("one shared interview", () => {
  beforeEach(resetDatabase);

  async function acceptedPair() {
    const p = await pairedApplicants();
    await answerPairing(p.dana.token, p.link.id, true);
    return p;
  }

  it("is offered to the holders once both have an interview to arrange and neither is booked", async () => {
    const { alice, link } = await acceptedPair();
    const offers = await listSharedInterviewOffers(alice);
    expect(offers).toEqual([expect.objectContaining({ pairId: link.id, names: { first: "Dana", second: "Eve" } })]);
  });

  it("is not offered before the pair is confirmed, or after either is booked", async () => {
    const p = await pairedApplicants();
    expect(await listSharedInterviewOffers(p.alice)).toHaveLength(0);
    await answerPairing(p.dana.token, p.link.id, true);
    expect(await listSharedInterviewOffers(p.alice)).toHaveLength(1);
    const first = await p.arrival(p.dana.arrivalId);
    await db.update(admission).set({ interviewScheduledAt: new Date() }).where(eq(admission.id, first.id));
    expect(await listSharedInterviewOffers(p.alice)).toHaveLength(0);
  });

  it("is answered by a holder — the check that used to be missing — and recorded either way", async () => {
    const { alice, carol, link } = await acceptedPair();
    await expect(answerSharedInterviewOffer(carol, { pairId: link.id, accept: true })).rejects.toThrow(/recruitment-task holder/);
    await expect(answerSharedInterviewOffer(carol, { pairId: link.id, accept: false })).rejects.toThrow(/recruitment-task holder/);
    const declined = await answerSharedInterviewOffer(alice, { pairId: link.id, accept: false });
    expect(declined.declined).toBe(true);
    expect((await listPairings(alice))[0].sharedCall).toBe("declined");
    expect(await listSharedInterviewOffers(alice)).toHaveLength(0);
    await expect(answerSharedInterviewOffer(alice, { pairId: link.id, accept: true })).rejects.toThrow(/already been answered/);
  });

  it("puts both on one poll, so the slot has to suit both of them and enough holders", async () => {
    const { alice, bob, link, dana, eve, arrival } = await acceptedPair();
    const [danaA, eveA] = [await arrival(dana.arrivalId), await arrival(eve.arrivalId)];
    const eveOldPoll = eveA.interviewPollId!;
    expect(eveOldPoll).not.toBe(danaA.interviewPollId);
    const both = inDays(2);
    const onlyDana = inDays(3);
    // Eve had offered a time on her own poll, and Bob had too.
    await submitInterviewAvailability(eveA, [both]);
    await submitAvailability(bob, eveOldPoll, { slots: [both] });

    await answerSharedInterviewOffer(alice, { pairId: link.id, accept: true });
    const [d, e] = [await arrival(dana.arrivalId), await arrival(eve.arrivalId)];
    expect(e.interviewPollId).toBe(d.interviewPollId);
    const [poll] = await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, d.interviewPollId!));
    expect(poll.requiredParticipantIds.sort()).toEqual([d.id, e.id].sort());
    expect(poll.title).toBe("Interview: Dana and Eve");
    // Her old poll is gone, and what she and Bob had offered came across.
    expect(await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, eveOldPoll))).toHaveLength(0);
    const entries = await db.select().from(schedulingEntry).where(eq(schedulingEntry.pollId, poll.id));
    expect(entries.find((x) => x.arrivalId === e.id)!.availableSlots).toEqual([both]);
    expect(entries.find((x) => x.memberId === bob.id)!.availableSlots).toEqual([both]);

    // Only Dana is free on one day: not a slot, whoever offers it.
    await submitInterviewAvailability(d, [onlyDana]);
    await submitAvailability(alice, poll.id, { slots: [both, onlyDana] });
    await submitAvailability(bob, poll.id, { slots: [onlyDana] });
    let state = await getInterviewState(d);
    expect(state.qualifyingSlots).toEqual([]);
    // Both free at `both`, and Alice and Bob both offered it.
    await submitInterviewAvailability(d, [both, onlyDana]);
    await submitAvailability(bob, poll.id, { slots: [both, onlyDana] });
    state = await getInterviewState(d);
    expect(state.qualifyingSlots).toEqual([both]);
    // Not offerable twice.
    await expect(answerSharedInterviewOffer(alice, { pairId: link.id, accept: true })).rejects.toThrow(/already been answered/);
  });

  it("books both at once, tells both, has the same interviewers — and each is reported on separately", async () => {
    const { alice, bob, link, dana, eve, arrival } = await acceptedPair();
    await answerSharedInterviewOffer(alice, { pairId: link.id, accept: true });
    const slot = inDays(-1); // already past, so the call counts as held
    const [d, e] = [await arrival(dana.arrivalId), await arrival(eve.arrivalId)];
    await submitInterviewAvailability(d, [slot]);
    await submitInterviewAvailability(e, [slot]);
    await submitAvailability(alice, d.interviewPollId!, { slots: [slot] });
    await submitAvailability(bob, d.interviewPollId!, { slots: [slot] });
    await confirmInterview(bob, d.id, slot);

    const [booked, bookedE] = [await arrival(dana.arrivalId), await arrival(eve.arrivalId)];
    expect(booked.interviewScheduledAt).not.toBeNull();
    expect(bookedE.interviewScheduledAt).not.toBeNull();
    expect((await getInterviewers(booked)).map((m) => m.id).sort()).toEqual((await getInterviewers(bookedE)).map((m) => m.id).sort());
    await markInterviewHeld(alice, d.id).catch(() => undefined);

    // One call; two sets of recommendations. Dana is a yes from both, Eve a no from both.
    for (const who of [alice, bob]) {
      await submitArrivalEvaluation(who, d.id, { recommendation: "proceed" });
      await submitArrivalEvaluation(who, e.id, { recommendation: "decline" });
    }
    expect((await recordArrivalDecisionIfReached(alice, d.id))!.resolution).toBe("accepted");
    expect((await recordArrivalDecisionIfReached(alice, e.id))!.resolution).toBe("declined");
    expect((await arrival(dana.arrivalId)).admittedMemberId).not.toBeNull();
    expect((await arrival(eve.arrivalId)).admittedMemberId).toBeNull();
  });

  it("is refused if one of them has since been booked or finished", async () => {
    const { alice, link, dana } = await acceptedPair();
    await db.update(admission).set({ interviewScheduledAt: new Date() }).where(eq(admission.id, dana.arrivalId));
    await expect(answerSharedInterviewOffer(alice, { pairId: link.id, accept: true })).rejects.toThrow(/neither booked/);
  });
});
