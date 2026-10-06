import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  community,
  communityInvite,
  member,
  memberIdentity,
  memberLanguage,
  participation,
  recruitmentDecision,
  recruitmentSubscription,
  task,
} from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { createCycle } from "@/lib/cycles";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import type { CreateFormInput } from "@/lib/forms";
import { createProfileQuestion, listOnceEverAnswers, listOutstandingQuestions } from "@/lib/profile-questions";
import {
  getRecruitmentDecision,
  listOpenIntroCallsForSubscriber,
  recordDecisionIfReached,
  resolveWiderDiscussionManually,
  resolveWiderDiscussionWindows,
  setRecruitmentSubscriptionActive,
  submitEvaluation,
  submitRecruitmentApplication,
  updateRecruitmentSubscriptionLapses,
} from "@/lib/recruitment";
import type { RecruitmentDecisionRule } from "@/lib/recruitment";
import { findOrCreateMemberByEmail } from "@/lib/member";
import { confirmSlot, submitAvailability, submitAvailabilityAsApplicant } from "@/lib/scheduling-polls";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

// Phase 48's own resolved shape: a form whose fields are tagged as
// the applicant's name/email, per src/lib/forms.ts's
// isNameField/isEmailField.
const taggedFields: CreateFormInput["fields"] = [
  { key: "name", label: "Name", responseType: "text", required: true, isNameField: true },
  { key: "email", label: "Email", responseType: "text", required: true, isEmailField: true },
];

const untaggedFields: CreateFormInput["fields"] = [
  { key: "name", label: "Name", responseType: "text", required: true },
];

const PROCEED_RULES: RecruitmentDecisionRule[] = [
  { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
  { conditions: { minCounts: { decline: 2 } }, outcome: "decline" },
  { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
];

async function enableRecruitment(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  await db
    .update(community)
    .set({ modulesEnabled: [...row.modulesEnabled, "recruitment"] })
    .where(eq(community.id, communityId));
}

async function insertTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Recruitment task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      capacity: 2,
      createdBy,
    })
    .returning();
  return row;
}

async function setUp(
  fixtures: Awaited<ReturnType<typeof createFixtures>>,
  fields: CreateFormInput["fields"],
  overrides: Partial<{ decisionRules: RecruitmentDecisionRule[]; lapseThreshold: number }> = {},
) {
  const { community: testCommunity, alice, bob, branch } = fixtures;
  await enableRecruitment(testCommunity.id);
  const form = await createForm(alice, { title: "Application", fields });
  const recruitmentTask = await insertTask(testCommunity.id, branch.id, alice.id);
  await updateCommunity(alice, {
    recruitmentApplicationFormId: form.id,
    recruitmentEvaluatorCount: 2,
    recruitmentDecisionRules: overrides.decisionRules ?? PROCEED_RULES,
    ...(overrides.lapseThreshold !== undefined && { recruitmentSubscriptionLapseThreshold: overrides.lapseThreshold }),
  });
  await grantPermission(testCommunity.id, "recruitment", recruitmentTask.id);

  const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(refetchedAlice, recruitmentTask.id);
  const [refetchedBob] = await db.select().from(member).where(eq(member.id, bob.id));
  await claimTask(refetchedBob, recruitmentTask.id);

  return { form, task: recruitmentTask, alice: refetchedAlice, bob: refetchedBob, communityId: testCommunity.id };
}

describe("Form fields: isNameField/isEmailField tagging", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects more than one field tagged as the name field", async () => {
    const fixtures = await createFixtures();
    await expect(
      createForm(fixtures.alice, {
        title: "Bad form",
        fields: [
          { key: "a", label: "A", responseType: "text", isNameField: true },
          { key: "b", label: "B", responseType: "text", isNameField: true },
        ],
      }),
    ).rejects.toThrow(/at most one field can be tagged as the name field/);
  });

  it("rejects more than one field tagged as the email field", async () => {
    const fixtures = await createFixtures();
    await expect(
      createForm(fixtures.alice, {
        title: "Bad form",
        fields: [
          { key: "a", label: "A", responseType: "text", isEmailField: true },
          { key: "b", label: "B", responseType: "text", isEmailField: true },
        ],
      }),
    ).rejects.toThrow(/at most one field can be tagged as the email field/);
  });

  // Same helper, same rule, third tag — a community with two fields racing
  // to write the same table would be a data bug, not a display one.
  it("rejects more than one field tagged as the language field", async () => {
    const fixtures = await createFixtures();
    await expect(
      createForm(fixtures.alice, {
        title: "Bad form",
        fields: [
          { key: "a", label: "A", responseType: "text", isLanguageField: true },
          { key: "b", label: "B", responseType: "text", isLanguageField: true },
        ],
      }),
    ).rejects.toThrow(/at most one field can be tagged as the language field/);
  });

  it("accepts a form with one name field, one email field, and one language field", async () => {
    const fixtures = await createFixtures();
    const allThree: CreateFormInput["fields"] = [
      ...taggedFields,
      { key: "languages", label: "Languages", responseType: "text", isLanguageField: true },
    ];
    const form = await createForm(fixtures.alice, { title: "Good form", fields: allThree });
    expect(form.fields).toEqual(allThree);
  });

  it("accepts a form with one name field and one email field", async () => {
    const fixtures = await createFixtures();
    const form = await createForm(fixtures.alice, { title: "Good form", fields: taggedFields });
    expect(form.fields).toEqual(taggedFields);
  });
});

describe("Recruitment: applicant→Member conversion", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a real Member + MemberIdentity when an outcome resolves to accepted, and that email can log in afterward", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, taggedFields);

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Dana Applicant", email: "dana@example.com" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    expect(decision!.resolution).toBe("accepted");
    expect(decision!.convertedMemberId).not.toBeNull();

    const [newMember] = await db.select().from(member).where(eq(member.id, decision!.convertedMemberId!));
    expect(newMember.name).toBe("Dana Applicant");
    expect(newMember.communityId).toBe(setupResult.communityId);

    const [identity] = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.memberId, newMember.id));
    expect(identity.provider).toBe("magic_link");
    expect(identity.loginEmail).toBe("dana@example.com");

    // The whole point: the new member can now actually log in.
    const [communityRow] = await db.select().from(community).where(eq(community.id, setupResult.communityId));
    const loggedIn = await findOrCreateMemberByEmail(communityRow, "dana@example.com");
    expect(loggedIn?.id).toBe(newMember.id);
  });

  // isLanguageField exists because `member_language` is repeatable and a
  // Form's one opaque value isn't a typed list, so mapsToProfileQuestionId
  // can't reach it — the starter set's "Languages you speak" stays a
  // free-text blob that a Requirement's language check never matches. These
  // are the tests for the applicant who already said this, so the first-login
  // screen doesn't ask them to type it a second time.
  it("seeds real member_language rows from a field tagged isLanguageField", async () => {
    const fixtures = await createFixtures();
    const fieldsWithLanguages: CreateFormInput["fields"] = [
      ...taggedFields,
      { key: "languages", label: "Languages", responseType: "text", isLanguageField: true },
    ];
    const setupResult = await setUp(fixtures, fieldsWithLanguages);

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Ines Applicant", email: "ines@example.com", languages: "Spanish, Portuguese" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    const rows = await db
      .select()
      .from(memberLanguage)
      .where(eq(memberLanguage.memberId, decision!.convertedMemberId!));
    expect(rows.map((r) => r.language).sort()).toEqual(["Portuguese", "Spanish"]);
    // All at the one level the form didn't claim. A form asking one
    // question shouldn't produce a claim about fluency it never asked for.
    expect(rows.every((r) => r.level === "conversational")).toBe(true);
  });

  it("splits on newlines as well as commas, and skips empty parts", async () => {
    const fixtures = await createFixtures();
    const fieldsWithLanguages: CreateFormInput["fields"] = [
      ...taggedFields,
      { key: "languages", label: "Languages", responseType: "text", isLanguageField: true },
    ];
    const setupResult = await setUp(fixtures, fieldsWithLanguages);

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Jan Applicant", email: "jan@example.com", languages: "Dutch,\n\n  Polish  ,\n" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    const rows = await db
      .select()
      .from(memberLanguage)
      .where(eq(memberLanguage.memberId, decision!.convertedMemberId!));
    // A blank part would become a row that matches no requirement while
    // looking like an entry on /profile.
    expect(rows.map((r) => r.language).sort()).toEqual(["Dutch", "Polish"]);
  });

  it("does not duplicate or downgrade a language the member already listed", async () => {
    const fixtures = await createFixtures();
    const fieldsWithLanguages: CreateFormInput["fields"] = [
      ...taggedFields,
      { key: "languages", label: "Languages", responseType: "text", isLanguageField: true },
    ];
    const setupResult = await setUp(fixtures, fieldsWithLanguages);

    // The member has to exist *before* the decision, since that is the
    // only window where the dedupe is reachable: a Member who applied
    // earlier, already logged in, and set their own languages. Reusing the
    // existing-member-by-email path is what puts conversion on an account
    // that already has a row.
    const [existingMember] = await db
      .insert(member)
      .values({ communityId: setupResult.communityId, name: "Kim" })
      .returning();
    await db.insert(memberIdentity).values({
      memberId: existingMember.id,
      provider: "magic_link",
      loginEmail: "kim@example.com",
    });
    await db.insert(memberLanguage).values({
      memberId: existingMember.id,
      language: "English",
      level: "native",
    });

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Kim", email: "kim@example.com", languages: "English, Welsh" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);
    expect(decision!.convertedMemberId).toBe(existingMember.id);

    const rows = await db
      .select()
      .from(memberLanguage)
      .where(eq(memberLanguage.memberId, existingMember.id));
    // The form's own value for English is a duplicate of what they already
    // said, and the new one is Welsh.
    expect(rows.map((r) => r.language).sort()).toEqual(["English", "Welsh"]);
    // The member's own stated level survives — a form that didn't ask
    // about proficiency must not overwrite one that said "native".
    expect(rows.find((r) => r.language === "English")?.level).toBe("native");
    expect(rows.find((r) => r.language === "Welsh")?.level).toBe("conversational");
  });

  it("converts normally when the form asks nothing about languages", async () => {
    const setupResult = await setUp(await createFixtures(), taggedFields);
    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Lee Applicant", email: "lee@example.com" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    expect(decision!.convertedMemberId).not.toBeNull();
    const rows = await db
      .select()
      .from(memberLanguage)
      .where(eq(memberLanguage.memberId, decision!.convertedMemberId!));
    expect(rows.length).toBe(0);
  });

  it("seeds a real ProfileAnswer from a field tagged mapsToProfileQuestionId, so onboarding doesn't re-ask it", async () => {
    const fixtures = await createFixtures();
    const pronouns = await createProfileQuestion(fixtures.alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
      surfaces: ["onboarding"],
    });
    const fieldsWithMapping: CreateFormInput["fields"] = [
      ...taggedFields,
      { key: "pronouns", label: "Pronouns", responseType: "text", mapsToProfileQuestionId: pronouns.id },
    ];
    const setupResult = await setUp(fixtures, fieldsWithMapping);

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Frankie Applicant", email: "frankie@example.com", pronouns: "they/them" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    const [newMember] = await db.select().from(member).where(eq(member.id, decision!.convertedMemberId!));

    const onceEver = await listOnceEverAnswers(newMember, { surface: "onboarding" });
    expect(onceEver).toHaveLength(1);
    expect(onceEver[0].question.id).toBe(pronouns.id);
    expect(onceEver[0].answer.value).toBe("they/them");

    // Already answered — onboarding's own "still outstanding" list
    // must not ask for it again.
    const outstanding = await listOutstandingQuestions(newMember, { surface: "onboarding" });
    expect(outstanding.find((o) => o.question.id === pronouns.id)).toBeUndefined();
  });

  it("skips a mapped field that doesn't validate against its target question's shape, without blocking conversion", async () => {
    const fixtures = await createFixtures();
    const vibe = await createProfileQuestion(fixtures.alice, {
      label: "Vibe",
      responseType: "single_choice",
      options: ["Chill", "Energetic"],
      scope: "once_ever",
    });
    const fieldsWithMapping: CreateFormInput["fields"] = [
      ...taggedFields,
      { key: "vibe", label: "Vibe", responseType: "text", mapsToProfileQuestionId: vibe.id },
    ];
    const setupResult = await setUp(fixtures, fieldsWithMapping);

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Gale Applicant", email: "gale@example.com", vibe: "not one of the real options" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    expect(decision!.resolution).toBe("accepted");
    expect(decision!.convertedMemberId).not.toBeNull();

    const [newMember] = await db.select().from(member).where(eq(member.id, decision!.convertedMemberId!));
    const onceEver = await listOnceEverAnswers(newMember);
    expect(onceEver).toHaveLength(0);
  });

  it("sets the new member's referredByMemberId from the linked invite's creator, and the Accompaniment task's suggestedMemberId reads it back", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, taggedFields);

    const [invite] = await db
      .insert(communityInvite)
      .values({
        communityId: setupResult.communityId,
        createdBy: setupResult.alice.id,
        token: "test-invite-token-1",
      })
      .returning();

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Erin Applicant", email: "erin@example.com" },
      inviteToken: invite.token,
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    const [newMember] = await db.select().from(member).where(eq(member.id, decision!.convertedMemberId!));
    expect(newMember.referredByMemberId).toBe(setupResult.alice.id);

    const [accompanimentTask] = await db.select().from(task).where(eq(task.id, decision!.accompanimentTaskId!));
    expect(accompanimentTask.suggestedMemberId).toBe(setupResult.alice.id);
  });

  it("leaves convertedMemberId null, without erroring, when the application form isn't tagged", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, untaggedFields);

    const application = await submitRecruitmentApplication(setupResult.communityId, { values: { name: "Frank" } });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    expect(decision!.resolution).toBe("accepted");
    expect(decision!.convertedMemberId).toBeNull();

    const [accompanimentTask] = await db.select().from(task).where(eq(task.id, decision!.accompanimentTaskId!));
    expect(accompanimentTask.description).toMatch(/isn't tagged/);
  });

  it("links to an existing member by email instead of creating a duplicate", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, taggedFields);

    const [existingMember] = await db
      .insert(member)
      .values({ communityId: setupResult.communityId, name: "Already Here" })
      .returning();
    await db.insert(memberIdentity).values({
      memberId: existingMember.id,
      provider: "magic_link",
      loginEmail: "already-here@example.com",
    });

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Already Here (reapplying)", email: "already-here@example.com" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    expect(decision!.convertedMemberId).toBe(existingMember.id);
    const identities = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.loginEmail, "already-here@example.com"));
    expect(identities).toHaveLength(1);
  });

  it("converts on a manually-resolved wider_discussion outcome", async () => {
    const fixtures = await createFixtures();
    const rules: RecruitmentDecisionRule[] = [
      { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
    ];
    const setupResult = await setUp(fixtures, taggedFields, { decisionRules: rules });

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Gale Applicant", email: "gale@example.com" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "unsure" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "unsure" });
    await recordDecisionIfReached(setupResult.alice, application.id);

    const resolved = await resolveWiderDiscussionManually(setupResult.alice, application.id, {
      resolution: "accepted",
    });
    expect(resolved.convertedMemberId).not.toBeNull();
    const [newMember] = await db.select().from(member).where(eq(member.id, resolved.convertedMemberId!));
    expect(newMember.name).toBe("Gale Applicant");
  });

  it("converts on the scheduled wider_discussion auto-resolution job", async () => {
    const fixtures = await createFixtures();
    const rules: RecruitmentDecisionRule[] = [
      { conditions: {}, outcome: "wider_discussion", defaultResolution: "proceed" },
    ];
    const setupResult = await setUp(fixtures, taggedFields, { decisionRules: rules });

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Hana Applicant", email: "hana@example.com" },
    });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "unsure" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "unsure" });
    await recordDecisionIfReached(setupResult.alice, application.id);

    // Backdate the deadline, same technique the rest of this suite
    // already uses to exercise a scheduled job without a real wait.
    await db
      .update(recruitmentDecision)
      .set({ widerDiscussionDeadline: new Date(Date.now() - 1000) })
      .where(eq(recruitmentDecision.formResponseId, application.id));

    const result = await resolveWiderDiscussionWindows();
    expect(result.resolved).toBe(1);

    const decision = await getRecruitmentDecision(application.id);
    expect(decision!.resolution).toBe("accepted");
    expect(decision!.convertedMemberId).not.toBeNull();
  });

  it("accepting a cycle-keyed application seeds the converted member's participation as coming (§4.3/8d)", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, taggedFields);
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, setupResult.communityId));
    const cycleRow = await createCycle(setupResult.alice, { source: "blank", name: "Season A" });

    const application = await submitRecruitmentApplication(setupResult.communityId, {
      values: { name: "Dana Applicant", email: "dana@example.com" },
      cycleId: cycleRow.id,
    });
    expect(application.cycleId).toBe(cycleRow.id);
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);

    expect(decision!.resolution).toBe("accepted");
    const [newMember] = await db.select().from(member).where(eq(member.id, decision!.convertedMemberId!));
    const [row] = await db
      .select()
      .from(participation)
      .where(and(eq(participation.cycleId, cycleRow.id), eq(participation.memberId, newMember.id)));
    expect(row?.status).toBe("coming");
  });
});

describe("Recruitment: subscription auto-lapse", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function driveToConfirmedIntroCall(
    setupResult: Awaited<ReturnType<typeof setUp>>,
    applicantValues: Record<string, string>,
  ) {
    const application = await submitRecruitmentApplication(setupResult.communityId, { values: applicantValues });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(setupResult.bob, application.id, { recommendation: "proceed" });
    const decision = await recordDecisionIfReached(setupResult.alice, application.id);
    const pollId = decision!.introCallPollId!;

    const slot = "2027-06-01T10:00:00.000Z";
    await submitAvailability(setupResult.alice, pollId, { slots: [slot] });
    await submitAvailability(setupResult.bob, pollId, { slots: [slot] });
    await submitAvailabilityAsApplicant(pollId, application.id, { slots: [slot] });

    return { application, decision, pollId, slot };
  }

  it("increments an active subscriber's count when they give no availability, and lapses at the threshold", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, untaggedFields, { lapseThreshold: 2 });

    const [carol] = await db
      .insert(member)
      .values({ communityId: setupResult.communityId, name: "Carol" })
      .returning();
    await setRecruitmentSubscriptionActive(carol, true);

    // Round 1: carol doesn't submit anything for this intro call.
    const { pollId: pollId1 } = await driveToConfirmedIntroCall(setupResult, { name: "One" });
    await confirmSlot(setupResult.alice, pollId1, { slot: "2027-06-01T10:00:00.000Z" });
    let result = await updateRecruitmentSubscriptionLapses();
    expect(result.processed).toBe(1);
    expect(result.lapsed).toBe(0);

    let [sub] = await db.select().from(recruitmentSubscription).where(eq(recruitmentSubscription.memberId, carol.id));
    expect(sub.consecutiveNoAvailabilityCount).toBe(1);
    expect(sub.active).toBe(true);

    // Round 2: still nothing from carol — hits the threshold of 2.
    const { pollId: pollId2 } = await driveToConfirmedIntroCall(setupResult, { name: "Two" });
    await confirmSlot(setupResult.alice, pollId2, { slot: "2027-06-01T10:00:00.000Z" });
    result = await updateRecruitmentSubscriptionLapses();
    expect(result.lapsed).toBe(1);

    [sub] = await db.select().from(recruitmentSubscription).where(eq(recruitmentSubscription.memberId, carol.id));
    expect(sub.consecutiveNoAvailabilityCount).toBe(2);
    expect(sub.active).toBe(false);
  });

  it("resets an active subscriber's count to 0 once they submit availability for an intro call", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, untaggedFields, { lapseThreshold: 5 });

    const [carol] = await db
      .insert(member)
      .values({ communityId: setupResult.communityId, name: "Carol" })
      .returning();
    await setRecruitmentSubscriptionActive(carol, true);
    await db
      .update(recruitmentSubscription)
      .set({ consecutiveNoAvailabilityCount: 3 })
      .where(eq(recruitmentSubscription.memberId, carol.id));

    const { pollId, slot } = await driveToConfirmedIntroCall(setupResult, { name: "Three" });

    const openBefore = await listOpenIntroCallsForSubscriber(carol);
    expect(openBefore).toHaveLength(1);
    expect(openBefore[0].submittedByMe).toBe(false);

    await submitAvailability(carol, pollId, { slots: [slot] });

    const openAfter = await listOpenIntroCallsForSubscriber(carol);
    expect(openAfter[0].submittedByMe).toBe(true);

    await confirmSlot(setupResult.alice, pollId, { slot });
    await updateRecruitmentSubscriptionLapses();

    const [sub] = await db.select().from(recruitmentSubscription).where(eq(recruitmentSubscription.memberId, carol.id));
    expect(sub.consecutiveNoAvailabilityCount).toBe(0);
  });

  it("never touches a decision whose intro call hasn't confirmed a slot yet, and is a no-op for a non-subscriber", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, untaggedFields);

    const [carol] = await db
      .insert(member)
      .values({ communityId: setupResult.communityId, name: "Carol" })
      .returning();
    expect(await listOpenIntroCallsForSubscriber(carol)).toEqual([]);

    await driveToConfirmedIntroCall(setupResult, { name: "Four" });
    const result = await updateRecruitmentSubscriptionLapses();
    expect(result.processed).toBe(0);
  });
});
