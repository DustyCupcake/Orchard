import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { maybeSeedDefaultProfileQuestions } from "./profile-questions/defaults";
import { member, memberIdentity, community as communityTable, contactMethod } from "@/db/schema";
import { isModuleEnabled } from "./modules";
import { isOidcConfigured } from "./oidc";
import { seedPrimaryContactMethod } from "./contact-methods";

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

  // And the member's own *primary* address, which is the one they were told
  // their email goes to. Without this, moving your primary to a second
  // address would move every notification but leave you unable to log in
  // there — a "this is where we email you" that isn't true of the one
  // thing this app emails you about most.
  //
  // This is not a credential store: a match still only produces a link
  // *sent to that address*, so what proves you is possession of the inbox,
  // exactly as above. A member who points their primary at an address they
  // don't control has misconfigured their own account, and gets no further
  // than a link nobody receives.
  const [existingPrimary] = await db
    .select({ member })
    .from(contactMethod)
    .innerJoin(member, eq(contactMethod.memberId, member.id))
    .where(and(eq(contactMethod.isPrimary, true), eq(contactMethod.value, email)));

  if (existingPrimary) {
    return existingPrimary.member;
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

  const newMember = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(member)
      .values({ communityId: community.id, name: email.split("@")[0] })
      .returning();

    await tx.insert(memberIdentity).values({
      memberId: created.id,
      provider: "magic_link",
      loginEmail: email,
    });

    // Verified without asking: a magic link only ever arrives at an address
    // its recipient controls, and reaching this line at all means this
    // person clicked the one that did. Same transaction as the identity it
    // mirrors, so a member never exists without somewhere their own mail
    // can go.
    await seedPrimaryContactMethod(tx, created.id, email, { verified: true });

    return created;
  });

  // The first person through this door is the community's first Admin,
  // and the moment it makes sense to give them a starting set of
  // questions — it's the only moment there is, since a question has to
  // belong to somebody and until now there was nobody. Deliberately
  // outside the transaction: the member must exist even if seeding
  // doesn't, and a community with no questions and a settings button
  // beats a failed login.
  await maybeSeedDefaultProfileQuestions(newMember);

  return newMember;
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
  input: { sub: string; email: string; emailVerified: boolean | null; name: string | null },
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

  const newMember = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(member)
      .values({
        communityId: community.id,
        name: input.name?.trim() || input.email.split("@")[0],
      })
      .returning();

    await tx.insert(memberIdentity).values({
      memberId: created.id,
      provider: "oidc",
      providerSubject: input.sub,
      loginEmail: input.email,
    });

    // Seeded from the IdP's own assertion, and marked verified only when the
    // IdP actually verified it. An IdP that returns `email` with no
    // `email_verified` is common, and treating that silence as proof is
    // precisely how an unverified claim would end up looking like a
    // confirmed one — so those members get an unverified primary and a
    // one-click link to confirm it, which is the same path anyone adding a
    // second address takes.
    await seedPrimaryContactMethod(tx, created.id, input.email, { verified: input.emailVerified === true });

    return created;
  });

  // Same reasoning as the magic-link path above: first member through
  // the door, so first chance to give the community its questions.
  await maybeSeedDefaultProfileQuestions(newMember);

  return newMember;
}
