import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, memberIdentity } from "@/db/schema";

// Finds the Member already linked to this email via a magic_link
// identity, or creates both a new Member and that identity — first
// login for an email is how someone joins, for now (no separate
// application/invite flow yet, see Recruitment in docs/spec.md).
export async function findOrCreateMemberByEmail(communityId: string, email: string) {
  const [existing] = await db
    .select({ member })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(and(eq(memberIdentity.provider, "magic_link"), eq(memberIdentity.loginEmail, email)));

  if (existing) {
    return existing.member;
  }

  return db.transaction(async (tx) => {
    const [newMember] = await tx
      .insert(member)
      .values({ communityId, name: email.split("@")[0] })
      .returning();

    await tx.insert(memberIdentity).values({
      memberId: newMember.id,
      provider: "magic_link",
      loginEmail: email,
    });

    return newMember;
  });
}
