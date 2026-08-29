import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, recruitmentApplicationInvite, task } from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { claimTask } from "@/lib/tasks";
import { archiveForm, createForm, listFormResponses, submitPublicFormResponse } from "@/lib/forms";
import type { CreateFormInput } from "@/lib/forms";
import {
  communityInviteStatus,
  computeRecruitmentOutcome,
  createCommunityInvite,
  getCommunityInviteByToken,
  getMyRecruitmentSubscription,
  getRecruitmentApplicationForm,
  getRecruitmentApplicationFormPublic,
  listApplicationAlerts,
  listApplicationsForEvaluation,
  requireValidDecisionRules,
  revokeCommunityInvite,
  setRecruitmentSubscriptionActive,
  submitEvaluation,
  submitRecruitmentApplication,
} from "@/lib/recruitment";
import type { RecruitmentDecisionRule } from "@/lib/recruitment";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

const applicationFields: CreateFormInput["fields"] = [
  { key: "name", label: "Name", responseType: "free_text", required: true },
  { key: "why", label: "Why do you want to join?", responseType: "free_text", required: false },
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
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

// Sets up: recruitment on, an application form configured, and a
// designated recruitment task claimed by `alice` — the standard
// fixture most of this file's tests build on.
async function setUpApplicationPipeline(
  fixtures: Awaited<ReturnType<typeof createFixtures>>,
  overrides: Partial<{ evaluatorCount: number; decisionRules: RecruitmentDecisionRule[] }> = {},
) {
  const { community: testCommunity, alice, branch } = fixtures;
  await enableRecruitment(testCommunity.id);
  const form = await createForm(alice, { title: "Application", fields: applicationFields });
  const t = await insertTask(testCommunity.id, branch.id, alice.id);
  await updateCommunity(alice, {
    recruitmentApplicationFormId: form.id,
    recruitmentTaskId: t.id,
    ...(overrides.evaluatorCount !== undefined && { recruitmentEvaluatorCount: overrides.evaluatorCount }),
    ...(overrides.decisionRules !== undefined && { recruitmentDecisionRules: overrides.decisionRules }),
  });
  const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
  await claimTask(refetchedAlice, t.id);
  return { form, task: t, alice: refetchedAlice };
}

describe("submitPublicFormResponse (forms.ts)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("always sets submittedBy to null, regardless of allowAnonymous", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, { title: "Public form", fields: applicationFields, allowAnonymous: false });

    const created = await submitPublicFormResponse(form.id, { values: { name: "Dana", why: "" } });
    expect(created.submittedBy).toBeNull();
    expect((created.values as Record<string, unknown>).name).toBe("Dana");
  });

  it("still enforces required fields", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, { title: "Public form", fields: applicationFields });

    await expect(submitPublicFormResponse(form.id, { values: { why: "because" } })).rejects.toThrow(AppError);
  });

  it("rejects submitting to an archived form", async () => {
    const { alice } = await createFixtures();
    const form = await createForm(alice, { title: "Public form", fields: applicationFields });
    await archiveForm(alice, form.id);

    await expect(submitPublicFormResponse(form.id, { values: { name: "Dana" } })).rejects.toThrow(ConflictError);
  });

  it("rejects a nonexistent form", async () => {
    await expect(
      submitPublicFormResponse("00000000-0000-0000-0000-000000000000", { values: {} }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("getRecruitmentApplicationForm / getRecruitmentApplicationFormPublic", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is null when nothing's configured", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    expect(await getRecruitmentApplicationForm(alice)).toBeNull();
    expect(await getRecruitmentApplicationFormPublic(testCommunity.id)).toBeNull();
  });

  it("returns the configured form once set", async () => {
    const fixtures = await createFixtures();
    const { form } = await setUpApplicationPipeline(fixtures);

    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, fixtures.alice.id));
    expect((await getRecruitmentApplicationForm(refetchedAlice))?.id).toBe(form.id);
    expect((await getRecruitmentApplicationFormPublic(fixtures.community.id))?.id).toBe(form.id);
  });
});

describe("submitRecruitmentApplication", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects when the recruitment module is off", async () => {
    const { community: testCommunity } = await createFixtures();
    await expect(
      submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" } }),
    ).rejects.toThrow(AppError);
  });

  it("rejects when no application form is configured", async () => {
    const { community: testCommunity } = await createFixtures();
    await enableRecruitment(testCommunity.id);
    await expect(
      submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" } }),
    ).rejects.toThrow(AppError);
  });

  it("creates a real, unattributed FormResponse once configured", async () => {
    const fixtures = await createFixtures();
    await setUpApplicationPipeline(fixtures);

    const created = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });
    expect(created.submittedBy).toBeNull();
  });

  it("links a valid referenced invite without consuming it", async () => {
    const fixtures = await createFixtures();
    const { alice } = await setUpApplicationPipeline(fixtures);
    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true, inviterKnowsPersonally: true });

    const created = await submitRecruitmentApplication(fixtures.community.id, {
      values: { name: "Dana" },
      inviteToken: invite.token,
    });

    const [link] = await db
      .select()
      .from(recruitmentApplicationInvite)
      .where(eq(recruitmentApplicationInvite.formResponseId, created.id));
    expect(link.communityInviteId).toBe(invite.id);

    // Never consumed by this — still unredeemed.
    const refetchedInvite = await getCommunityInviteByToken(invite.token);
    expect(communityInviteStatus(refetchedInvite)).toBe("valid");
  });

  it("rejects a nonexistent invite token", async () => {
    const fixtures = await createFixtures();
    await setUpApplicationPipeline(fixtures);

    await expect(
      submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" }, inviteToken: "garbage" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects a revoked invite token", async () => {
    const fixtures = await createFixtures();
    const { alice } = await setUpApplicationPipeline(fixtures);
    const invite = await createCommunityInvite(alice, {});
    await revokeCommunityInvite(alice, invite.id);

    await expect(
      submitRecruitmentApplication(fixtures.community.id, {
        values: { name: "Dana" },
        inviteToken: invite.token,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("never creates a FormResponse when the referenced invite is invalid", async () => {
    const fixtures = await createFixtures();
    await setUpApplicationPipeline(fixtures);
    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, fixtures.alice.id));
    const form = (await getRecruitmentApplicationForm(refetchedAlice))!;

    await expect(
      submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" }, inviteToken: "garbage" }),
    ).rejects.toThrow(NotFoundError);

    expect(await listFormResponses(refetchedAlice, form.id)).toHaveLength(0);
  });
});

describe("submitEvaluation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is holder-gated", async () => {
    const fixtures = await createFixtures();
    await setUpApplicationPipeline(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });

    await expect(
      submitEvaluation(fixtures.bob, application.id, { recommendation: "proceed" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects evaluating a formResponse that isn't the configured application form", async () => {
    const fixtures = await createFixtures();
    const { alice } = await setUpApplicationPipeline(fixtures);
    const otherForm = await createForm(alice, { title: "Unrelated form", fields: applicationFields });
    const otherResponse = await submitPublicFormResponse(otherForm.id, { values: { name: "Dana" } });

    await expect(
      submitEvaluation(alice, otherResponse.id, { recommendation: "proceed" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("upserts in place — resubmitting updates rather than duplicating", async () => {
    const fixtures = await createFixtures();
    const { alice } = await setUpApplicationPipeline(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });

    const first = await submitEvaluation(alice, application.id, { recommendation: "unsure", notes: "need more info" });
    const second = await submitEvaluation(alice, application.id, { recommendation: "proceed", notes: null });

    expect(second.id).toBe(first.id);
    expect(second.recommendation).toBe("proceed");
    expect(second.notes).toBeNull();
  });
});

describe("computeRecruitmentOutcome", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is null with fewer evaluations filed than required, but reports the real counts", async () => {
    const fixtures = await createFixtures();
    const { alice } = await setUpApplicationPipeline(fixtures, { evaluatorCount: 2 });
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });
    await submitEvaluation(alice, application.id, { recommendation: "proceed" });

    const [communityRow] = await db.select().from(community).where(eq(community.id, fixtures.community.id));
    const result = await computeRecruitmentOutcome(communityRow, application.id);
    expect(result.outcome).toBeNull();
    expect(result.evaluationsFiled).toBe(1);
    expect(result.evaluatorsNeeded).toBe(2);
  });

  it("resolves to the first matching rule once enough evaluations are filed", async () => {
    const fixtures = await createFixtures();
    const rules: RecruitmentDecisionRule[] = [
      { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
      { conditions: { minCounts: { decline: 2 } }, outcome: "decline" },
      { conditions: {}, outcome: "wider_discussion" },
    ];
    const { alice } = await setUpApplicationPipeline(fixtures, { evaluatorCount: 2, decisionRules: rules });
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });

    // A second evaluator: claim a second slot on the recruitment task.
    const [bobTask] = await db.select().from(task).where(eq(task.communityId, fixtures.community.id));
    await db.update(task).set({ capacity: 2 }).where(eq(task.id, bobTask.id));
    await claimTask(fixtures.bob, bobTask.id);

    await submitEvaluation(alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(fixtures.bob, application.id, { recommendation: "proceed" });

    const [communityRow] = await db.select().from(community).where(eq(community.id, fixtures.community.id));
    const result = await computeRecruitmentOutcome(communityRow, application.id);
    expect(result.outcome).toBe("proceed");
  });

  it("falls through to the fallback rule when nothing more specific matches", async () => {
    const fixtures = await createFixtures();
    const rules: RecruitmentDecisionRule[] = [
      { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
      { conditions: {}, outcome: "wider_discussion" },
    ];
    const { alice } = await setUpApplicationPipeline(fixtures, { evaluatorCount: 1, decisionRules: rules });
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });
    await submitEvaluation(alice, application.id, { recommendation: "unsure" });

    const [communityRow] = await db.select().from(community).where(eq(community.id, fixtures.community.id));
    const result = await computeRecruitmentOutcome(communityRow, application.id);
    expect(result.outcome).toBe("wider_discussion");
  });

  it("a linked invite's checkboxes feed matching; no linked invite means invite-conditioned rules never match", async () => {
    const fixtures = await createFixtures();
    const rules: RecruitmentDecisionRule[] = [
      { conditions: { inviterThinksGoodFit: true, inviterKnowsPersonally: true }, outcome: "proceed" },
      { conditions: {}, outcome: "wider_discussion" },
    ];
    const { alice } = await setUpApplicationPipeline(fixtures, { evaluatorCount: 1, decisionRules: rules });

    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true, inviterKnowsPersonally: true });
    const viaInvite = await submitRecruitmentApplication(fixtures.community.id, {
      values: { name: "Dana" },
      inviteToken: invite.token,
    });
    await submitEvaluation(alice, viaInvite.id, { recommendation: "unsure" });

    const withoutInvite = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Eli" } });
    await submitEvaluation(alice, withoutInvite.id, { recommendation: "unsure" });

    const [communityRow] = await db.select().from(community).where(eq(community.id, fixtures.community.id));
    expect((await computeRecruitmentOutcome(communityRow, viaInvite.id)).outcome).toBe("proceed");
    expect((await computeRecruitmentOutcome(communityRow, withoutInvite.id)).outcome).toBe("wider_discussion");
  });
});

describe("requireValidDecisionRules", () => {
  it("allows an empty list", () => {
    expect(() => requireValidDecisionRules([])).not.toThrow();
  });

  it("allows a list ending in an unconditional fallback", () => {
    expect(() =>
      requireValidDecisionRules([
        { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
        { conditions: {}, outcome: "wider_discussion" },
      ]),
    ).not.toThrow();
  });

  it("rejects a list with no unconditional fallback rule", () => {
    expect(() =>
      requireValidDecisionRules([{ conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" }]),
    ).toThrow(AppError);
  });
});

describe("listApplicationAlerts / listApplicationsForEvaluation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a member who is neither subscribed nor a holder", async () => {
    const fixtures = await createFixtures();
    await setUpApplicationPipeline(fixtures);
    await expect(listApplicationAlerts(fixtures.bob)).rejects.toThrow(ForbiddenError);
  });

  it("gives a subscriber minimal counts, never the applicant's own answers", async () => {
    const fixtures = await createFixtures();
    await setUpApplicationPipeline(fixtures, { evaluatorCount: 2 });
    await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });
    await setRecruitmentSubscriptionActive(fixtures.bob, true);

    const alerts = await listApplicationAlerts(fixtures.bob);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).not.toHaveProperty("values");
    expect(alerts[0].evaluatorsNeeded).toBe(2);
    expect(alerts[0].evaluationsFiled).toBe(0);
  });

  it("listApplicationsForEvaluation is holder-only and includes full answers + evaluations", async () => {
    const fixtures = await createFixtures();
    const { alice } = await setUpApplicationPipeline(fixtures);
    const application = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });
    await submitEvaluation(alice, application.id, { recommendation: "proceed", notes: "seems great" });

    await expect(listApplicationsForEvaluation(fixtures.bob)).rejects.toThrow(ForbiddenError);

    const full = await listApplicationsForEvaluation(alice);
    expect(full).toHaveLength(1);
    expect((full[0].response.values as Record<string, unknown>).name).toBe("Dana");
    expect(full[0].evaluations).toHaveLength(1);
    expect(full[0].evaluations[0].notes).toBe("seems great");
  });
});

describe("Recruitment subscription", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("defaults to inactive with no row", async () => {
    const { alice } = await createFixtures();
    const sub = await getMyRecruitmentSubscription(alice);
    expect(sub.active).toBe(false);
  });

  it("rejects activating when the recruitment module is off", async () => {
    const { alice } = await createFixtures();
    await expect(setRecruitmentSubscriptionActive(alice, true)).rejects.toThrow(AppError);
  });

  it("activating then deactivating toggles the same row in place", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableRecruitment(testCommunity.id);

    const activated = await setRecruitmentSubscriptionActive(alice, true);
    expect(activated.active).toBe(true);

    const deactivated = await setRecruitmentSubscriptionActive(alice, false);
    expect(deactivated.id).toBe(activated.id);
    expect(deactivated.active).toBe(false);
  });
});
