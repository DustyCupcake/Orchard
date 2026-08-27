import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { question, questionResponse } from "@/db/schema";
import type { member as memberTable, question as questionTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { requireTaskInCommunity } from "../tasks/shared";
import { getCurrentRound } from "./rounds";

type Member = typeof memberTable.$inferSelect;
type Question = typeof questionTable.$inferSelect;

const responseTypes = ["free_text", "single_choice", "multi_choice"] as const;

export const createQuestionInput = z
  .object({
    text: z.string().min(1),
    responseType: z.enum(responseTypes).optional(),
    options: z.array(z.string().min(1)).optional(),
    deadline: z.string().datetime().nullable().optional(),
    priority: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    const responseType = input.responseType ?? "free_text";
    if (
      (responseType === "single_choice" || responseType === "multi_choice") &&
      (!input.options || input.options.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "options are required for a choice-based response type",
        path: ["options"],
      });
    }
  });
export type CreateQuestionInput = z.infer<typeof createQuestionInput>;

// "Anyone can pose a question, tied to a specific task, at any time.
// No categorization or approval needed" — see docs/spec.md's "Input
// rounds". Queues silently: no round assignment, no notification.
export async function createQuestion(actor: Member, taskId: string, input: CreateQuestionInput) {
  await requireTaskInCommunity(actor, taskId);

  const responseType = input.responseType ?? "free_text";
  if (
    (responseType === "single_choice" || responseType === "multi_choice") &&
    (!input.options || input.options.length === 0)
  ) {
    throw new AppError("options are required for a choice-based response type");
  }

  const [created] = await db
    .insert(question)
    .values({
      taskId,
      askedBy: actor.id,
      text: input.text,
      responseType,
      options: input.options ?? [],
      deadline: input.deadline ? new Date(input.deadline) : null,
      priority: input.priority ?? false,
    })
    .returning();
  return created;
}

// Every question posed on a task, queued or bundled — "results ...
// stay visible on the task itself for anyone else", so this is plain
// task-scoped visibility, no extra gate. Each question comes back with
// its computed status (queued/open/closed, relative to the
// Community's current round) and its responses.
export type QuestionWithResponses = Question & {
  status: "queued" | "open" | "closed";
  responses: (typeof questionResponse.$inferSelect)[];
};

export async function listTaskQuestions(
  actor: Member,
  taskId: string,
): Promise<QuestionWithResponses[]> {
  await requireTaskInCommunity(actor, taskId);

  const questions = await db.select().from(question).where(eq(question.taskId, taskId));
  if (questions.length === 0) return [];

  const currentRound = await getCurrentRound(actor.communityId);
  const allResponses = await db
    .select()
    .from(questionResponse)
    .where(
      inArray(
        questionResponse.questionId,
        questions.map((q) => q.id),
      ),
    );
  const responsesByQuestion = new Map<string, (typeof questionResponse.$inferSelect)[]>();
  for (const r of allResponses) {
    const list = responsesByQuestion.get(r.questionId) ?? [];
    list.push(r);
    responsesByQuestion.set(r.questionId, list);
  }

  return questions.map((q) => ({
    ...q,
    status: !q.roundId ? "queued" : q.roundId === currentRound?.id ? "open" : "closed",
    responses: responsesByQuestion.get(q.id) ?? [],
  }));
}

export const submitQuestionResponseInput = z.object({ value: z.unknown() });
export type SubmitQuestionResponseInput = z.infer<typeof submitQuestionResponseInput>;

function validateValue(q: Question, value: unknown) {
  if (q.responseType === "free_text") {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ConflictError("A text answer is required");
    }
    return value.trim();
  }
  if (q.responseType === "single_choice") {
    if (typeof value !== "string" || !q.options.includes(value)) {
      throw new ConflictError("Answer must be one of this question's options");
    }
    return value;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => q.options.includes(v))) {
    throw new ConflictError("Answer must be a non-empty subset of this question's options");
  }
  return value;
}

// Only answerable while the question is in the Community's *current*
// round — a queued question hasn't opened yet, and a question from a
// superseded round has closed. Upserts in place: "answering ... in a
// single sitting" doesn't preclude changing your mind before the round
// closes.
export async function submitQuestionResponse(
  actor: Member,
  questionId: string,
  input: SubmitQuestionResponseInput,
) {
  const [q] = await db.select().from(question).where(eq(question.id, questionId));
  if (!q) {
    throw new NotFoundError("Question not found");
  }
  await requireTaskInCommunity(actor, q.taskId);

  const currentRound = await getCurrentRound(actor.communityId);
  if (!q.roundId || q.roundId !== currentRound?.id) {
    throw new ConflictError("This question isn't open for answers right now");
  }

  const value = validateValue(q, input.value);

  const [existing] = await db
    .select()
    .from(questionResponse)
    .where(and(eq(questionResponse.questionId, questionId), eq(questionResponse.memberId, actor.id)));

  if (existing) {
    const [updated] = await db
      .update(questionResponse)
      .set({ value, answeredAt: new Date() })
      .where(eq(questionResponse.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(questionResponse)
    .values({ questionId, memberId: actor.id, value })
    .returning();
  return created;
}
