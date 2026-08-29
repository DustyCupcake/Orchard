import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inquiry } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow, requireRecruitmentTaskHolder } from "./access";

type Member = typeof memberTable.$inferSelect;

export const submitInquiryInput = z.object({
  message: z.string().min(1),
  contactInfo: z.string().min(1),
});
export type SubmitInquiryInput = z.infer<typeof submitInquiryInput>;

// Public — no actor. "A simple 'message us' box, no application
// structure" (docs/spec.md's Recruitment).
export async function submitInquiry(communityId: string, input: SubmitInquiryInput) {
  const communityRow = await getCommunityRow(communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const [created] = await db
    .insert(inquiry)
    .values({ communityId, message: input.message, contactInfo: input.contactInfo })
    .returning();
  return created;
}

// Visible to anyone holding a recruitment-facing task — not
// community-wide, since an interested stranger's contact details
// aren't the kind of thing that needs default-open visibility.
export async function listInquiries(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  return db
    .select()
    .from(inquiry)
    .where(eq(inquiry.communityId, actor.communityId))
    .orderBy(desc(inquiry.submittedAt));
}

async function getInquiryInCommunity(actor: Member, inquiryId: string) {
  const [row] = await db
    .select()
    .from(inquiry)
    .where(and(eq(inquiry.id, inquiryId), eq(inquiry.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Inquiry not found");
  }
  return row;
}

// Same low-stakes claiming as everywhere else here — mainly so two
// recruitment-task holders don't unknowingly cold-message the same
// interested person.
export async function claimInquiry(actor: Member, inquiryId: string) {
  await requireRecruitmentTaskHolder(actor);
  const row = await getInquiryInCommunity(actor, inquiryId);
  if (row.claimedBy) {
    throw new ConflictError("This inquiry has already been claimed");
  }

  const [updated] = await db
    .update(inquiry)
    .set({ claimedBy: actor.id, claimedAt: new Date() })
    .where(eq(inquiry.id, inquiryId))
    .returning();
  return updated;
}

// Any recruitment-task holder can mark one resolved, whether or not
// they're the one who claimed it — claiming avoids duplicate outreach,
// it isn't a lock on who gets to close it out.
export async function resolveInquiry(actor: Member, inquiryId: string) {
  await requireRecruitmentTaskHolder(actor);
  const row = await getInquiryInCommunity(actor, inquiryId);
  if (row.resolvedAt) {
    throw new ConflictError("This inquiry is already resolved");
  }

  const [updated] = await db
    .update(inquiry)
    .set({ resolvedAt: new Date() })
    .where(eq(inquiry.id, inquiryId))
    .returning();
  return updated;
}
