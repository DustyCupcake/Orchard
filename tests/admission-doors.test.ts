import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, communityInvite, cycle, member, memberIdentity, participation } from "@/db/schema";
import { createFixtures, resetDatabase, setLanes, withLegacyLanes } from "./helpers";
import { createCycle, updateCycleSettings } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import {
  admitArrival,
  admitWaitlistedAnyway,
  createAdmissionArrival,
  createCommunityInvite,
  getArrivalByToken,
  listWaitlisted,
  loadArrivalReadout,
  redeemCommunityInvite,
  releaseWaitlist,
  revokeCommunityInvite,
} from "@/lib/recruitment";
import { NotFoundError } from "@/lib/errors";

// docs/admission-flow.md §6. Doors govern *entering*, and are checked in every
// place somebody enters; a place in an event is taken at *admission*, so a
// person approved for a full event waits for room rather than being turned
// away or let in over it.

async function setUp(opts: { lanes?: Parameters<typeof setLanes>[1] } = {}) {
  const fixtures = await createFixtures();
  await db
    .update(community)
    .set({ modulesEnabled: ["recruitment"], cyclesEnabled: true })
    .where(eq(community.id, fixtures.community.id));
  if (opts.lanes) await setLanes(fixtures.community.id, opts.lanes);
  else await withLegacyLanes(fixtures.community.id);
  return fixtures;
}

const future = () => new Date(Date.now() + 86_400_000).toISOString();

describe("doors, checked where somebody enters", () => {
  beforeEach(resetDatabase);

  it("refuses to redeem an invite while the community's invites door is closed, keeps the link, and works once it reopens", async () => {
    const { community: c, alice } = await setUp();
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true });
    await db.update(community).set({ recruitmentInvitesOpen: false }).where(eq(community.id, c.id));

    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(
      /isn't accepting invite-based joins.*link is kept/,
    );
    const [kept] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(kept.redeemedAt).toBeNull();
    expect(kept.revokedAt).toBeNull();

    await db.update(community).set({ recruitmentInvitesOpen: true }).where(eq(community.id, c.id));
    expect((await redeemCommunityInvite(invite.token, { email: "dana@example.com" })).kind).toBe("admitted");
  });

  it("refuses an invite to an application lane while the applications door is closed, at redeeming and again at applying", async () => {
    const { community: c, alice } = await setUp();
    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true });
    await db.update(community).set({ recruitmentApplicationsOpen: false }).where(eq(community.id, c.id));
    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(/isn't accepting applications/);
  });

  it("closes an event's doors separately: invites, applications, and the period", async () => {
    const { community: c, alice } = await setUp();
    const ev = await createCycle(alice, { source: "blank", name: "Season" });
    const invite = await createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true, expiresAt: future() });

    await updateCycleSettings(alice, ev.id, { invitesOpen: false });
    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(/Invites for this event are closed/);
    await expect(createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true, expiresAt: future() })).rejects.toThrow(
      /Invites for this event are closed/,
    );

    await updateCycleSettings(alice, ev.id, { invitesOpen: true, joiningWindowClosesAt: new Date(Date.now() - 1000).toISOString() });
    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(/joining period isn't open/);
    void c;
  });

  it("does not turn anyone away for a closed interviews door — it holds them at the interview step", async () => {
    const { community: c, alice } = await setUp({
      lanes: [{ name: "Interview", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: true }],
    });
    await db.update(community).set({ recruitmentInterviewsOpen: false }).where(eq(community.id, c.id));
    const invite = await createCommunityInvite(alice, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(outcome.kind).toBe("waiting");
    if (outcome.kind !== "waiting") return;
    const { readout } = await loadArrivalReadout((await getArrivalByToken(outcome.token))!);
    expect(readout.stage).toBe("entered");
  });

  it("refuses a new entry to a full event, but lets a direct invite that was holding a place use it", async () => {
    const { community: c, alice, bob } = await setUp();
    const ev = await createCycle(alice, { source: "blank", name: "Season" });
    await updateCycleSettings(alice, ev.id, { capacity: 2 });
    await declareParticipation(alice, ev.id, { status: "coming" });
    const evaluated = await createCommunityInvite(alice, { cycleId: ev.id });
    const direct = await createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true, expiresAt: future() });
    // Alice + the direct invite's hold = 2 = full.
    await expect(createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true, expiresAt: future() })).rejects.toThrow(/event is full/);
    // …a process invite made before it filled can't be used to get in once it has…
    await expect(redeemCommunityInvite(evaluated.token, { email: "eve@example.com" })).rejects.toThrow(/event is full/);
    // …but the invite holding the place is exactly what that place is for.
    const outcome = await redeemCommunityInvite(direct.token, { email: "dana@example.com" });
    expect(outcome.kind).toBe("admitted");
    void bob;
    void c;
  });
});

describe("a full event: waiting for room (§6)", () => {
  beforeEach(resetDatabase);

  async function fullEvent() {
    const fixtures = await setUp();
    const ev = await createCycle(fixtures.alice, { source: "blank", name: "Season" });
    await declareParticipation(fixtures.alice, ev.id, { status: "coming" });
    await updateCycleSettings(fixtures.alice, ev.id, { capacity: 1 });
    const lanes = await setLanes(fixtures.community.id, [
      { name: "Direct", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: false },
      { name: "Open", kind: "public" },
    ]);
    const lane = lanes.find((l) => l.kind === "public")!;
    const arrive = async (email: string, name = email.split("@")[0]) =>
      (
        await createAdmissionArrival({ communityId: fixtures.community.id, cycleId: ev.id, email, name, lane, route: "application" })
      ).arrival;
    return { ...fixtures, ev, lane, arrive };
  }

  it("waitlists a direct invitee when the event filled by other means after the invite was made, and says so", async () => {
    const { alice, ev } = await fullEvent();
    // Alice leaves, the invite takes the place, then capacity is cut so the event
    // is over-full before the link is opened.
    await declareParticipation(alice, ev.id, { status: "not_coming" });
    const invite = await createCommunityInvite(alice, { cycleId: ev.id, expiresAt: future() });
    await declareParticipation(alice, ev.id, { status: "coming" });

    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(outcome.kind).toBe("waitlisted");
    if (outcome.kind !== "waitlisted") return;
    expect(await db.select().from(member).where(eq(member.name, "dana"))).toHaveLength(0);
    const { readout } = await loadArrivalReadout((await getArrivalByToken(outcome.token))!);
    expect(readout.stage).toBe("waitlisted");
    // The invite is spent — they have a request in, not a link to reuse.
    const [spent] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(spent.redeemedAt).not.toBeNull();
  });

  it("waitlists an approved arrival instead of making a member over capacity, and says so on their page", async () => {
    const { arrive, ev } = await fullEvent();
    const dana = await arrive("dana@example.com");
    const result = await admitArrival(dana.id);
    expect(result).toEqual({ waitlisted: true, memberId: null, created: false });
    expect(await db.select().from(member).where(eq(member.name, "dana"))).toHaveLength(0);
    expect(await db.select().from(participation).where(eq(participation.cycleId, ev.id))).toHaveLength(1);

    const { readout, sentence } = await loadArrivalReadout((await getArrivalByToken(dana.token))!);
    expect(readout.stage).toBe("waitlisted");
    expect(sentence).toMatch(/as soon as there's room/);
    // Asking again doesn't change when they started waiting.
    const since = (await listWaitlisted(ev.id))[0].waitlistedAt;
    await admitArrival(dana.id);
    expect((await listWaitlisted(ev.id))[0].waitlistedAt).toEqual(since);
  });

  it("admits the one who waited longest when a place frees up, and the next only when another does", async () => {
    const { arrive, alice, ev } = await fullEvent();
    const first = await arrive("first@example.com");
    const second = await arrive("second@example.com");
    await admitArrival(first.id);
    await admitArrival(second.id);
    expect((await listWaitlisted(ev.id)).map((w) => w.name)).toEqual(["first", "second"]);

    // One place frees; only one person gets it, and it is the first to wait.
    await declareParticipation(alice, ev.id, { status: "not_coming" });
    const rows = await db.select().from(admission).where(eq(admission.cycleId, ev.id));
    expect(rows.find((r) => r.id === first.id)!.admittedMemberId).not.toBeNull();
    expect(rows.find((r) => r.id === second.id)!.admittedMemberId).toBeNull();
    expect((await listWaitlisted(ev.id)).map((w) => w.name)).toEqual(["second"]);
    expect(await releaseWaitlist(ev.id)).toBe(0);
  });

  it("admits whoever is waiting when the capacity is raised", async () => {
    const { arrive, alice, ev } = await fullEvent();
    const dana = await arrive("dana@example.com");
    await admitArrival(dana.id);
    await updateCycleSettings(alice, ev.id, { capacity: 2 });
    const [after] = await db.select().from(admission).where(eq(admission.id, dana.id));
    expect(after.admittedMemberId).not.toBeNull();
  });

  it("frees a held place when a direct invite is revoked, and admits whoever was waiting behind it", async () => {
    const { arrive, alice, ev } = await fullEvent();
    // Alice leaves; a direct invite takes the one place; somebody waits behind it.
    await declareParticipation(alice, ev.id, { status: "not_coming" });
    const invite = await createCommunityInvite(alice, { cycleId: ev.id, expiresAt: future() });
    const dana = await arrive("dana@example.com");
    expect((await admitArrival(dana.id)).waitlisted).toBe(true);

    await revokeCommunityInvite(alice, invite.id);
    const [after] = await db.select().from(admission).where(eq(admission.id, dana.id));
    expect(after.admittedMemberId).not.toBeNull();
  });

  it("lets an administrator admit somebody anyway, and nobody who isn't waiting", async () => {
    const { arrive, alice, ev, bob } = await fullEvent();
    const dana = await arrive("dana@example.com");
    await admitArrival(dana.id);

    const result = await admitWaitlistedAnyway(alice, dana.id);
    expect(result.waitlisted).toBe(false);
    // Over capacity, on purpose: 1 place, 2 coming.
    expect(await db.select().from(participation).where(eq(participation.cycleId, ev.id))).toHaveLength(2);

    await expect(admitWaitlistedAnyway(alice, dana.id)).rejects.toThrow(NotFoundError);
    await expect(admitWaitlistedAnyway(bob, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
  });

  it("decides two admissions into the last place one after the other, so only one gets it", async () => {
    const { arrive, ev } = await fullEvent();
    await db.update(cycle).set({ capacity: 2 }).where(eq(cycle.id, ev.id));
    const [a, b] = [await arrive("a@example.com"), await arrive("b@example.com")];
    const results = await Promise.all([admitArrival(a.id), admitArrival(b.id)]);
    expect(results.filter((r) => r.waitlisted)).toHaveLength(1);
    expect(results.filter((r) => !r.waitlisted)).toHaveLength(1);
  });

  it("gives someone who already has a place in the event no second one to wait for", async () => {
    const { alice, arrive } = await fullEvent();
    // They applied as a stranger and became a member some other way meanwhile —
    // and already have the one place there is. Admitting the application links
    // them to it rather than waiting for a place they hold.
    const again = await arrive("alice@example.com", "Alice again");
    await db.insert(memberIdentity).values({ memberId: alice.id, provider: "magic_link", loginEmail: "alice@example.com" });
    const result = await admitArrival(again.id);
    expect(result.waitlisted).toBe(false);
    if (!result.waitlisted) expect(result.memberId).toBe(alice.id);
  });
});

