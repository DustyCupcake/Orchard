import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import type { Tx } from "@/db";
import {
  admission,
  browseInterest,
  contactMethod,
  member,
  memberAxisValue,
  memberIdentity,
  memberLanguage,
  profileAnswer,
  signInSetup,
  tierRequest,
  unmatchedSignIn,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireAdmins } from "../settings/admins";
import { recordSettingChanges } from "../settings/history";

type Member = typeof memberTable.$inferSelect;

// Removing a member who has nothing to their name — the duplicate a sign-in left behind,
// a test account, somebody who never did anything. There was no administrator way to
// delete a member at all: `anonymiseMember` is the member acting on themselves and keeps
// the row (37 tables point at `member` and almost none cascade), and a member who has
// signed in as somebody else's duplicate usually can't be signed in as.
//
// What makes this safe is that it asks the database, not this file, what refers to the
// member: every foreign key onto `member` is read from the catalog, so a table added next
// year is counted without anyone remembering to list it. The only things deleted are the
// rows that are *about the person themselves* and mean nothing without them (their
// sign-in, contact methods, answers, languages, attributes, interests, a request still
// waiting). Anything else — a task they hold, a place in an event, a report, a comment, an
// admission that made them — is the community's record and **blocks the removal**, which is
// listed rather than dropped. Nothing is deleted unless nothing blocks.

/** Tables whose rows are about the person alone, deleted with them. */
const PERSONAL = new Set([
  "member_identity",
  "contact_method",
  "profile_answer",
  "member_axis_value",
  "member_language",
  "browse_interest",
  "sign_in_setup",
]);

export type RemovalBlocker = { table: string; column: string; count: number };

const quote = (id: string) => `"${id.replaceAll('"', '""')}"`;

// Every (table, column) with a foreign key onto member(id), from the catalog.
async function referencesToMember(executor: Tx | typeof db) {
  const rows = (await executor.execute(sql`
    select c.conrelid::regclass::text as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'member'::regclass and array_length(c.conkey, 1) = 1
  `)) as unknown as { table_name: string; column_name: string }[];
  return rows.map((r) => ({ table: r.table_name.replaceAll('"', ""), column: r.column_name }));
}

async function blockersOf(executor: Tx | typeof db, memberId: string): Promise<RemovalBlocker[]> {
  const refs = await referencesToMember(executor);
  const out: RemovalBlocker[] = [];
  for (const ref of refs) {
    // A row of the member's own is not a reference *to* them from somewhere else.
    if (PERSONAL.has(ref.table)) continue;
    const result = (await executor.execute(
      sql`select count(*)::int as n from ${sql.raw(quote(ref.table))} where ${sql.raw(quote(ref.column))} = ${memberId}`,
    )) as unknown as { n: number }[];
    const count = result[0]?.n ?? 0;
    // A member's own row never counts against itself (referred_by_member_id on the same table).
    if (count > 0) out.push({ table: ref.table, column: ref.column, count });
  }
  // The admission that made them has no foreign key (it points at members it later forgets),
  // but it is history the funnel owns, so it blocks too.
  const [admitted] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(admission)
    .where(eq(admission.admittedMemberId, memberId));
  if ((admitted?.n ?? 0) > 0) out.push({ table: "admission", column: "admitted_member_id", count: admitted.n });
  return out;
}

async function clearPersonalRows(tx: Tx, memberId: string) {
  await tx.delete(profileAnswer).where(eq(profileAnswer.memberId, memberId));
  await tx.delete(memberIdentity).where(eq(memberIdentity.memberId, memberId));
  await tx.delete(contactMethod).where(eq(contactMethod.memberId, memberId));
  await tx.delete(memberAxisValue).where(eq(memberAxisValue.memberId, memberId));
  await tx.delete(memberLanguage).where(eq(memberLanguage.memberId, memberId));
  await tx.delete(browseInterest).where(eq(browseInterest.memberId, memberId));
  await tx.delete(signInSetup).where(eq(signInSetup.memberId, memberId));
  // A request still waiting is a claim on access this person won't use; a decided one is the
  // record of who confirmed whom, and blocks.
  await tx.delete(tierRequest).where(and(eq(tierRequest.memberId, memberId), isNull(tierRequest.decidedAt)));
  // A held sign-in that suggested them as the match no longer has one to suggest.
  await tx.update(unmatchedSignIn).set({ suggestedMemberId: null }).where(eq(unmatchedSignIn.suggestedMemberId, memberId));
}

async function load(actor: Member, memberId: string): Promise<Member> {
  await requireAdmins(actor);
  if (memberId === actor.id) throw new ForbiddenError("You can't remove yourself — leaving is done from your own profile");
  const [target] = await db.select().from(member).where(and(eq(member.id, memberId), eq(member.communityId, actor.communityId)));
  if (!target) throw new NotFoundError("Member not found");
  return target;
}

/** What would stop this member being removed, without changing anything. */
export async function describeMemberRemoval(actor: Member, memberId: string) {
  const target = await load(actor, memberId);
  return { member: target, blockers: await blockersOf(db, memberId) };
}

const describeBlockers = (blockers: RemovalBlocker[]) =>
  blockers.map((b) => `${b.count} in ${b.table.replaceAll("_", " ")}`).join(", ");

/**
 * Delete a member who has nothing attached beyond data about themselves. Refuses, naming
 * what is attached, otherwise; recorded in the settings history either way it succeeds.
 */
export async function removeEmptyMember(actor: Member, memberId: string) {
  const target = await load(actor, memberId);
  return db.transaction(async (tx) => {
    await clearPersonalRows(tx, memberId);
    // Counted after clearing and inside the transaction, so a refusal rolls the clearing back:
    // a member with a task is left exactly as they were.
    const blockers = await blockersOf(tx, memberId);
    if (blockers.length > 0) {
      throw new ConflictError(`${target.name} can't be removed: they still have ${describeBlockers(blockers)}. Deal with those first, or leave this member as they are.`);
    }
    await tx.delete(member).where(eq(member.id, memberId));
    await recordSettingChanges(tx, {
      actor,
      entity: "member_sign_in",
      action: "removed_empty_member",
      entityLabel: target.name,
      current: { member: target.name },
      changes: { member: null },
    });
    return { removed: target.name };
  });
}
