import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { formResponse, schedulingPoll, taskAssignment } from "@/db/schema";
import type { community as communityTable, member as memberTable, recruitmentDecision } from "@/db/schema";
import { getCompositionBreakdown } from "../composition";
import { getCurrentCycle } from "../profile-questions";
import { getCycleParticipationSummary } from "../participation";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow, requireRecruitmentTaskHolder } from "./access";
import { computeRecruitmentOutcome } from "./evaluations";
import { getRecruitmentDecision } from "./decisions";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type RecruitmentDecisionRow = typeof recruitmentDecision.$inferSelect;

// docs/spec.md's own state machine names "accepted / declined /
// waitlisted" as the decision-reached tier — but nothing across Phases
// 32-34 ever produces a "waitlisted" resolution (recruitmentDecision's
// own resolution enum is only accepted/declined; see
// src/db/schema/recruitment.ts). Same category of real, flagged gap as
// Phase 34's own referredByMemberId note: resolved here by only ever
// computing accepted/declined for that tier, never inventing a third
// value the rest of the system has no way to set.
export const RECRUITMENT_PIPELINE_STAGES = [
  "applied",
  "evaluation_in_progress",
  "call_pending",
  "call_scheduled",
  "decision_pending",
  "accepted",
  "declined",
  "accompaniment_assigned",
] as const;
export type RecruitmentPipelineStage = (typeof RECRUITMENT_PIPELINE_STAGES)[number];

export type RecruitmentCandidate = {
  id: string;
  submittedAt: Date;
  stage: RecruitmentPipelineStage;
  stageSince: Date;
  evaluationsFiled: number;
  evaluatorsNeeded: number;
  decision: RecruitmentDecisionRow | null;
};

// A candidate's stage is read live off Form/Evaluation/SchedulingPoll/
// Task state — never a stored field, per docs/spec.md's own framing.
// One real, documented deviation from spec's linear arrow chain: spec
// narrates evaluate → call → decide, but Phase 33/34 actually built
// evaluate → decide-via-rules (recordDecisionIfReached, synchronous)
// → call (auto-scheduled as a side effect of a proceed-adjacent
// decision, not an input into it). A straight "decline" never gets a
// call at all, and a straight "proceed" already has resolution=
// "accepted" set the instant the decision is recorded — so
// "call_pending"/"call_scheduled"/"decision_pending" are only ever
// actually reachable for a still-unresolved wider_discussion
// candidate, distinguished by comparing the intro call's
// confirmedSlotStart against now(): unconfirmed → call_pending,
// confirmed-but-future → call_scheduled, confirmed-and-past (the call
// happened) → decision_pending, exactly spec's own "call happened, no
// outcome recorded" phrasing.
async function computeCandidateStage(
  communityRow: CommunityRow,
  response: { id: string; submittedAt: Date },
): Promise<RecruitmentCandidate> {
  const { evaluationsFiled, evaluatorsNeeded } = await computeRecruitmentOutcome(communityRow, response.id);
  const decision = await getRecruitmentDecision(response.id);

  const base = { id: response.id, submittedAt: response.submittedAt, evaluationsFiled, evaluatorsNeeded, decision };

  if (!decision) {
    return {
      ...base,
      stage: evaluationsFiled === 0 ? "applied" : "evaluation_in_progress",
      stageSince: response.submittedAt,
    };
  }

  if (decision.resolution === "declined") {
    return { ...base, stage: "declined", stageSince: decision.decidedAt };
  }

  if (decision.resolution === "accepted") {
    if (decision.accompanimentTaskId) {
      const [holding] = await db
        .select({ claimedAt: taskAssignment.claimedAt })
        .from(taskAssignment)
        .where(and(eq(taskAssignment.taskId, decision.accompanimentTaskId), eq(taskAssignment.isShadow, false)))
        .orderBy(taskAssignment.claimedAt)
        .limit(1);
      if (holding) {
        return { ...base, stage: "accompaniment_assigned", stageSince: holding.claimedAt };
      }
    }
    return { ...base, stage: "accepted", stageSince: decision.decidedAt };
  }

  // resolution === null: only reachable for a still-open wider_discussion
  // window (proceed sets "accepted" immediately; decline sets "declined"
  // immediately — see src/lib/recruitment/decisions.ts's recordDecisionIfReached).
  const poll = decision.introCallPollId
    ? (await db.select().from(schedulingPoll).where(eq(schedulingPoll.id, decision.introCallPollId)))[0]
    : undefined;

  if (!poll || !poll.confirmedSlotStart) {
    return { ...base, stage: "call_pending", stageSince: decision.decidedAt };
  }
  if (poll.confirmedSlotStart > new Date()) {
    return { ...base, stage: "call_scheduled", stageSince: poll.confirmedAt ?? decision.decidedAt };
  }
  return { ...base, stage: "decision_pending", stageSince: poll.confirmedSlotStart };
}

async function listCandidates(communityRow: CommunityRow): Promise<RecruitmentCandidate[]> {
  if (!communityRow.recruitmentApplicationFormId) return [];

  const responses = await db
    .select({ id: formResponse.id, submittedAt: formResponse.submittedAt })
    .from(formResponse)
    .where(eq(formResponse.formId, communityRow.recruitmentApplicationFormId))
    .orderBy(desc(formResponse.submittedAt));

  return Promise.all(responses.map((response) => computeCandidateStage(communityRow, response)));
}

// Holder-only — "a list of everyone currently in flight, their
// computed stage, and how long they've sat there," alongside the
// Cycle's remaining capacity (Phase 31) and a Tier/Branch composition
// breakdown (reusing Phase 24's own logic via getCompositionBreakdown)
// as informational context. Never a community-wide view — see
// docs/spec.md's Recruitment pipeline view: "not the kind of thing
// that needs default-open visibility the way a task does."
export async function getRecruitmentPipeline(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const currentCycle = await getCurrentCycle(actor.communityId);
  const [candidates, capacity, composition] = await Promise.all([
    listCandidates(communityRow),
    currentCycle ? getCycleParticipationSummary(actor, currentCycle.id) : Promise.resolve(null),
    getCompositionBreakdown(actor),
  ]);

  return { candidates, capacity, composition };
}

// The dashboard's own "needs action" subset — evaluated-but-uncalled
// (call_pending) or called-but-undecided (decision_pending), per
// docs/development-plan.md's Phase 35. A thin filter over the same
// listCandidates the full pipeline view uses, skipping the
// capacity/composition context the dashboard doesn't need.
export async function listRecruitmentActionItems(actor: Member): Promise<RecruitmentCandidate[]> {
  await requireRecruitmentTaskHolder(actor);
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const candidates = await listCandidates(communityRow);
  return candidates.filter((c) => c.stage === "call_pending" || c.stage === "decision_pending");
}
