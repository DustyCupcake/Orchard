import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { memberLanguage } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

export const MEMBER_LANGUAGE_LEVELS = ["basic", "conversational", "fluent", "native"] as const;
export type MemberLanguageLevel = (typeof MEMBER_LANGUAGE_LEVELS)[number];

export const memberLanguageInput = z.object({
  language: z.string().min(1),
  level: z.enum(MEMBER_LANGUAGE_LEVELS),
});
export type MemberLanguageInput = z.infer<typeof memberLanguageInput>;

// Always self-service, same posture as tags/contact methods — a member
// manages their own spoken languages freely, no admin gate.
export async function listOwnMemberLanguages(actor: Member) {
  return db.select().from(memberLanguage).where(eq(memberLanguage.memberId, actor.id));
}

export async function addMemberLanguage(actor: Member, input: MemberLanguageInput) {
  const [created] = await db
    .insert(memberLanguage)
    .values({ memberId: actor.id, language: input.language, level: input.level })
    .returning();
  return created;
}

export async function deleteMemberLanguage(actor: Member, id: string) {
  const [row] = await db.select().from(memberLanguage).where(eq(memberLanguage.id, id));
  if (!row) {
    throw new NotFoundError("Language not found");
  }
  if (row.memberId !== actor.id) {
    throw new ForbiddenError("Not your language entry");
  }
  await db.delete(memberLanguage).where(eq(memberLanguage.id, id));
}

// The Requirement "language" type's own check (src/lib/tasks/requirements.ts)
// — any level counts, since proficiency isn't a gate concern for v1, just
// a fact worth recording. Case-insensitive, matching how a member typing
// "Spanish" should satisfy a requirement authored as "spanish". Takes
// dbOrTx like every other requirement-satisfaction check in that file,
// so it composes inside the same transaction when called from there.
export async function memberSpeaksLanguage(
  dbOrTx: DbOrTx,
  memberId: string,
  language: string,
): Promise<boolean> {
  const rows = await dbOrTx.select().from(memberLanguage).where(eq(memberLanguage.memberId, memberId));
  const needle = language.trim().toLowerCase();
  return rows.some((r) => r.language.trim().toLowerCase() === needle);
}
