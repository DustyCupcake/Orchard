import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, inputRound, question, questionResponse, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";

type Member = typeof memberTable.$inferSelect;

// The Community's current round — the one with the latest cutoffAt.
// Creating a newer round is what supersedes ("closes") this one; see
// src/db/schema/input-round.ts.
export async function getCurrentRound(communityId: string) {
  const [row] = await db
    .select()
    .from(inputRound)
    .where(eq(inputRound.communityId, communityId))
    .orderBy(desc(inputRound.cutoffAt))
    .limit(1);
  return row ?? null;
}

// The "single sitting" answering surface — every question bundled
// into the Community's current round, across every task, with enough
// task context to answer without hunting each one down individually.
// Sorted "by proximity to its own deadline and then by priority" per
// spec — soonest deadline first (no deadline sorts last), priority-
// flagged questions first within that.
export async function listCurrentRoundQuestions(actor: Member) {
  const currentRound = await getCurrentRound(actor.communityId);
  if (!currentRound) return { round: null, questions: [] };

  const rows = await db
    .select({
      question,
      taskId: task.id,
      taskTitle: task.title,
      branchName: branch.name,
    })
    .from(question)
    .innerJoin(task, eq(question.taskId, task.id))
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(eq(question.roundId, currentRound.id))
    .orderBy(asc(question.deadline), desc(question.priority));

  const myResponses =
    rows.length === 0
      ? []
      : await db
          .select()
          .from(questionResponse)
          .where(
            and(
              inArray(
                questionResponse.questionId,
                rows.map((r) => r.question.id),
              ),
              eq(questionResponse.memberId, actor.id),
            ),
          );
  const myResponseByQuestion = new Map(myResponses.map((r) => [r.questionId, r]));

  return {
    round: currentRound,
    questions: rows.map((r) => ({ ...r, myResponse: myResponseByQuestion.get(r.question.id) ?? null })),
  };
}

// Purely a computed display hint for "get your questions in" — no
// state, no notification actually sent (this codebase doesn't have a
// real outbound-notification layer yet — see docs/development-plan.md's
// "Beyond Phase 19"), just "how long until the next cutoff," derived
// live from Community.nextInputRoundCutoffAt.
export async function getNextCutoffAt(actor: Member): Promise<Date | null> {
  const [row] = await db
    .select({ nextInputRoundCutoffAt: community.nextInputRoundCutoffAt })
    .from(community)
    .where(eq(community.id, actor.communityId));
  return row?.nextInputRoundCutoffAt ?? null;
}
