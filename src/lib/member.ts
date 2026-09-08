import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity, community as communityTable } from "@/db/schema";
import { isModuleEnabled } from "./modules";
import { isOidcConfigured } from "./oidc";

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
export async function findOrCreateMemberByEmail(community: typeof communityTable.$inferSelect, email: string) {
  const [existingMagicLink] = await db
    .select({ member })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(and(eq(memberIdentity.provider, "magic_link"), eq(memberIdentity.loginEmail, email)));

  if (existingMagicLink) {
    return existingMagicLink.member;
  }

  // A member provisioned (or last logged in) via OIDC has no magic_link
  // identity, so the lookup above misses them — without this, magic-link
  // login for a Zitadel-originated member would either bounce (Recruitment
  // on) or silently create a *second*, disconnected Member sharing their
  // email (Recruitment off). Matching by email here keeps magic-link
  // working as a fallback onto the exact same account, of either
  // provenance — see the OIDC-configured gate below for what it's
  // deliberately not allowed to do.
  const [existingOidc] = await db
    .select({ member })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(and(eq(memberIdentity.provider, "oidc"), eq(memberIdentity.loginEmail, email)));

  if (existingOidc) {
    return existingOidc.member;
  }

  // Once a Community has SSO configured *and* made it primary (a
  // separate opt-in — oidcPrimary — from merely having OIDC working;
  // see src/db/schema/community.ts's own comment), magic-link stops
  // being a way to *originate* a new account — new members are meant to
  // arrive via Zitadel. It stays available purely as a fallback login
  // for someone who already has an account (matched above, either
  // provenance) — and when oidcPrimary is off, nothing here changes at
  // all from magic-link-only behavior.
  if (isOidcConfigured(community) && community.oidcPrimary) {
    return null;
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
