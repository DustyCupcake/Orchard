import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle as cycleTable, member, task } from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { claimTask } from "@/lib/tasks";
import { createTier } from "@/lib/settings";
import { createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { createForm } from "@/lib/forms";
import type { CreateFormInput } from "@/lib/forms";
import {
  getRecruitmentPipeline,
  listRecruitmentActionItems,
  recordDecisionIfReached,
  submitEvaluation,
  submitRecruitmentApplication,
} from "@/lib/recruitment";
import { ForbiddenError } from "@/lib/errors";
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
// recruitment task claimed by both alice and bob (two evaluators) —
// the same fixture shape tests/recruitment-decisions.test.ts already
// established.
async function setUp(
  fixtures: Awaited<ReturnType<typeof createFixtures>>,
  overrides: Partial<{ policy: Record<string, unknown> }> = {},
) {
  const { community: testCommunity, alice, bob, branch } = fixtures;
  await enableRecruitment(testCommunity.id);
  const form = await createForm(alice, { title: "Application", fields: applicationFields });
  const recruitmentTask = await insertTask(testCommunity.id, branch.id, alice.id);
  await updateCommunity(alice, {
    recruitmentApplicationFormId: form.id,
    ...((overrides.policy ?? POLICY_TWO_OF_TWO) as object),
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
  email: string = "dana@example.com",
) {
  const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana", email } });
  await submitEvaluation(setupResult.alice, application.formResponse.id, { recommendation: recommendations[0] });
  await submitEvaluation(setupResult.bob, application.formResponse.id, { recommendation: recommendations[1] });
  const decision = await recordDecisionIfReached(setupResult.alice, application.formResponse.id);
  return { application, decision };
}

describe("getRecruitmentPipeline — the stage is the admission stage", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const candidateOf = async (alice: Awaited<ReturnType<typeof setUp>>["alice"], arrivalId: string) =>
    (await getRecruitmentPipeline(alice)).candidates.find((c) => c.id === arrivalId)!;

  it("is 'application_submitted' right after submission, and the holders owe reports", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana", email: "dana@example.com" } });

    const candidate = await candidateOf(setupResult.alice, application.arrivalId);
    expect(candidate).toMatchObject({ stage: "application_submitted", evaluationsFiled: 0, reportsNeeded: 2, name: "Dana", needsAction: true });
    expect(candidate.actionLabel).toBe("Reports needed (0 of 2)");
    expect(candidate.formResponseId).toBe(application.formResponse.id);
  });

  it("is 'evaluation_in_progress' once some but not all reports are in", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana", email: "dana@example.com" } });
    await submitEvaluation(setupResult.alice, application.formResponse.id, { recommendation: "proceed" });

    const candidate = await candidateOf(setupResult.alice, application.arrivalId);
    expect(candidate.stage).toBe("evaluation_in_progress");
    expect(candidate.evaluationsFiled).toBe(1);
    expect(candidate.actionLabel).toBe("Reports needed (1 of 2)");
  });

  it("is 'declined' immediately for a decline outcome, since the decision closed the arrival", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);

    const candidate = await candidateOf(setupResult.alice, application.arrivalId);
    expect(candidate.stage).toBe("declined");
    expect(candidate.needsAction).toBe(false);
    expect(candidate.decision?.resolution).toBe("declined");
  });

  it("is 'admitted' immediately for a proceed outcome, with the member made and an accompaniment task filed", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"], "accepted@example.com");
    expect(decision!.accompanimentTaskId).not.toBeNull();

    const candidate = await candidateOf(setupResult.alice, application.arrivalId);
    expect(candidate.stage).toBe("admitted");
    expect(candidate.sentence).toMatch(/You're in/);
  });

  it("is 'wider_discussion' while the window is open — the community's, so nobody is stuck", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"], "wider@example.com");
    expect(decision!.ruleOutcome).toBe("wider_discussion");
    // The decision no longer schedules a call: that already happened before it.
    expect(decision!.introCallPollId).toBeNull();

    const candidate = await candidateOf(setupResult.alice, application.arrivalId);
    expect(candidate.stage).toBe("wider_discussion");
    expect(candidate.needsAction).toBe(false);
  });
});

describe("getRecruitmentPipeline — capacity & composition context", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns null capacity with no current Cycle", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { capacity } = await getRecruitmentPipeline(setupResult.alice);
    expect(capacity).toBeNull();
  });

  it("returns the current Cycle's remaining capacity once one exists", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, fixtures.community.id));
    const cycle = await createCycle(setupResult.alice, { source: "blank", name: "Gathering" });
    await db.update(cycleTable).set({ capacity: 10 }).where(eq(cycleTable.id, cycle.id));
    await declareParticipation(setupResult.bob, cycle.id, { status: "coming" });

    const { capacity } = await getRecruitmentPipeline(setupResult.alice);
    expect(capacity).not.toBeNull();
    expect(capacity!.capacity).toBe(10);
    expect(capacity!.comingCount).toBe(1);
    expect(capacity!.remainingCapacity).toBe(9);
  });

  it("includes Tier composition alongside the candidate list", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const tier = await createTier(setupResult.alice, { name: "Experienced" });
    await db.update(member).set({ tierIds: [tier.id] }).where(eq(member.id, setupResult.bob.id));

    const { composition } = await getRecruitmentPipeline(setupResult.alice);
    expect(composition.tierCounts).toEqual(
      expect.arrayContaining([{ id: tier.id, name: "Experienced", count: 1 }]),
    );
  });

  it("rejects a non-holder", async () => {
    const fixtures = await createFixtures();
    await setUp(fixtures);
    const { alice: stranger } = await createFixtures();
    await expect(getRecruitmentPipeline(stranger)).rejects.toThrow(ForbiddenError);
  });
});

describe("listRecruitmentActionItems", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("surfaces only the candidates the holders have to move — not a decided one, nor a window that is the community's", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);

    const appliedOnly = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Applied", email: "applied@example.com" } });
    const { application: widerDiscussion } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"], "wider@example.com");
    const { application: declined } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"], "declined@example.com");

    const actionItems = (await listRecruitmentActionItems(setupResult.alice)).personal;
    const ids = actionItems.map((c) => c.id);
    expect(ids).toContain(appliedOnly.arrivalId);
    expect(ids).not.toContain(widerDiscussion.arrivalId);
    expect(ids).not.toContain(declined.arrivalId);
    expect(actionItems.every((c) => c.needsAction && c.actionLabel)).toBe(true);
  });

  it("rejects a non-holder", async () => {
    const fixtures = await createFixtures();
    await setUp(fixtures);
    const { alice: stranger } = await createFixtures();
    await expect(listRecruitmentActionItems(stranger)).rejects.toThrow(ForbiddenError);
  });
});
