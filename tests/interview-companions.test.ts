import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, interviewCompanion, member, schedulingPoll } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes, POLICY_TWO_OF_TWO } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import { updateCommunity } from "@/lib/settings";
import { submitAvailability } from "@/lib/scheduling-polls";
import { computeAggregate } from "@/lib/scheduling-polls/availability";
import {
  confirmInterview,
  createCommunityInvite,
  getInterviewers,
  getInterviewState,
  redeemCommunityInvite,
  submitInterviewAvailability,
} from "@/lib/recruitment";
import {
  answerCompanionRequest,
  askInviterToJoin,
  getInviterOffer,
  listAcceptedCompanionIds,
  listMyCompanionRequests,
} from "@/lib/recruitment/interview-companions";
import { ConflictError, NotFoundError } from "@/lib/errors";

// docs/plans/accompaniment-plan.md step 5: the person who invited an applicant can be at their interview,
// if the applicant asks and the inviter would like to. Company, not an interviewer: they never count toward
// the holders a time needs, never file a report, and never stop a time being booked.

const fields = [
  { key: "name", label: "Name", responseType: "text" as const, required: true, isNameField: true },
  { key: "email", label: "Email", responseType: "text" as const, required: true, isEmailField: true },
];

const inDays = (days: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

// Alice and Bob hold recruitment (two reports needed); Carol holds nothing and invites Dana.
async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, bob, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"], cyclesEnabled: true }).where(eq(community.id, c.id));
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol Smith" }).returning();
  const form = await createForm(alice, { title: "Application", fields });
  await updateCommunity(alice, { recruitmentApplicationFormId: form.id, ...POLICY_TWO_OF_TWO });
  await setLanes(c.id, [
    { name: "Invited", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: true },
    { name: "Open", kind: "public", interviewRequired: true },
  ]);
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  await claimTask(alice, recruitmentTask.id);
  await claimTask(bob, recruitmentTask.id);

  const invite = await createCommunityInvite(carol, {});
  const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
  if (outcome.kind !== "waiting") throw new Error(`expected waiting, got ${outcome.kind}`);
  const arrivalOf = async () => (await db.select().from(admission).where(eq(admission.id, outcome.arrivalId)))[0];
  const arrival = await arrivalOf();
  return { ...fixtures, carol, arrivalId: outcome.arrivalId, arrivalOf, pollId: arrival.interviewPollId! };
}

const asMember = async (id: string) => (await db.select().from(member).where(eq(member.id, id)))[0];

describe("who the person may ask", () => {
  beforeEach(resetDatabase);

  it("is whoever invited them, by first name, with nothing asked yet", async () => {
    const s = await setUp();
    expect(await getInviterOffer(await s.arrivalOf())).toEqual({ memberId: s.carol.id, firstName: "Carol", status: null });
  });

  it("is nobody when nobody invited them", async () => {
    const s = await setUp();
    await db.update(admission).set({ inviteId: null }).where(eq(admission.id, s.arrivalId));
    expect(await getInviterOffer(await s.arrivalOf())).toBeNull();
  });

  it("is nobody when the community has turned the offer off, unless somebody was already asked", async () => {
    const s = await setUp();
    await updateCommunity(s.alice, { interviewOfferInviter: false });
    expect(await getInviterOffer(await s.arrivalOf())).toBeNull();
    await expect(askInviterToJoin(s.arrivalId)).rejects.toBeInstanceOf(ConflictError);

    await updateCommunity(s.alice, { interviewOfferInviter: true });
    await askInviterToJoin(s.arrivalId);
    await updateCommunity(s.alice, { interviewOfferInviter: false });
    expect(await getInviterOffer(await s.arrivalOf())).toMatchObject({ status: "requested" });
  });
});

describe("asking", () => {
  beforeEach(resetDatabase);

  it("is once: an answer is respected, and asking again is not a way round a no", async () => {
    const s = await setUp();
    await askInviterToJoin(s.arrivalId);
    await expect(askInviterToJoin(s.arrivalId)).rejects.toThrow(/already asked/);
    await answerCompanionRequest(s.carol, s.arrivalId, false);
    await expect(askInviterToJoin(s.arrivalId)).rejects.toThrow(/already asked/);
  });

  it("needs an interview to be at, and one that hasn't happened", async () => {
    const s = await setUp();
    await db.update(admission).set({ interviewPollId: null }).where(eq(admission.id, s.arrivalId));
    await expect(askInviterToJoin(s.arrivalId)).rejects.toThrow(/interview/);
    await db.update(admission).set({ interviewPollId: s.pollId, interviewHeldAt: new Date() }).where(eq(admission.id, s.arrivalId));
    await expect(askInviterToJoin(s.arrivalId)).rejects.toThrow(/already happened/);
  });
});

describe("the inviter's answer", () => {
  beforeEach(resetDatabase);

  it("is asked on their own dashboard, can be yes or no, and can be changed until it has happened", async () => {
    const s = await setUp();
    await askInviterToJoin(s.arrivalId);
    expect(await listMyCompanionRequests(s.carol)).toMatchObject([{ personName: "dana", status: "requested", pollId: s.pollId, confirmedStart: null }]);

    await answerCompanionRequest(s.carol, s.arrivalId, true);
    expect(await listMyCompanionRequests(s.carol)).toMatchObject([{ status: "accepted" }]);

    await answerCompanionRequest(s.carol, s.arrivalId, false);
    expect(await listMyCompanionRequests(s.carol)).toEqual([]);
    const [row] = await db.select().from(interviewCompanion).where(eq(interviewCompanion.arrivalId, s.arrivalId));
    expect(row.status).toBe("declined");

    await db.update(admission).set({ interviewHeldAt: new Date() }).where(eq(admission.id, s.arrivalId));
    await expect(answerCompanionRequest(s.carol, s.arrivalId, true)).rejects.toBeInstanceOf(ConflictError);
  });

  it("is for the person who was asked, and nobody else", async () => {
    const s = await setUp();
    await askInviterToJoin(s.arrivalId);
    await expect(answerCompanionRequest(s.bob, s.arrivalId, true)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listMyCompanionRequests(s.bob)).toEqual([]);
  });
});

describe("a companion is not an interviewer", () => {
  beforeEach(resetDatabase);

  async function accepted(s: Awaited<ReturnType<typeof setUp>>) {
    await askInviterToJoin(s.arrivalId);
    await answerCompanionRequest(s.carol, s.arrivalId, true);
  }

  it("never counts toward the holders a time needs", async () => {
    const s = await setUp();
    await accepted(s);
    const slot = inDays(2);
    await submitInterviewAvailability(await s.arrivalOf(), [slot]);
    // One holder and the companion: two people, but only one holder, and two are needed.
    await submitAvailability(s.alice, s.pollId, { slots: [slot] });
    await submitAvailability(s.carol, s.pollId, { slots: [slot] });
    expect((await getInterviewState(await s.arrivalOf())).qualifyingSlots).toEqual([]);

    await submitAvailability(s.bob, s.pollId, { slots: [slot] });
    expect((await getInterviewState(await s.arrivalOf())).qualifyingSlots).toEqual([slot]);
  });

  it("does not, even where everyone counts as a holder", () => {
    const poll = { resolutionMode: "person_plus_n_holders", minAttendance: 2, requiredParticipantIds: ["arrival-1"] } as unknown as typeof schedulingPoll.$inferSelect;
    const entry = (memberId: string | null, arrivalId: string | null) => ({ memberId, arrivalId, availableSlots: ["s"] }) as unknown as typeof import("@/db/schema").schedulingEntry.$inferSelect;
    const entries = [entry(null, "arrival-1"), entry("dave", null), entry("carol", null)];
    const open = { everyone: true, holderIds: new Set<string>(), standing: new Map<string, Set<string>>() };
    expect(computeAggregate(poll, entries, open).slots[0].qualifies).toBe(true);
    expect(computeAggregate(poll, entries, { ...open, companionIds: new Set(["carol"]) }).slots[0].qualifies).toBe(false);
    expect(computeAggregate(poll, [...entries, entry("erin", null)], { ...open, companionIds: new Set(["carol"]) }).slots[0].qualifies).toBe(true);
  });

  it("is not on the call as an interviewer, so files nothing, even having offered the very time", async () => {
    const s = await setUp();
    await accepted(s);
    const slot = inDays(2);
    await submitInterviewAvailability(await s.arrivalOf(), [slot]);
    for (const m of [s.alice, s.bob, s.carol]) await submitAvailability(m, s.pollId, { slots: [slot] });
    await confirmInterview(s.alice, s.arrivalId, slot);
    expect((await getInterviewers(await s.arrivalOf())).map((m) => m.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("is a holder when they really are one: the person who invited them can be both", async () => {
    const s = await setUp();
    const invite = await createCommunityInvite(await asMember(s.alice.id), {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "erin@example.com" });
    if (outcome.kind !== "waiting") throw new Error("expected waiting");
    await askInviterToJoin(outcome.arrivalId);
    await answerCompanionRequest(await asMember(s.alice.id), outcome.arrivalId, true);
    const arrival = (await db.select().from(admission).where(eq(admission.id, outcome.arrivalId)))[0];
    const slot = inDays(2);
    await submitInterviewAvailability(arrival, [slot]);
    await submitAvailability(await asMember(s.alice.id), arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(await asMember(s.bob.id), arrival.interviewPollId!, { slots: [slot] });
    expect((await getInterviewState(arrival)).qualifyingSlots).toEqual([slot]);
  });
});

describe("availability is preferred and never required", () => {
  beforeEach(resetDatabase);

  it("shows a note on a time a companion can't make, offers the others first, and never removes one", async () => {
    const s = await setUp();
    await askInviterToJoin(s.arrivalId);
    await answerCompanionRequest(s.carol, s.arrivalId, true);
    const early = inDays(2, 9);
    const late = inDays(2, 15);
    await submitInterviewAvailability(await s.arrivalOf(), [early, late]);
    for (const m of [s.alice, s.bob]) await submitAvailability(m, s.pollId, { slots: [early, late] });

    // Carol hasn't said when she's free: noted on both, and both still qualify.
    let state = await getInterviewState(await s.arrivalOf());
    expect(state.qualifyingSlots).toEqual([early, late]);
    expect(state.slotNotes[early]).toBe("Carol Smith hasn't said when they're free");

    // She can make the later one only: it is offered first, the early one carries the note and still qualifies.
    await submitAvailability(s.carol, s.pollId, { slots: [late] });
    state = await getInterviewState(await s.arrivalOf());
    expect(state.qualifyingSlots).toEqual([late, early]);
    expect(state.slotNotes).toEqual({ [early]: "Carol Smith can't make this one" });
  });

  it("never holds up an interview: a time is booked without them, and they are not named as coming", async () => {
    const s = await setUp();
    await askInviterToJoin(s.arrivalId);
    await answerCompanionRequest(s.carol, s.arrivalId, true);
    const slot = inDays(2);
    await submitInterviewAvailability(await s.arrivalOf(), [slot]);
    for (const m of [s.alice, s.bob]) await submitAvailability(m, s.pollId, { slots: [slot] });
    await confirmInterview(s.alice, s.arrivalId, slot);
    const state = await getInterviewState(await s.arrivalOf());
    expect(state.confirmed).not.toBeNull();
    expect(state.companionsAttending).toEqual([]);
  });

  it("is named as coming when they said yes and offered the time that was booked, and not if they declined", async () => {
    const s = await setUp();
    await askInviterToJoin(s.arrivalId);
    await answerCompanionRequest(s.carol, s.arrivalId, true);
    const slot = inDays(2);
    await submitInterviewAvailability(await s.arrivalOf(), [slot]);
    for (const m of [s.alice, s.bob, s.carol]) await submitAvailability(m, s.pollId, { slots: [slot] });
    await confirmInterview(s.alice, s.arrivalId, slot);
    expect((await getInterviewState(await s.arrivalOf())).companionsAttending).toEqual(["Carol Smith"]);

    await answerCompanionRequest(s.carol, s.arrivalId, false);
    expect((await getInterviewState(await s.arrivalOf())).companionsAttending).toEqual([]);
  });
});

describe("a shared interview", () => {
  beforeEach(resetDatabase);

  it("has everyone's accepted companions on its one poll", async () => {
    const s = await setUp();
    const invite = await createCommunityInvite(s.carol, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "erin@example.com" });
    if (outcome.kind !== "waiting") throw new Error("expected waiting");
    await db.update(admission).set({ interviewPollId: s.pollId }).where(eq(admission.id, outcome.arrivalId));
    await db.insert(interviewCompanion).values([
      { arrivalId: s.arrivalId, memberId: s.carol.id, status: "accepted" },
      { arrivalId: outcome.arrivalId, memberId: s.bob.id, status: "accepted" },
      { arrivalId: outcome.arrivalId, memberId: s.alice.id, status: "declined" },
    ]);
    expect([...(await listAcceptedCompanionIds(s.pollId))].sort()).toEqual([s.bob.id, s.carol.id].sort());
  });
});
