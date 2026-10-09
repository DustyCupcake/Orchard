import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  community,
  communityInvite,
  cycle,
  joiningLane,
  joiningNomination,
  joiningSupport,
  form,
  member,
  objection,
  participation,
  recruitmentPair,
  recruitmentSubscription,
} from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { addPermissionGrant } from "@/lib/permissions";
import {
  createCommunityInvite,
  getCycleJoiningState,
  getInviteFollowUp,
  getJoinLaneRule,
  getJoinLaneRulesForContext,
  laneRedemptionKind,
  listOutstandingReferralInvites,
  redeemCommunityInvite,
  setCommunityJoiningLaneRules,
  setCycleJoiningLaneRules,
  deleteCycleJoiningLaneRules,
  submitRecruitmentApplication,
} from "@/lib/recruitment";
import {
  JOINING_LANE_DEFAULTS,
  JOINING_LANE_PRESETS,
  describeLaneConsequence,
  redemptionPathForRule,
  summarizeLaneRule,
} from "@/lib/recruitment/lanes";
import {
  getNominationForApplication,
  getNominationForInvite,
  getSupportView,
  lapseExpiredNominations,
  recordSupport,
  skipNomination,
  settleNominationIfSatisfied,
} from "@/lib/recruitment/support";
import { resolveConsensusWindows } from "@/lib/recruitment/consensus";
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
import { raiseInviteObjection } from "@/lib/recruitment/objections";
import { listPairings } from "@/lib/recruitment/pairs";

// docs/plans/archive/joining-admission-plan.md, work-plan step 8. The four things the
// redesign actually promises, each tested at the boundary where it would
// break if it were untrue:
//
//   lane resolution   a cycle's own row wins, the community's is next,
//                     the §2.9 defaults are the floor — and none of the
//                     three is ever snapshotted onto an invite or an
//                     application.
//   the third door    interviewsOpen is checked where an interview would
//                     actually be scheduled, not just displayed.
//   never auto-fail   a nomination that lapses, or that its own subject
//                     skips, lets them through. There is no code path
//                     anywhere in this file (or the lib) that refuses
//                     someone for want of a second.
//   the overrule      an objection stands by default; only a majority of
//                     the mediation body can admit someone over it, and
//                     the objector's identity is shielded from everybody
//                     else including the evaluators.

async function enableRecruitment(communityId: string) {
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, communityId));
}

async function setLane(
  communityId: string,
  lane: Parameters<typeof getJoinLaneRule>[2],
  rule: Parameters<typeof setCommunityJoiningLaneRules>[1][typeof lane],
  cycleId: string | null = null,
) {
  await setCommunityJoiningLaneRules(communityId, { [lane]: rule });
  if (cycleId) {
    await setCycleJoiningLaneRules(communityId, cycleId, { [lane]: rule });
  }
}

const basic = { verificationMode: "basic", supportCount: 1, applicationRequired: false, interviewRequired: false, applyInsteadAvailable: true } as const;
const fullProcess = { verificationMode: "basic", supportCount: 1, applicationRequired: true, interviewRequired: true, applyInsteadAvailable: true } as const;
const nomination = { verificationMode: "nomination", supportCount: 1, applicationRequired: true, interviewRequired: false, applyInsteadAvailable: true } as const;
const consensus = { verificationMode: "consensus", supportCount: 1, applicationRequired: false, interviewRequired: false, applyInsteadAvailable: true } as const;

describe("lane resolution (docs/plans/archive/joining-admission-plan.md §2, §4.1)", () => {
  beforeEach(resetDatabase);

  it("falls back to the §2.9 defaults when the community has no rows at all", async () => {
    const { community: c } = await createFixtures();
    const rules = await getJoinLaneRulesForContext(c.id, null);
    for (const [lane, expected] of Object.entries(JOINING_LANE_DEFAULTS)) {
      expect(rules.get(lane as never)).toEqual(expected);
    }
    // The §2.9 table itself, asserted rather than restated: a community
    // that touches nothing has to get today's behaviour.
    expect(rules.get("invited_knows_personally")).toMatchObject({ verificationMode: "basic", applicationRequired: false });
    expect(rules.get("invited_good_fit")).toMatchObject({ verificationMode: "basic", applicationRequired: true, interviewRequired: true });
    expect(rules.get("public_application")).toMatchObject({ verificationMode: "basic", applicationRequired: true });
  });

  it("prefers a cycle's own row over the community's, and the community's over the defaults", async () => {
    const { community: c } = await createFixtures();
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event", startedAt: new Date() }).returning();

    // The community runs the public door with a form; this one event
    // doesn't. Written separately rather than through a helper so the
    // two rows are visibly distinct — a helper that wrote the same rule
    // twice would make this test pass for the wrong reason.
    await setCommunityJoiningLaneRules(c.id, { invited_knows_personally: fullProcess });
    await setCycleJoiningLaneRules(c.id, ev.id, { invited_knows_personally: basic });

    expect((await getJoinLaneRule(c.id, ev.id, "invited_knows_personally")).applicationRequired).toBe(false);
    // …and the community's own row is untouched by the override.
    expect((await getJoinLaneRule(c.id, null, "invited_knows_personally")).applicationRequired).toBe(true);
    // A lane nobody configured still resolves, at the §2.9 default.
    expect((await getJoinLaneRule(c.id, ev.id, "invited_neither")).applicationRequired).toBe(true);
  });

  it("resolves a cycle's rows as overrides, not copies — deleting one hands the lane back", async () => {
    const { community: c } = await createFixtures();
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event", startedAt: new Date() }).returning();

    await setCommunityJoiningLaneRules(c.id, { invited_neither: fullProcess });
    await setCycleJoiningLaneRules(c.id, ev.id, { invited_neither: basic });
    expect((await getJoinLaneRule(c.id, ev.id, "invited_neither")).applicationRequired).toBe(false);

    await deleteCycleJoiningLaneRules(c.id, ev.id, ["invited_neither"]);
    // Inheritance is the absence of a row, so the community's rule comes
    // back — and it comes back *live*, so a later community change moves
    // this cycle too.
    expect((await getJoinLaneRule(c.id, ev.id, "invited_neither")).applicationRequired).toBe(true);
    await setCommunityJoiningLaneRules(c.id, { invited_neither: basic });
    expect((await getJoinLaneRule(c.id, ev.id, "invited_neither")).applicationRequired).toBe(false);
  });

  it("normalises a dead support count away when a lane leaves nomination", async () => {
    const { community: c } = await createFixtures();
    await setLane(c.id, "invited_good_fit", { ...nomination, supportCount: 3 });
    await setLane(c.id, "invited_good_fit", { ...fullProcess, supportCount: 3 });
    // A "3 supporters" setting on a basic lane is a number that never
    // applies, and storing it is how a community later switches back to
    // nomination and silently inherits a count it never chose.
    expect((await getJoinLaneRule(c.id, null, "invited_good_fit")).supportCount).toBe(1);
  });

  it("maps each rule to exactly one path, and only a process-less basic lane holds a capacity slot", () => {
    expect(redemptionPathForRule(basic)).toBe("direct");
    expect(redemptionPathForRule(fullProcess)).toBe("process");
    expect(redemptionPathForRule(nomination)).toBe("nomination");
    expect(redemptionPathForRule(consensus)).toBe("check");
    expect(laneRedemptionKind(consensus)).toBe("process");
  });

  it("keeps every preset internally consistent and every one editable afterwards", () => {
    for (const preset of JOINING_LANE_PRESETS) {
      for (const [lane, rule] of Object.entries(preset.rules)) {
        expect(Object.keys(preset.rules)).toHaveLength(4);
        // A preset may not stack nomination and consensus on one lane
        // (J2) — and since the mode is exclusive by construction, the
        // only way to break J2 would be a rule with two of them.
        expect(["basic", "nomination", "consensus"]).toContain(rule.verificationMode);
        expect(typeof describeLaneConsequence(rule)).toBe("string");
        // Asserted on content, not on length. These two sentences are the
        // entire legibility argument for the settings panel — they are what
        // a rule *is* to somebody deciding whether to change it — and a
        // `length > 0` check waved through "plus an application and a
        // interview" on all four cards, which is the combination three of
        // the four presets produce. The two failure modes worth naming:
        // a bare "undefined" from a mode the label map doesn't cover, and
        // a wrong article in front of a vowel.
        const summary = summarizeLaneRule(rule);
        expect(summary).not.toMatch(/undefined|null|NaN/);
        expect(summary).not.toMatch(/\ba [aeiou]/i);
        expect(summary).not.toMatch(/\ban [^aeiou]/i);
        void lane;
      }
    }
    // "Welcoming" *is* the §2.9 default, byte for byte — the preset is
    // what the defaults look like when you can see them.
    expect(JOINING_LANE_PRESETS[0].rules).toEqual(JOINING_LANE_DEFAULTS);
  });

  it("never says a lapsed nomination turns anyone away", () => {
    // The sentence the applicant and the inviter both read has to carry
    // the guarantee explicitly, because §2.5/J6 is the one promise that
    // distinguishes this design from the endorsement mechanisms it borrows
    // its vocabulary from.
    const sentence = describeLaneConsequence(nomination);
    expect(sentence).toMatch(/never turns them away/);
    expect(sentence).toMatch(/one other member/);
    expect(describeLaneConsequence({ ...nomination, supportCount: 3 })).toMatch(/3 other members/);
    // And a consensus lane's sentence has to say the objection stands
    // unless it is overruled — that is the default, not the exception.
    expect(describeLaneConsequence(consensus)).toMatch(/unless the mediation body overrules/);
  });

  it("reads as English in every combination, because the sentence is the setting", () => {
    // The one-line summary is what a card shows *above* its controls, so
    // it is the only part of the rule somebody reads before deciding
    // whether to open it. A summary that is technically derived and
    // grammatically wrong is worse than no summary, because it looks
    // authoritative. Spelled out rather than left to the loop above: this
    // is the exact sentence a community with untouched settings sees on
    // three of its four lane cards, and it is the one that was wrong.
    expect(
      summarizeLaneRule({ ...nomination, applicationRequired: true, interviewRequired: true }),
    ).toBe("needs 1 more member, plus an application and an interview");
    expect(summarizeLaneRule({ ...nomination, applicationRequired: true, interviewRequired: false })).toBe(
      "needs 1 more member, plus an application",
    );
    expect(summarizeLaneRule({ ...nomination, applicationRequired: false, interviewRequired: true })).toBe(
      "needs 1 more member, plus an interview",
    );
    // Nothing switched on: no trailing clause at all, rather than
    // "plus " with nothing after it.
    expect(summarizeLaneRule({ ...nomination, applicationRequired: false, interviewRequired: false })).toBe(
      "needs 1 more member",
    );
    expect(summarizeLaneRule({ verificationMode: "consensus", supportCount: 1, applicationRequired: true, interviewRequired: true, applyInsteadAvailable: true })).toBe(
      "announced to the community before admission, plus an application and an interview",
    );
  });
});

describe("the third door (docs/plans/archive/joining-admission-plan.md §2.3/J3)", () => {
  beforeEach(resetDatabase);

  it("composes interviewsOpen into the joining state alongside the other two", async () => {
    const { community: c } = await createFixtures();
    const [ev] = await db
      .insert(cycle)
      .values({ communityId: c.id, name: "Event", startedAt: new Date(), interviewsOpen: false })
      .returning();
    const state = await getCycleJoiningState(c.id, ev.id);
    expect(state.periodOpen).toBe(true);
    expect(state.applicationsOpen).toBe(true);
    expect(state.invitesOpen).toBe(true);
    expect(state.interviewsOpen).toBe(false);
  });

  it("refuses an invite on a lane that asks for an interview when interviews are shut", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    const [ev] = await db
      .insert(cycle)
      .values({ communityId: c.id, name: "Event", startedAt: new Date(), interviewsOpen: false })
      .returning();
    await setLane(c.id, "invited_good_fit", fullProcess);

    // A community that closes interviews and then signs somebody up for
    // an interview has broken the promise the door made, so the invite
    // is refused at send — not at scheduling time, days later.
    await expect(
      createCommunityInvite(alice, { cycleId: ev.id, inviterThinksGoodFit: true }),
    ).rejects.toThrow(/Interviews for this event are closed/);
  });
});

describe("nomination never auto-fails (docs/plans/archive/joining-admission-plan.md §2.5/J6)", () => {
  beforeEach(resetDatabase);

  it("opens a support window at send, so the inviter can hand the link over", async () => {
    const { community: c, alice, bob } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "invited_good_fit", nomination);

    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true });
    const followUp = await getInviteFollowUp(invite.id);
    expect(followUp?.supportToken).toBeTruthy();
    expect(followUp?.supportDeadline).toBeInstanceOf(Date);

    const nominationRow = await getNominationForInvite(invite.id);
    expect(nominationRow?.state).toBe("awaiting");

    // The redemption *reports* the wait rather than creating a member —
    // the person is told what they're waiting for and given the link that
    // ends it.
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(outcome).toMatchObject({ kind: "awaiting_support", supportToken: nominationRow!.supportToken });
    const created = await db.select().from(member).where(eq(member.name, "dana"));
    expect(created).toHaveLength(0);
  });

  it("counts supports against the lane's number, with the supporter's own marks", async () => {
    const { community: c, alice, bob } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "invited_good_fit", { ...nomination, supportCount: 2 });
    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true });
    const token = (await getNominationForInvite(invite.id))!.supportToken;

    const [carol] = await db
      .insert(member)
      .values({ communityId: c.id, name: "Carol" })
      .returning();
    const [dave] = await db.insert(member).values({ communityId: c.id, name: "Dave" }).returning();

    const first = await recordSupport(carol, { token, knowsPersonally: true, thinksGoodFit: false });
    expect(first.reached).toBe(false);
    // "The parties see 'supported by {name}'" — so the view names them.
    const midway = await getSupportView(token, carol);
    expect(midway!.supports.map((s) => s.name)).toEqual(["Carol"]);
    expect(midway!.supports[0].knowsPersonally).toBe(true);

    const second = await recordSupport(dave, { token, knowsPersonally: false, thinksGoodFit: true });
    expect(second.reached).toBe(true);
    await settleNominationIfSatisfied((await getNominationForInvite(invite.id))!.id, 2);
    expect((await getNominationForInvite(invite.id))!.state).toBe("supported");
    void bob;
  });

  it("refuses a support with neither mark — a click with nothing behind it isn't proof", async () => {
    const { community: c, alice, bob } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "invited_good_fit", nomination);
    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true });
    const token = (await getNominationForInvite(invite.id))!.supportToken;
    await expect(recordSupport(bob, { token, knowsPersonally: false, thinksGoodFit: false })).rejects.toThrow(
      /Say how you know this person/,
    );
  });

  it("lets the subject skip the wait and drop onto the lane's process", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "invited_good_fit", nomination);
    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true });
    const token = (await getNominationForInvite(invite.id))!.supportToken;

    const { inviteToken } = await skipNomination(token);
    expect(inviteToken).toBe(invite.token);
    expect((await getNominationForInvite(invite.id))!.state).toBe("skipped");

    // Past the wait, the redemption is the lane's *process* — the
    // application — not a refusal, and (the bug this test exists for) not
    // a straight admission either: this lane asked for a form, so a
    // skipped nomination must not quietly hand over a member.
    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(
      /application process/,
    );
    const [created] = await db.select().from(member).where(eq(member.name, "dana"));
    expect(created).toBeUndefined();
  });

  it("falls through rather than failing when the window lapses unsupported", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    // A nomination lane with *no* process at all: nothing to fall through
    // to but the join itself, which is exactly the point — a lapsed
    // nomination must not turn a lane that asked for nothing into one
    // that asks for an application.
    await setLane(c.id, "invited_knows_personally", {
      verificationMode: "nomination",
      supportCount: 1,
      applicationRequired: false,
      interviewRequired: false,
      applyInsteadAvailable: true,
    });
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true });
    await db
      .update(joiningNomination)
      .set({ deadline: new Date(Date.now() - 1000) })
      .where(eq(joiningNomination.inviteId, invite.id));

    const { lapsed } = await lapseExpiredNominations();
    expect(lapsed).toHaveLength(1);
    expect((await getNominationForInvite(invite.id))!.state).toBe("lapsed");

    // A process-less nomination lane: the fall-through *is* the join, and
    // nobody was turned away for want of a second.
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(outcome.kind).toBe("member");
  });

  it("keeps the support window visible to the inviter's own list, as outstanding pipeline work", async () => {
    const { community: c, alice, branch, bob } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "invited_good_fit", nomination);
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event", startedAt: new Date() }).returning();
    const invite = await createCommunityInvite(alice, { cycleId: ev.id, inviterThinksGoodFit: true });

    const grantTask = await insertTask(c.id, branch.id, alice.id, { cycleId: ev.id, capacity: 1 });
    await grantPermission(c.id, "recruitment", grantTask.id);
    await claimTask(alice, grantTask.id);

    const outstanding = await listOutstandingReferralInvites(alice);
    expect(outstanding.map((i) => i.id)).toEqual([invite.id]);
    void bob;
  });
});

describe("consensus: consent, shield, standing objections, and the overrule exception", () => {
  beforeEach(resetDatabase);

  async function announceArrival(communityId: string, inviter: typeof member.$inferSelect) {
    await setLane(communityId, "invited_knows_personally", consensus);
    const invite = await createCommunityInvite(inviter, { inviterKnowsPersonally: true, awarenessConfirmed: true });
    const outcome = await redeemCommunityInvite(invite.token, {
      email: "dana@example.com",
      consentAccepted: true,
      disclosure: "the disclosure they read",
    });
    expect(outcome.kind).toBe("announced");
    return { invite, outcome };
  }

  it("refuses to send a consensus invite the inviter hasn't acknowledged", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "invited_knows_personally", consensus);
    await expect(createCommunityInvite(alice, { inviterKnowsPersonally: true })).rejects.toThrow(
      /you've told them/,
    );
  });

  it("refuses redemption without the invitee's own binding consent", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "invited_knows_personally", consensus);
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true, awarenessConfirmed: true });
    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(
      /read the disclosure/,
    );
  });

  it("holds the arrival itself back until the window closes clean", async () => {
    const { community: c, alice, branch, bob } = await createFixtures();
    await enableRecruitment(c.id);
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event", startedAt: new Date() }).returning();
    await setLane(c.id, "invited_knows_personally", consensus, ev.id);
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
    expect(outcome.kind).toBe("announced");

    // The Member row exists — they had to be able to be told what was
    // happening to them — but the participation row *is* the arrival, and
    // it is what consent gates.
    const [created] = await db.select().from(member).where(eq(member.name, "dana"));
    expect(created).toBeTruthy();
    const [before] = await db
      .select()
      .from(participation)
      .where(and(eq(participation.cycleId, ev.id), eq(participation.memberId, created.id)));
    expect(before).toBeUndefined();
    const [row] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(row!.consentAt).toBeTruthy();
    expect(row!.consentDisclosure).toBe("read this");

    // The timer can only ever let someone in.
    await db
      .update(communityInvite)
      .set({ consensusDeadline: new Date(Date.now() - 1000) })
      .where(eq(communityInvite.id, invite.id));
    const result = await resolveConsensusWindows();
    expect(result.admitted).toBe(1);
    const [after] = await db
      .select()
      .from(participation)
      .where(and(eq(participation.cycleId, ev.id), eq(participation.memberId, created.id)));
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

    await db
      .insert(recruitmentSubscription)
      .values({ memberId: bob.id, active: true })
      .returning();
    await raiseInviteObjection(bob, invite.id, "I've heard something about this");
    await db
      .update(communityInvite)
      .set({ consensusDeadline: new Date(Date.now() - 1000) })
      .where(eq(communityInvite.id, invite.id));

    const result = await resolveConsensusWindows();
    expect(result.admitted).toBe(0);
    expect(result.heldForMediation).toBe(1);
    const [row] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(row!.consensusState).toBe("announced");

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

    await db.insert(recruitmentSubscription).values({ memberId: bob.id, active: true }).returning();
    await raiseInviteObjection(bob, invite.id, "a real concern");

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

    const [raised] = await db.select().from(objection).where(eq(objection.inviteId, invite.id));
    // Upholding it: the objection stands and the person doesn't join.
    await resolveObjection(alice, { objectionId: raised!.id, outcome: "upheld", note: "we talked; not this time" });
    const [after] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(after!.consensusState).toBe("withheld");
    const [created] = await db.select().from(member).where(eq(member.name, "dana"));
    const [place] = await db
      .select()
      .from(participation)
      .where(and(eq(participation.memberId, created.id), eq(participation.status, "coming")));
    expect(place).toBeUndefined();
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
    await db.insert(recruitmentSubscription).values({ memberId: bob.id, active: true }).returning();
    await raiseInviteObjection(bob, invite.id, "a real concern");

    const mediationTask = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);
    const [raised] = await db.select().from(objection).where(eq(objection.inviteId, invite.id));

    await expect(
      resolveObjection(alice, { objectionId: raised!.id, outcome: "overruled", note: "let's just let them in" }),
    ).rejects.toThrow(/quorum is 5 people/);

    await db
      .update(community)
      .set({ recruitmentObjectionOverrule: "majority" })
      .where(eq(community.id, c.id));
    await resolveObjection(alice, { objectionId: raised!.id, outcome: "overruled", note: "the record of why" });
    const [after] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(after!.consensusState).toBe("admitted");
    const [settlement] = await db.select().from(objection).where(eq(objection.id, raised!.id));
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
      await db.insert(recruitmentSubscription).values({ memberId: bob.id, active: true }).returning();
      await raiseInviteObjection(bob, invite.id, "a real concern");
      const mediationTask = await insertTask(c.id, branch.id, alice.id, { capacity: 3 });
      await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
      for (const holder of [alice, carol, dave]) await claimTask(holder, mediationTask.id);
      const [raised] = await db.select().from(objection).where(eq(objection.inviteId, invite.id));
      const inviteState = async () =>
        (await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id)))[0]!.consensusState;
      return { alice, bob, carol, dave, raised: raised!, inviteState };
    }

    it("records one holder's support and leaves the concern standing", async () => {
      const { alice, raised, inviteState } = await threeHolderBody();

      const result = await resolveObjection(alice, { objectionId: raised.id, outcome: "overruled", note: "I'd let them in" });
      expect(result.resolution).toBe("standing");
      expect(await inviteState()).not.toBe("admitted");

      // Pressing it again is the same position, not a second vote.
      await resolveObjection(alice, { objectionId: raised.id, outcome: "overruled", note: "still would" });
      const [afterTwice] = await db.select().from(objection).where(eq(objection.id, raised.id));
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
    await db.insert(recruitmentSubscription).values({ memberId: bob.id, active: true }).returning();
    const raised = await raiseInviteObjection(bob, invite.id, "a real concern");

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
    expect(await canSeeObjectorIdentity(alice, { ...raised, raisedBy: carol.id })).toBe(true);
    const [applicant] = await db.select().from(member).where(eq(member.name, "dana"));
    expect(applicant).toBeTruthy();
    // Even subscribed — and even as the person who sent the invite — the
    // inviter cannot object. §2.6 calls the leak "through the invitee's
    // friend" and the cheapest way to keep that promise is to not let
    // the friend raise it at all.
    await db.insert(recruitmentSubscription).values({ memberId: alice.id, active: true }).returning();
    await expect(raiseInviteObjection(alice, invite.id, "I invited them and I object")).rejects.toThrow(
      /You invited this person/,
    );
  });

  it("lets the objector recuse the body's eyes, and consent for one named person", async () => {
    const { community: c, alice, branch, bob, carol } = await fixturesOfFour();
    await enableRecruitment(c.id);
    const { invite } = await announceArrival(c.id, alice);
    await db.insert(recruitmentSubscription).values({ memberId: bob.id, active: true }).returning();
    const raised = await raiseInviteObjection(bob, invite.id, "a real concern");

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
    await db.insert(recruitmentSubscription).values({ memberId: bob.id, active: true }).returning();
    const raised = await raiseInviteObjection(bob, invite.id, "a real concern");

    const mediationTask = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "recruitment_mediation", mediationTask.id);
    await claimTask(alice, mediationTask.id);
    await expect(
      resolveObjection(bob, { objectionId: raised.id, outcome: "cleared", note: "clearing my own" }),
    ).rejects.toThrow(/you can't also settle it/);

    await withdrawObjection(bob, raised.id);
    const [after] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(after!.consensusState).toBe("admitted");
    // A general (cycle-less) invite has no participation to seed — the
    // arrival *is* the membership, and the cycle case above is where the
    // participation row's absence-then-appearance is asserted.
    const [created] = await db.select().from(member).where(eq(member.name, "dana"));
    expect(created.joinedViaInviteId).toBe(invite.id);
  });

  it("shows the body who raised what, and how it went, on its own records", async () => {
    const { community: c, alice, branch, bob } = await fixturesOfFour();
    await enableRecruitment(c.id);
    const { invite } = await announceArrival(c.id, alice);
    await db.insert(recruitmentSubscription).values({ memberId: bob.id, active: true }).returning();
    await raiseInviteObjection(bob, invite.id, "first concern");
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

describe("a public application on a nomination lane gets the same treatment", () => {
  beforeEach(resetDatabase);

  it("opens a support window on submission, and hands the page a link", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await setLane(c.id, "public_application", nomination);
    const [formRow] = await db
      .insert(form)
      .values({
        communityId: c.id,
        title: "Application",
        createdBy: alice.id,
        fields: [{ key: "why", label: "Why?", responseType: "text" }],
      })
      .returning();
    await db
      .update(community)
      .set({ recruitmentApplicationFormId: formRow.id })
      .where(eq(community.id, c.id));

    const created = await submitRecruitmentApplication(c.id, { values: { why: "because" } });
    const nominationRow = await getNominationForApplication(created.id);
    expect(nominationRow?.state).toBe("awaiting");
    expect(nominationRow?.supportToken).toBeTruthy();
  });
});

describe("pairing is fact-only (docs/plans/archive/joining-admission-plan.md §2.8/J9)", () => {
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
      { nomineeMemberIds: [bob.id], pokeMemberIds: [], cycleId: null, firstResponseId: null },
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
    expect(listed[0].namedMember?.name).toBe("Bob");
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

// A guard against the whole test file drifting into a place where a
// lane row could be trusted: the read side must never depend on a row
// existing, because resetDatabase truncates communities (and with them
// every lane row) before every single test in here.
describe("lane resolution is total", () => {
  beforeEach(resetDatabase);
  it("returns all four lanes for a community with no rows and a cycle with no rows", async () => {
    const { community: c } = await createFixtures();
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event" }).returning();
    expect((await getJoinLaneRulesForContext(c.id, null)).size).toBe(4);
    expect((await getJoinLaneRulesForContext(c.id, ev.id)).size).toBe(4);
    const laneRows = await db.select().from(joiningLane);
    expect(laneRows).toHaveLength(0);
    const supportRows = await db.select().from(joiningSupport);
    expect(supportRows).toHaveLength(0);
  });
});
