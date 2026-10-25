import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, task, taskAssignment } from "@/db/schema";

// docs/plans/accompaniment-plan.md §4. The one place that says what an accompanier may see of the
// person they accompany beyond the basics, so every reader asks the same question and none can
// drift. It reads two tables and nothing else, which is also why it is its own file: the readers
// that need it (the contribution view, the accompanier's page) would otherwise import each other.
//
// Fails closed, on every step:
//   - there must be an accompaniment for this person that is still open (not ended, task not done);
//   - the viewer must be the one holding the task *now* (a shadow is not the accompanier);
//   - the person's choice must have been made *for this viewer* (consent is to a person, so a new
//     accompanier starts from nothing and nothing is rewritten for that to be true);
//   - and the person must have said yes to this particular thing.

export type Shares = { axes: boolean; contribution: boolean; answers: boolean };
export const NO_SHARES: Shares = { axes: false, contribution: false, answers: false };

type Row = typeof accompaniment.$inferSelect;

/** What a person's choices amount to right now, given who currently holds the task. */
export function effectiveShares(row: Row, holderId: string | null, over: boolean): Shares {
  if (over || !holderId || row.sharedWithMemberId !== holderId) return NO_SHARES;
  return { axes: row.sharesAxes, contribution: row.sharesContribution, answers: row.sharesAnswers };
}

/** The open accompaniment of this member, with whoever holds its task right now. */
export async function getOpenAccompanimentOf(memberId: string) {
  const [row] = await db
    .select({ a: accompaniment, taskStatus: task.status })
    .from(accompaniment)
    .innerJoin(task, eq(accompaniment.taskId, task.id))
    .where(and(eq(accompaniment.memberId, memberId), isNull(accompaniment.endedAt), ne(task.status, "done")));
  if (!row) return null;
  const [holder] = await db
    .select({ memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, row.a.taskId), eq(taskAssignment.isShadow, false)))
    .orderBy(asc(taskAssignment.claimedAt))
    .limit(1);
  return { accompaniment: row.a, holderId: holder?.memberId ?? null };
}

/**
 * Whether `viewerId` is the accompanier of `targetId` and `targetId` has chosen to let them see
 * this. Used to open a door that is otherwise shut, never to close one.
 */
export async function accompanierMaySee(viewerId: string, targetId: string, what: keyof Shares): Promise<boolean> {
  if (viewerId === targetId) return false;
  const open = await getOpenAccompanimentOf(targetId);
  if (!open || open.holderId !== viewerId) return false;
  return effectiveShares(open.accompaniment, open.holderId, false)[what];
}

/**
 * The people `viewerId` accompanies right now: an open accompaniment whose task they hold (a shadow
 * doesn't). `withAnswers` narrows it to those who have chosen to share their profile answers with
 * *this* viewer. Read once for a whole roster, so the member grid can ask it without a query per
 * person.
 */
export async function listAccompaniedBy(viewerId: string, opts: { withAnswers?: boolean } = {}): Promise<Set<string>> {
  const rows = await db
    .select({ a: accompaniment })
    .from(accompaniment)
    .innerJoin(task, eq(accompaniment.taskId, task.id))
    .innerJoin(
      taskAssignment,
      and(eq(taskAssignment.taskId, accompaniment.taskId), eq(taskAssignment.memberId, viewerId), eq(taskAssignment.isShadow, false)),
    )
    .where(and(isNull(accompaniment.endedAt), ne(task.status, "done")));
  const out = new Set<string>();
  for (const { a } of rows) {
    if (opts.withAnswers && !(a.sharesAnswers && a.sharedWithMemberId === viewerId)) continue;
    out.add(a.memberId);
  }
  return out;
}
