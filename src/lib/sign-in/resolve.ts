import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { admission, member, memberIdentity, unmatchedSignIn } from "@/db/schema";
import type { community as communityTable } from "@/db/schema";
import { findOrCreateMemberByOidcSubject } from "../member";

type Community = typeof communityTable.$inferSelect;
type Member = typeof member.$inferSelect;

// docs/plans/admission-flow.md §6a — turning a sign-in at the provider into a member.
//
// The provider's role is the gate to signing in at all; what this decides is *which
// member* the person is, and whether to make one. It used to look up by `sub` and, finding
// nothing, create a member — never looking at the address — so anyone who already had a
// member (a magic-link account, or somebody admitted through recruitment) got a second,
// empty one and left the first orphaned with their answers, places and tasks.
//
//   1. A `sub` already linked to a member: that member, as before.
//   2. The provider asserts it checked the address (`email_verified`) and a member
//      *admitted here* has that address and no provider account yet: link them. An
//      unverified address, or a member who was not admitted through the funnel (a
//      founder, someone imported), is never linked on the address alone — that is how an
//      unverified claim would take over an account, which is the reason it used to be
//      refused. Both of the conditions together keep that reason intact.
//   3. Any other member that has the address: held for an administrator, with that member
//      suggested, rather than a duplicate made.
//   4. Nobody has it: today's behaviour (a member is made) if the community lets anyone
//      with the role in, otherwise held.
//
// "Held" is a row an administrator links to a member or turns away (unmatched.ts). The
// person is told plainly, and nothing is lost: their sign-in is the same row if they try
// again.

export type SignInResolution =
  | { kind: "member"; member: Member }
  | { kind: "held" }
  | { kind: "turned_away" };

export type SignInClaims = {
  sub: string;
  email: string;
  emailVerified: boolean | null;
  nickname: string | null;
  givenName: string | null;
};

async function memberWithoutProviderAccountFor(email: string): Promise<Member | null> {
  const rows = await db
    .select({ member })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(and(eq(memberIdentity.provider, "magic_link"), sql`lower(${memberIdentity.loginEmail}) = ${email.trim().toLowerCase()}`));
  for (const row of rows) {
    const [hasProvider] = await db
      .select({ id: memberIdentity.id })
      .from(memberIdentity)
      .where(and(eq(memberIdentity.memberId, row.member.id), eq(memberIdentity.provider, "oidc")));
    if (!hasProvider) return row.member;
  }
  return null;
}

async function wasAdmittedHere(memberId: string): Promise<boolean> {
  const [row] = await db.select({ id: admission.id }).from(admission).where(eq(admission.admittedMemberId, memberId));
  return Boolean(row);
}

async function hold(community: Community, claims: SignInClaims, suggested: Member | null): Promise<SignInResolution> {
  const now = new Date();
  const [existing] = await db.select().from(unmatchedSignIn).where(eq(unmatchedSignIn.providerSubject, claims.sub));
  if (existing?.resolution === "turned_away") return { kind: "turned_away" };
  if (existing) {
    await db
      .update(unmatchedSignIn)
      .set({
        lastSeenAt: now,
        loginEmail: claims.email,
        emailVerified: claims.emailVerified,
        suggestedMemberId: suggested?.id ?? existing.suggestedMemberId,
      })
      .where(eq(unmatchedSignIn.id, existing.id));
    return { kind: "held" };
  }
  await db.insert(unmatchedSignIn).values({
    communityId: community.id,
    providerSubject: claims.sub,
    loginEmail: claims.email,
    emailVerified: claims.emailVerified,
    nickname: claims.nickname,
    givenName: claims.givenName,
    suggestedMemberId: suggested?.id ?? null,
  });
  return { kind: "held" };
}

export async function resolveOidcSignIn(community: Community, claims: SignInClaims): Promise<SignInResolution> {
  // 1. Already linked.
  const [linked] = await db
    .select({ member, identity: memberIdentity })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(and(eq(memberIdentity.provider, "oidc"), eq(memberIdentity.providerSubject, claims.sub)));
  if (linked) {
    return { kind: "member", member: (await findOrCreateMemberByOidcSubject(community, claims)) };
  }

  // A sign-in an administrator already linked or turned away stays as they decided.
  const [prior] = await db.select().from(unmatchedSignIn).where(eq(unmatchedSignIn.providerSubject, claims.sub));
  if (prior?.resolution === "turned_away") return { kind: "turned_away" };

  const candidate = await memberWithoutProviderAccountFor(claims.email);
  if (candidate) {
    // 2. Verified address, and somebody admitted through the funnel.
    if (claims.emailVerified === true && (await wasAdmittedHere(candidate.id))) {
      try {
        await db.insert(memberIdentity).values({
          memberId: candidate.id,
          provider: "oidc",
          providerSubject: claims.sub,
          loginEmail: claims.email,
        });
        return { kind: "member", member: candidate };
      } catch (err) {
        // Another account at the provider already carries this address: not ours to guess
        // between, so an administrator decides.
        console.error("[sign-in] could not link the provider account by address:", err);
        return hold(community, claims, candidate);
      }
    }
    // 3. A member has the address but nothing proves it is this person.
    return hold(community, claims, candidate);
  }

  // 4. Nobody has the address.
  if (community.ssoJoinPolicy === "admitted_only") return hold(community, claims, null);
  return { kind: "member", member: await findOrCreateMemberByOidcSubject(community, claims) };
}

