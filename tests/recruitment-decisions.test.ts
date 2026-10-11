import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  admission,
  community,
  communityCheck,
  communityCheckConcern,
  member,
  recruitmentDecision,
  schedulingEntry,
  schedulingPoll,
  task,
} from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { claimTask } from "@/lib/tasks";
import { addPermissionGrant } from "@/lib/permissions";
import { createForm } from "@/lib/forms";
import type { CreateFormInput } from "@/lib/forms";
import {
  admitArrival,
  closeDueChecks,
  createCommunityInvite,
  getArrivalForFormResponse,
  getIntroCallAvailability,
  getIntroCallByToken,
  getOpenCheck,
  getRecruitmentDecision,
  listChecksFor,
  listConcerns,
  loadArrivalReadout,
  raiseConcern,
  recordDecisionIfReached,
  resolveObjection,
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
    // Its window is a community check on the arrival, not a field of the decision.
    const arrival = (await getArrivalForFormResponse(decision!.formResponseId))!;
    expect((await getOpenCheck(arrival.id))!.kind).toBe("evaluation");
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

// The wider discussion is the one community check (docs/admission-flow.md §5): a
// window on the arrival, opened when the reports lead to it, in which any member can
// raise a concern — not a field on the decision with a timer of its own.
describe("the wider discussion is a community check", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function undecided(opts: Parameters<typeof setUp>[1] = {}) {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, opts);
    const { decision, application } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    const arrival = (await getArrivalForFormResponse(application.formResponse.id))!;
    return { fixtures, setupResult, decision: decision!, application, arrival };
  }

  const expire = (arrivalId: string) =>
    db
      .update(communityCheck)
      .set({ deadline: new Date(Date.now() - 1000) })
      .where(and(eq(communityCheck.arrivalId, arrivalId), isNull(communityCheck.endedAt)));

  it("opens an evaluation window on the arrival, saying what a quiet one does", async () => {
    const { arrival, decision } = await undecided({ widerDiscussionHours: 10 });
    const check = await getOpenCheck(arrival.id);
    expect(check).toMatchObject({ kind: "evaluation", onQuiet: "decline", windowHours: 10 });
    expect(check!.deadline.getTime()).toBeGreaterThan(Date.now() + 9 * 3_600_000);
    // The decision is only the record of what the reports said; the window is the check's.
    expect(decision.resolution).toBeNull();
    const readout = await loadArrivalReadout(arrival);
    expect(readout.readout.stage).toBe("wider_discussion");
  });

  it("takes its quiet answer from the decision form, fixed when it opens", async () => {
    const { arrival } = await undecided({ policy: { ...POLICY_TWO_OF_TWO, recruitmentDiscussionEnds: "admit" } });
    expect((await getOpenCheck(arrival.id))!.onQuiet).toBe("admit");
  });

  it("leaves a window that is not yet due alone", async () => {
    const { arrival } = await undecided({ widerDiscussionHours: 1000 });
    const result = await closeDueChecks();
    expect(result).toMatchObject({ checked: 1, ended: 0 });
    expect(await getOpenCheck(arrival.id)).not.toBeNull();
  });

  it("ends a quiet window by what it said it would do — here, declining", async () => {
    const { arrival, decision } = await undecided();
    await expire(arrival.id);
    expect((await closeDueChecks()).ended).toBe(1);

    const [resolved] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
    expect(resolved.resolution).toBe("declined");
    expect((await listChecksFor(arrival.id))[0]).toMatchObject({ endedAs: "quiet" });
    expect((await db.select().from(admission).where(eq(admission.id, arrival.id)))[0].declinedAt).not.toBeNull();
  });

  it("…or admitting, which makes the member and creates the Accompaniment task", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures, { policy: { recruitmentDiscussionEnds: "admit" } });
    const { decision, application } = await submitAndDecide(fixtures, setupResult, ["unsure", "unsure"]);
    const arrival = (await getArrivalForFormResponse(application.formResponse.id))!;
    await expire(arrival.id);

    expect((await closeDueChecks()).ended).toBe(1);
    const [resolved] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision!.id));
    expect(resolved.resolution).toBe("accepted");
    expect(resolved.convertedMemberId).not.toBeNull();
    expect(resolved.accompanimentTaskId).not.toBeNull();
  });

  it("holds a window with a concern standing past its deadline — the clock never drops one", async () => {
    const { fixtures, arrival, decision } = await undecided();
    await raiseConcern(fixtures.bob, arrival.id, { note: "I have concerns" });
    await expire(arrival.id);

    const result = await closeDueChecks();
    expect(result).toMatchObject({ ended: 0, held: 1 });
    const [unchanged] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
    expect(unchanged.resolution).toBeNull();
    expect(await getOpenCheck(arrival.id)).not.toBeNull();
  });

  it("gives a wider discussion that predates windows its own, with the deadline and answer it already had", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana", email: "dana@example.com" } });
    // The shape an old database holds: a decision waiting out its window, and no arrival yet
    // that knows anything about it.
    await db.delete(admission).where(eq(admission.formResponseId, application.formResponse.id));
    await db.insert(recruitmentDecision).values({
      formResponseId: application.formResponse.id,
      ruleOutcome: "wider_discussion",
      defaultResolution: "proceed",
      widerDiscussionDeadline: new Date(Date.now() - 1000),
    });

    const result = await closeDueChecks();
    expect(result.ended).toBe(1);
    const decision = await getRecruitmentDecision(application.formResponse.id);
    expect(decision!.resolution).toBe("accepted");
    expect(decision!.convertedMemberId).not.toBeNull();
    void setupResult;
  });

  describe("raising a concern, the one way", () => {
    it("is open to any member — a subscription is not what makes someone a member", async () => {
      const { fixtures, arrival } = await undecided();
      // Bob has no recruitment subscription at all.
      const concern = await raiseConcern(fixtures.bob, arrival.id, { note: "I know this person and have concerns" });
      expect(concern.resolution).toBe("standing");
    });

    it("refuses an arrival with no window open, and one whose window has closed", async () => {
      const fixtures = await createFixtures();
      const setupResult = await setUp(fixtures);
      const { application } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);
      const declined = (await getArrivalForFormResponse(application.formResponse.id))!;
      await expect(raiseConcern(fixtures.bob, declined.id, { note: "concern" })).rejects.toThrow(/isn't open for a community check/);

      const { fixtures: f2, arrival } = await undecided();
      await expire(arrival.id);
      await expect(raiseConcern(f2.bob, arrival.id, { note: "concern" })).rejects.toThrow(/has closed/);
    });

    it("refuses an arrival in another community, and says it once per member", async () => {
      const { fixtures, arrival } = await undecided();
      const { alice: stranger, community: elsewhere } = await createFixtures();
      await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, elsewhere.id));
      await expect(raiseConcern(stranger, arrival.id, { note: "concern" })).rejects.toThrow(NotFoundError);
      await raiseConcern(fixtures.bob, arrival.id, { note: "first" });
      await expect(raiseConcern(fixtures.bob, arrival.id, { note: "second" })).rejects.toThrow(ConflictError);
    });

    it("lists a concern to the holders without ever exposing who raised it", async () => {
      const { fixtures, setupResult, arrival, decision } = await undecided();
      await raiseConcern(fixtures.bob, arrival.id, { note: "I know this person and have concerns" });

      const listed = await listConcerns(setupResult.alice, decision.formResponseId);
      expect(listed).toHaveLength(1);
      expect(listed[0].note).toBe("I know this person and have concerns");
      expect(listed[0]).not.toHaveProperty("raisedById");

      const [raw] = await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.checkId, (await getOpenCheck(arrival.id))!.id));
      expect(raw.raisedById).toBe(fixtures.bob.id);
    });

    it("lists only to the holders", async () => {
      const { decision } = await undecided();
      const { alice: strangerAlice } = await createFixtures();
      await expect(listConcerns(strangerAlice, decision.formResponseId)).rejects.toThrow(ForbiddenError);
    });
  });

  // The lost outcome this redesign names: mediation marked a concern settled and then
  // called a function only a recruitment holder may call, which refused — and the
  // window's clock later applied its *default*, admitting somebody whose concern had
  // been upheld. Here the mediation member holds no recruitment task at all.
  describe("mediation's outcome is applied by the funnel, not by whoever is a recruitment holder", () => {
    async function withMediator() {
      const base = await undecided();
      const [mediator] = await db.insert(member).values({ communityId: base.fixtures.community.id, name: "Mira" }).returning();
      const mediationTask = await insertTask(base.fixtures.community.id, base.fixtures.branch.id, base.setupResult.alice.id, { capacity: 1 });
      await addPermissionGrant(base.setupResult.alice, "recruitment_mediation", mediationTask.id);
      await claimTask(mediator, mediationTask.id);
      const concern = await raiseConcern(base.fixtures.bob, base.arrival.id, { note: "a real concern" });
      return { ...base, mediator, concern };
    }

    it("an upheld concern declines the arrival, and the clock afterwards changes nothing", async () => {
      const { arrival, decision, mediator, concern } = await withMediator();
      await resolveObjection(mediator, { objectionId: concern.id, outcome: "upheld", note: "we talked; not this time" });

      const [after] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
      expect(after.resolution).toBe("declined");
      const [row] = await db.select().from(admission).where(eq(admission.id, arrival.id));
      expect(row.declinedAt).not.toBeNull();
      expect(row.admittedMemberId).toBeNull();

      // Even with the clock long past, and the window's own default being to decline
      // here: nothing is admitted, and the record says why it ended.
      await closeDueChecks();
      expect((await listChecksFor(arrival.id))[0]).toMatchObject({ endedAs: "upheld", endedById: mediator.id });
    });

    it("an upheld concern is never admitted over, even where the window's default would admit", async () => {
      const fixtures = await createFixtures();
      const setupResult = await setUp(fixtures, { policy: { recruitmentDiscussionEnds: "admit" } });
      const { application } = await submitAndDecide(fixtures, setupResult, ["unsure", "unsure"]);
      const arrival = (await getArrivalForFormResponse(application.formResponse.id))!;
      const [mediator] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Mira" }).returning();
      const mediationTask = await insertTask(fixtures.community.id, fixtures.branch.id, setupResult.alice.id, { capacity: 1 });
      await addPermissionGrant(setupResult.alice, "recruitment_mediation", mediationTask.id);
      await claimTask(mediator, mediationTask.id);
      const concern = await raiseConcern(fixtures.bob, arrival.id, { note: "a real concern" });

      await resolveObjection(mediator, { objectionId: concern.id, outcome: "upheld", note: "not this time" });
      await db.update(communityCheck).set({ deadline: new Date(Date.now() - 1000) }).where(eq(communityCheck.arrivalId, arrival.id));
      await closeDueChecks();

      const [row] = await db.select().from(admission).where(eq(admission.id, arrival.id));
      expect(row.admittedMemberId).toBeNull();
      expect(row.declinedAt).not.toBeNull();
    });

    it("a cleared concern admits, with the member made and the Accompaniment task created", async () => {
      const { arrival, decision, mediator, concern } = await withMediator();
      await resolveObjection(mediator, { objectionId: concern.id, outcome: "cleared", note: "we talked; it's fine" });

      const [after] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
      expect(after.resolution).toBe("accepted");
      expect(after.convertedMemberId).not.toBeNull();
      expect(after.accompanimentTaskId).not.toBeNull();
      expect((await db.select().from(admission).where(eq(admission.id, arrival.id)))[0].admittedMemberId).toBe(after.convertedMemberId);
    });

    it("finishes an outcome whose last step failed: the next look reads the answer off the record", async () => {
      const { arrival, decision, mediator, concern } = await withMediator();
      // The concern was settled, and then nothing else happened (a crash, a failed write).
      await db
        .update(communityCheckConcern)
        .set({ resolution: "upheld", resolvedAt: new Date(), resolvedById: mediator.id, resolutionNote: "settled" })
        .where(eq(communityCheckConcern.id, concern.id));
      expect((await db.select().from(admission).where(eq(admission.id, arrival.id)))[0].declinedAt).toBeNull();

      expect((await closeDueChecks()).ended).toBe(1);
      const [after] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
      expect(after.resolution).toBe("declined");
      expect((await db.select().from(admission).where(eq(admission.id, arrival.id)))[0].declinedAt).not.toBeNull();
    });

    it("never admits an arrival over a standing concern, whoever asks", async () => {
      const { arrival } = await withMediator();
      await expect(admitArrival(arrival.id)).rejects.toThrow(/stands until the mediation body/);
    });
  });

  describe("two concerns on one arrival", () => {
    it("holds until every one is settled, and only then lets it go on", async () => {
      const base = await undecided();
      const [carol] = await db.insert(member).values({ communityId: base.fixtures.community.id, name: "Carol" }).returning();
      const [mediator] = await db.insert(member).values({ communityId: base.fixtures.community.id, name: "Mira" }).returning();
      const mediationTask = await insertTask(base.fixtures.community.id, base.fixtures.branch.id, base.setupResult.alice.id, { capacity: 1 });
      await addPermissionGrant(base.setupResult.alice, "recruitment_mediation", mediationTask.id);
      await claimTask(mediator, mediationTask.id);
      const first = await raiseConcern(base.fixtures.bob, base.arrival.id, { note: "one" });
      const second = await raiseConcern(carol, base.arrival.id, { note: "two" });

      await resolveObjection(mediator, { objectionId: first.id, outcome: "cleared", note: "fine" });
      expect(await getOpenCheck(base.arrival.id)).not.toBeNull();
      expect((await db.select().from(admission).where(eq(admission.id, base.arrival.id)))[0].admittedMemberId).toBeNull();

      await resolveObjection(mediator, { objectionId: second.id, outcome: "cleared", note: "also fine" });
      expect(await getOpenCheck(base.arrival.id)).toBeNull();
      expect((await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, base.decision.id)))[0].resolution).toBe("accepted");
    });

    it("lets one upheld concern decide it, and marks the others moot rather than judged", async () => {
      const base = await undecided();
      const [carol] = await db.insert(member).values({ communityId: base.fixtures.community.id, name: "Carol" }).returning();
      const [mediator] = await db.insert(member).values({ communityId: base.fixtures.community.id, name: "Mira" }).returning();
      const mediationTask = await insertTask(base.fixtures.community.id, base.fixtures.branch.id, base.setupResult.alice.id, { capacity: 1 });
      await addPermissionGrant(base.setupResult.alice, "recruitment_mediation", mediationTask.id);
      await claimTask(mediator, mediationTask.id);
      const first = await raiseConcern(base.fixtures.bob, base.arrival.id, { note: "one" });
      const second = await raiseConcern(carol, base.arrival.id, { note: "two" });

      await resolveObjection(mediator, { objectionId: first.id, outcome: "upheld", note: "it stands" });
      const [other] = await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.id, second.id));
      expect(other.resolution).toBe("moot");
      expect((await db.select().from(admission).where(eq(admission.id, base.arrival.id)))[0].declinedAt).not.toBeNull();
    });
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
