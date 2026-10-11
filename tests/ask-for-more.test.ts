import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, communityCheck, communityCheckConcern, member } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, POLICY_TWO_OF_TWO, resetDatabase, withCheckLane } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { addPermissionGrant } from "@/lib/permissions";
import { createForm } from "@/lib/forms";
import { updateCommunity } from "@/lib/settings";
import {
  createCommunityInvite,
  getArrivalByToken,
  getOpenCheck,
  listChecksFor,
  listMyCommunityInvites,
  listOpenChecksForMember,
  loadArrivalReadout,
  openCheck,
  raiseConcern,
  recordDecisionIfReached,
  redeemCommunityInvite,
  resolveObjection,
  submitAskedApplication,
  submitEvaluation,
} from "@/lib/recruitment";
import { ConflictError } from "@/lib/errors";

// docs/admission-flow.md §5, "ask for more": the mediation body adds an application
// and/or a conversation to an arrival's path. Nothing is invented for it — the
// person is taken back to those steps, evaluated and decided like anyone else, and if
// the reports then lead to a wider discussion there is a second window.

async function setUp() {
  const base = await createFixtures();
  const { community: c, alice, bob, branch } = base;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  await withCheckLane(c.id);
  const form = await createForm(alice, {
    title: "Application",
    fields: [
      { key: "name", label: "Name", responseType: "text", required: true, isNameField: true },
      { key: "email", label: "Email", responseType: "text", required: true, isEmailField: true },
    ],
  });
  await updateCommunity(alice, { recruitmentApplicationFormId: form.id, ...POLICY_TWO_OF_TWO });

  // Alice and Bob are the recruitment holders, who report once they are asked to.
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  await claimTask(alice, recruitmentTask.id);
  await claimTask(bob, recruitmentTask.id);

  // Mira is the mediation body, and holds nothing else.
  const [mira] = await db.insert(member).values({ communityId: c.id, name: "Mira" }).returning();
  const mediationTask = await insertTask(c.id, branch.id, alice.id, { capacity: 1 });
  await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
  await claimTask(mira, mediationTask.id);
  const [erin] = await db.insert(member).values({ communityId: c.id, name: "Erin" }).returning();

  // Alice invites Dana, who agrees to be announced.
  const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true, awarenessConfirmed: true });
  const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com", consentAccepted: true });
  if (outcome.kind !== "check") throw new Error("expected a check");
  const arrival = (await getArrivalByToken(outcome.token))!;
  return { ...base, mira, erin, invite, arrival, token: outcome.token, form };
}

describe("asking an arrival for more", () => {
  beforeEach(resetDatabase);

  const fresh = async (id: string) => (await db.select().from(admission).where(eq(admission.id, id)))[0]!;

  it("sends them back to an application, then reads them and decides like anyone else", async () => {
    const { arrival, token, alice, bob, mira } = await setUp();
    const concern = await raiseConcern(bob, arrival.id, { note: "I'd like to know more about them" });

    const settled = await resolveObjection(mira, {
      objectionId: concern.id,
      outcome: "asked_for_more",
      note: "we'd like to read an application first",
      askApplication: true,
    });
    expect(settled.resolution).toBe("asked_for_more");

    // The window ended by asking, nobody was admitted or declined, and the path grew.
    expect(await getOpenCheck(arrival.id)).toBeNull();
    expect((await listChecksFor(arrival.id))[0]).toMatchObject({ endedAs: "asked_for_more", askedApplication: true, askedInterview: false, endedById: mira.id });
    const asked = await fresh(arrival.id);
    expect(asked).toMatchObject({ requiredApplication: true, requiredInterview: false, requiredEvaluation: true, reportsNeeded: 2, admittedMemberId: null, declinedAt: null });
    expect(asked.applicationSubmittedAt).toBeNull();

    // Their own next move, which the holders aren't chasing.
    const waiting = await loadArrivalReadout(asked, { waitingOnThePerson: true });
    expect(waiting.readout.stage).toBe("entered");

    // They send the application on their own page. It is attached to the arrival they are.
    const sent = await submitAskedApplication(token, { name: "Dana", email: "dana@example.com" });
    expect(sent.formResponseId).not.toBeNull();
    expect(sent.applicationSubmittedAt).not.toBeNull();
    await expect(submitAskedApplication(token, { name: "Dana", email: "dana@example.com" })).rejects.toThrow(ConflictError);

    // From here it is the ordinary funnel: two reports, a decision, an admission.
    await submitEvaluation(alice, sent.formResponseId!, { recommendation: "proceed" });
    await submitEvaluation(bob, sent.formResponseId!, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(alice, sent.formResponseId!);
    expect(decision!.resolution).toBe("accepted");
    expect((await fresh(arrival.id)).admittedMemberId).not.toBeNull();
  });

  it("gives them a second window if the reports lead to a wider discussion", async () => {
    const { arrival, token, alice, bob, mira } = await setUp();
    const concern = await raiseConcern(bob, arrival.id, { note: "more, please" });
    await resolveObjection(mira, { objectionId: concern.id, outcome: "asked_for_more", note: "an application", askApplication: true });
    const sent = await submitAskedApplication(token, { name: "Dana", email: "dana@example.com" });

    await submitEvaluation(alice, sent.formResponseId!, { recommendation: "proceed" });
    await submitEvaluation(bob, sent.formResponseId!, { recommendation: "unsure" });
    await recordDecisionIfReached(alice, sent.formResponseId!);

    const checks = await listChecksFor(arrival.id);
    expect(checks.map((c) => c.kind)).toEqual(["evaluation", "entry"]);
    expect(checks[0].endedAt).toBeNull();
    expect((await loadArrivalReadout(await fresh(arrival.id))).readout.stage).toBe("wider_discussion");
  });

  it("arranges a conversation once the application it is about has arrived, not before", async () => {
    const { arrival, token, bob, mira } = await setUp();
    const concern = await raiseConcern(bob, arrival.id, { note: "I'd like to talk to them" });
    await resolveObjection(mira, {
      objectionId: concern.id,
      outcome: "asked_for_more",
      note: "an application and a conversation",
      askApplication: true,
      askInterview: true,
    });
    const asked = await fresh(arrival.id);
    expect(asked).toMatchObject({ requiredApplication: true, requiredInterview: true });
    expect(asked.interviewPollId).toBeNull();

    const sent = await submitAskedApplication(token, { name: "Dana", email: "dana@example.com" });
    expect(sent.interviewPollId).not.toBeNull();
  });

  describe("refuses what makes no sense, and leaves the concern standing when it does", () => {
    it("asking for nothing", async () => {
      const { arrival, bob, mira } = await setUp();
      const concern = await raiseConcern(bob, arrival.id, { note: "a concern" });
      await expect(resolveObjection(mira, { objectionId: concern.id, outcome: "asked_for_more", note: "more" })).rejects.toThrow(/Say what you'd like to ask for/);
      expect((await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.id, concern.id)))[0].resolution).toBe("standing");
      expect(await getOpenCheck(arrival.id)).not.toBeNull();
    });

    it("a conversation alone, because reports are written about an application", async () => {
      const { arrival, bob, mira } = await setUp();
      const concern = await raiseConcern(bob, arrival.id, { note: "a concern" });
      await expect(
        resolveObjection(mira, { objectionId: concern.id, outcome: "asked_for_more", note: "talk", askInterview: true }),
      ).rejects.toThrow(/only be asked for together with one/);
      expect((await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.id, concern.id)))[0].resolution).toBe("standing");
    });

    it("after the reports: the application and the conversation were had, so there is nothing more to ask for", async () => {
      const { arrival, bob, mira } = await setUp();
      // The entry window is over and the reports have led to a wider discussion.
      await db
        .update(communityCheck)
        .set({ endedAt: new Date(), endedAs: "closed" })
        .where(eq(communityCheck.arrivalId, arrival.id));
      await openCheck(arrival, "evaluation", "admit");
      const concern = await raiseConcern(bob, arrival.id, { note: "a concern" });
      await expect(
        resolveObjection(mira, { objectionId: concern.id, outcome: "asked_for_more", note: "more", askApplication: true }),
      ).rejects.toThrow(/nothing more to ask for/);
      expect((await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.id, concern.id)))[0].resolution).toBe("standing");
    });
  });
});

describe("what the people around an arrival can see of its window", () => {
  beforeEach(resetDatabase);

  it("tells the inviter the window is open, and who may raise a concern about it", async () => {
    const { alice, bob, erin, invite } = await setUp();
    expect((await listMyCommunityInvites(alice))[0]).toMatchObject({ id: invite.id, checkState: "open" });

    // Any member sees it and may raise a concern, except whoever invited them.
    const forBob = await listOpenChecksForMember(bob);
    expect(forBob).toHaveLength(1);
    expect(forBob[0]).toMatchObject({ kind: "entry", mayRaise: { ok: true } });
    expect((await listOpenChecksForMember(erin))[0].mayRaise).toEqual({ ok: true });
    expect((await listOpenChecksForMember(alice))[0].mayRaise).toEqual({ ok: false, reason: "You invited this person." });
  });

  it("lets a member see theirs, and withdraw it, without anyone else learning it was theirs", async () => {
    const { arrival, bob, erin } = await setUp();
    const concern = await raiseConcern(bob, arrival.id, { note: "a concern" });

    const mine = (await listOpenChecksForMember(bob))[0];
    expect(mine.mayRaise).toMatchObject({ ok: false });
    expect(mine.myStandingConcernId).toBe(concern.id);
    // Erin raised nothing, so she is told nothing about whose it was.
    expect((await listOpenChecksForMember(erin))[0].myStandingConcernId).toBeNull();
  });

  it("tells the inviter that the arrival was not admitted, and nothing about why", async () => {
    const { alice, bob, mira, arrival } = await setUp();
    const concern = await raiseConcern(bob, arrival.id, { note: "a concern" });
    await resolveObjection(mira, { objectionId: concern.id, outcome: "upheld", note: "it stands" });
    expect((await listMyCommunityInvites(alice))[0].checkState).toBe("declined");
  });
});
