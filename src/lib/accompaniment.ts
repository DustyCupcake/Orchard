import { and, asc, desc, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { accompaniment, admission, admissionSupport, community, evaluation, member, recruitmentDecision, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "./errors";
import { createRequirement, createTask } from "./tasks";
import { addComment } from "./tasks/notes";
import { addSuggestions } from "./tasks/suggestions";
import { releaseAssignmentInTx } from "./tasks/lifecycle";
import { listGrantingTaskIds } from "./permissions";
import { inviterOf } from "./recruitment/community-check";
import { resolvePrimaryEmail } from "./contact-methods";
import { sendAccompanierNamedEmail } from "./mailer";
import { publicAppUrl } from "./public-url";

type Member = typeof memberTable.$inferSelect;
type Arrival = typeof admission.$inferSelect;

const DAY_MS = 86_400_000;
// How long the thank-you card stays after an accompaniment ends: long enough to be seen, short enough that it never becomes furniture.
const THANKS_DAYS = 14;

// docs/plans/accompaniment-plan.md. A new member has someone to ask questions of and
// check in with. The *task* ("Accompany <name>") is what a person claims, with its
// ordinary lifecycle; the `accompaniment` row says whose it is and when it ends; and who
// is accompanying is never stored — it is whoever holds the task now, read live.

export type EnsureResult =
  | { status: "created"; accompanimentId: string; taskId: string }
  | { status: "skipped"; reason: "off" | "already" | "not_new" | "no_recruitment_task" | "nobody_to_create_it" };

// The task has to be created *as* someone, because a task needs a real creator. Not an
// authority question: whoever holds recruitment is the natural stand-in, then the person
// who invited the newcomer (who has a real stake in them), then the first person who
// reported on them. Never a random member — the task is visible, and its creator is part
// of the record. Nobody to be is reported to the caller, not guessed.
async function resolveAuthor(communityId: string, arrival: Arrival): Promise<Member | null> {
  const grantingTaskIds = await listGrantingTaskIds(communityId, "recruitment");
  if (grantingTaskIds.length > 0) {
    const [holding] = await db
      .select({ memberId: taskAssignment.memberId })
      .from(taskAssignment)
      .where(and(inArray(taskAssignment.taskId, grantingTaskIds), eq(taskAssignment.isShadow, false)))
      .orderBy(asc(taskAssignment.claimedAt))
      .limit(1);
    if (holding) {
      const [holder] = await db.select().from(member).where(eq(member.id, holding.memberId));
      if (holder) return holder;
    }
  }
  const inviterId = await inviterOf(arrival);
  if (inviterId) {
    const [inviter] = await db.select().from(member).where(eq(member.id, inviterId));
    if (inviter) return inviter;
  }
  const [first] = await db
    .select({ evaluatorId: evaluation.evaluatorId })
    .from(evaluation)
    .where(eq(evaluation.arrivalId, arrival.id))
    .orderBy(asc(evaluation.filedAt))
    .limit(1);
  if (first) {
    const [evaluator] = await db.select().from(member).where(eq(member.id, first.evaluatorId));
    if (evaluator) return evaluator;
  }
  return null;
}

/**
 * Make the accompaniment for someone who has just been admitted — the one place it is
 * made, called from the one place a member is made, so every route through the funnel
 * behaves alike. Idempotent: a member has at most one open accompaniment.
 *
 * Only for a member the admission actually *created*. Someone who was already a member and
 * was merely linked to this arrival isn't new, and isn't accompanied. Someone waiting for
 * a place in a full event isn't a member yet, so there is nothing to make until they are.
 */
export async function ensureAccompaniment(arrival: Arrival, memberId: string, opts: { isNewMember: boolean }): Promise<EnsureResult> {
  const [communityRow] = await db.select().from(community).where(eq(community.id, arrival.communityId));
  if (!communityRow?.accompanimentEnabled) return { status: "skipped", reason: "off" };
  if (!opts.isNewMember) return { status: "skipped", reason: "not_new" };

  const [open] = await db
    .select({ id: accompaniment.id })
    .from(accompaniment)
    .where(and(eq(accompaniment.memberId, memberId), isNull(accompaniment.endedAt)));
  if (open) return { status: "skipped", reason: "already" };

  // The task needs a branch, and an open module with no granting task has none to borrow.
  // Reported (the recruitment hub says so), not guessed.
  const grantingTaskIds = await listGrantingTaskIds(arrival.communityId, "recruitment");
  const [recruitmentTask] = grantingTaskIds.length > 0 ? await db.select({ branchId: task.branchId }).from(task).where(inArray(task.id, grantingTaskIds)) : [];
  if (!recruitmentTask) return { status: "skipped", reason: "no_recruitment_task" };

  const author = await resolveAuthor(arrival.communityId, arrival);
  if (!author) return { status: "skipped", reason: "nobody_to_create_it" };

  const [newcomer] = await db.select({ name: member.name }).from(member).where(eq(member.id, memberId));
  const name = newcomer?.name ?? arrival.name;
  const created = await createTask(
    author,
    {
      branchId: recruitmentTask.branchId,
      title: `Accompany ${name}`,
      description:
        `Be the person ${name} can ask questions of and check in with while they find their feet. ` +
        `They are told that this task exists and who holds it. If it isn't working, either of you can hand it back — nobody is at fault.`,
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
    },
    author.id,
  );

  // Who may accompany is the ordinary requirement mechanism, not a rule of its own.
  if (communityRow.accompanimentTierId) {
    await createRequirement(author, created.id, { type: "tier", value: { tierId: communityRow.accompanimentTierId } });
  }

  // Everyone with a reason to be asked, with the reason (docs/plans/accompaniment-plan.md §3.4):
  // those who said yes after the interview, whoever invited them, and whoever vouched for them.
  // Nobody is assigned and nobody is ranked; the people who might say yes are put where they
  // can see it, and where coordination can see them if nobody does.
  const [yes, supporters, inviterId] = await Promise.all([
    db
      .select({ memberId: evaluation.evaluatorId })
      .from(evaluation)
      .where(and(eq(evaluation.arrivalId, arrival.id), eq(evaluation.recommendation, "proceed"))),
    db.select({ memberId: admissionSupport.supporterId }).from(admissionSupport).where(eq(admissionSupport.arrivalId, arrival.id)),
    inviterOf(arrival),
  ]);
  await addSuggestions(db, [
    ...yes.map((r) => ({ taskId: created.id, memberId: r.memberId, reason: "said_yes" as const })),
    ...(inviterId ? [{ taskId: created.id, memberId: inviterId, reason: "invited" as const }] : []),
    ...supporters.map((r) => ({ taskId: created.id, memberId: r.memberId, reason: "supported" as const })),
  ].filter((e) => e.memberId !== memberId));

  const now = new Date();
  const [row] = await db
    .insert(accompaniment)
    .values({
      communityId: arrival.communityId,
      memberId,
      taskId: created.id,
      arrivalId: arrival.id,
      startedAt: now,
      endsOn: new Date(now.getTime() + communityRow.accompanimentEndsAfterDays * DAY_MS),
    })
    .returning({ id: accompaniment.id });

  // The decision that led here keeps pointing at the task, for the pages that still read it.
  await db
    .update(recruitmentDecision)
    .set({ accompanimentTaskId: created.id })
    .where(and(eq(recruitmentDecision.arrivalId, arrival.id), isNull(recruitmentDecision.accompanimentTaskId)));

  return { status: "created", accompanimentId: row.id, taskId: created.id };
}

export type MyAccompaniment = {
  id: string;
  taskId: string;
  startedAt: Date;
  endsOn: Date;
  endedAt: Date | null;
  askedForSomeoneElseAt: Date | null;
  /** Over, but only just: long enough ago to have been thanked, and not so long that a card is still wanted. */
  endedRecently: boolean;
  /** Whoever holds the task right now; null until someone does. */
  accompanier: { id: string; name: string } | null;
};

async function currentHolder(taskId: string) {
  const [holder] = await db
    .select({ id: member.id, name: member.name })
    .from(taskAssignment)
    .innerJoin(member, eq(taskAssignment.memberId, member.id))
    .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.isShadow, false)))
    .orderBy(asc(taskAssignment.claimedAt))
    .limit(1);
  return holder ?? null;
}

/**
 * A member's most recent accompaniment, whether or not it is over. An accompaniment is over
 * once it has ended *or* its task is done — either is enough, so the two can never disagree
 * about whether someone is still being accompanied.
 */
export async function getMyAccompaniment(memberId: string): Promise<MyAccompaniment | null> {
  const [row] = await db
    .select({ a: accompaniment, taskStatus: task.status, taskChangedAt: task.statusChangedAt })
    .from(accompaniment)
    .innerJoin(task, eq(accompaniment.taskId, task.id))
    .where(eq(accompaniment.memberId, memberId))
    .orderBy(desc(accompaniment.startedAt))
    .limit(1);
  if (!row) return null;
  const endedAt = row.a.endedAt ?? (row.taskStatus === "done" ? row.taskChangedAt : null);
  return {
    id: row.a.id,
    taskId: row.a.taskId,
    startedAt: row.a.startedAt,
    endsOn: row.a.endsOn,
    endedAt,
    askedForSomeoneElseAt: row.a.askedForSomeoneElseAt,
    endedRecently: endedAt !== null && Date.now() - endedAt.getTime() <= THANKS_DAYS * DAY_MS,
    accompanier: endedAt ? null : await currentHolder(row.a.taskId),
  };
}

/**
 * Whose accompaniment this task is, while it is open — the lookup the task page needs to
 * decide whether the holder gets to see that member's engagement record. Null for any task
 * that isn't an accompaniment, and for one that is over: the visibility ends with it.
 */
export async function getAccompaniedMemberId(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ memberId: accompaniment.memberId, endedAt: accompaniment.endedAt, status: task.status })
    .from(accompaniment)
    .innerJoin(task, eq(accompaniment.taskId, task.id))
    .where(eq(accompaniment.taskId, taskId));
  if (!row || row.endedAt || row.status === "done") return null;
  return row.memberId;
}

/**
 * The member asks for someone else. The task goes back to unclaimed, with a plain note on
 * it, and the accompaniment stays open so another person can take it. Nothing is logged
 * against anyone: a fit that isn't there is not a fault, and saying so is the point of
 * making this a button rather than a conversation the member has to start.
 */
export async function askForSomeoneElse(actor: Member) {
  const mine = await getMyAccompaniment(actor.id);
  if (!mine || mine.endedAt) throw new NotFoundError("Nobody is accompanying you right now");
  if (!mine.accompanier) throw new ConflictError("Nobody has taken this on yet, so there is nobody to change");

  await db.transaction(async (tx) => {
    const holders = await tx
      .select({ memberId: taskAssignment.memberId })
      .from(taskAssignment)
      .where(and(eq(taskAssignment.taskId, mine.taskId), eq(taskAssignment.isShadow, false)));
    for (const h of holders) await releaseAssignmentInTx(tx, mine.taskId, actor.communityId, h.memberId);
    await tx
      .update(accompaniment)
      .set({ askedForSomeoneElseAt: new Date(), announcedHolderId: null })
      .where(eq(accompaniment.id, mine.id));
  });
  await addComment(actor, mine.taskId, {
    body: `${actor.name} would like someone else to accompany them. It is nobody's fault — it is just about the fit — and the task is open again.`,
  });
}

// Ending closes the task as done and stops the accompanier seeing what the role gave them
// (nothing reads the relation once it is over). A task nobody holds is closed directly: there
// is no holder to finish it as, and the accompaniment has run out either way.
async function endAccompaniment(id: string, taskId: string, now: Date) {
  await db.transaction(async (tx) => {
    await tx.update(accompaniment).set({ endedAt: now }).where(and(eq(accompaniment.id, id), isNull(accompaniment.endedAt)));
    await tx
      .update(task)
      .set({ status: "done", statusChangedAt: now, attentionLevel: "ok", nextCheckinAt: null })
      .where(and(eq(task.id, taskId), ne(task.status, "done")));
  });
}

/**
 * The scheduled job: ends what has run out or whose task was finished by hand, and tells a
 * member who is accompanying them whenever that changes. Safe to run as often as you like —
 * each step looks at what is true now rather than at what happened since last time.
 */
export async function runAccompaniments(now: Date = new Date()) {
  const due = await db
    .select({ id: accompaniment.id, taskId: accompaniment.taskId })
    .from(accompaniment)
    .where(and(isNull(accompaniment.endedAt), lte(accompaniment.endsOn, now)));
  for (const a of due) await endAccompaniment(a.id, a.taskId, now);

  const finished = await db
    .select({ id: accompaniment.id })
    .from(accompaniment)
    .innerJoin(task, eq(accompaniment.taskId, task.id))
    .where(and(isNull(accompaniment.endedAt), eq(task.status, "done")));
  for (const a of finished) await db.update(accompaniment).set({ endedAt: now }).where(eq(accompaniment.id, a.id));

  const open = await db
    .select({ a: accompaniment })
    .from(accompaniment)
    .where(isNull(accompaniment.endedAt));
  for (const { a } of open) {
    const holder = await currentHolder(a.taskId);
    if (!holder) {
      // Nobody now: forget who was announced, so the next person to take it is told.
      if (a.announcedHolderId) await db.update(accompaniment).set({ announcedHolderId: null }).where(eq(accompaniment.id, a.id));
      continue;
    }
    if (holder.id === a.announcedHolderId) continue;
    try {
      const email = await resolvePrimaryEmail(a.memberId);
      const [newcomer] = await db.select({ name: member.name }).from(member).where(eq(member.id, a.memberId));
      const [communityRow] = await db.select({ name: community.name }).from(community).where(eq(community.id, a.communityId));
      if (email) {
        await sendAccompanierNamedEmail(email, {
          name: newcomer?.name ?? "there",
          communityName: communityRow?.name ?? "the community",
          accompanierName: holder.name,
          dashboardUrl: `${publicAppUrl()}/dashboard`,
        });
      }
    } catch (err) {
      console.error("[accompaniment] could not tell the member who is accompanying them", err);
    }
    // Recorded whether or not an address was found: the card on their dashboard says it
    // either way, and a member with no verified address would otherwise be retried for ever.
    await db.update(accompaniment).set({ announcedHolderId: holder.id }).where(eq(accompaniment.id, a.id));
  }
}
