import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle, formResponse, member, participation, recruitmentApplicationInvite, recruitmentDecision, task } from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { createCycle, updateCycleSettings } from "@/lib/cycles";
import { claimTask } from "@/lib/tasks";
import { archiveForm, createForm, listFormResponses, submitPublicFormResponse } from "@/lib/forms";
import type { CreateFormInput } from "@/lib/forms";
import {
  communityInviteStatus,
  computeRecruitmentOutcome,
  createCommunityInvite,
  getCommunityInviteByToken,
  getCycleJoiningState,
  getMyRecruitmentSubscription,
  getRecruitmentApplicationForm,
  getRecruitmentApplicationFormPublic,
  listApplicationAlerts,
  listApplicationsForEvaluation,
  listHeldRecruitmentScopes,
  listObjections,
  listOutstandingReferralInvites,
  requireValidDecisionRules,
  redeemCommunityInvite,
  resolveWiderDiscussionManually,
  revokeCommunityInvite,
  setRecruitmentSubscriptionActive,
  submitEvaluation,
  submitRecruitmentApplication,
} from "@/lib/recruitment";
import type { RecruitmentDecisionRule } from "@/lib/recruitment";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

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
    ...(overrides.evaluatorCount !== undefined && { recruitmentEvaluatorCount: overrides.evaluatorCount }),
    ...(overrides.decisionRules !== undefined && { recruitmentDecisionRules: overrides.decisionRules }),
  });
  await grantPermission(testCommunity.id, "recruitment", t.id);
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
    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true });

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
      { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
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
      { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
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
      { conditions: { inviterThinksGoodFit: true }, outcome: "proceed" },
      { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
    ];
    const { alice } = await setUpApplicationPipeline(fixtures, { evaluatorCount: 1, decisionRules: rules });

    const invite = await createCommunityInvite(alice, { inviterThinksGoodFit: true });
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
        { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
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

// --- cycle-scoped recruitment authority (docs/cycle-scope-remediation-
// plan.md §4.3, work-plan step 8b) ---

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

// 8c's intake will tag applications through the public path; until then
// the scope rides on the FormResponse row (formResponse.cycleId), so
// tests insert it directly the way the planned per-cycle intake will.
async function insertApplicationResponse(formId: string, cycleId: string | null, name: string) {
  const [row] = await db
    .insert(formResponse)
    .values({ formId, cycleId, submittedBy: null, values: { name } })
    .returning();
  return row;
}

describe("cycle-scoped recruitment authority (docs/cycle-scope-remediation-plan.md §4.3)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // Recruitment on, cycles enabled, an application form configured, and
  // two cycles to place work in.
  async function setUpCycleFixtures(fixtures: Awaited<ReturnType<typeof createFixtures>>) {
    const { community: testCommunity, alice } = fixtures;
    await enableRecruitment(testCommunity.id);
    await enableCycles(testCommunity.id);
    const form = await createForm(alice, { title: "Application", fields: applicationFields });
    await updateCommunity(alice, { recruitmentApplicationFormId: form.id });
    const cycleA = await createCycle(alice, { source: "blank", name: "Season A" });
    // createCycle guards against two open cycles (Phase 65) — close A at
    // the row level so the fixture can open B through the same API.
    await db.update(cycle).set({ closedAt: new Date() }).where(eq(cycle.id, cycleA.id));
    const cycleB = await createCycle(alice, { source: "blank", name: "Season B" });
    return { form, cycleA, cycleB };
  }

  // Places a recruitment task in `cycleId` (null = the standing,
  // community/evergreen placement) and makes alice its holder.
  async function designateRecruitment(fixtures: Awaited<ReturnType<typeof createFixtures>>, cycleId: string | null) {
    const { community: testCommunity, branch, alice } = fixtures;
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId });
    await grantPermission(testCommunity.id, "recruitment", t.id);
    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    await claimTask(refetchedAlice, t.id);
    return refetchedAlice;
  }

  it("a cycle-less (community/evergreen) placement is the null scope", async () => {
    const fixtures = await createFixtures();
    await setUpCycleFixtures(fixtures);
    const communityWide = await designateRecruitment(fixtures, null);
    expect(await listHeldRecruitmentScopes(communityWide)).toEqual(new Set([null]));
  });

  it("a cycle-placed recruitment task yields exactly that cycle's scope", async () => {
    const fixtures = await createFixtures();
    const { cycleA } = await setUpCycleFixtures(fixtures);
    const cycleHeld = await designateRecruitment(fixtures, cycleA.id);
    expect(await listHeldRecruitmentScopes(cycleHeld)).toEqual(new Set([cycleA.id]));
  });

  it("a cycle-less (community/evergreen) task covers every application — tagged and untagged", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, null);

    const tagged = await insertApplicationResponse(form.id, cycleA.id, "Dana");
    const untagged = await insertApplicationResponse(form.id, null, "Eli");

    const full = await listApplicationsForEvaluation(alice);
    expect(full.map((f) => f.response.id).sort()).toEqual([tagged.id, untagged.id].sort());
  });

  it("a recruitment task placed in cycle C sees only cycle C's applications", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA, cycleB } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, cycleA.id);

    const own = await insertApplicationResponse(form.id, cycleA.id, "Dana");
    await insertApplicationResponse(form.id, cycleB.id, "Eli");
    const untagged = await insertApplicationResponse(form.id, null, "Fia");

    const full = await listApplicationsForEvaluation(alice);
    expect(full.map((f) => f.response.id)).toEqual([own.id]);
    expect(full.map((f) => f.response.id)).not.toContain(untagged.id);
  });

  it("a cycle-placed holder cannot evaluate another cycle's or an untagged application", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA, cycleB } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, cycleA.id);

    const otherCycle = await insertApplicationResponse(form.id, cycleB.id, "Dana");
    const untagged = await insertApplicationResponse(form.id, null, "Eli");

    await expect(submitEvaluation(alice, otherCycle.id, { recommendation: "proceed" })).rejects.toThrow(ForbiddenError);
    await expect(submitEvaluation(alice, untagged.id, { recommendation: "proceed" })).rejects.toThrow(ForbiddenError);
  });

  it("a cycle-placed holder can evaluate their own cycle's application", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, cycleA.id);

    const own = await insertApplicationResponse(form.id, cycleA.id, "Dana");
    const filed = await submitEvaluation(alice, own.id, { recommendation: "proceed" });
    expect(filed.recommendation).toBe("proceed");
  });

  it("a cycle-placed holder cannot resolve another cycle's wider-discussion decision", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA, cycleB } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, cycleA.id);

    const other = await insertApplicationResponse(form.id, cycleB.id, "Dana");
    await db.insert(recruitmentDecision).values({
      formResponseId: other.id,
      ruleOutcome: "wider_discussion",
      defaultResolution: "proceed",
      resolution: null,
      widerDiscussionDeadline: new Date(Date.now() + 3_600_000),
    });

    await expect(
      resolveWiderDiscussionManually(alice, other.id, { resolution: "accepted" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("a cycle-placed holder cannot list objections on another cycle's application", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA, cycleB } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, cycleA.id);

    const other = await insertApplicationResponse(form.id, cycleB.id, "Dana");
    await expect(listObjections(alice, other.id)).rejects.toThrow(ForbiddenError);
  });

  it("a holder can list objections on an application their scope covers", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, cycleA.id);

    const own = await insertApplicationResponse(form.id, cycleA.id, "Dana");
    // No decision → no objection rows, but the scope check passes.
    expect(await listObjections(alice, own.id)).toEqual([]);
  });

  it("holding the community scope and a cycle together covers everything", async () => {
    const fixtures = await createFixtures();
    const { form, cycleA, cycleB } = await setUpCycleFixtures(fixtures);
    const alice = await designateRecruitment(fixtures, null);
    await designateRecruitment(fixtures, cycleA.id);

    await insertApplicationResponse(form.id, cycleA.id, "Dana");
    await insertApplicationResponse(form.id, cycleB.id, "Eli");

    expect(await listHeldRecruitmentScopes(alice)).toEqual(new Set([null, cycleA.id]));
    expect(await listApplicationsForEvaluation(alice)).toHaveLength(2);
  });
});

// --- cycle-targeted intake (docs/cycle-scope-remediation-plan.md §4.3,
// work-plan step 8c) ---

describe("cycle-targeted intake (docs/cycle-scope-remediation-plan.md §4.3/8c)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // Recruitment on, cycles enabled, a configured application form and
  // one open cycle to target.
  async function setUpIntakeFixtures(fixtures: Awaited<ReturnType<typeof createFixtures>>) {
    const { community: testCommunity, alice } = fixtures;
    await enableRecruitment(testCommunity.id);
    await enableCycles(testCommunity.id);
    const form = await createForm(alice, { title: "Application", fields: applicationFields });
    await updateCommunity(alice, { recruitmentApplicationFormId: form.id });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Season A" });
    return { form, cycle: cycleRow };
  }

  it("submitting with a cycleId tags the response with that cycle", async () => {
    const fixtures = await createFixtures();
    const { form, cycle } = await setUpIntakeFixtures(fixtures);

    const created = await submitRecruitmentApplication(fixtures.community.id, {
      values: { name: "Dana" },
      cycleId: cycle.id,
    });

    expect(created.cycleId).toBe(cycle.id);
    expect(created.formId).toBe(form.id);
  });

  it("prefers the cycle's own form pointer over the community's standing form", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpIntakeFixtures(fixtures);
    const cycleForm = await createForm(alice, { title: "Cycle-specific form", fields: applicationFields });
    await updateCycleSettings(alice, cycle.id, { recruitmentApplicationFormId: cycleForm.id });

    const created = await submitRecruitmentApplication(fixtures.community.id, {
      values: { name: "Dana" },
      cycleId: cycle.id,
    });

    expect(created.formId).toBe(cycleForm.id);
  });

  it("a general /apply submit stays untagged and uses the community's form", async () => {
    const fixtures = await createFixtures();
    const { form } = await setUpIntakeFixtures(fixtures);

    const created = await submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" } });

    expect(created.cycleId).toBeNull();
    expect(created.formId).toBe(form.id);
  });

  it("rejects a cycleId from outside the community", async () => {
    const fixtures = await createFixtures();
    await setUpIntakeFixtures(fixtures);

    await expect(
      submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" }, cycleId: crypto.randomUUID() }),
    ).rejects.toThrow(NotFoundError);
  });

  it("updateCycleSettings persists the joining config", async () => {
    const fixtures = await createFixtures();
    const { alice, community: testCommunity } = fixtures;
    const { cycle } = await setUpIntakeFixtures(fixtures);
    const cycleForm = await createForm(alice, { title: "Cycle form", fields: applicationFields });
    const future = new Date(Date.now() + 86_400_000).toISOString();

    await updateCycleSettings(alice, cycle.id, {
      recruitmentApplicationFormId: cycleForm.id,
      applicationsOpen: false,
      invitesOpen: false,
      joiningWindowClosesAt: future,
    });

    const state = await getCycleJoiningState(testCommunity.id, cycle.id);
    expect(state.cycle.recruitmentApplicationFormId).toBe(cycleForm.id);
    expect(state.cycle.applicationsOpen).toBe(false);
    expect(state.cycle.invitesOpen).toBe(false);
    expect(state.cycle.joiningWindowClosesAt?.toISOString()).toBe(new Date(future).toISOString());
  });

  it("rejects a cycle form pointer from another community", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpIntakeFixtures(fixtures);
    const other = await createFixtures();
    const foreignForm = await createForm(other.alice, { title: "Elsewhere", fields: applicationFields });

    await expect(
      updateCycleSettings(alice, cycle.id, { recruitmentApplicationFormId: foreignForm.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("the community-wide applications toggle closes the general door but not a cycle's own", async () => {
    const fixtures = await createFixtures();
    const { alice, community: testCommunity } = fixtures;
    const { form, cycle } = await setUpIntakeFixtures(fixtures);

    await updateCommunity(alice, { recruitmentApplicationsOpen: false });

    await expect(
      submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" } }),
    ).rejects.toThrow(AppError);

    // A cycle with its own applicationsOpen=true still admits — the
    // per-cycle doors are §4.3's real gate, the community toggle only
    // closes the general cycle-less door.
    const created = await submitRecruitmentApplication(testCommunity.id, {
      values: { name: "Dana" },
      cycleId: cycle.id,
    });
    expect(created.formId).toBe(form.id);
    expect(created.cycleId).toBe(cycle.id);
  });

  it("the per-cycle applicationsOpen flag shuts the cycle's door", async () => {
    const fixtures = await createFixtures();
    const { alice, community: testCommunity } = fixtures;
    const { cycle } = await setUpIntakeFixtures(fixtures);
    await updateCycleSettings(alice, cycle.id, { applicationsOpen: false });

    await expect(
      submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" }, cycleId: cycle.id }),
    ).rejects.toThrow(AppError);
  });

  it("the joining period gates intake — not yet open before the returning-priority window closes", async () => {
    const fixtures = await createFixtures();
    const { alice, community: testCommunity } = fixtures;
    const { cycle } = await setUpIntakeFixtures(fixtures);
    await updateCycleSettings(alice, cycle.id, {
      returningWindowClosesAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await expect(
      submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" }, cycleId: cycle.id }),
    ).rejects.toThrow(AppError);
  });

  it("the joining period gates intake — closed once joiningWindowClosesAt passes", async () => {
    const fixtures = await createFixtures();
    const { alice, community: testCommunity } = fixtures;
    const { cycle } = await setUpIntakeFixtures(fixtures);
    await updateCycleSettings(alice, cycle.id, {
      joiningWindowClosesAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    await expect(
      submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" }, cycleId: cycle.id }),
    ).rejects.toThrow(AppError);
  });

  it("capacity gates intake once comingCount fills the cycle", async () => {
    const fixtures = await createFixtures();
    const { alice, bob, community: testCommunity } = fixtures;
    const { cycle } = await setUpIntakeFixtures(fixtures);
    await updateCycleSettings(alice, cycle.id, { capacity: 1 });

    await db.insert(participation).values({ cycleId: cycle.id, memberId: bob.id, status: "coming" });

    const state = await getCycleJoiningState(testCommunity.id, cycle.id);
    expect(state.atCapacity).toBe(true);
    expect(state.applicationsOpen).toBe(false);

    await expect(
      submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" }, cycleId: cycle.id }),
    ).rejects.toThrow(AppError);
  });
});

// --- cycle invites + capacity holds + joining seed + pipeline
// visibility (docs/cycle-scope-remediation-plan.md §4.3, work-plan step
// 8d) ---

describe("cycle invites + capacity holds + joining seed (docs/cycle-scope-remediation-plan.md §4.3/8d)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // Recruitment on, cycles enabled, an application form configured, and
  // one open cycle to invite into.
  async function setUpInvitesFixtures(fixtures: Awaited<ReturnType<typeof createFixtures>>) {
    const { community: testCommunity, alice } = fixtures;
    await enableRecruitment(testCommunity.id);
    await enableCycles(testCommunity.id);
    const form = await createForm(alice, { title: "Application", fields: applicationFields });
    await updateCommunity(alice, { recruitmentApplicationFormId: form.id });
    const cycleRow = await createCycle(alice, { source: "blank", name: "Season A" });
    return { form, cycle: cycleRow };
  }

  it("a general invite gates on the community-wide invites toggle; a cycle invite does not", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    await updateCommunity(alice, { recruitmentInvitesOpen: false });

    await expect(createCommunityInvite(alice, { label: "general" })).rejects.toThrow(AppError);

    // Per-cycle doors are §4.3's real gate — the community toggle only
    // closes the general, cycle-less door.
    const created = await createCommunityInvite(alice, { cycleId: cycle.id, label: "for the cycle" });
    expect(created.cycleId).toBe(cycle.id);
  });

  it("direct invites into a capacity-capped cycle require a non-past expiry — no immortal holds", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    await updateCycleSettings(alice, cycle.id, { capacity: 3 });

    await expect(
      createCommunityInvite(alice, { cycleId: cycle.id, inviterKnowsPersonally: true }),
    ).rejects.toThrow(AppError);
    await expect(
      createCommunityInvite(alice, {
        cycleId: cycle.id,
        inviterKnowsPersonally: true,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toThrow(AppError);

    const created = await createCommunityInvite(alice, {
      cycleId: cycle.id,
      inviterKnowsPersonally: true,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(created.cycleId).toBe(cycle.id);
  });

  it("creating a cycle invite gates on the lane's door — direct on invitesOpen, process on applicationsOpen", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);

    // An unmarked invite is the invited_neither process lane: the
    // applications door is the one that matters.
    await updateCycleSettings(alice, cycle.id, { applicationsOpen: false });
    await expect(createCommunityInvite(alice, { cycleId: cycle.id })).rejects.toThrow(ConflictError);

    await updateCycleSettings(alice, cycle.id, { applicationsOpen: true });
    const processLaneInvite = await createCommunityInvite(alice, { cycleId: cycle.id });
    expect(processLaneInvite.cycleId).toBe(cycle.id);

    // A knows-personally invite is the invited_knows_personally direct
    // lane: the invites door gates it instead.
    await updateCycleSettings(alice, cycle.id, { invitesOpen: false });
    await expect(
      createCommunityInvite(alice, { cycleId: cycle.id, inviterKnowsPersonally: true }),
    ).rejects.toThrow(ConflictError);

    await updateCycleSettings(alice, cycle.id, { invitesOpen: true });
    const directLaneInvite = await createCommunityInvite(alice, {
      cycleId: cycle.id,
      inviterKnowsPersonally: true,
    });
    expect(directLaneInvite.cycleId).toBe(cycle.id);
  });

  it("rejects a cycleId from outside the community", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    await setUpInvitesFixtures(fixtures);
    const other = await createFixtures();
    await enableRecruitment(other.community.id);
    await enableCycles(other.community.id);
    const foreignCycle = await createCycle(other.alice, { source: "blank", name: "Elsewhere" });

    await expect(createCommunityInvite(alice, { cycleId: foreignCycle.id })).rejects.toThrow(NotFoundError);
  });

  it("outstanding direct-lane invites hold capacity slots until used, revoked, or expired", async () => {
    const fixtures = await createFixtures();
    const { alice, community: testCommunity } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    await updateCycleSettings(alice, cycle.id, { capacity: 2 });
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const first = await createCommunityInvite(alice, {
      cycleId: cycle.id,
      inviterKnowsPersonally: true,
      expiresAt: future,
    });
    let state = await getCycleJoiningState(testCommunity.id, cycle.id);
    expect(state.holds).toBe(1);
    expect(state.atCapacity).toBe(false);
    expect(state.invitesOpen).toBe(true);

    await createCommunityInvite(alice, { cycleId: cycle.id, inviterKnowsPersonally: true, expiresAt: future });
    state = await getCycleJoiningState(testCommunity.id, cycle.id);
    expect(state.holds).toBe(2);
    expect(state.atCapacity).toBe(true);
    expect(state.invitesOpen).toBe(false);

    // Revoking a hold releases its slot.
    await revokeCommunityInvite(alice, first.id);
    state = await getCycleJoiningState(testCommunity.id, cycle.id);
    expect(state.holds).toBe(1);
    expect(state.atCapacity).toBe(false);
  });

  it("process-lane cycle invites hold nothing — the lane is fixed at create, never the cycle", async () => {
    const fixtures = await createFixtures();
    const { alice, community: testCommunity } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    await updateCycleSettings(alice, cycle.id, { capacity: 2 });
    const future = new Date(Date.now() + 86_400_000).toISOString();

    // An unmarked invite is the invited_neither process lane: it routes
    // through the evaluated application and holds no capacity slot, and
    // it never follows what the cycle does afterwards (§2.9).
    await createCommunityInvite(alice, { cycleId: cycle.id, expiresAt: future });
    await createCommunityInvite(alice, { cycleId: cycle.id, expiresAt: future });

    const state = await getCycleJoiningState(testCommunity.id, cycle.id);
    expect(state.holds).toBe(0);
    expect(state.atCapacity).toBe(false);
  });

  it("redeeming a direct cycle invite creates the member and seeds participation as coming", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    const created = await createCommunityInvite(alice, { cycleId: cycle.id, label: "Dana", inviterKnowsPersonally: true });

    const newMember = await redeemCommunityInvite(created.token, { email: "dana@example.com" });

    expect(newMember.communityId).toBe(fixtures.community.id);
    expect(newMember.joinedViaInviteId).toBe(created.id);
    const [row] = await db
      .select()
      .from(participation)
      .where(and(eq(participation.cycleId, cycle.id), eq(participation.memberId, newMember.id)));
    expect(row?.status).toBe("coming");
  });

  it("an unmarked process-lane invite never redeems directly", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    const created = await createCommunityInvite(alice, { cycleId: cycle.id });

    await expect(redeemCommunityInvite(created.token, { email: "dana@example.com" })).rejects.toThrow(ConflictError);
  });

  it("an application referencing a process-lane invite is tagged with the invite's cycle", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    const created = await createCommunityInvite(alice, { cycleId: cycle.id, label: "Dana" });

    const response = await submitRecruitmentApplication(fixtures.community.id, {
      values: { name: "Dana" },
      inviteToken: created.token,
    });

    expect(response.cycleId).toBe(cycle.id);
  });

  it("a direct invite's token on the application path is rejected — it redeems on /invite", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle } = await setUpInvitesFixtures(fixtures);
    const created = await createCommunityInvite(alice, { cycleId: cycle.id, inviterKnowsPersonally: true });

    await expect(
      submitRecruitmentApplication(fixtures.community.id, { values: { name: "Dana" }, inviteToken: created.token }),
    ).rejects.toThrow(AppError);
  });

  it("an explicit cycleId conflicting with the invite's cycle is rejected", async () => {
    const fixtures = await createFixtures();
    const { alice } = fixtures;
    const { cycle: cycleA } = await setUpInvitesFixtures(fixtures);
    await db.update(cycle).set({ closedAt: new Date() }).where(eq(cycle.id, cycleA.id));
    const cycleB = await createCycle(alice, { source: "blank", name: "Season B" });
    const created = await createCommunityInvite(alice, { cycleId: cycleB.id });

    await expect(
      submitRecruitmentApplication(fixtures.community.id, {
        values: { name: "Dana" },
        inviteToken: created.token,
        cycleId: cycleA.id,
      }),
    ).rejects.toThrow(AppError);
  });

  it("outstanding process-lane cycle invites are visible to the recruitment pipeline, scoped like applications", async () => {
    const fixtures = await createFixtures();
    const { community: testCommunity, branch, alice } = fixtures;
    const { cycle: cycleA } = await setUpInvitesFixtures(fixtures);
    // The invite must be created while the period is open — created
    // first, then the cycle closes so a second can be opened alongside.
    await createCommunityInvite(alice, { cycleId: cycleA.id, label: "For A" });
    await db.update(cycle).set({ closedAt: new Date() }).where(eq(cycle.id, cycleA.id));
    const cycleB = await createCycle(alice, { source: "blank", name: "Season B" });
    await createCommunityInvite(alice, { cycleId: cycleB.id, label: "For B" });

    // A cycle-placed holder sees only their own cycle's outstanding
    // process-lane invites (§4.3 scope, applied to the invitation side).
    const tA = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    await grantPermission(testCommunity.id, "recruitment", tA.id);
    const [aliceRow] = await db.select().from(member).where(eq(member.id, alice.id));
    await claimTask(aliceRow, tA.id);
    expect((await listOutstandingReferralInvites(aliceRow)).map((r) => r.label)).toEqual(["For A"]);

    // The cycle-less community/evergreen holder sees every cycle's.
    const t0 = await insertTask(testCommunity.id, branch.id, alice.id, {});
    await grantPermission(testCommunity.id, "recruitment", t0.id);
    await claimTask(aliceRow, t0.id);
    expect((await listOutstandingReferralInvites(aliceRow)).map((r) => r.label).sort()).toEqual([
      "For A",
      "For B",
    ]);
  });
});
