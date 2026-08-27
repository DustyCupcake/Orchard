import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assembly, assemblyQuestion, assemblyResponse } from "@/db/schema";
import type { member as memberTable, assemblyQuestion as assemblyQuestionTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { computeAssemblyPhase } from "./phase";

type Member = typeof memberTable.$inferSelect;
type AssemblyQuestion = typeof assemblyQuestionTable.$inferSelect;

export const submitAssemblyResponseInput = z.object({ value: z.unknown() });
export type SubmitAssemblyResponseInput = z.infer<typeof submitAssemblyResponseInput>;

function validateValue(q: AssemblyQuestion, value: unknown) {
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
