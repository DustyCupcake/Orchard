import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, admissionLane, community, communityInvite, cycle, member, memberIdentity, participation } from "@/db/schema";
import { createFixtures, resetDatabase, setLanes, withCheckLane, withLegacyLanes } from "./helpers";
import {
  admitArrival,
  assertEmailFreeToArrive,
  closeArrival,
  createAdmissionArrival,
  createCommunityInvite,
  getArrivalByToken,
  loadArrivalReadout,
  redeemCommunityInvite,
  withdrawArrival,
} from "@/lib/recruitment";
import { resolveConsensusWindows } from "@/lib/recruitment/consensus";
import { ConflictError } from "@/lib/errors";

// docs/admission-flow.md §4 and §6: an arrival is a person in the funnel and
// not a member; admission is the one function that makes one. These test the
// promises that make that worth having — nobody is a member early, the same
// thing happens whichever way they came in, it is safe to run twice, and the
// person's private page says the same thing the funnel believes.

async function enableRecruitment(communityId: string) {
  await db.update(community).set({ modulesEnabled: ["recruitment"], cyclesEnabled: true }).where(eq(community.id, communityId));
}

async function arrivalFor(lane: Awaited<ReturnType<typeof setLanes>>[number], email = "dana@example.com") {
  const { arrival } = await createAdmissionArrival({
    communityId: lane.communityId,
    cycleId: null,
    email,
    name: "Dana",
    lane,
    route: "application",
  });
  return arrival;
}

describe("making an arrival", () => {
  beforeEach(resetDatabase);

  it("copies the lane's path onto it, so editing the lane later never moves somebody in flight", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public", reportsNeeded: 3, supportShortcutCount: 2 }]);
    const arrival = await arrivalFor(lane);
    expect(arrival).toMatchObject({
      requiredVerification: "none",
      requiredApplication: true,
      requiredInterview: true,
      requiredEvaluation: true,
      reportsNeeded: 3,
      supportShortcutCount: 2,
      admittedMemberId: null,
    });
    // The lane is now a different lane; the arrival's path is not.
    await db.update(admissionLane).set({ applicationRequired: false, interviewRequired: false });
    const [after] = await db.select().from(admission).where(eq(admission.id, arrival.id));
    expect(after).toMatchObject({ requiredApplication: true, requiredInterview: true, reportsNeeded: 3 });
  });

  it("gives each person one private link and nobody else's", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const a = await arrivalFor(lane, "a@example.com");
    const b = await arrivalFor(lane, "b@example.com");
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect((await getArrivalByToken(a.token))?.email).toBe("a@example.com");
    expect(await getArrivalByToken("not-a-token")).toBeNull();
  });

  it("refuses an address that is already in the funnel, or already a member, with a sentence saying which", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const first = await arrivalFor(lane);
    await expect(assertEmailFreeToArrive(c.id, "DANA@example.com")).rejects.toThrow(/already a request to join/);

    await closeArrival(first.id, "declined");
    await expect(assertEmailFreeToArrive(c.id, "dana@example.com")).rejects.toThrow(/already been closed/);

    const [m] = await db.insert(member).values({ communityId: c.id, name: "Existing" }).returning();
    await db.insert(memberIdentity).values({ memberId: m.id, provider: "magic_link", loginEmail: "existing@example.com" });
    await expect(assertEmailFreeToArrive(c.id, "existing@example.com")).rejects.toThrow(/already belongs to a member/);
  });
});

describe("admitting an arrival (§6)", () => {
  beforeEach(resetDatabase);

  it("makes the member once: an identity, a way to be reached, the inviter as referrer, and the arrival pointing at them", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await withLegacyLanes(c.id);
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true });
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(outcome.kind).toBe("admitted");
    if (outcome.kind !== "admitted") return;

    const [created] = await db.select().from(member).where(eq(member.id, outcome.memberId));
    expect(created).toMatchObject({ referredByMemberId: alice.id, joinedViaInviteId: invite.id });
    const identities = await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, created.id));
    expect(identities).toMatchObject([{ provider: "magic_link", loginEmail: "dana@example.com" }]);

    const arrival = await getArrivalByToken(outcome.token);
    expect(arrival).toMatchObject({ admittedMemberId: created.id, route: "invite", inviteId: invite.id });
    const [spent] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(spent).toMatchObject({ redeemedByMemberId: created.id });
    expect(spent.redeemedAt).not.toBeNull();
  });

  it("is safe to run twice — a second trigger returns the same member rather than making another", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const arrival = await arrivalFor(lane);
    const [first, second] = await Promise.all([admitArrival(arrival.id), admitArrival(arrival.id)]);
    expect(second.memberId).toBe(first.memberId);
    expect(await db.select().from(member).where(eq(member.name, "Dana"))).toHaveLength(1);
    void c;
    expect((await admitArrival(arrival.id)).created).toBe(false);
  });

  it("seeds their place in an event only now, so a person who hasn't been admitted never counts against its room", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Event", startedAt: new Date() }).returning();
    const { arrival } = await createAdmissionArrival({
      communityId: c.id,
      cycleId: ev.id,
      email: "dana@example.com",
      name: "Dana",
      lane,
      route: "application",
    });
    expect(await db.select().from(participation).where(eq(participation.cycleId, ev.id))).toHaveLength(0);
    const { memberId } = await admitArrival(arrival.id);
    const [place] = await db.select().from(participation).where(and(eq(participation.cycleId, ev.id), eq(participation.memberId, memberId)));
    expect(place?.status).toBe("coming");
  });

  it("refuses to admit somebody who was declined or stopped", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const declined = await arrivalFor(lane, "a@example.com");
    await closeArrival(declined.id, "declined");
    await expect(admitArrival(declined.id)).rejects.toThrow(ConflictError);
    const stopped = await arrivalFor(lane, "b@example.com");
    await closeArrival(stopped.id, "withdrawn");
    await expect(admitArrival(stopped.id)).rejects.toThrow(/withdrawn/);
  });
});

describe("redeeming an invite goes through the arrival", () => {
  beforeEach(resetDatabase);

  it("makes nobody a member on a community check, and tells them where to follow it", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await withCheckLane(c.id);
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true, awarenessConfirmed: true });
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com", consentAccepted: true });
    expect(outcome.kind).toBe("check");
    if (outcome.kind !== "check") return;

    expect(await db.select().from(member).where(eq(member.name, "dana"))).toHaveLength(0);
    const arrival = (await getArrivalByToken(outcome.token))!;
    const { readout, sentence } = await loadArrivalReadout(arrival);
    // Consent was given at the door, the check is the thing it's waiting on,
    // and the sentence is the one the funnel itself would give.
    expect(readout.stage).toBe("check_pending");
    expect(sentence).toMatch(/announced/);
  });

  it("makes an interview-only lane wait for the interview, with no consent step it doesn't have", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await setLanes(c.id, [{ name: "Interview", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: true }]);
    const invite = await createCommunityInvite(alice, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(outcome.kind).toBe("waiting");
    if (outcome.kind !== "waiting") return;
    const { readout } = await loadArrivalReadout((await getArrivalByToken(outcome.token))!);
    expect(readout.stage).toBe("entered");
    expect(readout.reason).toBe("entered");
  });

  it("doesn't spend the link when the person can't be made an arrival", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await setLanes(c.id, [{ name: "Interview", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: true }]);
    const first = await createCommunityInvite(alice, {});
    await redeemCommunityInvite(first.token, { email: "dana@example.com" });

    const second = await createCommunityInvite(alice, {});
    await expect(redeemCommunityInvite(second.token, { email: "dana@example.com" })).rejects.toThrow(/already a request to join/);
    const [unspent] = await db.select().from(communityInvite).where(eq(communityInvite.id, second.id));
    expect(unspent.redeemedAt).toBeNull();
    // The same link works for somebody else.
    expect((await redeemCommunityInvite(second.token, { email: "eve@example.com" })).kind).toBe("waiting");
  });

  it("lets two simultaneous redemptions of one link through only once", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await withLegacyLanes(c.id);
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true });
    const results = await Promise.allSettled([
      redeemCommunityInvite(invite.token, { email: "a@example.com" }),
      redeemCommunityInvite(invite.token, { email: "b@example.com" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(admission)).toHaveLength(1);
  });
});

describe("stopping (the disclosure promises 'at any time')", () => {
  beforeEach(resetDatabase);

  it("ends a running community check, so its window can never admit somebody who asked to stop", async () => {
    const { community: c, alice } = await createFixtures();
    await enableRecruitment(c.id);
    await withCheckLane(c.id);
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true, awarenessConfirmed: true });
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com", consentAccepted: true });
    if (outcome.kind !== "check") throw new Error("expected a check");

    expect(await withdrawArrival(outcome.token)).toBe(true);
    await db.update(communityInvite).set({ consensusDeadline: new Date(Date.now() - 1000) }).where(eq(communityInvite.id, invite.id));
    expect((await resolveConsensusWindows()).admitted).toBe(0);
    expect(await db.select().from(member).where(eq(member.name, "dana"))).toHaveLength(0);
    const { readout } = await loadArrivalReadout((await getArrivalByToken(outcome.token))!);
    expect(readout.stage).toBe("withdrawn");
    // …and doing it twice, or after the fact, is a no-op rather than an error.
    expect(await withdrawArrival(outcome.token)).toBe(false);
  });

  it("is not available to somebody already admitted", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const arrival = await arrivalFor(lane);
    await admitArrival(arrival.id);
    expect(await withdrawArrival(arrival.token)).toBe(false);
  });
});

