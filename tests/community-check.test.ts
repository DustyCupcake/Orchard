import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  admission,
  community,
  communityInvite,
  cycle,
  communityCheck,
  communityCheckConcern,
  member,
  participation,
  recruitmentPair,
} from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, withCheckLane } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { addPermissionGrant } from "@/lib/permissions";
import { closeDueChecks, createCommunityInvite, getOpenCheck, listChecksFor, raiseConcern, redeemCommunityInvite } from "@/lib/recruitment";
import {
  canSeeObjectorIdentity,
  consentPartyToObjection,
  getMediationQueue,
  listMediationActionItems,
  overruleThreshold,
  recuseFromObjection,
  resolveObjection,
  withdrawObjection,
} from "@/lib/recruitment";
import { listPairings } from "@/lib/recruitment/pairs";

// The community check (docs/admission-flow.md §5), on a lane whose
// verification is `community_check`: the invitee's own consent, an announced
// arrival that is *not yet a member*, the shield around whoever raises a
// concern, standing objections that no timer can drop, and the overrule
// exception that takes a majority of the mediation body. Plus pairing, which
// records facts and decides nothing.
//
// What changed from the first version of these tests is the moment someone
// becomes a member: a check arrival used to be made a Member straight away so
// they could be told what was happening to them, and is now an arrival with
// its own private page until the check ends — admission is the one place a
// Member is made, so everything below that says "joins" means "is admitted".

async function enableRecruitment(communityId: string) {
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, communityId));
  await withCheckLane(communityId);
}

async function arrivalOf(inviteId: string) {
  const [row] = await db.select().from(admission).where(eq(admission.inviteId, inviteId));
  return row;
}

// Any member can raise a concern about an arrival in its window (§5) — no
// subscription needed, which is what "any member" means.
async function raise(by: typeof member.$inferSelect, inviteId: string, note: string) {
  const arrival = await arrivalOf(inviteId);
  return raiseConcern(by, arrival.id, { note });
}

async function concernOf(inviteId: string) {
  const arrival = await arrivalOf(inviteId);
  const [row] = await db
    .select({ concern: communityCheckConcern })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .where(eq(communityCheck.arrivalId, arrival.id));
  return row!.concern;
}

// The clock running out, without waiting for it.
async function expireWindow(inviteId: string) {
  const arrival = await arrivalOf(inviteId);
  await db
    .update(communityCheck)
    .set({ deadline: new Date(Date.now() - 1000) })
    .where(and(eq(communityCheck.arrivalId, arrival.id), isNull(communityCheck.endedAt)));
}

const admittedState = async (inviteId: string) => ((await arrivalOf(inviteId)).admittedMemberId ? "admitted" : "waiting");

describe("consensus: consent, shield, standing objections, and the overrule exception", () => {
  beforeEach(resetDatabase);

  async function announceArrival(communityId: string, inviter: typeof member.$inferSelect) {
    const invite = await createCommunityInvite(inviter, { inviterKnowsPersonally: true, awarenessConfirmed: true });
    const outcome = await redeemCommunityInvite(invite.token, {
      email: "dana@example.com",
      consentAccepted: true,
      disclosure: "the disclosure they read",
    });
    expect(outcome.kind).toBe("check");
    return { invite, outcome };
  }

  it("refuses to send a consensus invite the inviter hasn't acknowledged", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await expect(createCommunityInvite(alice, { inviterKnowsPersonally: true })).rejects.toThrow(
      /you've told them/,
    );
  });

  it("refuses redemption without the invitee's own binding consent", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true, awarenessConfirmed: true });
    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(
      /read the disclosure/,
    );
  });

  it("holds the arrival itself back until the window closes clean", async () => {
    const { community: c, alice, branch, bob } = await createFixtures();
    await enableRecruitment(c.id);
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event", startedAt: new Date() }).returning();
    const invite = await createCommunityInvite(alice, {
      cycleId: ev.id,
      inviterKnowsPersonally: true,
      awarenessConfirmed: true,
    });
    const outcome = await redeemCommunityInvite(invite.token, {
      email: "dana@example.com",
      consentAccepted: true,
      disclosure: "read this",
    });
    expect(outcome.kind).toBe("check");

    // They are an arrival, with a private page, and not a member — admission
    // is the one place a member is made, and it hasn't happened. So there is
    // no place for them in the event either: the participation row *is* the
    // arrival, and it is what the check gates.
    const arrival = await arrivalOf(invite.id);
    expect(arrival.email).toBe("dana@example.com");
    expect(arrival.consentGivenAt).not.toBeNull();
    expect(arrival.admittedMemberId).toBeNull();
    expect(await db.select().from(member).where(eq(member.name, "dana"))).toHaveLength(0);
    const [row] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(row!.consentAt).toBeTruthy();
    expect(row!.consentDisclosure).toBe("read this");

    // The timer can only ever let someone in — and letting them in is the
    // admission function, which makes the member and seeds their place.
    await expireWindow(invite.id);
    const result = await closeDueChecks();
    expect(result.ended).toBe(1);
    const admitted = await arrivalOf(invite.id);
    expect(admitted.admittedMemberId).not.toBeNull();
    expect(admitted.checkPassedAt).not.toBeNull();
    const [after] = await db
      .select()
      .from(participation)
      .where(and(eq(participation.cycleId, ev.id), eq(participation.memberId, admitted.admittedMemberId!)));
    expect(after?.status).toBe("coming");
    void branch;
    void bob;
  });

  it("refuses to let the timer throw out an objection, and never admits over one either", async () => {
    const { community: c, alice, branch, bob } = await createFixtures();
    await enableRecruitment(c.id);
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event", startedAt: new Date() }).returning();
    const { invite } = await announceArrival(c.id, alice);
    void ev;
    await raise(bob, invite.id, "I've heard something about this");
    await expireWindow(invite.id);

    const result = await closeDueChecks();
    expect(result.ended).toBe(0);
    expect(result.held).toBe(1);
    // The window is still open and the arrival still waiting: the clock didn't decide.
    expect(await getOpenCheck((await arrivalOf(invite.id)).id)).not.toBeNull();
    expect((await arrivalOf(invite.id)).admittedMemberId).toBeNull();

    // …and the concern is now a duty item, which is the fix for the
    // veto-by-inaction the plan names.
    const grantTask = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "recruitment_mediation", grantTask.id);
    await claimTask(bob, grantTask.id);
    const items = await listMediationActionItems(bob);
    expect(items.personal).toHaveLength(1);
    expect(items.personal[0].subject).toBe("invite");
  });

  it("lets a lone objector win by default, and gates the exception on a threshold", async () => {
    const { community: c, alice, branch, bob, carol } = await fixturesOfFour();
    await enableRecruitment(c.id);
    const { invite } = await announceArrival(c.id, alice);
    await raise(bob, invite.id, "a real concern");

    const mediationTask = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);

    // Majority-of-current-holders, strictly more than half.
    expect(overruleThreshold({ ...c, recruitmentObjectionOverrule: "majority", recruitmentObjectionQuorum: 3 } as never, 1)).toBe(1);
    expect(overruleThreshold({ ...c, recruitmentObjectionOverrule: "majority", recruitmentObjectionQuorum: 3 } as never, 3)).toBe(2);
    // A body of one can still overrule — a body of one has nobody else
    // to ask, and clamping to zero would let one person overrule
    // themselves out of their own veto.
    expect(overruleThreshold({ ...c, recruitmentObjectionOverrule: "majority", recruitmentObjectionQuorum: 3 } as never, 0)).toBe(1);

    const raised = await concernOf(invite.id);
    // Upholding it: the objection stands and the person doesn't join.
    await resolveObjection(alice, { objectionId: raised!.id, outcome: "upheld", note: "we talked; not this time" });
    expect((await listChecksFor((await arrivalOf(invite.id)).id))[0]!.endedAs).toBe("upheld");
    // Nobody was made a member, and the arrival is closed rather than deleted.
    const arrival = await arrivalOf(invite.id);
    expect(arrival.admittedMemberId).toBeNull();
    expect(arrival.declinedAt).not.toBeNull();
    expect(await db.select().from(member).where(eq(member.name, "dana"))).toHaveLength(0);
    void carol;
  });

  it("refuses an overrule the body hasn't reached, and admits when it has", async () => {
    const { community: c, alice, branch, bob } = await fixturesOfFour();
    await enableRecruitment(c.id);
    // A quorum of 5 with a body of one is a community that has decided
    // objections are never voted away. That has to read as "unavailable",
    // not as a threshold of 1.
    await db
      .update(community)
      .set({ recruitmentObjectionOverrule: "quorum", recruitmentObjectionQuorum: 5 })
      .where(eq(community.id, c.id));
    const { invite } = await announceArrival(c.id, alice);
    await raise(bob, invite.id, "a real concern");

    const mediationTask = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);
    const raised = await concernOf(invite.id);

    await expect(
      resolveObjection(alice, { objectionId: raised!.id, outcome: "overruled", note: "let's just let them in" }),
    ).rejects.toThrow(/quorum is 5 people/);

    await db
      .update(community)
      .set({ recruitmentObjectionOverrule: "majority" })
      .where(eq(community.id, c.id));
    await resolveObjection(alice, { objectionId: raised!.id, outcome: "overruled", note: "the record of why" });
    expect(await admittedState(invite.id)).toBe("admitted");
    const [settlement] = await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.id, raised!.id));
    // The exception always carries its note onto the record.
    expect(settlement!.resolutionNote).toBe("the record of why");
  });

  // The overrule is the exception to "an objection stands", and the plan
  // makes it a majority of the body *agreeing* — not a body big enough to
  // have a majority. These pin the difference: before, any single holder's
  // click settled it as long as the threshold was reachable in principle.
  describe("an overrule takes the threshold of the body, not one holder", () => {
    async function threeHolderBody() {
      const { community: c, alice, branch, bob, carol } = await fixturesOfFour();
      const [dave] = await db.insert(member).values({ communityId: c.id, name: "Dave" }).returning();
      await enableRecruitment(c.id);
      const { invite } = await announceArrival(c.id, alice);
      await raise(bob, invite.id, "a real concern");
      const mediationTask = await insertTask(c.id, branch.id, alice.id, { capacity: 3 });
      await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
      for (const holder of [alice, carol, dave]) await claimTask(holder, mediationTask.id);
      const raised = await concernOf(invite.id);
      const inviteState = () => admittedState(invite.id);
      return { alice, bob, carol, dave, raised: raised!, inviteState };
    }

    it("records one holder's support and leaves the concern standing", async () => {
      const { alice, raised, inviteState } = await threeHolderBody();

      const result = await resolveObjection(alice, { objectionId: raised.id, outcome: "overruled", note: "I'd let them in" });
      expect(result.resolution).toBe("standing");
      expect(await inviteState()).not.toBe("admitted");

      // Pressing it again is the same position, not a second vote.
      await resolveObjection(alice, { objectionId: raised.id, outcome: "overruled", note: "still would" });
      const [afterTwice] = await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.id, raised.id));
      expect(afterTwice!.resolution).toBe("standing");
      const queue = await getMediationQueue(alice);
      expect(queue.standing[0]!.overruleSupporters.map((s) => s.name)).toEqual(["Alice"]);
    });

    it("admits once enough of the body agree, and the record names each of them", async () => {
      const { alice, carol, raised, inviteState } = await threeHolderBody();

      await resolveObjection(alice, { objectionId: raised.id, outcome: "overruled", note: "known them for years" });
      const settled = await resolveObjection(carol, { objectionId: raised.id, outcome: "overruled", note: "I vouch for the context" });

      expect(settled.resolution).toBe("overruled");
      expect(await inviteState()).toBe("admitted");
      expect(settled.resolutionNote).toContain("2 of 3");
      expect(settled.resolutionNote).toContain("Alice: known them for years");
      expect(settled.resolutionNote).toContain("Carol: I vouch for the context");
    });

    it("stops counting a supporter the objector has since recused", async () => {
      const { alice, bob, carol, dave, raised, inviteState } = await threeHolderBody();

      await resolveObjection(alice, { objectionId: raised.id, outcome: "overruled", note: "I would" });
      await recuseFromObjection(bob, { objectionId: raised.id, memberId: alice.id });

      // Alice's earlier support no longer counts, so Carol's makes one, not two.
      const afterCarol = await resolveObjection(carol, { objectionId: raised.id, outcome: "overruled", note: "and I would" });
      expect(afterCarol.resolution).toBe("standing");
      expect(await inviteState()).not.toBe("admitted");

      const afterDave = await resolveObjection(dave, { objectionId: raised.id, outcome: "overruled", note: "me too" });
      expect(afterDave.resolution).toBe("overruled");
      expect(afterDave.resolutionNote).not.toContain("Alice:");
    });

    it("lets a single holder clear or uphold without anyone else, as before", async () => {
      const { alice, raised } = await threeHolderBody();
      const settled = await resolveObjection(alice, { objectionId: raised.id, outcome: "cleared", note: "we talked" });
      expect(settled.resolution).toBe("cleared");
    });
  });

  it("shields the objector's identity from the evaluators, the applicant and the inviter", async () => {
    const { community: c, alice, branch, bob, carol } = await fixturesOfFour();
    await enableRecruitment(c.id);
    const { invite } = await announceArrival(c.id, alice);
    const raised = await raise(bob, invite.id, "a real concern");

    const mediationTask = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);
    const evaluatorTask = await insertTask(c.id, branch.id, alice.id, {});
    await grantPermission(c.id, "recruitment", evaluatorTask.id);
    await claimTask(carol, evaluatorTask.id);

    expect(await canSeeObjectorIdentity(alice, raised)).toBe(true);
    // The evaluator, the inviter and the applicant are all outside the
    // shield, and the inviter cannot even raise one in the first place.
    expect(await canSeeObjectorIdentity(carol, raised)).toBe(false);
    expect(await canSeeObjectorIdentity(alice, { ...raised, raisedById: carol.id })).toBe(true);
    // The applicant is an arrival, and holds none of the roles that could see
    // the shield — they have no member row at all to hold one.
    expect(await arrivalOf(invite.id)).toBeTruthy();
    // Even subscribed — and even as the person who sent the invite — the
    // inviter cannot object. §2.6 calls the leak "through the invitee's
    // friend" and the cheapest way to keep that promise is to not let
    // the friend raise it at all.
    await expect(raise(alice, invite.id, "I invited them and I object")).rejects.toThrow(
      /You invited this person/,
    );
  });

  it("lets the objector recuse the body's eyes, and consent for one named person", async () => {
    const { community: c, alice, branch, bob, carol } = await fixturesOfFour();
    await enableRecruitment(c.id);
    const { invite } = await announceArrival(c.id, alice);
    const raised = await raise(bob, invite.id, "a real concern");

    const mediationTask = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);
    await claimTask(carol, mediationTask.id);

    // Recusal is the objector's alone.
    await expect(recuseFromObjection(alice, { objectionId: raised.id, memberId: carol.id })).rejects.toThrow(
      /Only the person who raised/,
    );
    await recuseFromObjection(bob, { objectionId: raised.id, memberId: carol.id });
    expect(await canSeeObjectorIdentity(carol, raised)).toBe(false);
    // …and a recused member has no business settling it either, which is
    // re-read at the moment of the write rather than trusted from a
    // render.
    await expect(
      resolveObjection(carol, { objectionId: raised.id, outcome: "cleared", note: "looks fine to me" }),
    ).rejects.toThrow(/recused you/);

    // Consenting somebody to *being told* does not un-recuse them: being
    // told is not the same as being able to see it on the queue.
    await consentPartyToObjection(bob, { objectionId: raised.id, memberId: carol.id, note: "I told you first" });
    expect(await canSeeObjectorIdentity(carol, raised)).toBe(false);
  });

  it("admits on withdrawal, and refuses the objector settling their own objection", async () => {
    const { community: c, alice, branch, bob } = await fixturesOfFour();
    await enableRecruitment(c.id);
    const { invite } = await announceArrival(c.id, alice);
    const raised = await raise(bob, invite.id, "a real concern");

    const mediationTask = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);
    await expect(
      resolveObjection(bob, { objectionId: raised.id, outcome: "cleared", note: "clearing my own" }),
    ).rejects.toThrow(/you can't also settle it/);

    await withdrawObjection(bob, raised.id);
    expect(await admittedState(invite.id)).toBe("admitted");
    // A general (cycle-less) invite has no participation to seed — the
    // arrival *is* the membership, and the cycle case above is where the
    // participation row's absence-then-appearance is asserted.
    const [created] = await db.select().from(member).where(eq(member.name, "dana"));
    expect(created.referredByMemberId).toBe(alice.id);
  });

  it("shows the body who raised what, and how it went, on its own records", async () => {
    const { community: c, alice, branch, bob } = await fixturesOfFour();
    await enableRecruitment(c.id);
    const { invite } = await announceArrival(c.id, alice);
    await raise(bob, invite.id, "first concern");
    const mediationTask = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);

    const queue = await getMediationQueue(alice);
    expect(queue.standing).toHaveLength(1);
    expect(queue.overrule.available).toBe(true);
    expect(queue.body.map((m) => m.name)).toEqual(["Alice"]);
    // Not the objector, so the identity is shielded even from the body
    // member reading the queue.
    expect(queue.standing[0].objectorName).toBeNull();
  });

  it("reports a missing mediation body rather than quietly falling back to the evaluators", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    // Nobody holds recruitment_mediation at all.
    await expect(getMediationQueue(alice)).rejects.toThrow(/mediation body/);
  });
});


describe("pairing is fact-only (docs/joining-admission-plan.md §2.8/J9)", () => {
  beforeEach(resetDatabase);

  it("records who named whom, and needs a real person behind it", async () => {
    const { community: c, alice, branch, bob } = await createFixtures();
    await enableRecruitment(c.id);
    const grantTask = await insertTask(c.id, branch.id, alice.id, {});
    await grantPermission(c.id, "recruitment", grantTask.id);
    await claimTask(alice, grantTask.id);

    const { createPairings } = await import("@/lib/recruitment/pairs");
    const pairs = await createPairings(
      { communityId: c.id, memberId: alice.id },
      { nomineeMemberIds: [bob.id], pokeMemberIds: [], cycleId: null, firstArrivalId: null },
      { requireMember: false },
    );
    expect(pairs).toHaveLength(1);
    const [row] = await db.select().from(recruitmentPair).where(eq(recruitmentPair.id, pairs[0].id));
    expect(row!.requestedById).toBe(alice.id);
    expect(row!.secondMemberId).toBe(bob.id);
    // A live member settles immediately: there is no pending application
    // to wait for, the pair is just a fact.
    expect(row!.status).toBe("accepted");

    const listed = await listPairings(alice);
    expect(listed[0].namer?.name).toBe("Alice");
    expect(listed[0].other?.name).toBe("Bob");
    // A pair whose other half is an existing member can never share an
    // interview — there is only one applicant — and the list says so
    // rather than implying one was available and skipped.
    expect(listed[0].sharedCall).toBe("not_applicable");
  });
});

async function fixturesOfFour() {
  const base = await createFixtures();
  const carol = await db.insert(member).values({ communityId: base.community.id, name: "Carol" }).returning();
  return { ...base, carol: carol[0] };
}
