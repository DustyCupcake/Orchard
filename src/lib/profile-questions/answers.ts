import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { profileAnswer, profileQuestion } from "@/db/schema";
import type { member as memberTable, profileQuestion as profileQuestionTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { getCurrentCycle, getCurrentPhase } from "./capacity";

type Member = typeof memberTable.$inferSelect;
type ProfileQuestion = typeof profileQuestionTable.$inferSelect;

export const submitAnswerInput = z.object({
  status: z.enum(["answered", "deferred"]),
  value: z.unknown().optional(),
  capacityVisibility: z.enum(["flag_only", "open"]).optional(),
});
export type SubmitAnswerInput = z.infer<typeof submitAnswerInput>;

function validateValue(question: ProfileQuestion, value: unknown) {
  if (question.responseType === "free_text") {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ConflictError("A text answer is required");
    }
    return value.trim();
  }
  if (question.responseType === "single_choice") {
    if (typeof value !== "string" || !question.options.includes(value)) {
      throw new ConflictError("Answer must be one of this question's options");
    }
    return value;
  }
  // multi_choice
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => question.options.includes(v))) {
    throw new ConflictError("Answer must be a non-empty subset of this question's options");
  }
  return value;
}

// Which cycle a per_cycle/phase answer stamps against — null for
// once_ever (see profile-question.ts's schema comment). Throws if a
// per_cycle/phase question is answered with no current cycle to stamp
// it against; in practice this shouldn't happen since such a question
// wouldn't have appeared in listOutstandingQuestions() either.
async function resolveCycleId(question: ProfileQuestion, communityId: string): Promise<string | null> {
  if (question.scope === "once_ever") return null;
  const currentCycle = await getCurrentCycle(communityId);
  if (!currentCycle) {
    throw new ConflictError("No current cycle to answer this against");
  }
  return currentCycle.id;
}

export async function answerProfileQuestion(
  actor: Member,
  questionId: string,
  input: SubmitAnswerInput,
) {
  const [question] = await db
    .select()
    .from(profileQuestion)
    .where(and(eq(profileQuestion.id, questionId), eq(profileQuestion.communityId, actor.communityId)));
  if (!question || question.archivedAt) {
    throw new NotFoundError("Profile question not found");
  }

  const value = input.status === "answered" ? validateValue(question, input.value) : null;
  const cycleId = await resolveCycleId(question, actor.communityId);

  const [existing] = await db
    .select()
    .from(profileAnswer)
    .where(
      and(
        eq(profileAnswer.memberId, actor.id),
        eq(profileAnswer.questionId, questionId),
        cycleId ? eq(profileAnswer.cycleId, cycleId) : isNull(profileAnswer.cycleId),
      ),
    );

  const row = {
    status: input.status,
    value,
    capacityVisibility: input.capacityVisibility ?? "flag_only",
    answeredAt: new Date(),
  } as const;

  if (existing) {
    const [updated] = await db
      .update(profileAnswer)
      .set(row)
      .where(eq(profileAnswer.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(profileAnswer)
    .values({ memberId: actor.id, questionId, cycleId, ...row })
    .returning();
  return created;
}

export type OutstandingQuestion = {
  question: ProfileQuestion;
  existingAnswer: typeof profileAnswer.$inferSelect | null;
};

// Profile page: which questions does this member have no real answer
// for yet — no answer at all, or a deferred one (see spec's
// "Surfacing"). A per_cycle/phase question that can't resolve to a
// current cycle/phase at all just doesn't appear, same as it wouldn't
// on any other surface.
export async function listOutstandingQuestions(actor: Member): Promise<OutstandingQuestion[]> {
  const questions = await db
    .select()
    .from(profileQuestion)
    .where(and(eq(profileQuestion.communityId, actor.communityId), isNull(profileQuestion.archivedAt)));

  const currentCycle = await getCurrentCycle(actor.communityId);
  const currentPhase = await getCurrentPhase(actor.communityId);

  const outstanding: OutstandingQuestion[] = [];
  for (const q of questions) {
    let cycleId: string | null = null;
    if (q.scope === "once_ever") {
      cycleId = null;
    } else if (q.scope === "per_cycle") {
      if (!currentCycle) continue;
      cycleId = currentCycle.id;
    } else {
      // phase
      if (!currentCycle || !currentPhase) continue;
      if (q.phaseNameHint?.toLowerCase() !== currentPhase.name.toLowerCase()) continue;
      cycleId = currentCycle.id;
    }

    const [existing] = await db
      .select()
      .from(profileAnswer)
      .where(
        and(
          eq(profileAnswer.memberId, actor.id),
          eq(profileAnswer.questionId, q.id),
          cycleId ? eq(profileAnswer.cycleId, cycleId) : isNull(profileAnswer.cycleId),
        ),
      );

    if (!existing || existing.status === "deferred") {
      outstanding.push({ question: q, existingAnswer: existing ?? null });
    }
  }

  return outstanding;
}

// Once-ever answers a member has already given — shown/editable
// directly on their profile, same as tags or contact methods (spec:
// "not something they have to hunt down a form to correct").
export async function listOnceEverAnswers(actor: Member) {
  const questions = await db
    .select()
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, actor.communityId),
        eq(profileQuestion.scope, "once_ever"),
        isNull(profileQuestion.archivedAt),
      ),
    );

  const answers = await db
    .select()
    .from(profileAnswer)
    .where(and(eq(profileAnswer.memberId, actor.id), isNull(profileAnswer.cycleId)));
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  return questions
    .filter((q) => answerByQuestion.has(q.id) && answerByQuestion.get(q.id)!.status === "answered")
    .map((q) => ({ question: q, answer: answerByQuestion.get(q.id)! }));
}
