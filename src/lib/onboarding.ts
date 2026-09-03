import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, member, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getUnmetRequirements, listRequirements } from "./tasks";

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

// The one real, resolved consumer of Phase 50's "requirements that fit
// you" eligibility check, reused for a *different* purpose than that
// phase's own sort dimension: "surfacing, not deciding" here means a
// plain unclaimed-tasks pool narrowed by a cheap fit test — tag overlap
// with the member's own `tags`, or an individual_gate Requirement they
// fully satisfy — never a scored/ranked recommendation engine (still
// permanently out of scope, same line Phase 50 draws). Used both for
// onboarding's first-login suggestions and, reusing this exact same
// function (per docs/development-plan.md's own "using the same
// heuristic, not a second mechanism"), for the Done-confirmation
// "you might also like" strip on the board.
export async function listTaskFitSuggestions(
  actor: Member,
  options: { excludeTaskId?: string; limit?: number } = {},
): Promise<TaskFitSuggestion[]> {
  const limit = options.limit ?? 3;

  const candidates = await db
    .select({ id: task.id, title: task.title, tags: task.tags, branchName: branch.name })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(and(eq(task.communityId, actor.communityId), eq(task.status, "unclaimed")));

  const memberTags = new Set(actor.tags);
  const fits: TaskFitSuggestion[] = [];

  for (const candidate of candidates) {
    if (options.excludeTaskId && candidate.id === options.excludeTaskId) continue;

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

    if (tagOverlap || gateFit) {
      fits.push({ id: candidate.id, title: candidate.title, branchName: candidate.branchName });
      if (fits.length >= limit) break;
    }
  }

  return fits;
}
