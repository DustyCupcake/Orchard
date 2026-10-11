import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity, unmatchedSignIn } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requireAdmins } from "../settings/admins";
import { recordSettingChanges } from "../settings/history";

type Member = typeof memberTable.$inferSelect;

// docs/admission-flow.md §6a — the sign-ins Orchard would not turn into a member by
// itself (resolve.ts), held for an administrator.

export async function listUnmatchedSignIns(actor: Member) {
  await requireAdmins(actor);
  const rows = await db
    .select()
    .from(unmatchedSignIn)
    .where(and(eq(unmatchedSignIn.communityId, actor.communityId), isNull(unmatchedSignIn.resolution)))
    .orderBy(desc(unmatchedSignIn.lastSeenAt));
  const suggestedIds = rows.map((r) => r.suggestedMemberId).filter((id): id is string => Boolean(id));
  const suggested = suggestedIds.length
    ? await db.select({ id: member.id, name: member.name }).from(member).where(eq(member.communityId, actor.communityId))
    : [];
  const nameOf = new Map(suggested.map((m) => [m.id, m.name]));
  return rows.map((r) => ({ ...r, suggestedMemberName: r.suggestedMemberId ? (nameOf.get(r.suggestedMemberId) ?? null) : null }));
}

/** Members without a provider account, for the administrator's picker. */
export async function listLinkableMembers(actor: Member) {
  await requireAdmins(actor);
  const all = await db.select({ id: member.id, name: member.name }).from(member).where(eq(member.communityId, actor.communityId)).orderBy(member.name);
  const withProvider = await db
    .select({ memberId: memberIdentity.memberId })
    .from(memberIdentity)
    .where(eq(memberIdentity.provider, "oidc"));
  const has = new Set(withProvider.map((r) => r.memberId));
  return all.filter((m) => !has.has(m.id));
}

/**
 * Connect a held sign-in to a member who has no provider account yet. The one place an
 * administrator vouches that two addresses are one person — for the person who signs in to the
 * provider with a different address than the one they joined with.
 */
export async function linkSignInToMember(actor: Member, unmatchedId: string, memberId: string) {
  await requireAdmins(actor);
  return db.transaction(async (tx) => {
    const [held] = await tx.select().from(unmatchedSignIn).where(and(eq(unmatchedSignIn.id, unmatchedId), eq(unmatchedSignIn.communityId, actor.communityId)));
    if (!held) throw new NotFoundError("That sign-in isn't waiting any more");
    if (held.resolution) throw new ConflictError("That sign-in has already been dealt with");
    const [target] = await tx.select().from(member).where(and(eq(member.id, memberId), eq(member.communityId, actor.communityId)));
    if (!target) throw new NotFoundError("Member not found");
    const [already] = await tx
      .select({ id: memberIdentity.id })
      .from(memberIdentity)
      .where(and(eq(memberIdentity.memberId, memberId), eq(memberIdentity.provider, "oidc")));
    if (already) throw new ConflictError(`${target.name} already has a provider account linked`);
    const [clash] = await tx
      .select({ id: memberIdentity.id })
      .from(memberIdentity)
      .where(and(eq(memberIdentity.provider, "oidc"), eq(memberIdentity.loginEmail, held.loginEmail)));
    if (clash) throw new ConflictError("Another member already has a provider account with that address");

    await tx.insert(memberIdentity).values({ memberId, provider: "oidc", providerSubject: held.providerSubject, loginEmail: held.loginEmail });
    await tx
      .update(unmatchedSignIn)
      .set({ resolution: "linked", resolvedAt: new Date(), resolvedById: actor.id, linkedMemberId: memberId })
      .where(eq(unmatchedSignIn.id, held.id));
    await recordSettingChanges(tx, {
      actor,
      entity: "member_sign_in",
      action: "linked_sign_in",
      entityId: memberId,
      entityLabel: target.name,
      current: { signInAccount: null },
      changes: { signInAccount: held.loginEmail },
    });
    return target;
  });
}

/** Refuse a held sign-in. It stays refused if the same person tries again. */
export async function turnAwaySignIn(actor: Member, unmatchedId: string) {
  await requireAdmins(actor);
  const [held] = await db.select().from(unmatchedSignIn).where(and(eq(unmatchedSignIn.id, unmatchedId), eq(unmatchedSignIn.communityId, actor.communityId)));
  if (!held) throw new NotFoundError("That sign-in isn't waiting any more");
  if (held.resolution) throw new ConflictError("That sign-in has already been dealt with");
  const [updated] = await db
    .update(unmatchedSignIn)
    .set({ resolution: "turned_away", resolvedAt: new Date(), resolvedById: actor.id })
    .where(eq(unmatchedSignIn.id, held.id))
    .returning();
  return updated;
}
