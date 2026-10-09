import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, member, memberIdentity, objection, recruitmentDecision } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import { updateCommunity } from "@/lib/settings";
import { createCycle, updateCycleSettings } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import {
  createAdmissionArrival,
  createCommunityInvite,
  getArrivalByToken,
  getSupportView,
  listMyInviteesInFlight,
  listSupports,
  listSupportsForApplication,
  pokeForSupport,
  recordSupport,
  redeemCommunityInvite,
  submitRecruitmentApplication,
  trySupportShortcut,
  withdrawArrival,
} from "@/lib/recruitment";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

// docs/admission-flow.md §2, "The support shortcut". N members' word skips what's
// left of the path and admits — for a public applicant as well as an invitee —
// runs alongside the path rather than in front of it, never counts the person or
// whoever invited them, and never skips past a standing concern.

const applicationFields = [
  { key: "name", label: "Name", responseType: "text" as const, required: true, isNameField: true },
  { key: "email", label: "Email", responseType: "text" as const, required: true, isEmailField: true },
];

async function setUp(shortcut: number | null = 2) {
  const fixtures = await createFixtures();
  const { community: c, alice, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"], cyclesEnabled: true }).where(eq(community.id, c.id));
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
  const [dave] = await db.insert(member).values({ communityId: c.id, name: "Dave" }).returning();
  const form = await createForm(alice, { title: "Application", fields: applicationFields });
  await updateCommunity(alice, { recruitmentApplicationFormId: form.id });
  await setLanes(c.id, [
    { name: "Invited", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: true, supportShortcutCount: shortcut },
    { name: "Open", kind: "public", supportShortcutCount: shortcut },
  ]);
  const apply = async (name: string, extra: Partial<Parameters<typeof submitRecruitmentApplication>[1]> = {}) =>
    submitRecruitmentApplication(c.id, { values: { name, email: `${name.toLowerCase()}@example.com` }, ...extra });
  return { ...fixtures, carol, dave, apply, branch };
}

const knows = { knowsPersonally: true, thinksGoodFit: false };

describe("the shortcut for a public applicant", () => {
  beforeEach(resetDatabase);

  it("admits them once N members have vouched, and not before — the path is theirs until then", async () => {
    const { community: c, bob, carol, apply } = await setUp(2);
    const application = await apply("Dana");
    const arrival = (await getArrivalByToken(application.token))!;

    const first = await recordSupport(bob, { supportToken: arrival.supportToken, ...knows });
    expect(first).toMatchObject({ reached: false, admitted: null });
    expect(await db.select().from(member).where(eq(member.name, "Dana"))).toHaveLength(0);

    const second = await recordSupport(carol, { supportToken: arrival.supportToken, thinksGoodFit: true });
    expect(second.reached).toBe(true);
    expect(second.admitted).toMatchObject({ waitlisted: false });

    const [after] = await db.select().from(admission).where(eq(admission.id, arrival.id));
    expect(after.admittedMemberId).not.toBeNull();
    expect(after.supportShortcutReachedAt).not.toBeNull();
    // Recorded as an acceptance, the way a proceed decision would be, so the
    // record agrees with the member.
    const [decision] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, application.formResponse.id));
    expect(decision).toMatchObject({ resolution: "accepted", convertedMemberId: after.admittedMemberId });
    void c;
  });

  it("counts one member once, however many times they say it, and takes their latest marks", async () => {
    const { bob, apply } = await setUp(2);
    const { token } = await apply("Dana");
    const arrival = (await getArrivalByToken(token))!;
    await recordSupport(bob, { supportToken: arrival.supportToken, thinksGoodFit: true });
    const again = await recordSupport(bob, { supportToken: arrival.supportToken, ...knows });
    expect(again.reached).toBe(false);
    expect(await listSupports(arrival.id)).toMatchObject([{ name: "Bob", knowsPersonally: true, thinksGoodFit: false }]);
  });

  it("refuses a word with neither mark — a click with nothing behind it isn't proof", async () => {
    const { bob, apply } = await setUp();
    const arrival = (await getArrivalByToken((await apply("Dana")).token))!;
    await expect(recordSupport(bob, { supportToken: arrival.supportToken })).rejects.toThrow(/how you know/);
  });

  it("does nothing on a lane without the shortcut, but still records the vouches for whoever evaluates", async () => {
    const { bob, carol, dave, apply } = await setUp(null);
    const application = await apply("Dana");
    const arrival = (await getArrivalByToken(application.token))!;
    for (const m of [bob, carol, dave]) {
      expect((await recordSupport(m, { supportToken: arrival.supportToken, ...knows })).reached).toBe(false);
    }
    expect((await getArrivalByToken(application.token))!.admittedMemberId).toBeNull();
    expect((await listSupportsForApplication(application.formResponse.id)).map((s) => s.name)).toEqual(["Bob", "Carol", "Dave"]);
  });

  it("never counts the person themselves", async () => {
    const { community: c, bob, apply } = await setUp(1);
    const application = await apply("Dana");
    const arrival = (await getArrivalByToken(application.token))!;
    // Dana turns out to already be a member under her own address.
    const [dana] = await db.insert(member).values({ communityId: c.id, name: "Dana M" }).returning();
    await db.insert(memberIdentity).values({ memberId: dana.id, provider: "magic_link", loginEmail: "dana@example.com" });
    await expect(recordSupport(dana, { supportToken: arrival.supportToken, ...knows })).rejects.toThrow(ForbiddenError);
    void bob;
  });

  it("never counts whoever invited them, whether the invite is on the arrival or behind the application", async () => {
    const { community: c, alice, bob, apply } = await setUp(1);
    // An invite to an application lane: the vouch is behind the application.
    await setLanes(c.id, [
      { name: "Invited", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, supportShortcutCount: 1 },
      { name: "Open", kind: "public", supportShortcutCount: 1 },
    ]);
    const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true });
    const application = await apply("Eve", { inviteToken: invite.token });
    const arrival = (await getArrivalByToken(application.token))!;
    await expect(recordSupport(alice, { supportToken: arrival.supportToken, ...knows })).rejects.toThrow(/You invited them/);
    // Somebody else's word does count.
    expect((await recordSupport(bob, { supportToken: arrival.supportToken, ...knows })).reached).toBe(true);
  });

  it("refuses a member of another community, and a settled request", async () => {
    const { community: c, bob, apply } = await setUp(2);
    const arrival = (await getArrivalByToken((await apply("Dana")).token))!;
    const [other] = await db.insert(community).values({ name: "Elsewhere" }).returning();
    const [stranger] = await db.insert(member).values({ communityId: other.id, name: "Stranger" }).returning();
    await expect(recordSupport(stranger, { supportToken: arrival.supportToken, ...knows })).rejects.toThrow(ForbiddenError);

    await withdrawArrival(arrival.token);
    await expect(recordSupport(bob, { supportToken: arrival.supportToken, ...knows })).rejects.toThrow(ConflictError);
    await expect(recordSupport(bob, { supportToken: "no-such-token", ...knows })).rejects.toThrow(NotFoundError);
    void c;
  });
});

describe("the shortcut never skips past a concern", () => {
  beforeEach(resetDatabase);

  it("holds at N while a concern stands, and counts again the moment it's settled", async () => {
    const { community: c, bob, carol, dave, apply } = await setUp(2);
    const application = await apply("Dana");
    const arrival = (await getArrivalByToken(application.token))!;
    await db.insert(objection).values({ communityId: c.id, formResponseId: application.formResponse.id, raisedBy: dave.id, note: "a real concern" });

    await recordSupport(bob, { supportToken: arrival.supportToken, ...knows });
    const held = await recordSupport(carol, { supportToken: arrival.supportToken, ...knows });
    expect(held).toMatchObject({ reached: true, heldByConcern: true, admitted: null });
    expect((await getArrivalByToken(application.token))!.admittedMemberId).toBeNull();
    // Not marked as reached either: nothing was skipped.
    expect((await getArrivalByToken(application.token))!.supportShortcutReachedAt).toBeNull();

    await db.update(objection).set({ resolution: "cleared", resolvedAt: new Date() }).where(eq(objection.communityId, c.id));
    const after = await trySupportShortcut(arrival.id);
    expect(after).toMatchObject({ reached: true, heldByConcern: false });
    expect((await getArrivalByToken(application.token))!.admittedMemberId).not.toBeNull();
  });

  it("is idempotent: asking again after admission changes nothing", async () => {
    const { bob, carol, apply } = await setUp(2);
    const arrival = (await getArrivalByToken((await apply("Dana")).token))!;
    await recordSupport(bob, { supportToken: arrival.supportToken, ...knows });
    await recordSupport(carol, { supportToken: arrival.supportToken, ...knows });
    expect(await trySupportShortcut(arrival.id)).toMatchObject({ reached: false, admitted: null });
    expect(await db.select().from(member).where(eq(member.name, "Dana"))).toHaveLength(1);
  });
});

describe("the shortcut for an invitee", () => {
  beforeEach(resetDatabase);

  it("admits an invitee who waits for an interview, with no application behind them", async () => {
    const { alice, bob, carol, dave } = await setUp(2);
    const invite = await createCommunityInvite(alice, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "eve@example.com" });
    if (outcome.kind !== "waiting") throw new Error(`expected waiting, got ${outcome.kind}`);
    const arrival = (await getArrivalByToken(outcome.token))!;

    // The inviter's own word isn't counted twice…
    await expect(recordSupport(alice, { supportToken: arrival.supportToken, ...knows })).rejects.toThrow(/You invited them/);
    // …and two others' are enough, without an interview.
    await recordSupport(bob, { supportToken: arrival.supportToken, ...knows });
    expect((await recordSupport(carol, { supportToken: arrival.supportToken, ...knows })).reached).toBe(true);
    expect((await getArrivalByToken(outcome.token))!.admittedMemberId).not.toBeNull();
    // A third arrives too late and is told so.
    await expect(recordSupport(dave, { supportToken: arrival.supportToken, ...knows })).rejects.toThrow(/already been settled/);
  });

  it("puts the inviter's invitees on their own list, with the link to share", async () => {
    const { alice, bob } = await setUp(2);
    const invite = await createCommunityInvite(alice, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "eve@example.com" });
    if (outcome.kind !== "waiting") throw new Error("expected waiting");
    const arrival = (await getArrivalByToken(outcome.token))!;
    await recordSupport(bob, { supportToken: arrival.supportToken, ...knows });

    const mine = await listMyInviteesInFlight(alice);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ needed: 2 });
    expect(mine[0].supports.map((s) => s.name)).toEqual(["Bob"]);
    expect(mine[0].link).toContain(`/support/${arrival.supportToken}`);
    // Nobody else sees them there.
    expect(await listMyInviteesInFlight(bob)).toHaveLength(0);
  });
});

describe("a full event", () => {
  beforeEach(resetDatabase);

  it("waitlists someone the shortcut would admit, rather than letting them over capacity", async () => {
    const { community: c, alice, bob, carol, apply } = await setUp(2);
    const ev = await createCycle(alice, { source: "blank", name: "Season" });
    const application = await apply("Dana", { cycleId: ev.id });
    await declareParticipation(alice, ev.id, { status: "coming" });
    await updateCycleSettings(alice, ev.id, { capacity: 1 });
    const arrival = (await getArrivalByToken(application.token))!;
    await recordSupport(bob, { supportToken: arrival.supportToken, ...knows });
    const result = await recordSupport(carol, { supportToken: arrival.supportToken, ...knows });
    expect(result.admitted).toMatchObject({ waitlisted: true });
    expect((await getArrivalByToken(application.token))!.waitlistedAt).not.toBeNull();
    void c;
  });
});

describe("seeing the person, and asking", () => {
  beforeEach(resetDatabase);

  it("tells only a signed-in member of the same community who the person is, and why they can't add their word", async () => {
    const { alice, bob } = await setUp(2);
    const invite = await createCommunityInvite(alice, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    if (outcome.kind !== "waiting") throw new Error("expected waiting");
    const arrival = (await getArrivalByToken(outcome.token))!;

    const anonymous = await getSupportView(arrival.supportToken, null);
    expect(anonymous).toMatchObject({ personName: null, cannotBecause: expect.stringMatching(/Sign in/) });
    expect((await getSupportView(arrival.supportToken, bob))).toMatchObject({ personName: "dana", cannotBecause: null, needed: 2 });
    expect((await getSupportView(arrival.supportToken, alice))?.cannotBecause).toMatch(/invited them/);
    expect(await getSupportView("no-such-token", bob)).toBeNull();
  });

  it("lets somebody holding the recruitment task add their word from the application, no link needed — and nobody else", async () => {
    const { community: c, alice, bob, carol, branch, apply } = await setUp(2);
    const arrival = (await getArrivalByToken((await apply("Dana")).token))!;
    await expect(recordSupport(bob, { arrivalId: arrival.id, ...knows })).rejects.toThrow();

    const t = await insertTask(c.id, branch.id, alice.id, {});
    await grantPermission(c.id, "recruitment", t.id);
    await claimTask(bob, t.id);
    expect((await recordSupport(bob, { arrivalId: arrival.id, ...knows })).reached).toBe(false);
    expect((await listSupports(arrival.id)).map((s) => s.name)).toEqual(["Bob"]);
    void carol;
  });

  it("asks only members who can be asked, one message each, never the asker, and hands back the link", async () => {
    const { alice, bob, carol } = await setUp(2);
    const invite = await createCommunityInvite(alice, {});
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    if (outcome.kind !== "waiting") throw new Error("expected waiting");
    const arrival = (await getArrivalByToken(outcome.token))!;
    await db.insert(memberIdentity).values({ memberId: bob.id, provider: "magic_link", loginEmail: "bob@example.com" });
    // Carol has no address on file.

    const result = await pokeForSupport(alice, arrival.id, [bob.id, carol.id, alice.id]);
    expect(result.poked).toEqual([bob.id]);
    expect(result.undeliverable).toEqual([carol.id]);
    expect(result.link).toContain(`/support/${arrival.supportToken}`);
    // Asking counts toward nothing on its own.
    expect(await listSupports(arrival.id)).toHaveLength(0);
    // And it isn't open to just anybody.
    await expect(pokeForSupport(bob, arrival.id, [carol.id])).rejects.toThrow();
  });
});

describe("arrivals made before support existed", () => {
  beforeEach(resetDatabase);

  it("all have a support link of their own, distinct from their private one", async () => {
    const { community: c } = await createFixtures();
    const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const make = async (email: string) =>
      (await createAdmissionArrival({ communityId: c.id, cycleId: null, email, name: email, lane, route: "application" })).arrival;
    const [a, b] = [await make("a@example.com"), await make("b@example.com")];
    expect(a.supportToken).not.toBe(a.token);
    expect(a.supportToken).not.toBe(b.supportToken);
  });
});
