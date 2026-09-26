import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { question, questionResponse } from "@/db/schema";
import type { member as memberTable, question as questionTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import {
  RESPONSE_TYPES,
  TEXT_VALIDATIONS,
  fieldShapeColumnValues,
  isChoiceType,
  toFieldShape,
  validateFieldValue,
} from "../field-shape";
import { requireTaskInCommunity } from "../tasks/shared";
import { getCurrentRound } from "./rounds";

type Member = typeof memberTable.$inferSelect;
type Question = typeof questionTable.$inferSelect;

// The same six shapes every other question system uses, from the same
// list — see src/lib/field-shape.ts. This was its own three-value list
// with its own validator below, which is exactly the duplication that
// made a task question unable to ask "when could you do this".
const responseTypes = RESPONSE_TYPES;

const fieldShapeInput = {
  multiline: z.boolean().optional(),
  validation: z.enum(TEXT_VALIDATIONS).optional(),
  allowOther: z.boolean().optional(),
  min: z.number().int().nullable().optional(),
  max: z.number().int().nullable().optional(),
  step: z.number().int().nullable().optional(),
};

export const createQuestionInput = z
  .object({
    text: z.string().min(1),
    responseType: z.enum(responseTypes).optional(),
    options: z.array(z.string().min(1)).optional(),
    ...fieldShapeInput,
    deadline: z.string().datetime().nullable().optional(),
    priority: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (isChoiceType(input.responseType ?? "text") && (!input.options || input.options.length === 0)) {
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

  const responseType = input.responseType ?? "text";
  if (isChoiceType(responseType) && (!input.options || input.options.length === 0)) {
    throw new AppError("options are required for a choice-based response type");
  }

  const [created] = await db
    .insert(question)
    .values({
      taskId,
      askedBy: actor.id,
      text: input.text,
      responseType,
      // Field-shape flags, with the ones that don't apply to this type
      // zeroed in one place — same rule as ProfileQuestion and Form.
      ...fieldShapeColumnValues(toFieldShape({ responseType, ...input, options: input.options ?? [] })),
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

// One question by id, for a caller that has to read a submitted value
// against the shape it was rendered from. Mirrors getProfileQuestion on
// the ProfileQuestion side; a second lookup on the write path is the
// price of keeping the form-data interpretation in the action, and it's
// a single indexed row either way.
export async function getQuestionForShape(actor: Member, questionId: string) {
  const [row] = await db.select().from(question).where(eq(question.id, questionId));
  if (!row) {
    throw new NotFoundError("Question not found");
  }
  // Community scoping comes from the task the question hangs off, so
  // there's no community column to filter on here — go through the task
  // to check it, which is the same gate createQuestion/listTaskQuestions
  // use. This exists to interpret submitted input, not to authorize;
  // submitQuestionResponse still re-checks the round and lifecycle rules.
  await requireTaskInCommunity(actor, row.taskId);
  return row;
}

export const submitQuestionResponseInput = z.object({ value: z.unknown() });
export type SubmitQuestionResponseInput = z.infer<typeof submitQuestionResponseInput>;

// The one validator, shared with ProfileQuestion, Form submissions and
// Assemblies — see src/lib/field-shape.ts. Was a per-responseType
// if/else chain here that knew about three types; a fourth question
// system has to be able to ask about a date or a number without writing
// its own copy of this.
//
// A blank submission is rejected rather than stored, but the wording is
// ours: a member who leaves an input-round question alone has answered
// perfectly well by not answering, so "this answer is required" would be
// both false and a bit of a telling-off for pressing the button on an
// empty box. `question_response.value` is NOT NULL, so there is also no
// honest way to store a blank — the alternatives are deleting the
// response (a silent no-op that leaves "Update answer" doing nothing)
// and the database error this avoids.
function validateValue(q: Question, value: unknown) {
  return validateFieldValue(
    toFieldShape({
      responseType: q.responseType,
      options: q.options,
      multiline: q.multiline,
      validation: q.validation,
      allowOther: q.allowOther,
      min: q.min,
      max: q.max,
      step: q.step,
    }),
    value,
    {
      allowBlank: false,
      blankMessage: "Fill this in to answer the question, or leave it for now",
    },
  );
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
