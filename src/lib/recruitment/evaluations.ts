import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { evaluation, formResponse } from "@/db/schema";
import type { community as communityTable, member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow, requireRecruitmentScopeForCycle, requireRecruitmentTaskHolder } from "./access";
import { decideFromReports, type DecisionPolicy } from "./decision-policy";
import { ensureArrivalForApplication } from "./admission";
import { getInterviewers, syncInterviewFacts } from "./interviews";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type EvaluationRow = typeof evaluation.$inferSelect;

const recommendationValues = ["proceed", "decline", "unsure"] as const;
export type RecruitmentRecommendation = (typeof recommendationValues)[number];
export type RecruitmentOutcome = "proceed" | "wider_discussion" | "decline";

type RecommendationCounts = Record<RecruitmentRecommendation, number>;

function countRecommendations(evaluations: Pick<EvaluationRow, "recommendation">[]): RecommendationCounts {
  const counts: RecommendationCounts = { proceed: 0, decline: 0, unsure: 0 };
  for (const e of evaluations) counts[e.recommendation] += 1;
  return counts;
}

/** The community's one policy for how reports decide (docs/admission-flow.md §2). */
export function policyOf(communityRow: Pick<
  CommunityRow,
  | "recruitmentInWhen"
  | "recruitmentCustomMinYes"
  | "recruitmentCustomMaxNo"
  | "recruitmentAnyNoMeans"
  | "recruitmentDiscussionEnds"
  | "recruitmentDeclineOutrightAt"
>): DecisionPolicy {
  return {
    inWhen: communityRow.recruitmentInWhen,
    customMinYes: communityRow.recruitmentCustomMinYes,
    customMaxNo: communityRow.recruitmentCustomMaxNo,
    anyNoMeans: communityRow.recruitmentAnyNoMeans,
    discussionEnds: communityRow.recruitmentDiscussionEnds,
    declineOutrightAt: communityRow.recruitmentDeclineOutrightAt,
  };
}

// How many reports THIS arrival needs: the number its lane had when they arrived
// (§2 — "fixed for each person when they arrive, like the rest of their path", and
// per arrival, never per event). An application that predates arrivals is given
// one first, on the lane that now covers it, so there is one answer to "how many"
// and it is never the old community-wide count read behind the lane's back.
async function reportsNeededFor(fallback: number, formResponseId: string): Promise<number> {
  const arrival = await ensureArrivalForApplication(formResponseId);
  return arrival?.reportsNeeded ?? fallback;
}

// Live-computed, never persisted — the same "computed from real state, not a
// second number kept in sync by hand" posture this codebase takes everywhere.
// Returns evaluationsFiled/evaluatorsNeeded alongside so callers (the
// pipeline-ish list views) don't need a second query — outcome is null until the
// arrival's reports are all in. Unsure counts toward them and is neither yes nor
// no; what a full set means is the community's policy, not a list of rules.
export async function computeRecruitmentOutcome(
  communityRow: Pick<
    CommunityRow,
    | "recruitmentEvaluatorCount"
    | "recruitmentInWhen"
    | "recruitmentCustomMinYes"
    | "recruitmentCustomMaxNo"
    | "recruitmentAnyNoMeans"
    | "recruitmentDiscussionEnds"
    | "recruitmentDeclineOutrightAt"
  >,
  formResponseId: string,
) {
  const evaluations = await db.select().from(evaluation).where(eq(evaluation.formResponseId, formResponseId));
  const evaluatorsNeeded = await reportsNeededFor(communityRow.recruitmentEvaluatorCount, formResponseId);
  const notYetDecided = {
    outcome: null as RecruitmentOutcome | null,
    defaultResolution: null as "proceed" | "decline" | null,
    evaluationsFiled: evaluations.length,
    evaluatorsNeeded,
    evaluations,
  };

  if (evaluations.length < evaluatorsNeeded) {
    return notYetDecided;
  }

  const counts = countRecommendations(evaluations);
  const decided = decideFromReports(policyOf(communityRow), { yes: counts.proceed, no: counts.decline, unsure: counts.unsure });
  return {
    outcome: decided.outcome,
    defaultResolution: decided.defaultResolution,
    evaluationsFiled: evaluations.length,
    evaluatorsNeeded,
    evaluations,
  };
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
    .select({ id: formResponse.id, cycleId: formResponse.cycleId })
    .from(formResponse)
    .where(
      and(eq(formResponse.id, formResponseId), eq(formResponse.formId, communityRow.recruitmentApplicationFormId)),
    );
  if (!responseRow) {
    throw new NotFoundError("Application not found");
  }

  // A cycle-placed evaluator can only act on their own cycle's
  // applications — the §4.3 scope rule, enforced on every write just as
  // it is on the pipeline listing.
  await requireRecruitmentScopeForCycle(actor, responseRow.cycleId);

  // Who may file depends on what the lane contains (docs/admission-flow.md §2):
  // with an interview, the interviewers — the holders who took part in the call —
  // and only once it has happened; without one, any holder who reads the
  // application. An application that predates arrivals never had an interview
  // before its decision, and isn't made to wait for one now.
  const arrival = await ensureArrivalForApplication(formResponseId);
  if (arrival?.requiredInterview) {
    const synced = await syncInterviewFacts(arrival.id);
    if (!synced.interviewHeldAt) {
      throw new ConflictError("The interview hasn't happened yet — reports are filed after it, by the people who took part");
    }
    if (!(await getInterviewers(synced)).some((m) => m.id === actor.id)) {
      throw new ForbiddenError("Only the people who took part in the interview can report on it");
    }
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
