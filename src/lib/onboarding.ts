import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, member, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getUnmetRequirements, listRequirements } from "./tasks";
import {
  AXIS_SCALE_MAX,
  AXIS_SCALE_MIN,
  COMMITMENT_PREFERENCE_AXIS_KEY,
  effortAxisValue,
  listMemberAxisValues,
  listTaskAxisValuesForTasks,
  listTraitAxes,
} from "./trait-axes";

type Member = typeof memberTable.$inferSelect;

// docs/development-plan.md's Phase 56 — "a handful of static cards,
// not a manual," the same hardcoded-per-use posture Forms' own MVP
// fields already take. No CMS/authoring UI; editing these is a code
// change, deliberately, until real use ever asks for more.
export const ONBOARDING_CARDS: { title: string; body: string }[] = [
  {
    title: "Work, not roles",
    body: "The atomic unit here is the task, not a position. You claim work directly — nobody assigns you a fixed job.",
  },
  {
    title: "Claim what fits, park what doesn't",
    body: "See something open that fits your time or skills? Claim it. Stuck on something you're already holding? Park it with a note — nobody's watching a clock.",
  },
  {
    title: "Start small, take on more",
    body: "A task's detail page always shows what it actually needs — description, requirements, who else is on it. Finishing one nudges you toward related ones.",
  },
  {
    title: "Ask when you're stuck",
    body: "Every task has a \"talk to my coordinator\" button and a wiki for notes others left. You're never expected to figure it out alone.",
  },
];

export async function completeOnboarding(actor: Member) {
  await db.update(member).set({ hasCompletedOnboarding: true }).where(eq(member.id, actor.id));
}

export type TaskFitSuggestion = { id: string; title: string; branchName: string };

const AXIS_SCALE_RANGE = AXIS_SCALE_MAX - AXIS_SCALE_MIN;

// The one real, resolved consumer of Phase 50's "requirements that fit
// you" eligibility check, reused for a *different* purpose than that
// phase's own sort dimension. "Surfacing, not deciding" still holds —
// this never gates a claim, never auto-assigns anyone, and the internal
// score below is never serialized or shown to anyone — but it IS now a
// real ranking signal, not the flat "first N matches in query order"
// this used to be. That's a deliberate reversal of this comment's own
// prior claim that ranking was permanently out of scope: confirmed with
// the user that what was actually meant to stay out of scope is
// *automatic assignment*, not internal scoring used only to order
// suggestions. See docs/spec.md's "Member onboarding & first session"
// and trait-axes.ts for the axis-proximity half of the score; tag
// overlap and satisfied individual_gate Requirements are the other two
// signals, same as before, still the only three ways a candidate gets
// included at all — an axis-only match with no tag/gate signal also
// counts as included now, since axes are a real fit signal in their
// own right.
export async function listTaskFitSuggestions(
  actor: Member,
  options: { excludeTaskId?: string; limit?: number } = {},
): Promise<TaskFitSuggestion[]> {
  const limit = options.limit ?? 3;

  const candidates = await db
    .select({ id: task.id, title: task.title, tags: task.tags, effort: task.effort, branchName: branch.name })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(and(eq(task.communityId, actor.communityId), eq(task.status, "unclaimed")));

  const relevantCandidates = options.excludeTaskId
    ? candidates.filter((c) => c.id !== options.excludeTaskId)
    : candidates;

  const memberTags = new Set(actor.tags);
  const axes = await listTraitAxes(actor);
  const commitmentAxis = axes.find((a) => a.key === COMMITMENT_PREFERENCE_AXIS_KEY);
  const otherAxes = axes.filter((a) => a.key !== COMMITMENT_PREFERENCE_AXIS_KEY);

  const [memberAxisValues, taskAxisValuesByTask] = await Promise.all([
    listMemberAxisValues(actor.id),
    listTaskAxisValuesForTasks(relevantCandidates.map((c) => c.id)),
  ]);

  const scored: (TaskFitSuggestion & { score: number })[] = [];

  for (const candidate of relevantCandidates) {
    const tagOverlap = candidate.tags.some((tag) => memberTags.has(tag));
    let gateFit = false;
    if (!tagOverlap) {
      const requirements = await listRequirements(actor, candidate.id);
      const gates = requirements.filter((r) => r.mode === "individual_gate");
      if (gates.length > 0) {
        const unmet = await getUnmetRequirements(db, actor, candidate.id);
        gateFit = unmet.length === 0;
      }
    }

    const taskAxisMap = taskAxisValuesByTask.get(candidate.id) ?? new Map<string, number>();
    const proximities: number[] = [];
    for (const axis of otherAxes) {
      const memberValue = memberAxisValues.get(axis.id);
      const taskValue = taskAxisMap.get(axis.id);
      if (memberValue === undefined || taskValue === undefined) continue;
      proximities.push(1 - Math.abs(memberValue - taskValue) / AXIS_SCALE_RANGE);
    }
    if (commitmentAxis) {
      const memberValue = memberAxisValues.get(commitmentAxis.id);
      if (memberValue !== undefined) {
        const taskValue = effortAxisValue(candidate.effort);
        proximities.push(1 - Math.abs(memberValue - taskValue) / AXIS_SCALE_RANGE);
      }
    }

    if (!tagOverlap && !gateFit && proximities.length === 0) continue;

    // A first-pass weighting, deliberately tunable — the point of
    // scoring at all (rather than a flat qualifying test) is to let this
    // get smarter over time as real use shows what actually predicts a
    // good fit, per the user's own framing of this feature.
    const avgProximity = proximities.length > 0 ? proximities.reduce((a, b) => a + b, 0) / proximities.length : 0;
    const score = avgProximity + (tagOverlap ? 0.5 : 0) + (gateFit ? 0.5 : 0);

    scored.push({ id: candidate.id, title: candidate.title, branchName: candidate.branchName, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ id, title, branchName }) => ({ id, title, branchName }));
}
