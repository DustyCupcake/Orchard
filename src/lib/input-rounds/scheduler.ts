import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { community, inputRound, question, task } from "@/db/schema";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The scheduled job: "on a fixed community-wide cadence ... everything
// queued gets bundled into one round" (docs/spec.md's "Input rounds").
// Cadence is an explicit clock (Community.nextInputRoundCutoffAt), not
// derived from round history, so it stays fixed regardless of whether
// any given cutoff actually had anything queued. A community with no
// clock yet (fresh install, or this job's first-ever run) just
// anchors one — its first real cutoff is a full interval later, not
// immediately.
//
// Idempotent and safe to run on any cadence (registered at */5 * * * *
// like every other job here, per docs/architecture.md): if the job
// hasn't ticked in a while, the while-loop below catches the clock up
// to the future without creating more than one round for whatever's
// currently queued — there's nothing to split across the skipped
// ticks, since only the first one finds anything to bundle.
export async function resolveInputRounds(): Promise<{
  checked: number;
  anchored: number;
  roundsCreated: number;
  questionsBundled: number;
}> {
  const communities = await db.select().from(community);
  const now = new Date();

  let anchored = 0;
  let roundsCreated = 0;
  let questionsBundled = 0;

  for (const c of communities) {
    if (!c.nextInputRoundCutoffAt) {
      await db
        .update(community)
        .set({ nextInputRoundCutoffAt: new Date(now.getTime() + c.inputRoundIntervalDays * MS_PER_DAY) })
        .where(eq(community.id, c.id));
      anchored++;
      continue;
    }

    let nextCutoff = c.nextInputRoundCutoffAt;
    while (nextCutoff <= now) {
      const queued = await db
        .select({ id: question.id })
        .from(question)
        .innerJoin(task, eq(question.taskId, task.id))
        .where(and(isNull(question.roundId), eq(task.communityId, c.id)));

      if (queued.length > 0) {
        const [round] = await db
          .insert(inputRound)
          .values({ communityId: c.id, cutoffAt: nextCutoff })
          .returning();
        await db
          .update(question)
          .set({ roundId: round.id })
          .where(
            inArray(
              question.id,
              queued.map((q) => q.id),
            ),
          );
        roundsCreated++;
        questionsBundled += queued.length;
      }

      nextCutoff = new Date(nextCutoff.getTime() + c.inputRoundIntervalDays * MS_PER_DAY);
    }

    await db.update(community).set({ nextInputRoundCutoffAt: nextCutoff }).where(eq(community.id, c.id));
  }

  return { checked: communities.length, anchored, roundsCreated, questionsBundled };
}
