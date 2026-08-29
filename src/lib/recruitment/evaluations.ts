import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { communityInvite, evaluation, formResponse, recruitmentApplicationInvite } from "@/db/schema";
import type { community as communityTable, member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow, requireRecruitmentTaskHolder } from "./access";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type EvaluationRow = typeof evaluation.$inferSelect;

const recommendationValues = ["proceed", "decline", "unsure"] as const;
export type RecruitmentRecommendation = (typeof recommendationValues)[number];
export type RecruitmentOutcome = "proceed" | "wider_discussion" | "decline";

// Resolved shape for Community.recruitmentDecisionRules — spec asks
// for this to be community-configured without naming a concrete
// structure ("Peach Please's specific matrix becomes one configuration
// of this, not the only shape it can take"). An ordered list,
// evaluated top-to-bottom, first match wins. `conditions` reads the
// filed recommendation counts and, when the applicant referenced an
// invite link on their application, its two checkboxes as additional
// inputs — a condition naming a checkbox simply never matches an
// application with no linked invite.
export const recruitmentDecisionConditionSchema = z.object({
  minCounts: z
    .object({
      proceed: z.number().int().nonnegative().optional(),
      decline: z.number().int().nonnegative().optional(),
      unsure: z.number().int().nonnegative().optional(),
    })
    .optional(),
  inviterThinksGoodFit: z.boolean().optional(),
  inviterKnowsPersonally: z.boolean().optional(),
});
export type RecruitmentDecisionCondition = z.infer<typeof recruitmentDecisionConditionSchema>;

export const recruitmentDecisionRuleSchema = z.object({
  conditions: recruitmentDecisionConditionSchema,
  outcome: z.enum(["proceed", "wider_discussion", "decline"]),
});
export type RecruitmentDecisionRule = z.infer<typeof recruitmentDecisionRuleSchema>;

export const recruitmentDecisionRulesSchema = z.array(recruitmentDecisionRuleSchema);

function isUnconditional(c: RecruitmentDecisionCondition): boolean {
  const hasMinCounts = c.minCounts && Object.keys(c.minCounts).length > 0;
  return !hasMinCounts && c.inviterThinksGoodFit === undefined && c.inviterKnowsPersonally === undefined;
}

// Defense-in-depth, re-checked here rather than trusted from the zod
// schema alone — same precedent Phase 25's requireValidFields and
// Phase 26's requireLineItems already set. "A required fallback rule
// so every combination resolves to something" (docs/development-
// plan.md's Phase 33) — only enforced when rules is non-empty; an
// empty array just means "not configured yet," not an error.
export function requireValidDecisionRules(rules: RecruitmentDecisionRule[]) {
  if (rules.length === 0) return;
  if (!isUnconditional(rules[rules.length - 1].conditions)) {
    throw new AppError("The last decision rule must be an unconditional fallback (no conditions)");
  }
}

type RecommendationCounts = Record<RecruitmentRecommendation, number>;

function countRecommendations(evaluations: Pick<EvaluationRow, "recommendation">[]): RecommendationCounts {
  const counts: RecommendationCounts = { proceed: 0, decline: 0, unsure: 0 };
  for (const e of evaluations) counts[e.recommendation] += 1;
  return counts;
}

function conditionMatches(
  c: RecruitmentDecisionCondition,
  ctx: { counts: RecommendationCounts; inviterThinksGoodFit?: boolean; inviterKnowsPersonally?: boolean },
): boolean {
  if (c.minCounts) {
    for (const [key, min] of Object.entries(c.minCounts)) {
      if (ctx.counts[key as RecruitmentRecommendation] < min) return false;
    }
  }
  if (c.inviterThinksGoodFit !== undefined && ctx.inviterThinksGoodFit !== c.inviterThinksGoodFit) {
    return false;
  }
  if (c.inviterKnowsPersonally !== undefined && ctx.inviterKnowsPersonally !== c.inviterKnowsPersonally) {
    return false;
  }
  return true;
}

async function getLinkedInviteCheckboxes(formResponseId: string) {
  const [row] = await db
    .select({
      inviterThinksGoodFit: communityInvite.inviterThinksGoodFit,
      inviterKnowsPersonally: communityInvite.inviterKnowsPersonally,
    })
    .from(recruitmentApplicationInvite)
    .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
    .where(eq(recruitmentApplicationInvite.formResponseId, formResponseId));
  return row ?? null;
}

// Live-computed, never persisted — the same "computed from real state,
// not a second number kept in sync by hand" posture this codebase
// takes everywhere (attention levels, Assembly phase, Participation
// summaries). Phase 34 is explicitly the one that *acts on* / records
// a reached outcome (auto-scheduling, opening the wider-discussion
// window); this phase only needs to resolve what the outcome
// currently is. Returns evaluationsFiled/evaluatorsNeeded alongside so
// callers (the pipeline-ish list views) don't need a second query —
// outcome is null until enough distinct evaluators have filed.
export async function computeRecruitmentOutcome(
  communityRow: Pick<CommunityRow, "recruitmentEvaluatorCount" | "recruitmentDecisionRules">,
  formResponseId: string,
) {
  const evaluations = await db.select().from(evaluation).where(eq(evaluation.formResponseId, formResponseId));
  const evaluatorsNeeded = communityRow.recruitmentEvaluatorCount;

  if (evaluations.length < evaluatorsNeeded) {
    return { outcome: null as RecruitmentOutcome | null, evaluationsFiled: evaluations.length, evaluatorsNeeded, evaluations };
  }

  const linkedInvite = await getLinkedInviteCheckboxes(formResponseId);
  const rules = (communityRow.recruitmentDecisionRules as RecruitmentDecisionRule[]) ?? [];
  const ctx = {
    counts: countRecommendations(evaluations),
    inviterThinksGoodFit: linkedInvite?.inviterThinksGoodFit,
    inviterKnowsPersonally: linkedInvite?.inviterKnowsPersonally,
  };

  let outcome: RecruitmentOutcome | null = null;
  for (const rule of rules) {
    if (conditionMatches(rule.conditions, ctx)) {
      outcome = rule.outcome;
      break;
    }
  }
  return { outcome, evaluationsFiled: evaluations.length, evaluatorsNeeded, evaluations };
}

export const submitEvaluationInput = z.object({
  recommendation: z.enum(recommendationValues),
  notes: z.string().nullable().optional(),
});
export type SubmitEvaluationInput = z.infer<typeof submitEvaluationInput>;

// Holder-only — "the evaluators" are resolved as whoever currently
// holds the recruitment task, not a separate assignment mechanism.
// Resubmittable in place, same posture as Assemblies'
// submitAssemblyResponse / Budget's submitBudgetVote.
export async function submitEvaluation(actor: Member, formResponseId: string, input: SubmitEvaluationInput) {
  await requireRecruitmentTaskHolder(actor);

  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");
  if (!communityRow.recruitmentApplicationFormId) {
    throw new AppError("No application form is configured for this Community yet");
  }

  const [responseRow] = await db
    .select({ id: formResponse.id })
    .from(formResponse)
    .where(
      and(eq(formResponse.id, formResponseId), eq(formResponse.formId, communityRow.recruitmentApplicationFormId)),
    );
  if (!responseRow) {
    throw new NotFoundError("Application not found");
  }

  const values = { recommendation: input.recommendation, notes: input.notes ?? null, filedAt: new Date() };

  const [existing] = await db
    .select()
    .from(evaluation)
    .where(and(eq(evaluation.formResponseId, formResponseId), eq(evaluation.evaluatorId, actor.id)));

  if (existing) {
    const [updated] = await db.update(evaluation).set(values).where(eq(evaluation.id, existing.id)).returning();
    return updated;
  }

  const [created] = await db
    .insert(evaluation)
    .values({ formResponseId, evaluatorId: actor.id, ...values })
    .returning();
  return created;
}
