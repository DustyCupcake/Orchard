import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, admission, admissionLane, admissionSupport, community, engagementEvent, evaluation, member, tier, taskSuggestion } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, withLegacyLanes } from "./helpers";
import { admitArrival, createAdmissionArrival, createCommunityInvite } from "@/lib/recruitment";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import { listPendingSuggestions } from "@/lib/tasks/coordination-dashboard";
import {
  addSuggestions,
  dismissMySuggestion,
  joinReasons,
  listMyAccompanyInvitations,
  listSuggestionsForTasks,
  SUGGESTION_REASON_LABEL,
  SUGGESTION_REASON_TO_THEM,
} from "@/lib/tasks/suggestions";

// docs/plans/accompaniment-plan.md step 2: a task can have several people suggested for it, each
// with the reason, and a suggested person is nudged on their own dashboard without anything being
// held against them if they say no.

type Member = typeof member.$inferSelect;

// A branch coordinator, the way the coordination tests make one: a task granting the module,
// claimed by them.
async function makeBranchCoordinator(communityId: string, branchId: string, createdBy: string, coordinator: Member) {
  const coordTask = await insertTask(communityId, branchId, createdBy, { title: "Coordination" });
  await grantPermission(communityId, "branch_coordination", coordTask.id);
  await claimTask(coordinator, coordTask.id);
  return coordTask;
}

async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id);
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  const [holder] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(holder, recruitmentTask.id);
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
  // The four lanes a community starts with, so an invitation has somewhere to belong.
  await withLegacyLanes(c.id);
  const [lane] = await db.select().from(admissionLane).where(and(eq(admissionLane.communityId, c.id), eq(admissionLane.kind, "public")));
  return { ...fixtures, alice: holder, carol, lane };
}

// Dana arrives: Alice invited her, Bob said yes after the interview, Carol vouched for her, and
// Alice said yes as well.
async function admitDana(setup: Awaited<ReturnType<typeof setUp>>) {
  const { alice, bob, carol, lane, community: c } = setup;
  const { arrival } = await createAdmissionArrival({ communityId: c.id, cycleId: null, email: "dana@example.com", name: "Dana", lane, route: "application" });
  const invite = await createCommunityInvite(alice, { inviterKnowsPersonally: true });
  await db.update(admission).set({ inviteId: invite.id }).where(eq(admission.id, arrival.id));
  await db.insert(evaluation).values([
    { arrivalId: arrival.id, evaluatorId: bob.id, recommendation: "proceed" },
    { arrivalId: arrival.id, evaluatorId: alice.id, recommendation: "proceed" },
  ]);
  await db.insert(evaluation).values({ arrivalId: arrival.id, evaluatorId: carol.id, recommendation: "unsure" });
  await db.insert(admissionSupport).values({ arrivalId: arrival.id, supporterId: carol.id, knowsPersonally: true });
  const result = await admitArrival(arrival.id, { notify: false });
  const [acc] = await db.select().from(accompaniment).where(eq(accompaniment.memberId, result.memberId!));
  return { memberId: result.memberId!, taskId: acc.taskId };
}

const asPeople = async (taskId: string) =>
  ((await listSuggestionsForTasks([taskId])).get(taskId) ?? []).map((p) => ({ name: p.name, reasons: [...p.reasons].sort() }));

describe("who is suggested for a new member's accompaniment", () => {
  beforeEach(resetDatabase);

  it("is everyone with a reason, once each, with every reason they have", async () => {
    const setup = await setUp();
    const { taskId } = await admitDana(setup);
    const people = await asPeople(taskId);
    expect(people).toHaveLength(3);
    // Alice invited her and said yes: one person, both reasons. Bob only said yes. Carol only vouched
    // (her "unsure" report is not a reason).
    expect(people.find((p) => p.name === "Alice")!.reasons).toEqual(["invited", "said_yes"]);
    expect(people.find((p) => p.name === "Bob")!.reasons).toEqual(["said_yes"]);
    expect(people.find((p) => p.name === "Carol")!.reasons).toEqual(["supported"]);
  });

  it("never suggests the newcomer for their own accompaniment", async () => {
    const setup = await setUp();
    const { memberId, taskId } = await admitDana(setup);
    const ids = ((await listSuggestionsForTasks([taskId])).get(taskId) ?? []).map((p) => p.memberId);
    expect(ids).not.toContain(memberId);
  });

  it("reads kindly both ways: to the person deciding whom to ask, and to the person asked", () => {
    expect(joinReasons(["invited", "said_yes"], SUGGESTION_REASON_LABEL)).toBe("invited them, said yes after the interview");
    expect(joinReasons(["supported"], SUGGESTION_REASON_TO_THEM)).toBe("you vouched for them");
  });
});

describe("the invitation on a suggested member's own dashboard", () => {
  beforeEach(resetDatabase);

  it("names the newcomer and the reasons, and is the same task for everyone suggested", async () => {
    const setup = await setUp();
    const { taskId } = await admitDana(setup);
    const mine = await listMyAccompanyInvitations(setup.bob);
    expect(mine).toMatchObject([{ taskId, newcomerName: "Dana", reasons: ["said_yes"] }]);
    const alices = await listMyAccompanyInvitations(setup.alice);
    expect(alices[0].reasons.sort()).toEqual(["invited", "said_yes"]);
  });

  it("is only for accompaniment tasks: a suggestion on any other task tells nobody anything", async () => {
    const setup = await setUp();
    const t = await insertTask(setup.community.id, setup.branch.id, setup.alice.id, { title: "Water the trees" });
    await addSuggestions(db, [{ taskId: t.id, memberId: setup.bob.id, reason: "shadowed" }]);
    expect(await listMyAccompanyInvitations(setup.bob)).toEqual([]);
  });

  it("goes when somebody takes the task on, including the person asked", async () => {
    const setup = await setUp();
    const { taskId } = await admitDana(setup);
    await claimTask(setup.carol, taskId);
    expect(await listMyAccompanyInvitations(setup.bob)).toEqual([]);
    expect(await listMyAccompanyInvitations(setup.carol)).toEqual([]);
  });

  it("is a real claim, so a requirement on the task still applies", async () => {
    const setup = await setUp();
    const [core] = await db.insert(tier).values({ communityId: setup.community.id, name: "Core" }).returning();
    await db.update(member).set({ tierIds: [core.id] }).where(eq(member.id, setup.bob.id));
    await updateCommunity(setup.alice, { accompanimentTierId: core.id });
    const { taskId } = await admitDana(setup);
    // Carol was suggested, but isn't Core.
    await expect(claimTask(setup.carol, taskId)).rejects.toThrow();
    const [bob] = await db.select().from(member).where(eq(member.id, setup.bob.id));
    await claimTask(bob, taskId);
  });
});

describe("saying not me", () => {
  beforeEach(resetDatabase);

  it("hides the prompt for that person alone, and logs nothing against anyone", async () => {
    const setup = await setUp();
    const { taskId } = await admitDana(setup);
    const eventsBefore = await db.select().from(engagementEvent);

    await dismissMySuggestion(setup.bob, taskId);

    expect(await listMyAccompanyInvitations(setup.bob)).toEqual([]);
    expect((await listMyAccompanyInvitations(setup.alice)).length).toBe(1);
    expect(await db.select().from(engagementEvent)).toHaveLength(eventsBefore.length);
    // Coordination still sees Bob as a person with a reason to be asked: it is private to Bob.
    expect((await asPeople(taskId)).map((p) => p.name)).toContain("Bob");
    const [row] = await db.select().from(taskSuggestion).where(and(eq(taskSuggestion.taskId, taskId), eq(taskSuggestion.memberId, setup.bob.id)));
    expect(row.dismissedAt).not.toBeNull();
  });
});

describe("what coordination sees", () => {
  beforeEach(resetDatabase);

  it("lists the accompaniment task once, with everyone suggested and why", async () => {
    const setup = await setUp();
    await makeBranchCoordinator(setup.community.id, setup.branch.id, setup.alice.id, setup.alice);
    const { taskId } = await admitDana(setup);
    const pending = await listPendingSuggestions(setup.alice, []);
    const entry = pending.find((p) => p.id === taskId)!;
    expect(entry.suggested.map((p) => p.name).sort()).toEqual(["Alice", "Bob", "Carol"]);
    expect(entry.suggested.find((p) => p.name === "Alice")!.reasons.sort()).toEqual(["invited", "said_yes"]);
  });
});

describe("adding suggestions", () => {
  beforeEach(resetDatabase);

  it("is idempotent for the same person and reason, and keeps different reasons apart", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await addSuggestions(db, [{ taskId: t.id, memberId: bob.id, reason: "proposed" }]);
    await addSuggestions(db, [{ taskId: t.id, memberId: bob.id, reason: "proposed" }, { taskId: t.id, memberId: bob.id, reason: "suggested" }]);
    expect(await asPeople(t.id)).toEqual([{ name: "Bob", reasons: ["proposed", "suggested"] }]);
  });
});
