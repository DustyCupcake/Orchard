import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { admission } from "@/db/schema";
import type { community as communityTable, member as memberTable, recruitmentDecision } from "@/db/schema";
import { getCompositionBreakdown } from "../composition";
import { getCurrentCycle } from "../profile-questions";
import { getCycleParticipationSummary } from "../participation";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow, requireRecruitmentTaskHolder } from "./access";
import { isSharedByOpenness, type NeedsAction } from "../needs-action";
import { listGrantingTaskIds } from "../permissions";
import { getRecruitmentDecision } from "./decisions";
import { admissionNeedsAction, type AdmissionStage, type AdmissionStageReadout } from "./admission-stage";
import { loadArrivalReadout } from "./admission";
import { getInterviewState, syncInterviewFacts, type InterviewState } from "./interviews";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type RecruitmentDecisionRow = typeof recruitmentDecision.$inferSelect;

// docs/admission-flow.md §4: the stage is a pure function of the facts and the path
// (admission-stage.ts), and this pipeline, the dashboard's needs-action list and
// the person's own page all read that and nothing else. It used to be a second
// opinion computed here from the decision, the evaluations and the intro-call
// poll, which could only cover the evaluated path and whose own comment recorded
// two places the spec's arrow chain and the built code disagreed — one of which
// was the call coming *after* a decision that had already admitted the person.
export type RecruitmentCandidate = {
  /** The arrival — the person in the funnel. */
  id: string;
  formResponseId: string | null;
  name: string;
  laneName: string | null;
  submittedAt: Date;
  stage: AdmissionStage;
  reason: AdmissionStageReadout["reason"];
  /** The plain sentence the person is shown for this stage. */
  sentence: string;
  stageSince: Date;
  evaluationsFiled: number;
  reportsNeeded: number | null;
  /** Is the community the one that has to move? (§4: not the person, not a window running.) */
  needsAction: boolean;
  /** What exactly is waiting, for the holders, or null. */
  actionLabel: string | null;
  decision: RecruitmentDecisionRow | null;
};

// What is waiting, in the holders' words — the part the stage alone can't say,
// because it depends on who has offered what for the interview.
function actionLabelFor(readout: AdmissionStageReadout, interview: InterviewState | null, needed: number | null): string | null {
  if (!admissionNeedsAction(readout)) return null;
  if (interview && !interview.confirmed) {
    if (!interview.poll) return "Interview not set up — conversations are closed, or no recruitment task exists to file it under";
    if (interview.qualifyingSlots.length > 0) return "Interview ready to book";
    return "Interview needs more of you to offer times";
  }
  if (readout.stage === "decision_pending") return "Decision pending";
  return `Reports needed (${readout.evaluationsFiled} of ${needed ?? 0})`;
}

async function toCandidate(arrival: typeof admission.$inferSelect, communityRow: CommunityRow): Promise<RecruitmentCandidate> {
  // The poll's own state is written onto the arrival before it is read, so the
  // stage and what a holder sees agree about whether the call is booked or held.
  const synced = arrival.interviewPollId ? await syncInterviewFacts(arrival.id) : arrival;
  const interview = synced.requiredInterview ? await getInterviewState(synced) : null;
  // Waiting on the person: the interview poll exists and they haven't said when they're free.
  const waitingOnThePerson = Boolean(interview?.poll && !interview.confirmed && !interview.personHasOffered);
  const { readout, sentence, laneName } = await loadArrivalReadout(synced, { waitingOnThePerson });
  const decision = synced.formResponseId ? await getRecruitmentDecision(synced.formResponseId) : null;
  // The reports an application has counts live from the evaluations table (§4: no
  // second opinion of it kept on the arrival).
  void communityRow;
  return {
    id: synced.id,
    formResponseId: synced.formResponseId,
    name: synced.name,
    laneName,
    submittedAt: synced.createdAt,
    stage: readout.stage,
    reason: readout.reason,
    sentence,
    stageSince: readout.since ?? synced.createdAt,
    evaluationsFiled: readout.evaluationsFiled,
    reportsNeeded: readout.reportsNeeded,
    needsAction: admissionNeedsAction(readout),
    actionLabel: actionLabelFor(readout, interview, readout.reportsNeeded),
    decision,
  };
}

// Everyone with something to evaluate — an application or an interview — newest
// first. A lane that admits at once, or runs only a community check, has no
// evaluation to wait on and is not a recruitment candidate; the person's own page
// and the mediation queue already cover them.
async function listCandidates(communityRow: CommunityRow): Promise<RecruitmentCandidate[]> {
  const arrivals = await db
    .select()
    .from(admission)
    .where(and(eq(admission.communityId, communityRow.id), eq(admission.requiredEvaluation, true)))
    .orderBy(desc(admission.createdAt));
  return Promise.all(arrivals.map((arrival) => toCandidate(arrival, communityRow)));
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
export async function listRecruitmentActionItems(actor: Member): Promise<NeedsAction<RecruitmentCandidate>> {
  await requireRecruitmentTaskHolder(actor);
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const candidates = await listCandidates(communityRow);
  const items = candidates.filter((c) => c.needsAction);

  // An open module reaches this gate for every member, so the same
  // outstanding candidates land in every member's feed. Split them
  // (docs/open-permissions-plan.md D12): a real holder is on the hook, a
  // member who is only in the module because it is open is not.
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "recruitment");
  const shared = await isSharedByOpenness(actor.communityId, "recruitment", actor.id, grantingTaskIds);
  return shared ? { personal: [], shared: items } : { personal: items, shared: [] };
}
