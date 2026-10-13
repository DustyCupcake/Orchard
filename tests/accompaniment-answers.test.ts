import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, community, member, memberIdentity, profileAnswer, profileAnswerRuleConsent, sensitiveFieldAccessRule, task, taskAssignment } from "@/db/schema";
import { createFixtures, createRestrictedQuestion, grantPermission, insertTask, resetDatabase, setLanes } from "./helpers";
import { admitArrival, createAdmissionArrival } from "@/lib/recruitment";
import { claimAsShadow, claimTask } from "@/lib/tasks";
import { communityHasAccompanierQuestions, getAccompaniedView, getMyAccompaniment, runAccompaniments, setMyShares } from "@/lib/accompaniment";
import { answerProfileQuestion } from "@/lib/profile-questions";
import { createSensitiveFieldAccessRule, describeAudience, listReadableSensitiveQuestionIds, resolveReadableAnswersForCommunity, resolveReadableQuestions } from "@/lib/sensitive-data";
import { getMemberData } from "@/lib/member-data";

// docs/plans/accompaniment-plan.md step 4b: profile answers a new member has agreed to share with
// "my accompanier". A relation, not a group, so the resolver asks it per owner, and every step has
// to be yes: the question names the accompanier as an audience, the answer was given under that
// rule, the member has chosen to share answers with *this* accompanier, and the accompaniment is open.

async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id);
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  const [holder] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(holder, recruitmentTask.id);
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
  const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
  const { arrival } = await createAdmissionArrival({ communityId: c.id, cycleId: null, email: "dana@example.com", name: "Dana", lane, route: "application" });
  const result = await admitArrival(arrival.id, { notify: false });
  const [dana] = await db.select().from(member).where(eq(member.id, result.memberId!));
  await db.insert(memberIdentity).values({ memberId: dana.id, provider: "magic_link", loginEmail: "dana@example.com" }).onConflictDoNothing();
  const [acc] = await db.select().from(accompaniment).where(eq(accompaniment.memberId, dana.id));
  const question = await createRestrictedQuestion(
    alice,
    { label: "How do you like to be supported?", responseType: "text", scope: "once_ever" },
    { audience: { unlockedByAccompaniment: true } },
  );
  return { ...fixtures, alice: holder, carol, dana, taskId: acc.taskId, question };
}

const asMember = async (id: string) => (await db.select().from(member).where(eq(member.id, id)))[0];
const claimAs = async (memberId: string, taskId: string) => claimTask(await asMember(memberId), taskId);

async function answered(s: Awaited<ReturnType<typeof setUp>>) {
  await answerProfileQuestion(s.dana, s.question.id, { status: "answered", value: "Check in by message, not a call" });
  await claimAs(s.bob.id, s.taskId);
}

const readableFor = async (viewerId: string, ownerId: string, s: Awaited<ReturnType<typeof setUp>>) => {
  const [a] = await db.select().from(profileAnswer).where(and(eq(profileAnswer.memberId, ownerId), eq(profileAnswer.questionId, s.question.id)));
  return resolveReadableQuestions(await asMember(viewerId), ownerId, [{ questionId: s.question.id, sensitive: true, shareWithAudience: a.shareWithAudience }]);
};

describe("a question whose audience is the accompanier", () => {
  beforeEach(resetDatabase);

  it("can be made, is one route and not two, and is described to the member in their own terms", async () => {
    const s = await setUp();
    expect(s.question.sensitive).toBe(true);
    const [rule] = await db.select().from(sensitiveFieldAccessRule).where(eq(sensitiveFieldAccessRule.questionId, s.question.id));
    expect(rule).toMatchObject({ unlockedByAccompaniment: true, unlockedByTaskId: null, unlockedByTierId: null, unlockedByGrantModuleKey: null });
    expect(describeAudience(rule)).toBe("whoever is accompanying you, while they are");
    await expect(createSensitiveFieldAccessRule(s.alice, { questionId: s.question.id, unlockedByAccompaniment: true, unlockedByTaskId: s.taskId })).rejects.toThrow(/exactly one/);
    expect(await communityHasAccompanierQuestions(s.community.id)).toBe(true);
  });

  it("is not on offer to a community that has none", async () => {
    const { community: c } = await createFixtures();
    expect(await communityHasAccompanierQuestions(c.id)).toBe(false);
  });
});

describe("who can read the answer", () => {
  beforeEach(resetDatabase);

  it("is nobody beyond the member until they choose to share answers with their accompanier", async () => {
    const s = await setUp();
    await answered(s);
    expect((await readableFor(s.bob.id, s.dana.id, s)).has(s.question.id)).toBe(false);
    expect((await readableFor(s.dana.id, s.dana.id, s)).has(s.question.id)).toBe(true);
  });

  it("is their accompanier once they have, and only theirs", async () => {
    const s = await setUp();
    await answered(s);
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });
    expect((await readableFor(s.bob.id, s.dana.id, s)).has(s.question.id)).toBe(true);
    expect((await readableFor(s.alice.id, s.dana.id, s)).has(s.question.id)).toBe(false);
    expect((await readableFor(s.carol.id, s.dana.id, s)).has(s.question.id)).toBe(false);
  });

  it("needs the answer to have been given under this rule: an answer that predates it is not reached", async () => {
    const s = await setUp();
    await answered(s);
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });
    await db.delete(profileAnswerRuleConsent).where(eq(profileAnswerRuleConsent.ruleId, (await db.select().from(sensitiveFieldAccessRule))[0].id));
    expect((await readableFor(s.bob.id, s.dana.id, s)).has(s.question.id)).toBe(false);
  });

  it("is not reached when the member has turned off the share on that one answer", async () => {
    const s = await setUp();
    await answerProfileQuestion(s.dana, s.question.id, { status: "answered", value: "Private", shareWithAudience: false });
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });
    expect((await readableFor(s.bob.id, s.dana.id, s)).has(s.question.id)).toBe(false);
  });

  it("is not reached by choosing the other two things only", async () => {
    const s = await setUp();
    await answered(s);
    await setMyShares(s.dana, { axes: true, contribution: true, answers: false });
    expect((await readableFor(s.bob.id, s.dana.id, s)).has(s.question.id)).toBe(false);
  });

  it("is not reached by a shadow, and stops when the accompaniment is over", async () => {
    const s = await setUp();
    await answered(s);
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });
    await claimAsShadow(await asMember(s.carol.id), s.taskId);
    expect((await readableFor(s.carol.id, s.dana.id, s)).has(s.question.id)).toBe(false);

    await runAccompaniments(new Date(Date.now() + 100 * 86_400_000));
    expect((await readableFor(s.bob.id, s.dana.id, s)).has(s.question.id)).toBe(false);
  });

  it("starts from nothing for a new accompanier", async () => {
    const s = await setUp();
    await answered(s);
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });
    await db.delete(taskAssignment).where(eq(taskAssignment.taskId, s.taskId));
    await db.update(task).set({ status: "unclaimed" }).where(eq(task.id, s.taskId));
    await claimAs(s.alice.id, s.taskId);
    expect((await readableFor(s.alice.id, s.dana.id, s)).has(s.question.id)).toBe(false);
    expect((await getMyAccompaniment(s.dana.id))!.shares.answers).toBe(false);
  });
});

describe("the roster, which has to agree", () => {
  beforeEach(resetDatabase);

  it("shows the accompanier the one person's answer and nobody else's, and offers the column only to them", async () => {
    const s = await setUp();
    await answered(s);
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });

    const bobSees = await resolveReadableAnswersForCommunity(await asMember(s.bob.id));
    expect(bobSees.get(s.dana.id)?.has(s.question.id)).toBe(true);
    // Anybody else: nothing of Dana's, and the roster agrees with the single-person reader.
    const carolSees = await resolveReadableAnswersForCommunity(await asMember(s.carol.id));
    expect(carolSees.get(s.dana.id)?.has(s.question.id) ?? false).toBe(false);

    expect((await listReadableSensitiveQuestionIds(await asMember(s.bob.id))).has(s.question.id)).toBe(true);
    expect((await listReadableSensitiveQuestionIds(await asMember(s.carol.id))).has(s.question.id)).toBe(false);

    // And through the member-data grid itself, which is the page that actually shows it.
    const bobGrid = await getMemberData(await asMember(s.bob.id));
    const column = bobGrid.columns.find((c) => c.question.id === s.question.id)!;
    expect(column.entries).toEqual([{ memberId: s.dana.id, memberName: "Dana", display: "Check in by message, not a call" }]);
    const carolGrid = await getMemberData(await asMember(s.carol.id));
    expect(carolGrid.columns.find((c) => c.question.id === s.question.id)).toBeUndefined();
    expect(carolGrid.unavailable.map((u) => u.id)).toContain(s.question.id);
  });
});

describe("what the accompanier is shown", () => {
  beforeEach(resetDatabase);

  it("is the answers the member agreed to, with the question, and nothing when they haven't", async () => {
    const s = await setUp();
    await answered(s);
    expect((await getAccompaniedView(await asMember(s.bob.id), s.taskId))!.answers).toBeNull();
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });
    const view = await getAccompaniedView(await asMember(s.bob.id), s.taskId);
    expect(view!.answers).toEqual([{ question: "How do you like to be supported?", value: "Check in by message, not a call" }]);
  });

  it("is an empty list, not a refusal, when they chose to share and have answered nothing", async () => {
    const s = await setUp();
    await claimAs(s.bob.id, s.taskId);
    await setMyShares(s.dana, { axes: false, contribution: false, answers: true });
    expect((await getAccompaniedView(await asMember(s.bob.id), s.taskId))!.answers).toEqual([]);
  });
});
