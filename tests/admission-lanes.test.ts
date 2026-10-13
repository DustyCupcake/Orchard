import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admissionLane, community, cycle, member, task, taskAssignment } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase, setLanes, LEGACY_LANES, withLegacyLanes } from "./helpers";
import {
  countCapacityHolds,
  createCommunityInvite,
  getCycleJoiningState,
  laneRuleOf,
  listLanes,
  listOpenLanes,
  redeemCommunityInvite,
  resolveInviteLane,
  resolvePublicLane,
  saveCommunityLanes,
  setEventLanes,
} from "@/lib/recruitment";
import {
  LANE_PRESETS,
  describeLaneConsequence,
  declarationFromMarks,
  laneHoldsCapacity,
  laneRelevance,
  laneRoute,
  normalizeLaneRule,
  createEmptyLane,
  startingLanes,
  validateLanes,
  type AdmissionLaneRule,
} from "@/lib/recruitment/lane-rules";

// docs/plans/admission-flow.md §2a and §3. Lanes are rows, they are community-wide,
// and an event never overrides one — it chooses which are open. Everything the
// settings panel promises ("a configuration that can't produce a person's path
// is refused with a sentence saying why") is tested here at the place it would
// break: the pure rules the panel shares with the server, and the server that
// has the last word.

async function enableRecruitment(communityId: string) {
  await db.update(community).set({ modulesEnabled: ["recruitment"], cyclesEnabled: true }).where(eq(community.id, communityId));
}

const rule = (partial: Partial<AdmissionLaneRule>): AdmissionLaneRule =>
  normalizeLaneRule({ ...createEmptyLane(partial.kind ?? "invite"), ...partial });

describe("a lane's rule (pure)", () => {
  it("sends each shape of lane down exactly one route", () => {
    expect(laneRoute(rule({ applicationRequired: false, interviewRequired: false }))).toBe("direct");
    expect(laneRoute(rule({ applicationRequired: true, interviewRequired: false }))).toBe("process");
    expect(laneRoute(rule({ applicationRequired: false, interviewRequired: true }))).toBe("process");
    expect(laneRoute(rule({ verification: "community_check" }))).toBe("check");
  });

  it("holds a place in a capped event only on the route that admits at once", () => {
    expect(laneHoldsCapacity(rule({ applicationRequired: false, interviewRequired: false }))).toBe(true);
    expect(laneHoldsCapacity(rule({}))).toBe(false);
    expect(laneHoldsCapacity(rule({ verification: "community_check" }))).toBe(false);
  });

  it("applies the compatibility rules of §3, so the panel and the server can't disagree", () => {
    // A community check is the whole process.
    const check = rule({ verification: "community_check", applicationRequired: true, interviewRequired: true, supportShortcutCount: 3 });
    expect(check).toMatchObject({ applicationRequired: false, interviewRequired: false, reportsNeeded: null, supportShortcutCount: null });
    // With nothing to evaluate there is nothing to report on or skip.
    const direct = rule({ applicationRequired: false, interviewRequired: false, reportsNeeded: 5, supportShortcutCount: 2 });
    expect(direct).toMatchObject({ reportsNeeded: null, supportShortcutCount: null });
    // Where there is something to evaluate, reports needed is at least one.
    expect(rule({ reportsNeeded: 0 }).reportsNeeded).toBe(1);
    // A public lane handles no declaration; an invite lane has no address.
    expect(rule({ kind: "public", handlesNeither: true, publicSlug: " Camp " })).toMatchObject({ handlesNeither: false, publicSlug: "camp" });
    expect(rule({ kind: "invite", handlesNeither: true, publicSlug: "x" }).publicSlug).toBeNull();
  });

  it("reads the inviter's two ticks as one of three declarations, both ticked counting as knowing them", () => {
    expect(declarationFromMarks({ inviterKnowsPersonally: true, inviterThinksGoodFit: true })).toBe("knows_personally");
    expect(declarationFromMarks({ inviterKnowsPersonally: false, inviterThinksGoodFit: true })).toBe("good_fit_only");
    expect(declarationFromMarks({ inviterKnowsPersonally: false, inviterThinksGoodFit: false })).toBe("neither");
  });

  it("describes every route in a sentence generated from the same rule that decides the path", () => {
    expect(describeLaneConsequence(rule({ handlesKnowsPersonally: true, applicationRequired: false, interviewRequired: false }))).toBe(
      "Invited by a member who knows them personally. Admitted immediately.",
    );
    expect(describeLaneConsequence(rule({ handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, reportsNeeded: 3, supportShortcutCount: 2 }))).toBe(
      "Invited by any member. An application, then an interview, then 3 reports to decide. Support from 2 members skips the rest.",
    );
    expect(describeLaneConsequence(rule({ kind: "public", publicSlug: "camp", applicationRequired: true, interviewRequired: false, reportsNeeded: 1 }))).toBe(
      "Applies at /apply/camp. An application, then 1 report to decide.",
    );
    expect(describeLaneConsequence(rule({ handlesNeither: true, verification: "community_check" }))).toMatch(/Announced to the community; admitted if nobody raises a concern/);
  });
});

describe("validating a set of lanes (pure)", () => {
  const invited = rule({ name: "Invited", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true });
  const open = rule({ name: "Open application", kind: "public" });

  it("accepts the starting lanes and every preset, because a preset that can't be saved is a bug", () => {
    expect(validateLanes(startingLanes())).toEqual([]);
    for (const preset of LANE_PRESETS) expect(validateLanes(preset.lanes), preset.key).toEqual([]);
  });

  it("refuses an invite with nowhere to go, and one that would match two lanes", () => {
    const missing = validateLanes([rule({ name: "A", handlesKnowsPersonally: true })]);
    expect(missing.join(" ")).toMatch(/good fit|made no mark/);
    const doubled = validateLanes([invited, rule({ name: "B", handlesNeither: true })]);
    expect(doubled.join(" ")).toMatch(/would match both/);
  });

  it("asks that question of each context separately, among the lanes open there", () => {
    const knows = rule({ name: "Knows", handlesKnowsPersonally: true });
    const rest = rule({ name: "Rest", handlesGoodFitOnly: true, handlesNeither: true });
    const lanes = [invited, knows, rest];
    // The community opens "Invited"; the event opens Knows + Rest. Both are
    // complete, and "Invited" overlapping Knows is fine because they're never
    // open together.
    expect(
      validateLanes(lanes, [
        { label: "the community", laneIndexes: [0] },
        { label: "the event", laneIndexes: [1, 2] },
      ]),
    ).toEqual([]);
    expect(validateLanes(lanes, [{ label: "the event", laneIndexes: [1] }]).join(" ")).toMatch(/In the event/);
  });

  it("treats a context with no invite lane as invite-free rather than broken", () => {
    expect(validateLanes([open])).toEqual([]);
  });

  it("refuses a public lane with no application, two lanes at one address, and a bad address", () => {
    expect(validateLanes([invited, { ...open, applicationRequired: false }]).join(" ")).toMatch(/has to ask for an application/);
    expect(validateLanes([invited, open, rule({ name: "Second", kind: "public" })]).join(" ")).toMatch(/both served at \/apply/);
    expect(validateLanes([invited, rule({ name: "Camp", kind: "public", publicSlug: "Not a slug!" })]).join(" ")).toMatch(/isn't usable/);
    expect(validateLanes([invited, rule({ name: "Camp", kind: "public", publicSlug: "api" })]).join(" ")).toMatch(/isn't usable/);
  });

  it("refuses an unnamed lane and a duplicate name", () => {
    expect(validateLanes([{ ...invited, name: "" }]).join(" ")).toMatch(/needs a name/);
    expect(validateLanes([invited, { ...open, name: "invited" }]).join(" ")).toMatch(/Two lanes are called/);
  });
});

describe("lanes as rows", () => {
  beforeEach(resetDatabase);

  it("gives a community with none its starting lanes the first time anything reads them", async () => {
    const { community: c } = await createFixtures();
    expect(await db.select().from(admissionLane)).toHaveLength(0);
    const lanes = await listLanes(c.id);
    expect(lanes.map((l) => l.name).sort()).toEqual(["Invited", "Open application"]);
    // …and only once.
    await listLanes(c.id);
    expect(await db.select().from(admissionLane)).toHaveLength(2);
  });

  it("leaves a community that has only archived lanes alone — having none is a choice", async () => {
    const { community: c } = await createFixtures();
    await setLanes(c.id, []);
    expect(await listLanes(c.id)).toHaveLength(0);
    expect(await listOpenLanes(c.id, null)).toHaveLength(0);
    expect(await db.select().from(admissionLane)).toHaveLength(2);
  });

  it("finds an invite's lane from the inviter's declaration, and a public lane from its address", async () => {
    const { community: c } = await createFixtures();
    await setLanes(c.id, [
      { name: "Knows", kind: "invite", handlesKnowsPersonally: true },
      { name: "Rest", kind: "invite", handlesGoodFitOnly: true, handlesNeither: true },
      { name: "Open", kind: "public" },
      { name: "Camp", kind: "public", publicSlug: "camp" },
    ]);
    expect((await resolveInviteLane(c.id, null, "knows_personally"))?.name).toBe("Knows");
    expect((await resolveInviteLane(c.id, null, "good_fit_only"))?.name).toBe("Rest");
    expect((await resolveInviteLane(c.id, null, "neither"))?.name).toBe("Rest");
    expect((await resolvePublicLane(c.id, null))?.name).toBe("Open");
    expect((await resolvePublicLane(c.id, null, "camp"))?.name).toBe("Camp");
    expect(await resolvePublicLane(c.id, null, "nope")).toBeNull();
  });

  it("serves /apply from the only public lane even when it has an address", async () => {
    const { community: c } = await createFixtures();
    await setLanes(c.id, [{ name: "Camp", kind: "public", publicSlug: "camp" }]);
    expect((await resolvePublicLane(c.id, null))?.name).toBe("Camp");
  });
});

describe("which lanes an event opens (§2a)", () => {
  beforeEach(resetDatabase);

  async function eventFixtures() {
    const fixtures = await createFixtures();
    await enableRecruitment(fixtures.community.id);
    const [lanes] = [
      await setLanes(fixtures.community.id, [
        { name: "Knows", kind: "invite", handlesKnowsPersonally: true, applicationRequired: false, interviewRequired: false },
        { name: "Rest", kind: "invite", handlesGoodFitOnly: true, handlesNeither: true },
        { name: "Open", kind: "public" },
        { name: "Strict", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, reportsNeeded: 4, openInCommunity: false },
      ]),
    ];
    const [ev] = await db.insert(cycle).values({ communityId: fixtures.community.id, name: "Big event", startedAt: new Date() }).returning();
    return { ...fixtures, lanes, ev, byName: (n: string) => lanes.find((l) => l.name === n)! };
  }

  it("follows the community's set by default, and keeps following it", async () => {
    const { community: c, ev } = await eventFixtures();
    expect((await listOpenLanes(c.id, ev.id)).map((l) => l.name).sort()).toEqual(["Knows", "Open", "Rest"]);
    await db.update(admissionLane).set({ openInCommunity: false }).where(eq(admissionLane.name, "Open"));
    expect((await listOpenLanes(c.id, ev.id)).map((l) => l.name).sort()).toEqual(["Knows", "Rest"]);
  });

  it("can open a different process for one event as a different lane, without touching the community's", async () => {
    const { community: c, alice, ev, byName } = await eventFixtures();
    await setEventLanes(alice, ev.id, [byName("Strict").id, byName("Open").id]);
    expect((await listOpenLanes(c.id, ev.id)).map((l) => l.name).sort()).toEqual(["Open", "Strict"]);
    expect((await listOpenLanes(c.id, null)).map((l) => l.name).sort()).toEqual(["Knows", "Open", "Rest"]);
    // An invite to the event takes the event's lane for its declaration.
    expect((await resolveInviteLane(c.id, ev.id, "knows_personally"))?.name).toBe("Strict");
    expect((await resolveInviteLane(c.id, null, "knows_personally"))?.name).toBe("Knows");

    // Handing the choice back removes the event's set rather than copying the
    // community's into it, so it follows the community again.
    await setEventLanes(alice, ev.id, null);
    expect((await listOpenLanes(c.id, ev.id)).map((l) => l.name).sort()).toEqual(["Knows", "Open", "Rest"]);
  });

  it("refuses an event set that would leave an invite nowhere to go, with a sentence saying so", async () => {
    const { alice, ev, byName } = await eventFixtures();
    await expect(setEventLanes(alice, ev.id, [byName("Knows").id])).rejects.toThrow(/In this event/);
  });

  it("refuses an invite the event has no lane for, and says which kind", async () => {
    const { community: c, alice, ev, byName } = await eventFixtures();
    await setEventLanes(alice, ev.id, [byName("Open").id]);
    await expect(createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true })).rejects.toThrow(
      /doesn't take invitations from someone who knows them personally/,
    );
    void c;
  });

  it("holds an invite whose lane has since closed, rather than revoking it", async () => {
    const { community: c, alice, ev } = await eventFixtures();
    const invite = await createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true });
    // "Knows" is the only lane that takes that kind of invite; closing it
    // leaves the invite with nowhere to go, for now.
    await db.update(admissionLane).set({ openInCommunity: false }).where(eq(admissionLane.name, "Knows"));
    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(/can't be used right now/);
    // Nothing was spent: reopening the lane makes the same link work.
    await db.update(admissionLane).set({ openInCommunity: true }).where(eq(admissionLane.name, "Knows"));
    const outcome = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(outcome.kind).toBe("admitted");
    void c;
  });

  it("counts a direct lane's outstanding invites against a capped event's room, and nothing else's", async () => {
    const { community: c, alice, ev } = await eventFixtures();
    await db.update(cycle).set({ capacity: 5 }).where(eq(cycle.id, ev.id));
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true, expiresAt: future });
    await createCommunityInvite(alice, { cycleId: ev.id, inviterKnowsPersonally: true, expiresAt: future });
    await createCommunityInvite(alice, { cycleId: ev.id, expiresAt: future });
    expect(await countCapacityHolds(c.id, ev.id)).toBe(2);
    const state = await getCycleJoiningState(c.id, ev.id);
    expect(state.holds).toBe(2);
    expect(state.remainingCapacity).toBe(3);
  });
});

describe("saving the community's lanes", () => {
  beforeEach(resetDatabase);

  it("creates, updates and archives lanes in one go, and archives rather than deletes", async () => {
    const { community: c, alice } = await createFixtures();
    const existing = await listLanes(c.id);
    const invited = laneRuleOf(existing.find((l) => l.name === "Invited")!);

    const saved = await saveCommunityLanes(alice, [
      { ...invited, name: "Anyone invited", reportsNeeded: 3 },
      rule({ name: "Camp", kind: "public", publicSlug: "camp" }),
    ]);
    expect(saved.map((l) => l.name).sort()).toEqual(["Anyone invited", "Camp"]);
    expect(saved.find((l) => l.name === "Anyone invited")).toMatchObject({ id: invited.id, reportsNeeded: 3 });

    // The "Open application" lane that was left out is archived, not gone.
    const all = await listLanes(c.id, { includeArchived: true });
    expect(all.find((l) => l.name === "Open application")?.archivedAt).not.toBeNull();
    expect(await resolvePublicLane(c.id, null)).toMatchObject({ name: "Camp" });
  });

  it("refuses a set that can't produce a person's path, and writes nothing", async () => {
    const { community: c, alice } = await createFixtures();
    const before = await listLanes(c.id);
    await expect(
      saveCommunityLanes(alice, [rule({ name: "Half", handlesKnowsPersonally: true })]),
    ).rejects.toThrow(/has no lane to go to/);
    expect((await listLanes(c.id)).map((l) => l.id).sort()).toEqual(before.map((l) => l.id).sort());
  });

  it("won't take a name or address an archived lane still holds", async () => {
    const { community: c, alice } = await createFixtures();
    const invited = laneRuleOf((await listLanes(c.id)).find((l) => l.name === "Invited")!);
    await saveCommunityLanes(alice, [invited]); // archives "Open application"
    await expect(
      saveCommunityLanes(alice, [invited, rule({ name: "Open application", kind: "public" })]),
    ).rejects.toThrow(/archived lane called/);
  });

  it("won't take a lane away from an event that is using it", async () => {
    const { community: c, alice } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, c.id));
    await setLanes(c.id, [
      { name: "Invited", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true },
      { name: "Camp", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, openInCommunity: false },
    ]);
    const lanes = await listLanes(c.id);
    const [ev] = await db.insert(cycle).values({ communityId: c.id, name: "Camp event", startedAt: new Date() }).returning();
    await setEventLanes(alice, ev.id, [lanes.find((l) => l.name === "Camp")!.id]);
    await expect(
      saveCommunityLanes(alice, [laneRuleOf(lanes.find((l) => l.name === "Invited")!)]),
    ).rejects.toThrow(/open in the event “Camp event”/);
  });

  it("is for an Admins holder once there is one", async () => {
    const { community: c, alice, bob, branch } = await createFixtures();
    const [adminsTask] = await db
      .insert(task)
      .values({
        communityId: c.id,
        branchId: branch.id,
        title: "Admins",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 1 },
        createdBy: alice.id,
        openness: "community_endorsed",
        endorsementThreshold: 1,
        browsePeriodEnd: new Date(Date.now() + 3600000),
      })
      .returning();
    await grantPermission(c.id, "admin", adminsTask.id);
    await db.insert(taskAssignment).values({ taskId: adminsTask.id, memberId: alice.id });
    await db.update(community).set({ adminsEverClaimed: true }).where(eq(community.id, c.id));
    const invited = laneRuleOf((await listLanes(c.id)).find((l) => l.name === "Invited")!);
    await expect(saveCommunityLanes(bob, [invited])).rejects.toThrow(ForbiddenError);
    await expect(saveCommunityLanes(alice, [invited])).resolves.toBeDefined();
  });

  it("keeps the legacy four valid, since that is what existing communities were carried over to", async () => {
    const { community: c } = await createFixtures();
    await withLegacyLanes(c.id);
    const rules = (await listLanes(c.id)).map(laneRuleOf);
    expect(rules).toHaveLength(LEGACY_LANES.length);
    expect(validateLanes(rules)).toEqual([]);
  });
});

// docs/plans/admission-flow.md §3: whole sections of the settings screen follow from the lanes in
// play, so a community is never asked to configure something nothing uses.
describe("what the lanes in play mean for the settings screen", () => {
  const lane = (over: Partial<AdmissionLaneRule> = {}): AdmissionLaneRule => ({
    ...createEmptyLane("invite"),
    applicationRequired: false,
    interviewRequired: false,
    verification: "none",
    reportsNeeded: null,
    supportShortcutCount: null,
    openInCommunity: true,
    ...over,
  });

  it("has nothing to evaluate, check or shortcut when every lane admits at once", () => {
    expect(laneRelevance([lane({ id: "a" })])).toEqual({
      anyLane: true, anyApplication: false, anyInterview: false, evaluates: false, anyCheck: false, anyShortcut: false,
    });
    expect(laneRelevance([])).toMatchObject({ anyLane: false, evaluates: false });
  });

  it("evaluates when any lane has an application or an interview, and says which", () => {
    expect(laneRelevance([lane({ applicationRequired: true, reportsNeeded: 2 })])).toMatchObject({ evaluates: true, anyApplication: true, anyInterview: false });
    expect(laneRelevance([lane({ interviewRequired: true, reportsNeeded: 2 })])).toMatchObject({ evaluates: true, anyApplication: false, anyInterview: true });
  });

  it("treats a community check as the whole process: a check, and nothing to evaluate", () => {
    expect(laneRelevance([lane({ verification: "community_check" })])).toMatchObject({ anyCheck: true, evaluates: false });
  });

  it("offers the support shortcut only on a lane that evaluates and turns it on", () => {
    expect(laneRelevance([lane({ applicationRequired: true, reportsNeeded: 2, supportShortcutCount: 3 })]).anyShortcut).toBe(true);
    expect(laneRelevance([lane({ applicationRequired: true, reportsNeeded: 2, supportShortcutCount: null })]).anyShortcut).toBe(false);
    // A count left on a lane that no longer has anything to skip means nothing.
    expect(laneRelevance([lane({ supportShortcutCount: 3 })]).anyShortcut).toBe(false);
  });

  it("counts a lane only an event has opened, and ignores one open nowhere", () => {
    const eventOnly = lane({ id: "event-lane", applicationRequired: true, reportsNeeded: 2, openInCommunity: false });
    expect(laneRelevance([eventOnly]).evaluates).toBe(false);
    expect(laneRelevance([eventOnly], ["event-lane"]).evaluates).toBe(true);
  });
});

void member;
