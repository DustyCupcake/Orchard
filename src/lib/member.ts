import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity } from "@/db/schema";
import { isModuleEnabled } from "./modules";

// Finds the Member already linked to this email via a magic_link
// identity, or creates both a new Member and that identity — first
// login for an email is how someone joins, as long as the Recruitment
// module is off (the "open door" default, spec's own framing — not a
// bug to fix, the correct behavior for a Community that never turns
// Recruitment on). Once Recruitment is on, an *unrecognized* email
// verifying an ordinary magic link returns null instead of silently
// creating a Member — see docs/development-plan.md's Phase 32. Only
// new-membership creation is gated: an existing member (an identity
// already on file) always logs in exactly as before, module on or off.
export async function findOrCreateMemberByEmail(
  community: { id: string; modulesEnabled: string[] },
  email: string,
) {
  const [existing] = await db
    .select({ member })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(and(eq(memberIdentity.provider, "magic_link"), eq(memberIdentity.loginEmail, email)));

  if (existing) {
    return existing.member;
  }

  if (isModuleEnabled(community, "recruitment")) {
    return null;
  }

  return db.transaction(async (tx) => {
    const [newMember] = await tx
      .insert(member)
      .values({ communityId: community.id, name: email.split("@")[0] })
      .returning();

    await tx.insert(memberIdentity).values({
      memberId: newMember.id,
      provider: "magic_link",
      loginEmail: email,
    });

    return newMember;
  });
}

// Resolves or creates a Member from a verified OIDC login (Phase 57) —
// see docs/spec.md's Authentication: "identity is keyed on the OIDC
// sub claim, never on email." Looked up by (provider='oidc',
// providerSubject=sub) only — deliberately never falls back to
// matching an existing magic_link identity by email, even when one
// exists for the same address (out of scope per the dev plan: "not
// automatically merging a pre-existing magic-link Member into an OIDC
// login that happens to share an email" — a real edge case, but a
// manual admin action if it ever comes up). Callers are expected to
// have already confirmed the token carries the community's required
// role before calling this — this function only ever provisions, it
// never checks the role gate itself.
export async function findOrCreateMemberByOidcSubject(
  community: { id: string },
  input: { sub: string; email: string; name: string | null },
) {
  const [existing] = await db
    .select({ member, identity: memberIdentity })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(and(eq(memberIdentity.provider, "oidc"), eq(memberIdentity.providerSubject, input.sub)));

  if (existing) {
    // "Email is free to drift upstream... Orchard updates its own copy
    // to match" — the identity link stays keyed on sub regardless.
    if (existing.identity.loginEmail !== input.email) {
      await db
        .update(memberIdentity)
        .set({ loginEmail: input.email })
        .where(eq(memberIdentity.id, existing.identity.id));
    }
    return existing.member;
  }

  return db.transaction(async (tx) => {
    const [newMember] = await tx
      .insert(member)
      .values({
        communityId: community.id,
        name: input.name?.trim() || input.email.split("@")[0],
      })
      .returning();

    await tx.insert(memberIdentity).values({
      memberId: newMember.id,
      provider: "oidc",
      providerSubject: input.sub,
      loginEmail: input.email,
    });

    return newMember;
  });
}
