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
