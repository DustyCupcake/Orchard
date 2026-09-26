import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assembly, assemblyQuestion, assemblyResponse } from "@/db/schema";
import type { member as memberTable, assemblyQuestion as assemblyQuestionTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { toFieldShape, validateFieldValue } from "../field-shape";
import { computeAssemblyPhase } from "./phase";

type Member = typeof memberTable.$inferSelect;
type AssemblyQuestion = typeof assemblyQuestionTable.$inferSelect;

export const submitAssemblyResponseInput = z.object({ value: z.unknown() });
export type SubmitAssemblyResponseInput = z.infer<typeof submitAssemblyResponseInput>;

// The one validator, shared with ProfileQuestion, Form submissions and
// input rounds — see src/lib/field-shape.ts. Was the third copy of this
// if/else chain. A blank submission is rejected with wording of our own:
// abstaining from an agenda item is a complete position, so the shared
// "this answer is required" would misdescribe it. `assembly_response
// .value` is NOT NULL, so rejecting is also the only option that
// reports the problem instead of failing on the constraint.
function validateValue(q: AssemblyQuestion, value: unknown) {
  if (Array.isArray(value) && value.length === 0 && q.responseType === "multi_choice") {
    // Unchecking every box in a pick-any question is a different
    // mistake from picking something invalid, and saying so is the
    // difference between a member understanding what went wrong and
    // them concluding the question is broken. (The single-choice path
    // can't reach here — the browser always submits exactly one radio.)
    // Checked before the shared validator, which treats an empty array
    // as a blank and would answer with the generic wording above.
    throw new ConflictError("Pick at least one of this question's answers");
  }
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
      blankMessage: "Fill this in to record your answer, or leave this item unanswered",
    },
  );
}

// Only answerable during the Assembly's voting phase — not before
// (notice: "agenda locked and visible, voting not yet open") and not
// after ("then it closes"). Upserts in place, same as Input rounds'
// submitQuestionResponse().
export async function submitAssemblyResponse(
  actor: Member,
  agendaQuestionId: string,
  input: SubmitAssemblyResponseInput,
) {
  const [q] = await db.select().from(assemblyQuestion).where(eq(assemblyQuestion.id, agendaQuestionId));
  if (!q) {
    throw new NotFoundError("Agenda item not found");
  }
  const [a] = await db
    .select()
    .from(assembly)
    .where(and(eq(assembly.id, q.assemblyId), eq(assembly.communityId, actor.communityId)));
  if (!a) {
    throw new NotFoundError("Assembly not found");
  }
  if (computeAssemblyPhase(a) !== "voting") {
    throw new ConflictError("Voting isn't open for this Assembly right now");
  }

  const value = validateValue(q, input.value);
  return upsertResponse(actor, agendaQuestionId, value);
}

// The value is whatever validateFieldValue normalised it to, so it's
// `unknown` here rather than string | string[] — a number question
// yields a number, a yes/no yields a boolean, and the assembly_response
// column is jsonb precisely so all of those can be stored as themselves.
async function upsertResponse(actor: Member, agendaQuestionId: string, value: unknown) {
  const [existing] = await db
    .select()
    .from(assemblyResponse)
    .where(
      and(eq(assemblyResponse.assemblyQuestionId, agendaQuestionId), eq(assemblyResponse.memberId, actor.id)),
    );

  if (existing) {
    const [updated] = await db
      .update(assemblyResponse)
      .set({ value, answeredAt: new Date() })
      .where(eq(assemblyResponse.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(assemblyResponse)
    .values({ assemblyQuestionId: agendaQuestionId, memberId: actor.id, value })
    .returning();
  return created;
}

export type AssemblyBatchResult = {
  saved: string[];
  failed: { questionId: string; message: string }[];
};

/**
 * Answering a whole agenda in one go.
 *
 * A five-item Assembly used to mean five round-trips and five "Vote"
 * clicks — slow, and five chances to fat-finger one option. One submit
 * for the whole ballot is how a vote is meant to work.
 *
 * Two behaviours that only make sense because this is a batch:
 *
 *  - **A blank answer is skipped, not an error.** Left empty is how you
 *    say "not this one" when four others are answered. Treating it as a
 *    failure would make a partial ballot impossible to submit.
 *  - **Failures are per-question, and the rest still save.** A typo in
 *    one free-text box shouldn't discard four good answers, so each
 *    question is validated and written independently and the caller
 *    gets back which ones didn't take.
 */
export async function submitAssemblyResponses(
  actor: Member,
  questionIds: string[],
  answers: Record<string, unknown>,
): Promise<AssemblyBatchResult> {
  if (questionIds.length === 0) {
    return { saved: [], failed: [] };
  }

  // One query for every question, one for every Assembly they belong to
  // — rather than the two-per-question lookups the single-question path
  // does. Community scoping rides along here, so a questionId belonging
  // to another community simply isn't in `rows` and is reported as
  // unknown rather than being answered.
  const rows = await db.select().from(assemblyQuestion).where(inArray(assemblyQuestion.id, questionIds));
  const assemblyIds = [...new Set(rows.map((r) => r.assemblyId))];
  const assemblyRows =
    assemblyIds.length > 0
      ? await db
          .select()
          .from(assembly)
          .where(and(inArray(assembly.id, assemblyIds), eq(assembly.communityId, actor.communityId)))
      : [];
  const foundAssemblyIds = new Set(assemblyRows.map((a) => a.id));
  const votingAssemblyIds = new Set(
    assemblyRows.filter((a) => computeAssemblyPhase(a) === "voting").map((a) => a.id),
  );

  const saved: string[] = [];
  const failed: { questionId: string; message: string }[] = [];
  for (const id of questionIds) {
    const q = rows.find((r) => r.id === id);
    if (!q) {
      failed.push({ questionId: id, message: "That agenda item no longer exists" });
      continue;
    }
    // Two different reasons, kept apart on purpose. A question in
    // another community isn't in `assemblyRows` at all (the community
    // filter is on that query), and telling someone "voting isn't open"
    // about someone else's Assembly would be both wrong and a small
    // hint that it exists. Same NotFoundError wording the
    // single-question path uses.
    if (!foundAssemblyIds.has(q.assemblyId)) {
      failed.push({ questionId: id, message: "That agenda item isn't in this community" });
      continue;
    }
    if (!votingAssemblyIds.has(q.assemblyId)) {
      failed.push({ questionId: id, message: "Voting isn't open for this Assembly right now" });
      continue;
    }

    const raw = answers[id];
    const blank =
      raw === undefined ||
      (typeof raw === "string" ? raw.trim() === "" : Array.isArray(raw) && raw.length === 0);
    if (blank) continue;

    try {
      await upsertResponse(actor, id, validateValue(q, raw));
      saved.push(id);
    } catch (err) {
      failed.push({
        questionId: id,
        message: err instanceof ConflictError ? err.message : "That answer couldn't be saved",
      });
    }
  }

  return { saved, failed };
}
