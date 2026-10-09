import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  community,
  member,
  objection,
  recruitmentDecision,
  schedulingEntry,
  schedulingPoll,
  task,
} from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import type { CreateFormInput } from "@/lib/forms";
import {
  computeWiderDiscussionStatus,
  createCommunityInvite,
  getIntroCallAvailability,
  getIntroCallByToken,
  getRecruitmentDecision,
  listObjections,
  raiseObjection,
  recordDecisionIfReached,
  resolveWiderDiscussionManually,
  resolveWiderDiscussionWindows,
  setRecruitmentSubscriptionActive,
  submitEvaluation,
  submitIntroCallAvailability,
  submitRecruitmentApplication,
} from "@/lib/recruitment";
import { createPoll } from "@/lib/scheduling-polls";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase, withApplicationOnlyLanes, POLICY_TWO_OF_TWO } from "./helpers";

const applicationFields: CreateFormInput["fields"] = [
  { key: "name", label: "Name", responseType: "text", required: true, isNameField: true },
  { key: "email", label: "Email", responseType: "text", required: true, isEmailField: true },
];

async function enableRecruitment(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  await db
    .update(community)
    .set({ modulesEnabled: [...row.modulesEnabled, "recruitment"] })
    .where(eq(community.id, communityId));
  await withApplicationOnlyLanes(communityId);
}

async function insertTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  overrides: Partial<typeof task.$inferInsert> = {},
) {
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
      ...overrides,
    })
    .returning();
  return row;
}

// Recruitment on, an application form configured, a two-slot
// recruitment task claimed by both alice and bob (two evaluators),
// and the given decision rules (defaulting to a standard 2-proceed/
// 2-decline/fallback-to-wider_discussion set).
async function setUp(
  fixtures: Awaited<ReturnType<typeof createFixtures>>,
  overrides: Partial<{
    policy: Record<string, unknown>;
    widerDiscussionHours: number;
  }> = {},
) {
  const { community: testCommunity, alice, bob, branch } = fixtures;
  await enableRecruitment(testCommunity.id);
  const form = await createForm(alice, { title: "Application", fields: applicationFields });
  const recruitmentTask = await insertTask(testCommunity.id, branch.id, alice.id);
  await updateCommunity(alice, {
    recruitmentApplicationFormId: form.id,
    ...((overrides.policy ?? POLICY_TWO_OF_TWO) as object),
    ...(overrides.widerDiscussionHours !== undefined && {
      recruitmentWiderDiscussionHours: overrides.widerDiscussionHours,
    }),
  });
  await grantPermission(testCommunity.id, "recruitment", recruitmentTask.id);

  const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(refetchedAlice, recruitmentTask.id);
  const [refetchedBob] = await db.select().from(member).where(eq(member.id, bob.id));
  await claimTask(refetchedBob, recruitmentTask.id);

  return { form, task: recruitmentTask, alice: refetchedAlice, bob: refetchedBob };
}

async function submitAndDecide(
  fixtures: Awaited<ReturnType<typeof createFixtures>>,
  setupResult: Awaited<ReturnType<typeof setUp>>,
  recommendations: ["proceed" | "decline" | "unsure", "proceed" | "decline" | "unsure"],
  inviteToken?: string,
) {
  const application = await submitRecruitmentApplication(fixtures.community.id, {
    values: { name: "Dana", email: "dana@example.com" },
    inviteToken: inviteToken ?? null,
  });
  const formResponseId = application.formResponse.id;
  await submitEvaluation(setupResult.alice, formResponseId, { recommendation: recommendations[0] });
  await submitEvaluation(setupResult.bob, formResponseId, { recommendation: recommendations[1] });
  const decision = await recordDecisionIfReached(setupResult.alice, formResponseId);
  return { application, decision };
}

describe("recordDecisionIfReached", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is null (no decision row) before enough evaluations are filed", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana", email: "dana@example.com" } });
    await submitEvaluation(setupResult.alice, application.formResponse.id, { recommendation: "proceed" });

    const decision = await recordDecisionIfReached(setupResult.alice, application.formResponse.id);
    expect(decision).toBeNull();
    expect(await getRecruitmentDecision(application.formResponse.id)).toBeNull();
  });

  it("resolves immediately to accepted for a proceed outcome, makes the member, and schedules nothing", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"]);

    expect(decision!.ruleOutcome).toBe("proceed");
    expect(decision!.resolution).toBe("accepted");
    expect(decision!.accompanimentTaskId).not.toBeNull();
    expect(decision!.convertedMemberId).not.toBeNull();
    // The interview comes *before* the decision now (docs/admission-flow.md §2), so a
    // decision schedules no call: on a lane without one there is nothing to schedule.
    expect(decision!.introCallPollId).toBeNull();
    expect(await db.select().from(schedulingPoll).where(eq(schedulingPoll.communityId, fixtures.community.id))).toHaveLength(0);
    void application;
  });

  it("resolves immediately to declined for a decline outcome, with no intro call", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);

    expect(decision!.ruleOutcome).toBe("decline");
    expect(decision!.resolution).toBe("declined");
    expect(decision!.introCallPollId).toBeNull();
    expect(decision!.accompanimentTaskId).toBeNull();
  });

  it("opens a wider_discussion window with resolution still pending, and schedules nothing", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, { widerDiscussionHours: 10 });
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);

    expect(decision!.ruleOutcome).toBe("wider_discussion");
    expect(decision!.resolution).toBeNull();
    expect(decision!.defaultResolution).toBe("decline");
    expect(decision!.introCallPollId).toBeNull();
    expect(decision!.accompanimentTaskId).toBeNull();
    expect(decision!.widerDiscussionDeadline).not.toBeNull();
    expect(computeWiderDiscussionStatus(decision!)).toBe("open");
  });

  it("pre-fills the Accompaniment task's suggestedMemberId from a linked invite's creator", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const invite = await createCommunityInvite(setupResult.alice, {});
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"], invite.token);

    const [accompanimentTask] = await db.select().from(task).where(eq(task.id, decision!.accompanimentTaskId!));
    expect(accompanimentTask.suggestedMemberId).toBe(setupResult.alice.id);
    expect(accompanimentTask.title).toBe("Accompany new member");
  });

  it("leaves suggestedMemberId null when the application had no linked invite", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"]);

    const [accompanimentTask] = await db.select().from(task).where(eq(task.id, decision!.accompanimentTaskId!));
    expect(accompanimentTask.suggestedMemberId).toBeNull();
  });

  it("is idempotent — never creates a second decision or task", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision: first } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"]);

    const second = await recordDecisionIfReached(setupResult.alice, application.formResponse.id);
    expect(second!.id).toBe(first!.id);

    const allDecisions = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, application.formResponse.id));
    expect(allDecisions).toHaveLength(1);
    const allPolls = await db.select().from(schedulingPoll).where(eq(schedulingPoll.communityId, fixtures.community.id));
    expect(allPolls).toHaveLength(0);
  });
});

describe("computeWiderDiscussionStatus", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is null for a proceed/decline decision", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);
    expect(computeWiderDiscussionStatus(decision!)).toBeNull();
  });

  it("is closed once the deadline has passed", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    expect(computeWiderDiscussionStatus(decision!)).toBe("open");

    await db
      .update(recruitmentDecision)
      .set({ widerDiscussionDeadline: new Date(Date.now() - 1000) })
      .where(eq(recruitmentDecision.id, decision!.id));
    const [expired] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision!.id));
    expect(computeWiderDiscussionStatus(expired)).toBe("closed");
  });

  it("is closed once resolved, even before the deadline", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, { widerDiscussionHours: 1000 });
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);

    const resolved = await resolveWiderDiscussionManually(setupResult.alice, decision!.formResponseId, {
      resolution: "declined",
    });
    expect(computeWiderDiscussionStatus(resolved)).toBe("closed");
  });
});

describe("resolveWiderDiscussionManually", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a non-holder", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    const { alice: strangerAlice } = await createFixtures();

    await expect(
      resolveWiderDiscussionManually(strangerAlice, decision!.formResponseId, { resolution: "accepted" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects when there's no wider_discussion decision for this application", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);

    await expect(
      resolveWiderDiscussionManually(setupResult.alice, decision!.formResponseId, { resolution: "accepted" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects when already resolved", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    await resolveWiderDiscussionManually(setupResult.alice, decision!.formResponseId, { resolution: "declined" });

    await expect(
      resolveWiderDiscussionManually(setupResult.alice, decision!.formResponseId, { resolution: "accepted" }),
    ).rejects.toThrow(ConflictError);
  });

  it("resolving to accepted creates the Accompaniment task", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);

    const resolved = await resolveWiderDiscussionManually(setupResult.alice, decision!.formResponseId, {
      resolution: "accepted",
    });
    expect(resolved.resolution).toBe("accepted");
    expect(resolved.accompanimentTaskId).not.toBeNull();
  });
});

describe("resolveWiderDiscussionWindows (scheduled job)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("leaves a not-yet-due decision untouched", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, { widerDiscussionHours: 1000 });
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);

    const result = await resolveWiderDiscussionWindows();
    expect(result.checked).toBe(0);

    const [unchanged] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision!.id));
    expect(unchanged.resolution).toBeNull();
  });

  it("auto-resolves a due, unobjected decision per its defaultResolution", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    await db
      .update(recruitmentDecision)
      .set({ widerDiscussionDeadline: new Date(Date.now() - 1000) })
      .where(eq(recruitmentDecision.id, decision!.id));

    const result = await resolveWiderDiscussionWindows();
    expect(result.checked).toBe(1);
    expect(result.resolved).toBe(1);

    const [resolved] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision!.id));
    expect(resolved.resolution).toBe("declined"); // the policy's discussion ends in a decline
  });

  it("creates the Accompaniment task using the current recruitment-task holder when resolving to accepted", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, { policy: { recruitmentDiscussionEnds: "admit" } });
    const { decision } = await submitAndDecide(fixtures, setupResult, ["unsure", "unsure"]);
    await db
      .update(recruitmentDecision)
      .set({ widerDiscussionDeadline: new Date(Date.now() - 1000) })
      .where(eq(recruitmentDecision.id, decision!.id));

    const result = await resolveWiderDiscussionWindows();
    expect(result.accompanimentsCreated).toBe(1);

    const [resolved] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision!.id));
    expect(resolved.resolution).toBe("accepted");
    expect(resolved.accompanimentTaskId).not.toBeNull();
  });

  it("skips a due decision that has a raised Objection — waits on a human call, not the timer", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    await setRecruitmentSubscriptionActive(fixtures.bob, true);
    await raiseObjection(fixtures.bob, decision!.formResponseId, { note: "I have concerns" });
    await db
      .update(recruitmentDecision)
      .set({ widerDiscussionDeadline: new Date(Date.now() - 1000) })
      .where(eq(recruitmentDecision.id, decision!.id));

    const result = await resolveWiderDiscussionWindows();
    expect(result.resolved).toBe(0);

    const [unchanged] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision!.id));
    expect(unchanged.resolution).toBeNull();
  });
});

describe("Objection: raise / list", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("requires an active subscription to raise", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);

    await expect(raiseObjection(fixtures.bob, decision!.formResponseId, { note: "concern" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("rejects for a decision that was never a wider_discussion outcome in the first place", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);
    await setRecruitmentSubscriptionActive(fixtures.bob, true);

    await expect(raiseObjection(fixtures.bob, decision!.formResponseId, { note: "concern" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects when no decision has been reached for this application at all", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana", email: "dana@example.com" } });
    await submitEvaluation(setupResult.alice, application.formResponse.id, { recommendation: "proceed" });
    await setRecruitmentSubscriptionActive(fixtures.bob, true);

    await expect(raiseObjection(fixtures.bob, application.formResponse.id, { note: "concern" })).rejects.toThrow(NotFoundError);
  });

  it("rejects once the window has already closed", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    await setRecruitmentSubscriptionActive(fixtures.bob, true);
    await db
      .update(recruitmentDecision)
      .set({ widerDiscussionDeadline: new Date(Date.now() - 1000) })
      .where(eq(recruitmentDecision.id, decision!.id));

    await expect(raiseObjection(fixtures.bob, decision!.formResponseId, { note: "concern" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("records a real objection and lists it to holders without ever exposing raisedBy", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    await setRecruitmentSubscriptionActive(fixtures.bob, true);
    await raiseObjection(fixtures.bob, decision!.formResponseId, { note: "I know this person and have concerns" });

    const listed = await listObjections(setupResult.alice, decision!.formResponseId);
    expect(listed).toHaveLength(1);
    expect(listed[0].note).toBe("I know this person and have concerns");
    expect(listed[0]).not.toHaveProperty("raisedBy");

    const [raw] = await db.select().from(objection).where(eq(objection.formResponseId, decision!.formResponseId));
    expect(raw.raisedBy).toBe(fixtures.bob.id);
  });

  it("listObjections is holder-gated", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    const { alice: strangerAlice } = await createFixtures();

    await expect(listObjections(strangerAlice, decision!.formResponseId)).rejects.toThrow(ForbiddenError);
  });
});

// Decisions made before the interview moved in front of the decision carry an intro
// call of their own, and the link an applicant was given for it has to keep working.
// New decisions never make one, so the legacy shape is built by hand here.
async function attachLegacyIntroCall(
  setupResult: Awaited<ReturnType<typeof setUp>>,
  decision: typeof recruitmentDecision.$inferSelect,
) {
  const poll = await createPoll(setupResult.alice, {
    branchId: setupResult.task.branchId,
    title: "Recruitment intro call",
    resolutionMode: "person_plus_n_holders",
    minAttendance: 2,
    requiredParticipantIds: [decision.formResponseId],
    rangeStart: "2027-06-01",
    rangeEnd: "2027-06-14",
  });
  const [updated] = await db
    .update(recruitmentDecision)
    .set({ introCallPollId: poll.id, introCallToken: "legacy-token-" + decision.id })
    .where(eq(recruitmentDecision.id, decision.id))
    .returning();
  return updated;
}

describe("Intro call: token-based public access (decisions made before the interview moved)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("resolves a valid token to the right decision + poll, and rejects a bad token", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision: made } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"]);
    const decision = await attachLegacyIntroCall(setupResult, made!);

    expect(await getIntroCallByToken("not-a-real-token")).toBeNull();

    // Plaintext, not hashed — see src/db/schema/recruitment.ts's
    // recruitmentDecision comment: there's no automated delivery
    // channel for this token, so a human (the evaluator) has to be
    // able to read it back off the decision row to relay it.
    expect(decision!.introCallToken).toBeTruthy();
    const found = await getIntroCallByToken(decision!.introCallToken!);
    expect(found?.decision.formResponseId).toBe(application.formResponse.id);
    expect(found?.poll.id).toBe(decision!.introCallPollId);
  });

  it("submits and reads back the applicant's own availability through the real token, keyed by formResponseId", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision: made } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"]);
    const decision = await attachLegacyIntroCall(setupResult, made!);
    const token = decision!.introCallToken!;

    const slots = ["2027-06-01T10:00:00.000Z", "2027-06-01T10:30:00.000Z"];
    await submitIntroCallAvailability(token, { slots });

    const [entry] = await db
      .select()
      .from(schedulingEntry)
      .where(eq(schedulingEntry.formResponseId, application.formResponse.id));
    expect(entry.memberId).toBeNull();
    expect(entry.availableSlots).toEqual(slots);
    expect(await getIntroCallAvailability(token)).toEqual(slots);

    const readBack = await getIntroCallAvailability("not-the-real-token").catch((err) => err);
    expect(readBack).toBeInstanceOf(NotFoundError);
  });
});
