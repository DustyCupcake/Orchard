import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  community,
  communityInvite,
  member,
  memberIdentity,
  recruitmentDecision,
  recruitmentSubscription,
  task,
} from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import type { CreateFormInput } from "@/lib/forms";
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
  { key: "name", label: "Name", responseType: "free_text", required: true, isNameField: true },
  { key: "email", label: "Email", responseType: "free_text", required: true, isEmailField: true },
];

const untaggedFields: CreateFormInput["fields"] = [
  { key: "name", label: "Name", responseType: "free_text", required: true },
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
          { key: "a", label: "A", responseType: "free_text", isNameField: true },
          { key: "b", label: "B", responseType: "free_text", isNameField: true },
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
          { key: "a", label: "A", responseType: "free_text", isEmailField: true },
          { key: "b", label: "B", responseType: "free_text", isEmailField: true },
        ],
      }),
    ).rejects.toThrow(/at most one field can be tagged as the email field/);
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
