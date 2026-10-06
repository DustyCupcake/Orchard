import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { member, type member as memberTable } from "@/db/schema";

type Member = typeof memberTable.$inferSelect;

/**
 * Where a login lands: `/welcome` once, then the Dashboard for ever.
 *
 * Every entry point that starts a session calls this, which is what makes
 * the first-login screen reachable for all five provisioning paths without
 * any of them knowing about it. Two of them (application conversion and
 * admin roster import) create a Member *days* before the person logs in, so
 * "did this login create the account?" is not a question any entry point
 * can answer — the column is.
 *
 * Deliberately a redirect on entry and nothing more. There is no
 * layout-level guard reading `profileCompletedAt`, so a member who closes
 * the tab on `/welcome` is in the app on their next click like anybody
 * else, and the screen cannot become the thing standing between somebody
 * and their own community — the posture this codebase takes everywhere
 * else, and the reason `hasCompletedOnboarding` is a nudge too.
 */
export function firstLoginDestination(memberRow: Pick<Member, "profileCompletedAt">): "/welcome" | "/dashboard" {
  return memberRow.profileCompletedAt ? "/dashboard" : "/welcome";
}

/**
 * The same answer, for a caller holding only an id.
 *
 * Invite redemption is the reason this exists: it produces a Member id and
 * nothing else, and the alternative was either threading the whole row
 * out of the transaction that just made it or re-reading it. A member
 * with no row at all is treated as "send them to /welcome", which is both
 * the right answer and the only one that can't get anyone locked out —
 * the page itself bounces them onward if they've already been through it.
 */
export async function firstLoginDestinationFor(memberId: string): Promise<"/welcome" | "/dashboard"> {
  const [row] = await db
    .select({ profileCompletedAt: member.profileCompletedAt })
    .from(member)
    .where(eq(member.id, memberId));
  return row ? firstLoginDestination(row) : "/welcome";
}

/**
 * Record that this member has been offered first-login setup.
 *
 * Written on skip as well as on submit, and that asymmetry is the design:
 * the column answers "have we asked", not "is this person set up", because
 * only the first question can be answered truthfully by a column and
 * still leave the member in control of the second.
 *
 * `onlyIfUnset` guards the whole thing behind `IS NULL` so a second
 * submit can't move the timestamp, and so a member who later clears
 * anything on this screen doesn't get their original first-login time
 * rewritten to whenever they last pressed Save.
 */
export async function markProfileCompleted(memberId: string, options: { onlyIfUnset?: boolean } = {}) {
  const conditions = [eq(member.id, memberId)];
  if (options.onlyIfUnset) {
    conditions.push(isNull(member.profileCompletedAt));
  }

  const [updated] = await db
    .update(member)
    .set({ profileCompletedAt: new Date() })
    .where(and(...conditions))
    .returning();

  return updated ?? null;
}
