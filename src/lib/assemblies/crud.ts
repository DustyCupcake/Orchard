import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assembly, assemblyQuestion, assemblyResponse } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { computeAssemblyPhase } from "./phase";

type Member = typeof memberTable.$inferSelect;

// "The proposer ... picks durations that fit what's being decided,
// down to compressing agenda and notice to nearly nothing for
// something genuinely time-sensitive" — agenda/notice can be zero,
// voting can't (there'd be nothing left to actually vote during).
export const createAssemblyInput = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  agendaMinutes: z.number().int().min(0),
  noticeMinutes: z.number().int().min(0),
  votingMinutes: z.number().int().min(1),
});
export type CreateAssemblyInput = z.infer<typeof createAssemblyInput>;

// "Any member can propose an Assembly, same open-access principle as
// everywhere else — no gatekeeping on who's allowed to call for one."
export async function createAssembly(actor: Member, input: CreateAssemblyInput) {
  const now = new Date();
  const agendaEndsAt = new Date(now.getTime() + input.agendaMinutes * 60_000);
  const noticeEndsAt = new Date(agendaEndsAt.getTime() + input.noticeMinutes * 60_000);
  const votingEndsAt = new Date(noticeEndsAt.getTime() + input.votingMinutes * 60_000);

  const [created] = await db
    .insert(assembly)
    .values({
      communityId: actor.communityId,
      title: input.title,
      description: input.description ?? "",
      proposedBy: actor.id,
      agendaEndsAt,
      noticeEndsAt,
      votingEndsAt,
    })
    .returning();
  return created;
}

export async function listAssemblies(actor: Member) {
  const rows = await db
    .select()
    .from(assembly)
    .where(eq(assembly.communityId, actor.communityId))
    .orderBy(desc(assembly.createdAt));
  return rows.map((a) => ({ ...a, phase: computeAssemblyPhase(a) }));
}

export async function requireAssemblyInCommunity(actor: Member, assemblyId: string) {
  const [row] = await db
    .select()
    .from(assembly)
    .where(and(eq(assembly.id, assemblyId), eq(assembly.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Assembly not found");
  }
  return row;
}

// The full detail view: the Assembly, its agenda items, and — for
// each item — every response so far ("results are always advisory,
// never auto-applied", but they're not hidden either; same default-
// open visibility Input rounds already uses for its live tallies) plus
// this member's own response, for pre-filling the vote form.
export async function getAssembly(actor: Member, assemblyId: string) {
  const a = await requireAssemblyInCommunity(actor, assemblyId);

  const questions = await db
    .select()
    .from(assemblyQuestion)
    .where(eq(assemblyQuestion.assemblyId, assemblyId))
    .orderBy(assemblyQuestion.createdAt);

  const responses =
    questions.length === 0
      ? []
      : await db
          .select()
          .from(assemblyResponse)
          .where(
            inArray(
              assemblyResponse.assemblyQuestionId,
              questions.map((q) => q.id),
            ),
          );
  const responsesByQuestion = new Map<string, (typeof assemblyResponse.$inferSelect)[]>();
  for (const r of responses) {
    const list = responsesByQuestion.get(r.assemblyQuestionId) ?? [];
    list.push(r);
    responsesByQuestion.set(r.assemblyQuestionId, list);
  }

  return {
    ...a,
    phase: computeAssemblyPhase(a),
    questions: questions.map((q) => {
      const qResponses = responsesByQuestion.get(q.id) ?? [];
      return {
        ...q,
        responses: qResponses,
        myResponse: qResponses.find((r) => r.memberId === actor.id) ?? null,
      };
    }),
  };
}
