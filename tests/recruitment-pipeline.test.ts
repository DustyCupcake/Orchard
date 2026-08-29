import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle as cycleTable, member, schedulingPoll, task } from "@/db/schema";
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
import type { RecruitmentDecisionRule } from "@/lib/recruitment";
import { ForbiddenError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

const applicationFields: CreateFormInput["fields"] = [
  { key: "name", label: "Name", responseType: "free_text", required: true },
];

const DEFAULT_RULES: RecruitmentDecisionRule[] = [
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
  overrides: Partial<{ decisionRules: RecruitmentDecisionRule[] }> = {},
) {
  const { community: testCommunity, alice, bob, branch } = fixtures;
  await enableRecruitment(testCommunity.id);
  const form = await createForm(alice, { title: "Application", fields: applicationFields });
  const recruitmentTask = await insertTask(testCommunity.id, branch.id, alice.id);
  await updateCommunity(alice, {
    recruitmentApplicationFormId: form.id,
    recruitmentTaskId: recruitmentTask.id,
    recruitmentEvaluatorCount: 2,
    recruitmentDecisionRules: overrides.decisionRules ?? DEFAULT_RULES,
  });

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
) {
  const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });
  await submitEvaluation(setupResult.alice, application.id, { recommendation: recommendations[0] });
  await submitEvaluation(setupResult.bob, application.id, { recommendation: recommendations[1] });
  const decision = await recordDecisionIfReached(setupResult.alice, application.id);
  return { application, decision };
}

describe("getRecruitmentPipeline — computed stage", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is 'applied' right after submission, before any evaluation", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("applied");
    expect(candidate.evaluationsFiled).toBe(0);
  });

  it("is 'evaluation_in_progress' once some but not all evaluations are filed", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });
    await submitEvaluation(setupResult.alice, application.id, { recommendation: "proceed" });

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("evaluation_in_progress");
    expect(candidate.evaluationsFiled).toBe(1);
  });

  it("is 'declined' immediately for a decline outcome, with a stageSince of decidedAt", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("declined");
    expect(candidate.stageSince).toEqual(decision!.decidedAt);
  });

  it("is 'accepted' immediately for a proceed outcome, before the Accompaniment task is claimed", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"]);
    expect(decision!.accompanimentTaskId).not.toBeNull();

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("accepted");
  });

  it("becomes 'accompaniment_assigned' once the Accompaniment task is claimed", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "proceed"]);

    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, setupResult.alice.id));
    await claimTask(refetchedAlice, decision!.accompanimentTaskId!);

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("accompaniment_assigned");
    expect(candidate.stageSince).not.toEqual(decision!.decidedAt);
  });

  it("is 'call_pending' for a wider_discussion outcome before the intro call confirms a slot", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    expect(decision!.ruleOutcome).toBe("wider_discussion");
    expect(decision!.introCallPollId).not.toBeNull();

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("call_pending");
  });

  it("is 'call_scheduled' once the intro call confirms a slot still in the future", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);

    const future = new Date(Date.now() + 7 * 86_400_000);
    await db
      .update(schedulingPoll)
      .set({
        confirmedSlotStart: future,
        confirmedSlotEnd: new Date(future.getTime() + 3_600_000),
        confirmedBy: setupResult.alice.id,
        confirmedAt: new Date(),
      })
      .where(eq(schedulingPoll.id, decision!.introCallPollId!));

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("call_scheduled");
  });

  it("is 'decision_pending' once the confirmed call's slot is in the past", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);
    const { application, decision } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);

    const past = new Date(Date.now() - 7 * 86_400_000);
    await db
      .update(schedulingPoll)
      .set({
        confirmedSlotStart: past,
        confirmedSlotEnd: new Date(past.getTime() + 3_600_000),
        confirmedBy: setupResult.alice.id,
        confirmedAt: new Date(Date.now() - 8 * 86_400_000),
      })
      .where(eq(schedulingPoll.id, decision!.introCallPollId!));

    const { candidates } = await getRecruitmentPipeline(setupResult.alice);
    const candidate = candidates.find((c) => c.id === application.id)!;
    expect(candidate.stage).toBe("decision_pending");
    expect(candidate.stageSince).toEqual(past);
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

  it("surfaces only call_pending and decision_pending candidates", async () => {
    const fixtures = await createFixtures();
    const setupResult = await setUp(fixtures);

    const appliedOnly = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Applied" } });
    const { application: stuck } = await submitAndDecide(fixtures, setupResult, ["proceed", "unsure"]);
    const { application: declined } = await submitAndDecide(fixtures, setupResult, ["decline", "decline"]);

    const actionItems = await listRecruitmentActionItems(setupResult.alice);
    const ids = actionItems.map((c) => c.id);
    expect(ids).toContain(stuck.id);
    expect(ids).not.toContain(appliedOnly.id);
    expect(ids).not.toContain(declined.id);
    expect(actionItems.every((c) => c.stage === "call_pending" || c.stage === "decision_pending")).toBe(true);
  });

  it("rejects a non-holder", async () => {
    const fixtures = await createFixtures();
    await setUp(fixtures);
    const { alice: stranger } = await createFixtures();
    await expect(listRecruitmentActionItems(stranger)).rejects.toThrow(ForbiddenError);
  });
});
