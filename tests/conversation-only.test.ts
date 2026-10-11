import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { admission, community, evaluation, member, recruitmentDecision } from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes, POLICY_TWO_OF_TWO } from "./helpers";
import { claimTask } from "@/lib/tasks";
import { createForm } from "@/lib/forms";
import { updateCommunity } from "@/lib/settings";
import { submitAvailability } from "@/lib/scheduling-polls";
import {
  closeDueChecks,
  confirmInterview,
  createCommunityInvite,
  getArrivalDecision,
  getOpenCheck,
  getRecruitmentPipeline,
  listConversationsForEvaluation,
  loadArrivalReadout,
  markInterviewHeld,
  raiseConcern,
  recordArrivalDecisionIfReached,
  redeemCommunityInvite,
  submitArrivalEvaluation,
  submitInterviewAvailability,
} from "@/lib/recruitment";
import { ConflictError, ForbiddenError } from "@/lib/errors";

// docs/admission-flow.md §4: reports and decisions are about an *arrival*, with the
// application simply one thing it can have. A lane that asks only for a conversation —
// no application — used to wait for its interview and then have nobody's application
// to hang the reports on, so it could never be decided.

const inDays = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
};

async function setUp() {
  const fixtures = await createFixtures();
  const { community: c, alice, bob, branch } = fixtures;
  await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
  const [carol] = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
  const form = await createForm(alice, {
    title: "Application",
    fields: [
      { key: "name", label: "Name", responseType: "text", required: true, isNameField: true },
      { key: "email", label: "Email", responseType: "text", required: true, isEmailField: true },
    ],
  });
  await updateCommunity(alice, { recruitmentApplicationFormId: form.id, ...POLICY_TWO_OF_TWO });
  await setLanes(c.id, [
    { name: "Meet us", kind: "invite", handlesKnowsPersonally: true, handlesGoodFitOnly: true, handlesNeither: true, applicationRequired: false, interviewRequired: true },
    { name: "Open", kind: "public", interviewRequired: true },
  ]);
  const recruitmentTask = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
  await grantPermission(c.id, "recruitment", recruitmentTask.id);
  await claimTask(alice, recruitmentTask.id);
  await claimTask(bob, recruitmentTask.id);

  const invite = await createCommunityInvite(alice, {});
  const outcome = await redeemCommunityInvite(invite.token, { email: "eve@example.com" });
  if (outcome.kind !== "waiting") throw new Error(`expected waiting, got ${outcome.kind}`);
  const fresh = async () => (await db.select().from(admission).where(eq(admission.id, outcome.arrivalId)))[0]!;
  return { ...fixtures, carol, invite, arrivalId: outcome.arrivalId, fresh };
}

async function heldConversation() {
  const s = await setUp();
  const arrival = await s.fresh();
  expect(arrival.formResponseId).toBeNull();
  const slot = inDays(2);
  await submitAvailability(s.alice, arrival.interviewPollId!, { slots: [slot] });
  await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] });
  await submitInterviewAvailability(arrival, [slot]);
  await confirmInterview(s.alice, arrival.id, slot);
  await markInterviewHeld(s.alice, arrival.id);
  return { ...s, arrival, slot };
}

describe("a lane that asks only for a conversation", () => {
  beforeEach(resetDatabase);

  it("is decided from the interviewers' reports, and the person is admitted", async () => {
    const { alice, bob, arrival, fresh } = await heldConversation();

    await submitArrivalEvaluation(alice, arrival.id, { recommendation: "proceed" });
    expect(await getArrivalDecision(arrival.id)).toBeNull(); // one of two reports
    await submitArrivalEvaluation(bob, arrival.id, { recommendation: "proceed", notes: "easy to talk to" });
    const decision = await recordArrivalDecisionIfReached(alice, arrival.id);

    expect(decision).toMatchObject({ ruleOutcome: "proceed", resolution: "accepted", arrivalId: arrival.id, formResponseId: null });
    const done = await fresh();
    expect(done.admittedMemberId).not.toBeNull();
    expect(decision!.convertedMemberId).toBe(done.admittedMemberId);
    // A member now, named as they gave their name — there was no application to take answers from.
    const [made] = await db.select().from(member).where(eq(member.id, done.admittedMemberId!));
    expect(made.referredByMemberId).not.toBeNull();
    // And the Accompaniment task the decision makes for anyone accepted.
    expect(decision!.accompanimentTaskId).not.toBeNull();
  });

  it("files reports against the arrival, once per interviewer, updated in place", async () => {
    const { alice, arrival } = await heldConversation();
    await submitArrivalEvaluation(alice, arrival.id, { recommendation: "unsure" });
    await submitArrivalEvaluation(alice, arrival.id, { recommendation: "proceed" });
    const rows = await db.select().from(evaluation).where(eq(evaluation.arrivalId, arrival.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recommendation: "proceed", formResponseId: null });
  });

  it("keeps the same rules as any lane: after the call, by the people on it, never for a non-holder", async () => {
    const s = await setUp();
    const arrival = await s.fresh();
    // Before the interview there is nothing to report on.
    await expect(submitArrivalEvaluation(s.alice, arrival.id, { recommendation: "proceed" })).rejects.toThrow(/hasn't happened yet/);

    const slot = inDays(2);
    await submitAvailability(s.alice, arrival.interviewPollId!, { slots: [slot] });
    await submitAvailability(s.bob, arrival.interviewPollId!, { slots: [slot] });
    await submitInterviewAvailability(arrival, [slot]);
    await confirmInterview(s.alice, arrival.id, slot);
    await markInterviewHeld(s.alice, arrival.id);
    await expect(submitArrivalEvaluation(s.carol, arrival.id, { recommendation: "proceed" })).rejects.toThrow(/recruitment-task holder/);

    // Another community's holder can't see it at all.
    const { alice: stranger } = await createFixtures();
    await expect(submitArrivalEvaluation(stranger, arrival.id, { recommendation: "proceed" })).rejects.toThrow();
  });

  it("refuses a report about an arrival whose lane asks for none, or that has finished", async () => {
    const { alice, bob, arrival } = await heldConversation();
    await submitArrivalEvaluation(alice, arrival.id, { recommendation: "decline" });
    await submitArrivalEvaluation(bob, arrival.id, { recommendation: "decline" });
    await recordArrivalDecisionIfReached(alice, arrival.id);
    await expect(submitArrivalEvaluation(alice, arrival.id, { recommendation: "proceed" })).rejects.toThrow(ConflictError);
  });

  it("goes to a wider discussion like any other, and a concern in it is raised the usual way", async () => {
    const { alice, bob, carol, arrival, fresh } = await heldConversation();
    await submitArrivalEvaluation(alice, arrival.id, { recommendation: "proceed" });
    await submitArrivalEvaluation(bob, arrival.id, { recommendation: "unsure" });
    const decision = await recordArrivalDecisionIfReached(alice, arrival.id);
    expect(decision!.ruleOutcome).toBe("wider_discussion");

    const window = await getOpenCheck(arrival.id);
    expect(window).toMatchObject({ kind: "evaluation", onQuiet: "decline" });
    expect((await loadArrivalReadout(await fresh())).readout.stage).toBe("wider_discussion");
    await raiseConcern(carol, arrival.id, { note: "I know something" });

    // Quiet-windows end by what the form said; this one has a concern, so it is held.
    await db.update((await import("@/db/schema")).communityCheck).set({ deadline: new Date(Date.now() - 1000) }).where(eq((await import("@/db/schema")).communityCheck.arrivalId, arrival.id));
    expect(await closeDueChecks()).toMatchObject({ ended: 0, held: 1 });
  });

  it("a wider discussion with no concern ends by the form's answer, and declines the arrival", async () => {
    const { alice, bob, arrival, fresh } = await heldConversation();
    await submitArrivalEvaluation(alice, arrival.id, { recommendation: "proceed" });
    await submitArrivalEvaluation(bob, arrival.id, { recommendation: "unsure" });
    await recordArrivalDecisionIfReached(alice, arrival.id);
    const { communityCheck } = await import("@/db/schema");
    await db.update(communityCheck).set({ deadline: new Date(Date.now() - 1000) }).where(eq(communityCheck.arrivalId, arrival.id));

    expect((await closeDueChecks()).ended).toBe(1);
    expect((await fresh()).declinedAt).not.toBeNull();
    const [decision] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.arrivalId, arrival.id));
    expect(decision.resolution).toBe("declined");
  });

  it("is listed for the holders, with where the conversation is, and shows up in the pipeline", async () => {
    const { alice, arrival } = await heldConversation();
    const listed = await listConversationsForEvaluation(alice);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ evaluationsFiled: 0, evaluatorsNeeded: 2 });
    expect(listed[0].arrival.id).toBe(arrival.id);
    expect(listed[0].interview?.held).toBeTruthy();
    const candidate = (await getRecruitmentPipeline(alice)).candidates.find((c) => c.id === arrival.id)!;
    expect(candidate.needsAction).toBe(true);
    expect(candidate.actionLabel).toMatch(/Reports needed/);
  });

  it("is not listed to someone who holds nothing", async () => {
    const { carol } = await heldConversation();
    await expect(listConversationsForEvaluation(carol)).rejects.toThrow(ForbiddenError);
  });
});

describe("reports made before they were keyed on the arrival", () => {
  beforeEach(resetDatabase);

  it("belong to the arrival once it exists, so nothing already filed is lost", async () => {
    const { ensureArrivalForApplication, submitRecruitmentApplication } = await import("@/lib/recruitment");
    const fixtures = await createFixtures();
    const { community: c, alice } = fixtures;
    await db.update(community).set({ modulesEnabled: ["recruitment"] }).where(eq(community.id, c.id));
    const form = await createForm(alice, {
      title: "Application",
      fields: [
        { key: "name", label: "Name", responseType: "text", required: true, isNameField: true },
        { key: "email", label: "Email", responseType: "text", required: true, isEmailField: true },
      ],
    });
    await updateCommunity(alice, { recruitmentApplicationFormId: form.id });
    await setLanes(c.id, [{ name: "Open", kind: "public" }]);
    const application = await submitRecruitmentApplication(c.id, { values: { name: "Dana", email: "dana@example.com" } });
    // The old shape: a report and a decision with an application and no arrival.
    await db.insert(evaluation).values({ formResponseId: application.formResponse.id, evaluatorId: alice.id, recommendation: "proceed" });
    await db.insert(recruitmentDecision).values({ formResponseId: application.formResponse.id, ruleOutcome: "proceed" });

    const arrival = (await ensureArrivalForApplication(application.formResponse.id))!;
    const [report] = await db.select().from(evaluation).where(and(eq(evaluation.formResponseId, application.formResponse.id)));
    const [decision] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, application.formResponse.id));
    expect(report.arrivalId).toBe(arrival.id);
    expect(decision.arrivalId).toBe(arrival.id);
  });
});
