import { and, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  browseInterest,
  contactMethod,
  member,
  memberAxisValue,
  memberIdentity,
  memberLanguage,
  profileAnswer,
  taskAssignment,
  type member as memberTable,
  tierRequest,
} from "@/db/schema";

type Member = typeof memberTable.$inferSelect;

/**
 * Leave the community: delete what identifies the person, keep what the
 * community is entitled to.
 *
 * The decision this implements, and the reasoning behind the shape rather
 * than a plain `DELETE FROM member`:
 *
 * **Why the row survives at all.** 37 tables hold a member foreign key and
 * this schema has exactly two `onDelete: cascade` clauses, neither on a
 * member table. So deleting the row cannot work without either dropping
 * dozens of NOT NULL columns or adding cascades nobody has decided on — and
 * the settings change log's `actor_id` is one of them, non-null, with the
 * comment on it saying it exists so "who changed this" survives. A member
 * who has ever changed a setting is currently *undeletable*, and that is
 * the bug this function is shaped around rather than a constraint to route
 * around.
 *
 * **The name becomes a placeholder.** `member.name` is what everything
 * renders — the directory, task holders, a comment's byline, the change
 * log's read-time resolve — so overwriting it is what anonymises the
 * person everywhere at once, with no second source of truth to keep in
 * step. Derived from the member id rather than a counter or a random
 * value, so it is stable (the same member always reads the same way) and
 * not correlatable with anything the community already saw: the id is not
 * on any page a member can read, and no display order or timestamp in the
 * UI exposes it.
 *
 * **What is deleted** is data *about the person*: their answers, their
 * login identity, their contact methods, their per-member attribute rows.
 * Answers go unconditionally, including answers to questions marked
 * `publishedAsIndicator` — those feed a figure the community has reasoned
 * about, and deleting them changes that figure, but a person who has asked
 * for their data to go outranks an aggregate, and the question row itself
 * (the community's wording) is untouched either way.
 *
 * **What is kept** is the community's own record of having interacted with
 * someone: task holdings, comments, resources, wiki revisions,
 * participation, endorsements, evaluations, objections. A placeholder in
 * those positions reads exactly as what it is — somebody who left — and
 * deleting them instead would put holes in other people's history, which is
 * not the departing member's data to give away.
 *
 * **Task holdings are the one shared row that is deleted**, because a task
 * with a released holder reverts to unclaimed and can be picked up by
 * somebody else. That is a live, forward-facing consequence of the person
 * no longer being available, not a record of the past, so releasing is
 * both the honest and the useful behaviour. It also has to happen, because
 * a `NOT NULL` assignment row for a member who cannot sign in is a task
 * nobody can release through the UI.
 */
export async function anonymiseMember(
  actor: Member,
  opts: { keepName: boolean },
): Promise<{ pseudonym: string; releasedTasks: number; deletedAnswers: number }> {
  // The actor is the member. There is no separate target parameter and
  // deliberately not a "and targetId" one either: an anonymise function
  // that takes a second member id is a function whose authorisation is one
  // missing check away, and the only caller that exists is a member acting
  // on themselves.
  const target = actor;

  return db.transaction(async (tx) => {
    const pseudonym = placeholderName(target.id);

    // Profile answers first. `answer_rule_consent` cascades from
    // `profile_answer` (one of the only two cascades in the schema, and
    // this is one of them), so a member's per-audience consents go with
    // their answers and need no statement of their own — which matters
    // here, because a consent row left behind would be a record that
    // somebody agreed to a specific audience for an answer that no longer
    // exists.
    const deletedAnswers = await tx
      .delete(profileAnswer)
      .where(eq(profileAnswer.memberId, target.id))
      .returning({ id: profileAnswer.id });

    // The login. Not a consent decision: `member_identity.login_email` is
    // NOT NULL behind a unique index and is the only thing that lets
    // anybody sign in, so "may my name stay on the settings changes I
    // made" cannot extend to it under any answer.
    await tx.delete(memberIdentity).where(eq(memberIdentity.memberId, target.id));

    // Contact methods — a phone number and an email address, the most
    // directly identifying rows in the schema, and the reason the member
    // directory and /members/data have privacy settings at all.
    await tx.delete(contactMethod).where(eq(contactMethod.memberId, target.id));

    // Per-member attribute rows. Pure facts about this person with no
    // community-facing record attached.
    await tx.delete(memberAxisValue).where(eq(memberAxisValue.memberId, target.id));
    await tx.delete(memberLanguage).where(eq(memberLanguage.memberId, target.id));
    await tx.delete(browseInterest).where(eq(browseInterest.memberId, target.id));
    // A pending request for a tier is a claim on access this person is
    // giving up, and leaving one in place would leave an Admin a request to
    // confirm for somebody who is no longer here. Decided rows are kept as
    // the record of who confirmed whom.
    await tx
      .delete(tierRequest)
      .where(and(eq(tierRequest.memberId, target.id), isNull(tierRequest.decidedAt)));

    // Task holdings: released rather than left. See the note above.
    const releasedTasks = await releaseAllTaskHoldings(tx, target);

    // The name last, so that a failure anywhere above leaves the member
    // still identifiable and still able to retry — the one order in which
    // a partial run is the safe one. A member whose name has already been
    // overwritten but whose answers survive is a genuinely bad state: the
    // data is still there, nobody can find it, and the person cannot ask
    // for it to be removed again.
    await tx
      .update(member)
      .set({
        name: opts.keepName ? target.name : pseudonym,
        // Tags and tiers are this person's relationship to the community's
        // structure. Tiers gate things, so leaving them behind would keep
        // granting access to somebody who has left; tags are how the
        // community finds people, which is exactly what leaving stops.
        tierIds: [],
        tags: [],
        referredByMemberId: null,
        lastViewedCycleId: null,
      })
      .where(eq(member.id, target.id));

    return { pseudonym, releasedTasks, deletedAnswers: deletedAnswers.length };
  });
}

/**
 * Release every task this member holds, going through the same path the UI
 * uses so a task's status is left in the state a release leaves it
 * (`unclaimed`, check-in cleared) rather than as an orphaned assignment.
 *
 * `releaseAssignmentInTx` is the shared core (src/lib/tasks/lifecycle.ts)
 * specifically so this and the UI's own release cannot disagree about what
 * a released task looks like — the alternative, deleting assignment rows
 * directly, would leave every one of their tasks stuck in `claimed` with no
 * holder, which is a state the rest of the app has no way out of.
 */
async function releaseAllTaskHoldings(tx: Tx, target: Member): Promise<number> {
  const { releaseAssignmentInTx } = await import("../tasks/lifecycle");
  const holdings = await tx
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .where(eq(taskAssignment.memberId, target.id));

  let released = 0;
  for (const h of holdings) {
    try {
      await releaseAssignmentInTx(tx, h.taskId, target.communityId, target.id);
      released += 1;
    } catch {
      // A task in a status that cannot be released (closed, archived) is
      // left alone rather than failing the whole anonymisation. The
      // assignment row survives pointing at a placeholder, which is the
      // keep-with-placeholder rule applied to this one case, and is
      // strictly better than refusing to let somebody leave because they
      // once held a task in an odd state.
    }
  }
  return released;
}

/**
 * The placeholder `member.name`.
 *
 * Derived from the id rather than a counter: a counter is guessable and
 * sequential, so anyone could map "Former member #3" onto the third person
 * to leave, and the whole point is that the two cannot be correlated. The
 * id is a uuid and is not rendered anywhere a member can read it.
 */
function placeholderName(memberId: string): string {
  return `Former member ${memberId.slice(0, 4)}`;
}

/**
 * Whether a member has already left. Not stored as a boolean: the
 * placeholder name *is* the flag, and a second column would be a second
 * thing to get out of step with it.
 */
export function hasLeft(member: Pick<Member, "name">): boolean {
  return member.name.startsWith("Former member ");
}
