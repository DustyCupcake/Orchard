import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  consentPurpose,
  cycle,
  member as memberTable,
  profileAnswer,
  profileQuestion,
  profileAnswerRuleConsent,
  sensitiveFieldAccessRule,
  settingsChange,
  taskAssignment,
  tier,
} from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { createTier } from "@/lib/settings";
import {
  createSensitiveFieldAccessRule,
  deleteSensitiveFieldAccessRule,
  listReadableSensitiveQuestionIds,
  listSensitiveFieldAccessRules,
  listAudiencesForQuestions,
  describeAudience,
  extendAnswerConsent,
  listPendingAudienceConsents,
  questionsReadableBy,
  resolveReadableAnswersForCommunity,
  resolveReadableQuestions,
  type CreateSensitiveFieldAccessRuleInput,
} from "@/lib/sensitive-data";
import { answerProfileQuestion, createProfileQuestion, updateProfileQuestion } from "@/lib/profile-questions";
import {
  createConsentPurpose,
  getGatingPurposesForQuestions,
  grantConsent,
  withdrawConsent,
} from "@/lib/consent";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";

// This file used to be about four `member` columns. Those are gone
// (migration 0080) and what remains is the thing that was underneath them
// the whole time: who may read a member's answer to a sensitive question,
// and who may not.
//
// The important thing about that is that it was untested at the only
// level that matters. `resolveReadableQuestions` had a test suite, and
// every test called it directly with a fabricated second member — while
// its one production caller passed the viewer as the owner, so level 2 of
// the ladder never executed on a real request. The tests were true and
// the feature was inert. So the emphasis here is on
// `resolveReadableAnswersForCommunity` and `getMemberData`, which is what
// the app now actually calls, and on the properties that must hold for a
// third party.

async function addMember(communityId: string, name: string) {
  const [m] = await db.insert(memberTable).values({ communityId, name }).returning();
  return m;
}

/** A question restricted to an audience, the way the app actually has to
 *  make one: created plain, given a rule, then flagged. `sensitive` is
 *  refused at create time precisely because the rule has to name the
 *  question first, so there is no one-call shortcut to use here.
 */
async function restrictedQuestion(
  actor: Parameters<typeof createProfileQuestion>[0],
  label: string,
  route: Omit<CreateSensitiveFieldAccessRuleInput, "questionId">,
  emergencyAccess = false,
) {
  return createProfileQuestion(actor, {
    label,
    responseType: "text",
    scope: "once_ever",
    sensitive: true,
    audience: route,
    emergencyAccess,
  });
}

/** Restricted, then stripped of its audience: the fail-closed state.
 *
 *  Not reachable through the write side any more — a sensitive question
 *  without an audience is refused at creation, and the flag can't be moved
 *  afterwards — so this builds it the way a Community would have before
 *  that rule existed. The read side still has to resolve it, because
 *  deleting the last rule reaches it too.
 */
async function ownerOnlyQuestion(
  actor: Parameters<typeof createProfileQuestion>[0],
  label: string,
  emergencyAccess = false,
) {
  const question = await createProfileQuestion(actor, {
    label,
    responseType: "text",
    scope: "once_ever",
    sensitive: true,
    audience: { unlockedByTierId: (await insertTier(actor, "Welfare")).id },
    emergencyAccess,
  });
  const rules = await listSensitiveFieldAccessRules(actor);
  await deleteSensitiveFieldAccessRule(actor, rules.find((r) => r.questionId === question.id)!.id);
  return question;
}

async function insertTier(actor: { communityId: string }, name: string) {
  const [row] = await db.insert(tier).values({ communityId: actor.communityId, name }).returning();
  return row;
}

describe("question access rules", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a rule with neither or both of task/tier set", async () => {
    const { alice, branch } = await createFixtures();
    const question = await createProfileQuestion(alice, {
      label: "Allergies",
      responseType: "text",
      scope: "once_ever",
    });

    await expect(
      createSensitiveFieldAccessRule(alice, { questionId: question.id }),
    ).rejects.toThrow(AppError);

    const t = await insertTask(alice.communityId, branch.id, alice.id);
    const tierRow = await createTier(alice, { name: "Kitchen" });
    await expect(
      createSensitiveFieldAccessRule(alice, {
        questionId: question.id,
        unlockedByTaskId: t.id,
        unlockedByTierId: tierRow.id,
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects a task or tier from another community", async () => {
    const { alice } = await createFixtures();
    const question = await createProfileQuestion(alice, {
      label: "Allergies",
      responseType: "text",
      scope: "once_ever",
    });
    const { branch: strangerBranch, alice: strangerAlice } = await createFixtures();
    const strangerTask = await insertTask(
      strangerAlice.communityId,
      strangerBranch.id,
      strangerAlice.id,
    );

    await expect(
      createSensitiveFieldAccessRule(alice, {
        questionId: question.id,
        unlockedByTaskId: strangerTask.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("creates, lists, and deletes rules", async () => {
    const { alice, branch } = await createFixtures();
    const question = await createProfileQuestion(alice, {
      label: "Allergies",
      responseType: "text",
      scope: "once_ever",
    });
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const created = await createSensitiveFieldAccessRule(alice, {
      questionId: question.id,
      unlockedByTaskId: t.id,
    });
    expect(created.questionId).toBe(question.id);

    const rules = await listSensitiveFieldAccessRules(alice);
    expect(rules.map((r) => r.id)).toEqual([created.id]);

    await deleteSensitiveFieldAccessRule(alice, created.id);
    expect(await listSensitiveFieldAccessRules(alice)).toHaveLength(0);
  });

  it("rejects a rule naming an archived question, and one from another community", async () => {
    // A rule against an archived question would keep restricting nothing
    // forever, and the read side skips archived questions anyway — so the
    // row is dead weight that looks live in the settings list.
    const { alice, branch } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);
    const question = await createProfileQuestion(alice, {
      label: "Old question",
      responseType: "text",
      scope: "once_ever",
    });
    await db
      .update(profileQuestion)
      .set({ archivedAt: new Date() })
      .where(eq(profileQuestion.id, question.id));
    await expect(
      createSensitiveFieldAccessRule(alice, { questionId: question.id, unlockedByTaskId: t.id }),
    ).rejects.toThrow(/archived/);

    const { alice: stranger, community: elsewhere } = await createFixtures();
    const theirs = await createProfileQuestion(stranger, {
      label: "Theirs",
      responseType: "text",
      scope: "once_ever",
    });
    expect(elsewhere.id).not.toBe(alice.communityId);
    await expect(
      createSensitiveFieldAccessRule(alice, { questionId: theirs.id, unlockedByTaskId: t.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("accepts a staged rule against a question that isn't sensitive yet", async () => {
    // Rule first, flag second. Requiring the flag here as well would
    // deadlock: the flag is refused until a rule exists, so a rule that
    // demanded the flag would leave the state unreachable. This rule
    // restricts nothing today and starts the moment the box is ticked.
    const { alice, branch } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);
    const question = await createProfileQuestion(alice, {
      label: "Not yet restricted",
      responseType: "text",
      scope: "once_ever",
      sensitive: false,
    });

    const created = await createSensitiveFieldAccessRule(alice, {
      questionId: question.id,
      unlockedByTaskId: t.id,
    });
    expect(created.questionId).toBe(question.id);
  });
});

// The three-level ladder, exercised through the function the app calls.
describe("who may read a sensitive answer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reads a non-sensitive answer for anyone, and a sensitive one only for the audience", async () => {
    const { alice, community, branch } = await createFixtures();
    const bob = await addMember(community.id, "Bob");

    const publicQ = await createProfileQuestion(alice, {
      label: "Languages",
      responseType: "text",
      scope: "once_ever",
    });
    await answerProfileQuestion(alice, publicQ.id, { status: "answered", value: "Welsh" });

    const kitchenTask = await insertTask(community.id, branch.id, alice.id);
    await grantPermission(community.id, "kitchen", kitchenTask.id);
    await claimTask(alice, kitchenTask.id);
    const privateQ = await restrictedQuestion(alice, "Allergies", {
      unlockedByGrantModuleKey: "kitchen",
    });
    await answerProfileQuestion(alice, privateQ.id, { status: "answered", value: "peanuts" });

    // Alice holds the kitchen grant, so she may read the sensitive answer.
    const asAlice = await resolveReadableAnswersForCommunity(alice);
    expect(questionsReadableBy(asAlice, alice.id)).toContain(privateQ.id);
    expect(questionsReadableBy(asAlice, alice.id)).toContain(publicQ.id);
    // Bob reads the public answer and nothing else. His own row has no
    // answers yet, so the map has no entry for him at all.
    const asBob = await resolveReadableAnswersForCommunity(bob);
    expect([...questionsReadableBy(asBob, alice.id)]).toEqual([publicQ.id]);
  });

  it("resolves to nobody but the owner for a sensitive question with no rule", async () => {
    // The state the starter set's emergency contact arrives in, and the
    // one that used to be unreachable: `sensitive` with zero rules is a
    // deliberate answer, and the read side fails closed on it rather than
    // defaulting to everyone.
    const { alice, community } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const question = await ownerOnlyQuestion(alice, "Emergency contact", true);
    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "Sam, 07700 900123",
    });

    const asBob = await resolveReadableAnswersForCommunity(bob);
    expect(questionsReadableBy(asBob, alice.id).has(question.id)).toBe(false);
    // …and the owner still sees their own.
    const asAlice = await resolveReadableAnswersForCommunity(alice);
    expect(questionsReadableBy(asAlice, alice.id)).toContain(question.id);
  });

  it("honours the answer's own share box, in both directions", async () => {
    const { alice, community, branch } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const kitchenTask = await insertTask(community.id, branch.id, alice.id);
    await grantPermission(community.id, "kitchen", kitchenTask.id);
    await claimTask(alice, kitchenTask.id);
    // Bob is the reader here, so bob has to be in the audience. Both of
    // them holding it is the ordinary case, not a contrivance: the grant
    // route is "anyone holding any task granting this module".
    const bobsKitchen = await insertTask(community.id, branch.id, bob.id, { title: "Cooks too" });
    await grantPermission(community.id, "kitchen", bobsKitchen.id);
    await claimTask(bob, bobsKitchen.id);
    const question = await restrictedQuestion(alice, "Allergies", {
      unlockedByGrantModuleKey: "kitchen",
    });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" });
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(bob), alice.id)).toContain(
      question.id,
    );

    // Un-ticking reduces it to emergency-only, and keeps it on her own
    // profile — which is the whole reason the lever is per-answer.
    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      shareWithAudience: false,
    });
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(bob), alice.id).has(question.id)).toBe(
      false,
    );
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(alice), alice.id)).toContain(
      question.id,
    );
  });

  it("honours a consent purpose gating the question, and stops honouring it on withdrawal", async () => {
    // The check the four columns had and question-keyed purposes never
    // did. `getGatingPurposesForQuestions` existed, was validated, was
    // configurable in settings, and had no caller: an admin could pin a
    // purpose to a question, a member could withdraw it, and nothing
    // changed at all.
    const { alice, community, branch } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const kitchenTask = await insertTask(community.id, branch.id, bob.id);
    await grantPermission(community.id, "kitchen", kitchenTask.id);
    await claimTask(bob, kitchenTask.id);
    const question = await restrictedQuestion(alice, "Allergies", {
      unlockedByGrantModuleKey: "kitchen",
    });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" });
    const purpose = await createConsentPurpose(alice, {
      key: "kitchen_allergies",
      label: "Kitchen allergy reads",
      noticeText: "Cooks see your allergies.",
      gatesQuestionId: question.id,
      requiresExplicit: true,
    });

    // Bob is in the audience but the answer is *alice's*, so the consent
    // that matters is hers — consent is an agreement about your own data,
    // not a permission the reader holds. In the audience, no consent: not
    // readable.
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(bob), alice.id).has(question.id)).toBe(
      false,
    );
    await grantConsent(alice, purpose.id);
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(bob), alice.id)).toContain(
      question.id,
    );
    // …and her withdrawing it takes effect on the next read.
    await withdrawConsent(alice, purpose.id);
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(bob), alice.id).has(question.id)).toBe(
      false,
    );
  });

  it("refuses to store an answer to a gated question without consent", async () => {
    const { alice } = await createFixtures();
    const question = await ownerOnlyQuestion(alice, "Allergies");
    const purpose = await createConsentPurpose(alice, {
      key: "kitchen_allergies",
      label: "Kitchen allergy reads",
      noticeText: "Cooks see your allergies.",
      gatesQuestionId: question.id,
      requiresExplicit: true,
    });
    expect(purpose.gatesQuestionId).toBe(question.id);

    await expect(
      answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" }),
    ).rejects.toThrow(ConflictError);

    await grantConsent(alice, purpose.id);
    await expect(
      answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" }),
    ).resolves.toBeDefined();
  });

  it("never needs consent to defer or decline, since neither discloses anything", async () => {
    const { alice } = await createFixtures();
    const question = await ownerOnlyQuestion(alice, "Allergies");
    await updateProfileQuestion(alice, question.id, { allowPreferNotToSay: true });
    await createConsentPurpose(alice, {
      key: "kitchen_allergies",
      label: "Kitchen allergy reads",
      noticeText: "...",
      gatesQuestionId: question.id,
      requiresExplicit: true,
    });

    await expect(
      answerProfileQuestion(alice, question.id, { status: "declined" }),
    ).resolves.toBeDefined();
    await expect(
      answerProfileQuestion(alice, question.id, { status: "deferred" }),
    ).resolves.toBeDefined();
  });

  it("ignores archived questions and per-event answers", async () => {
    // A grid about the people shouldn't carry an event's worth of
    // answers, and an archived question has nothing left to show.
    const { alice, community } = await createFixtures();
    const [archived] = await db
      .insert(profileQuestion)
      .values({
        communityId: community.id,
        label: "Retired",
        responseType: "text",
        scope: "once_ever",
        archivedAt: new Date(),
      })
      .returning();
    const [perEvent] = await db
      .insert(profileQuestion)
      .values({
        communityId: community.id,
        label: "Do you need a bed?",
        responseType: "boolean",
        scope: "per_cycle",
      })
      .returning();
    const [cycleRow] = await db
      .insert(cycle)
      .values({ communityId: community.id, name: "Autumn", startedAt: new Date() })
      .returning();
    await db.insert(profileAnswer).values([
      { memberId: alice.id, questionId: archived.id, value: "x", status: "answered" },
      { memberId: alice.id, questionId: perEvent.id, value: true, status: "answered", cycleId: cycleRow.id },
    ]);

    const readable = await resolveReadableAnswersForCommunity(alice);
    expect(questionsReadableBy(readable, alice.id).has(archived.id)).toBe(false);
    expect(questionsReadableBy(readable, alice.id).has(perEvent.id)).toBe(false);
  });

  it("resolves a tier route, a task route and a grant route identically", async () => {
    // One resolution for three routes, on purpose: a second copy per route
    // is how "task rules count, tier rules don't" bugs arrive, and the
    // whole point of having three is that they mean the same thing.
    const { alice, community, branch } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const tierRow = await createTier(alice, { name: "Kitchen" });
    const taskRow = await insertTask(community.id, branch.id, alice.id);
    const grantTask = await insertTask(community.id, branch.id, alice.id, { title: "Kitchen" });
    await grantPermission(community.id, "kitchen", grantTask.id);
    const byTier = await restrictedQuestion(alice, "By tier", { unlockedByTierId: tierRow.id });
    const byTask = await restrictedQuestion(alice, "By task", { unlockedByTaskId: taskRow.id });
    const byGrant = await restrictedQuestion(alice, "By grant", {
      unlockedByGrantModuleKey: "kitchen",
    });
    for (const q of [byTier, byTask, byGrant]) {
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "yes" });
    }

    await db
      .update(memberTable)
      .set({ tierIds: [tierRow.id] })
      .where(eq(memberTable.id, bob.id));
    await db.insert(taskAssignment).values({ taskId: taskRow.id, memberId: bob.id, isShadow: false });
    await claimTask(alice, grantTask.id);
    await db.insert(taskAssignment).values({ taskId: grantTask.id, memberId: bob.id, isShadow: false });

    // Re-read rather than mutating the fixture: `satisfiedRuleIds` resolves
    // Tier rules from `viewer.tierIds`, so a stale row would test the
    // fixture's staleness instead of the tier route.
    const [bobWithTier] = await db
      .select()
      .from(memberTable)
      .where(eq(memberTable.id, bob.id));
    const readable = await resolveReadableAnswersForCommunity(bobWithTier);
    const mine = questionsReadableBy(readable, alice.id);
    expect(mine).toContain(byTier.id);
    expect(mine).toContain(byTask.id);
    expect(mine).toContain(byGrant.id);
  });

  it("does not count a shadow holding", async () => {
    // A shadow is a real assignment row that isn't a real hold — a
    // "covering for" note. Treating it as one would hand a restricted
    // answer to someone who has explicitly said they aren't doing the job.
    const { alice, community, branch } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const taskRow = await insertTask(community.id, branch.id, alice.id);
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTaskId: taskRow.id });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" });
    await db
      .insert(taskAssignment)
      .values({ taskId: taskRow.id, memberId: bob.id, isShadow: true });
    expect(
      questionsReadableBy(await resolveReadableAnswersForCommunity(bob), alice.id).has(question.id),
    ).toBe(false);
  });

  it("keeps the single-owner resolver working for one member at a time", async () => {
    // The narrow version is still what the self-service surfaces call, and
    // it must agree with the batch one — a second implementation of the
    // same ladder is how they drift apart.
    const { alice, community, branch } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const taskRow = await insertTask(community.id, branch.id, alice.id);
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTaskId: taskRow.id });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" });
    await db.insert(taskAssignment).values({ taskId: taskRow.id, memberId: bob.id, isShadow: false });

    const rows = [{ questionId: question.id, sensitive: true, shareWithAudience: true }];
    expect(await resolveReadableQuestions(bob, alice.id, rows)).toContain(question.id);
    expect(await resolveReadableQuestions(alice, bob.id, [])).toEqual(new Set());
  });

  it("lists which sensitive questions the viewer is in the audience for", async () => {
    // What the column picker and the kitchen both ask, and the cheap
    // version of the same question the batch resolver answers expensively.
    const { alice, community, branch } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const taskRow = await insertTask(community.id, branch.id, alice.id);
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTaskId: taskRow.id });
    const publicQ = await createProfileQuestion(alice, {
      label: "Languages",
      responseType: "text",
      scope: "once_ever",
    });
    await db.insert(taskAssignment).values({ taskId: taskRow.id, memberId: bob.id, isShadow: false });

    const forBob = await listReadableSensitiveQuestionIds(bob);
    expect([...forBob]).toEqual([question.id]);
    // A non-sensitive question is not "unlocked" by anything — it's
    // readable by everyone, which is a different fact.
    expect(forBob.has(publicQ.id)).toBe(false);
  });
});

/**
 * The widening question.
 *
 * An access rule says who *may* read a question. It used to be the whole
 * answer, which meant adding a rule to a question that already had
 * answers reached every one of them at once — a group being given access
 * to people's medical and welfare details by an Admin's click, with the
 * people themselves never asked. `profile_answer_rule_consent` is the
 * second half: a rule reads an answer only where the answer's owner
 * agreed to *that rule*.
 */
describe("widening an audience", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /** Alice's allergies, restricted to the Welfare Tier, already answered. */
  async function answeredQuestion() {
    const { alice, community } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const question = await restrictedQuestion(alice, "Allergies", {
      unlockedByTierId: welfare.id,
    });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" });
    await db.update(memberTable).set({ tierIds: [welfare.id] }).where(eq(memberTable.id, bob.id));
    return { alice, bob, community, welfare, question };
  }

  it("reaches the answers given after the rule exists", async () => {
    const { alice, community } = await createFixtures();
    const bob = await addMember(community.id, "Bob");
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const kitchen = await insertTier({ communityId: community.id }, "Kitchen");
    const question = await restrictedQuestion(alice, "Allergies", {
      unlockedByTierId: welfare.id,
    });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" });

    // A second group is added *after* the answer, and the member is told.
    await createSensitiveFieldAccessRule(alice, { questionId: question.id, unlockedByTierId: kitchen.id });
    // Re-read rather than reusing the fixture object: audience resolution
    // reads `tierIds` off the member it is handed, and the resolver is
    // given a row — so a stale in-memory copy fails the tier test for a
    // reason that has nothing to do with consent.
    const inKitchen = async () =>
      (await db.select().from(memberTable).where(eq(memberTable.id, bob.id)))[0];
    await db.update(memberTable).set({ tierIds: [kitchen.id] }).where(eq(memberTable.id, bob.id));
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(await inKitchen()), alice.id).has(question.id)).toBe(false);

    // Until they agree, it is as though the rule did not exist.
    const pending = await listPendingAudienceConsents(alice);
    expect(pending.map((p) => p.questionLabel)).toEqual(["Allergies"]);
    expect(pending[0].kind).toBe("audience");
    expect(pending[0].audienceLabel).toBe("anyone in the Kitchen Tier");

    await extendAnswerConsent(alice, pending[0].answerId, pending[0].ruleId!);
    expect(questionsReadableBy(await resolveReadableAnswersForCommunity(await inKitchen()), alice.id)).toContain(question.id);
    // And the prompt is spent.
    expect(await listPendingAudienceConsents(alice)).toEqual([]);
    void community;
  });

  it("does not reach an answer given before the rule existed, ever", async () => {
    // The same setup with nobody agreeing, and the narrow resolver agrees
    // with the batch one. The two must never disagree — `resolveReadableQuestions`
    // is what /profile and the emergency read use, and a batch-only fix
    // would have left a hole in a page rather than in a test.
    const { alice, bob, question, community } = await answeredQuestion();
    const kitchen = await insertTier({ communityId: community.id }, "Kitchen");
    await createSensitiveFieldAccessRule(alice, { questionId: question.id, unlockedByTierId: kitchen.id });
    await db.update(memberTable).set({ tierIds: [kitchen.id] }).where(eq(memberTable.id, bob.id));
    const bobInKitchen = (await db.select().from(memberTable).where(eq(memberTable.id, bob.id)))[0];

    const batch = await resolveReadableAnswersForCommunity(bobInKitchen);
    expect(questionsReadableBy(batch, alice.id).has(question.id)).toBe(false);
    const narrow = await resolveReadableQuestions(bobInKitchen, alice.id, [
      { questionId: question.id, sensitive: true, shareWithAudience: true },
    ]);
    expect(narrow.has(question.id)).toBe(false);
  });

  it("agrees to one group without agreeing to the next", async () => {
    // Per (answer, rule), not per (member, question). The single
    // shareWithAudience boolean cannot express this case at all: false
    // would hide the answer from the Welfare Tier too — a narrowing nobody
    // asked for and that Tier did not consent to — and true would hand it
    // to both new groups.
    const { alice, community } = await createFixtures();
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const kitchen = await insertTier({ communityId: community.id }, "Kitchen");
    const medical = await insertTier({ communityId: community.id }, "Medical");
    const question = await restrictedQuestion(alice, "Allergies", {
      unlockedByTierId: welfare.id,
    });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: "peanuts" });
    for (const id of [kitchen.id, medical.id]) {
      await createSensitiveFieldAccessRule(alice, { questionId: question.id, unlockedByTierId: id });
    }

    const pending = (await listPendingAudienceConsents(alice)).filter((p) => p.kind === "audience");
    expect(pending).toHaveLength(2);
    const kitchenRow = pending.find((p) => p.audienceLabel?.includes("Kitchen"))!;
    await extendAnswerConsent(alice, kitchenRow.answerId, kitchenRow.ruleId!);

    // The Welfare Tier and the owner still read it; the group that was not
    // agreed to does not.
    for (const [viewerTier, expected] of [
      [welfare.id, true],
      [kitchen.id, true],
      [medical.id, false],
    ] as const) {
      const [viewer] = await db
        .insert(memberTable)
        .values({ communityId: community.id, name: `V-${viewerTier.slice(0, 4)}`, tierIds: [viewerTier] })
        .returning();
      const readable = await resolveReadableAnswersForCommunity(viewer);
      expect(questionsReadableBy(readable, alice.id).has(question.id)).toBe(expected);
    }
  });

  it("is scoped to the answer's own owner", async () => {
    // A forged POST naming somebody else's answer must not consent on
    // their behalf — the whole point is that the person who would be read
    // is the one who says yes. Scoped in the lib rather than only in the
    // action, so a second caller can't get it wrong.
    const { alice, bob, community, question } = await answeredQuestion();
    const kitchen = await insertTier({ communityId: community.id }, "Kitchen");
    const rule = await createSensitiveFieldAccessRule(alice, {
      questionId: question.id,
      unlockedByTierId: kitchen.id,
    });
    const [answer] = await db.select().from(profileAnswer).where(eq(profileAnswer.questionId, question.id));

    // Bob tries to extend Alice's sharing.
    await expect(extendAnswerConsent(bob, answer.id, rule.id)).rejects.toThrow(NotFoundError);
    // …and Alice can.
    await extendAnswerConsent(alice, answer.id, rule.id);
    const consents = await db
      .select()
      .from(profileAnswerRuleConsent)
      .where(eq(profileAnswerRuleConsent.ruleId, rule.id));
    expect(consents).toHaveLength(1);
  });

  it("refuses consent for a rule that names a different question", async () => {
    const { alice, question } = await answeredQuestion();
    const other = await restrictedQuestion(alice, "Something else", {
      unlockedByTierId: (await insertTier({ communityId: alice.communityId }, "Kitchen")).id,
    });
    const [answer] = await db.select().from(profileAnswer).where(eq(profileAnswer.questionId, question.id));
    const rules = await listSensitiveFieldAccessRules(alice);
    const otherRule = rules.find((r) => r.questionId === other.id)!;
    expect(otherRule).toBeTruthy();
    await expect(extendAnswerConsent(alice, answer.id, otherRule.id)).rejects.toThrow(
      /doesn't apply to this answer/,
    );
  });
});

// What the answer form does now: one box per audience, so consent is
// granted *and withdrawn* per group. The widening half of this was already
// per (answer, rule) and is covered above; what is new here is that the
// first asking is per audience too, so the two halves of the model finally
// agree with each other.
describe("consenting per audience on the answer form", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("shares with exactly the audiences ticked, and no others", async () => {
    const { alice, community } = await createFixtures();
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const kitchen = await insertTier({ communityId: community.id }, "Kitchen");
    const medical = await insertTier({ communityId: community.id }, "Medical");
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTierId: welfare.id });
    for (const id of [kitchen.id, medical.id]) {
      await createSensitiveFieldAccessRule(alice, { questionId: question.id, unlockedByTierId: id });
    }
    const rules = await listSensitiveFieldAccessRules(alice);
    const byTier = (tierId: string) => rules.find((r) => r.unlockedByTierId === tierId)!.id;

    // The form offered all three, and the member unticked the Medical Tier.
    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      shareRuleIds: [byTier(welfare.id), byTier(kitchen.id)],
    });

    for (const [viewerTier, expected] of [
      [welfare.id, true],
      [kitchen.id, true],
      [medical.id, false],
    ] as const) {
      const [viewer] = await db
        .insert(memberTable)
        .values({ communityId: community.id, name: `V-${viewerTier.slice(0, 4)}`, tierIds: [viewerTier] })
        .returning();
      const readable = await resolveReadableAnswersForCommunity(viewer);
      expect(questionsReadableBy(readable, alice.id).has(question.id)).toBe(expected);
    }
  });

  it("takes an audience *away* when a box is cleared on a re-save", async () => {
    // The half that makes per-audience boxes worth having. Without the
    // revoke, a control that could only ever add would be worse than the
    // single box it replaced: the member would have no way to narrow
    // sharing to a subset of what they'd already agreed to.
    const { alice, community } = await createFixtures();
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const kitchen = await insertTier({ communityId: community.id }, "Kitchen");
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTierId: welfare.id });
    const kitchenRule = await createSensitiveFieldAccessRule(alice, {
      questionId: question.id,
      unlockedByTierId: kitchen.id,
    });
    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      shareRuleIds: (await listSensitiveFieldAccessRules(alice)).map((r) => r.id),
    });

    const [kitchenReader] = await db
      .insert(memberTable)
      .values({ communityId: community.id, name: "Kitchen reader", tierIds: [kitchen.id] })
      .returning();
    expect(
      questionsReadableBy(await resolveReadableAnswersForCommunity(kitchenReader), alice.id).has(question.id),
    ).toBe(true);

    // Same answer, saved again, with only the Welfare Tier still ticked.
    const welfareRule = (await listSensitiveFieldAccessRules(alice)).find(
      (r) => r.unlockedByTierId === welfare.id,
    )!;
    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      shareRuleIds: [welfareRule.id],
    });

    expect(
      questionsReadableBy(await resolveReadableAnswersForCommunity(kitchenReader), alice.id).has(question.id),
    ).toBe(false);
    const [answer] = await db.select().from(profileAnswer).where(eq(profileAnswer.questionId, question.id));
    const rows = await db
      .select()
      .from(profileAnswerRuleConsent)
      .where(eq(profileAnswerRuleConsent.answerId, answer.id));
    expect(rows.map((r) => r.ruleId)).toEqual([welfareRule.id]);
    expect(rows.map((r) => r.ruleId)).not.toContain(kitchenRule.id);
  });

  it("stores the answer as unshared when every box is unticked", async () => {
    // "Nobody on the list" is the same decision the old single box's
    // unticked state meant — reduce to yourself and emergency — so the
    // read path's Level-2 test has to see it as such rather than as
    // "shared with an empty set".
    const { alice } = await createFixtures();
    const question = await restrictedQuestion(alice, "Allergies", {
      unlockedByTierId: (await insertTier({ communityId: alice.communityId }, "Welfare")).id,
    });
    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      shareRuleIds: [],
    });
    const [answer] = await db.select().from(profileAnswer).where(eq(profileAnswer.questionId, question.id));
    expect(answer.shareWithAudience).toBe(false);
  });

  it("grants nothing for a rule belonging to another question", async () => {
    // A forged POST naming a foreign rule id must not consent to anything.
    // The ids are intersected against the question's own rules rather than
    // checked one by one, so this fails closed with no extra lookup.
    const { alice, community } = await createFixtures();
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const kitchen = await insertTier({ communityId: community.id }, "Kitchen");
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTierId: welfare.id });
    const foreign = await restrictedQuestion(alice, "Medication", { unlockedByTierId: kitchen.id });
    const foreignRule = (await listSensitiveFieldAccessRules(alice)).find(
      (r) => r.questionId === foreign.id,
    )!;

    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      shareRuleIds: [foreignRule.id],
    });
    // Not shared — and the foreign question is untouched by any of it.
    const [answer] = await db.select().from(profileAnswer).where(eq(profileAnswer.questionId, question.id));
    expect(answer.shareWithAudience).toBe(false);
    const foreignConsent = await db
      .select()
      .from(profileAnswerRuleConsent)
      .where(eq(profileAnswerRuleConsent.ruleId, foreignRule.id));
    expect(foreignConsent).toEqual([]);
  });

  it("still consents the whole audience for a caller that sends only the boolean", async () => {
    // The old call shape has to keep working and keep meaning what it
    // meant: a surface with no per-audience UI really was offering one tick
    // for the whole set, so treating it as consent to all of it is correct
    // rather than a silent upgrade to per-audience.
    const { alice, community } = await createFixtures();
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTierId: welfare.id });
    const [reader] = await db
      .insert(memberTable)
      .values({ communityId: community.id, name: "Welfare reader", tierIds: [welfare.id] })
      .returning();

    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      shareWithAudience: true,
    });
    expect(
      questionsReadableBy(await resolveReadableAnswersForCommunity(reader), alice.id).has(question.id),
    ).toBe(true);
  });
});

describe("naming an audience", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("gives every audience on a question, by name", async () => {
    const { alice, community } = await createFixtures();
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTierId: welfare.id });
    await createSensitiveFieldAccessRule(alice, { questionId: question.id, unlockedByGrantModuleKey: "kitchen" });

    const audiences = await listAudiencesForQuestions(community.id, [question.id]);
    expect(audiences.get(question.id)?.map((a) => a.label).sort()).toEqual([
      "anyone holding a Kitchen grant",
      "anyone in the Welfare Tier",
    ]);
  });

  it("uses the same words the second asking does", async () => {
    // The form and the widening prompt are the same consent asked twice.
    // If they described the group differently, a member could agree to the
    // Kitchen in one place and to something else in the other.
    const { alice, community } = await createFixtures();
    const welfare = await insertTier({ communityId: community.id }, "Welfare");
    const question = await restrictedQuestion(alice, "Allergies", { unlockedByTierId: welfare.id });
    await answerProfileQuestion(alice, question.id, {
      status: "answered",
      value: "peanuts",
      // Ticking only the Welfare Tier leaves the Kitchen grant as the one
      // audience still to be asked about, which is the prompt under test.
      shareRuleIds: (await listSensitiveFieldAccessRules(alice)).map((r) => r.id),
    });
    await createSensitiveFieldAccessRule(alice, { questionId: question.id, unlockedByGrantModuleKey: "kitchen" });

    const formLabels = (await listAudiencesForQuestions(community.id, [question.id]))
      .get(question.id)!
      .map((a) => a.label)
      .sort();
    const promptLabels = (await listPendingAudienceConsents(alice))
      .filter((p) => p.kind === "audience")
      .map((p) => p.audienceLabel)
      .sort();
    expect(promptLabels).toEqual(["anyone holding a Kitchen grant"]);
    expect(formLabels).toEqual(expect.arrayContaining(promptLabels));
  });

  it("names a vanished Tier or Task rather than printing an id", () => {
    // `describeAudience` is pure and this is its whole reason for existing:
    // the fallback text. Reachable only if a referenced Tier or Task goes
    // away — which the foreign keys on `sensitive_field_access_rule` in fact
    // prevent — so the dangling state cannot be built in a database and is
    // tested here instead. A member must never be asked to agree to
    // "share with 7b3f…", and a map miss must not print one.
    expect(
      describeAudience({ unlockedByGrantModuleKey: null, unlockedByTierId: "tier-1", unlockedByTaskId: null }),
    ).toBe("anyone in the Tier this Community has since removed Tier");
    expect(
      describeAudience({ unlockedByGrantModuleKey: null, unlockedByTierId: null, unlockedByTaskId: "task-1" }),
    ).toBe("anyone holding the “Task this Community has since removed” Task");
    // A rule carrying no route at all is readable by nobody, so calling it
    // "another group in this Community" would be a lie a member is being
    // asked to agree to.
    expect(
      describeAudience({ unlockedByGrantModuleKey: null, unlockedByTierId: null, unlockedByTaskId: null }),
    ).toBe("a group with no audience");
  });

  it("reports nothing for a question with no audience at all", async () => {
    // The form's "nobody else can read this" case depends on this being an
    // empty list rather than a placeholder row.
    const { alice } = await createFixtures();
    const question = await ownerOnlyQuestion(alice, "Allergies");
    const audiences = await listAudiencesForQuestions(alice.communityId, [question.id]);
    expect(audiences.get(question.id)).toBeUndefined();
  });
});

describe("consent purposes over questions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns nothing for a community with no gated question", async () => {
    const { community } = await createFixtures();
    expect(await getGatingPurposesForQuestions(community.id)).toEqual(new Map());
  });
});

describe("the rules table is question-only", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("cannot represent the old 'a column or a question' ambiguity", async () => {
    // The exact-one-of-two rule the application layer enforced for years
    // existed only because a row could name either a column or a
    // question. With the columns gone question_id is NOT NULL, so the
    // ambiguity is unrepresentable rather than validated — which is the
    // stronger of the two, and is why the write-side check went with it.
    expect(Object.keys(sensitiveFieldAccessRule)).toContain("questionId");
    expect(Object.keys(sensitiveFieldAccessRule)).not.toContain("fieldKey");
    expect(sensitiveFieldAccessRule.questionId.notNull).toBe(true);
  });

  it("carries emergency consent on the answer, not in the rule table", () => {
    // The audience half needed a table because a rule is a set and consent
    // is per member of it. Emergency access is one route, so consent is one
    // fact about a person and belongs on the answer.
    //
    // Asserted as an absence because the alternative was a nullable
    // `rule_id` with a magic value, or a sentinel rule row that isn't a
    // rule — both of which put a fake audience in a table whose whole
    // meaning is "somebody in this Community may read this question".
    const names = Object.keys(profileAnswerRuleConsent);
    expect(names).toContain("ruleId");
    expect(names).not.toContain("emergency");
    expect(Object.keys(profileAnswer)).toContain("emergencyConsent");
  });

  it("and the consent purpose has only the question target left", () => {
    expect(Object.keys(consentPurpose)).toContain("gatesQuestionId");
    expect(Object.keys(consentPurpose)).not.toContain("gatesSensitiveField");
  });
});

// createProfileQuestion used to commit the question, then create its rule,
// then set the sensitive flag — three steps. A failure in the middle (a
// task deleted since the form rendered, say) left a question that was NOT
// sensitive and so readable by everyone, with the Admin shown an error,
// and because `sensitive` can't be changed afterwards it could only be
// archived once members had answered it as a public question.
describe("creating a sensitive question is all-or-nothing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("leaves no question, no rule and no log row behind when the audience can't be created", async () => {
    const { alice } = await createFixtures();
    const questionsBefore = await db.select().from(profileQuestion);
    const logBefore = await db.select().from(settingsChange);

    await expect(
      createProfileQuestion(alice, {
        label: "Allergies",
        responseType: "text",
        scope: "once_ever",
        sensitive: true,
        // A task that doesn't exist: passes the shape checks, fails inside
        // the rule creation — i.e. after the question row has been written.
        audience: { unlockedByTaskId: crypto.randomUUID() },
      }),
    ).rejects.toThrow(NotFoundError);

    expect(await db.select().from(profileQuestion)).toHaveLength(questionsBefore.length);
    expect(await db.select().from(sensitiveFieldAccessRule)).toEqual([]);
    expect(await db.select().from(settingsChange)).toHaveLength(logBefore.length);
  });

  it("still creates the question, its rule and the flag together when it can", async () => {
    const { alice } = await createFixtures();
    const created = await createProfileQuestion(alice, {
      label: "Allergies",
      responseType: "text",
      scope: "once_ever",
      sensitive: true,
      audience: { unlockedByGrantModuleKey: "kitchen" },
    });
    expect(created.sensitive).toBe(true);
    const rules = await db.select().from(sensitiveFieldAccessRule).where(eq(sensitiveFieldAccessRule.questionId, created.id));
    expect(rules).toHaveLength(1);
  });
});
