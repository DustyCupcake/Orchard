import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { objection, recruitmentSubscription } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow, requireRecruitmentTaskHolder } from "./access";
import { computeWiderDiscussionStatus, getRecruitmentDecision } from "./decisions";

type Member = typeof memberTable.$inferSelect;

export const raiseObjectionInput = z.object({
  note: z.string().min(1),
});
export type RaiseObjectionInput = z.infer<typeof raiseObjectionInput>;

// "Subscribed members can raise an anonymous-to-the-community... but
// visible-to-the-evaluators objection" — see docs/spec.md's
// Recruitment. Open only to a member with an active
// RecruitmentSubscription (Phase 33's own mechanism), and only while
// the wider-discussion window is genuinely still open.
export async function raiseObjection(actor: Member, formResponseId: string, input: RaiseObjectionInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const [subscription] = await db
    .select({ active: recruitmentSubscription.active })
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  if (!subscription?.active) {
    throw new ForbiddenError("Only a subscribed member can raise an objection");
  }

  const decision = await getRecruitmentDecision(formResponseId);
  if (!decision) {
    throw new NotFoundError("No decision has been reached for this application yet");
  }
  if (computeWiderDiscussionStatus(decision) !== "open") {
    throw new ConflictError("The wider-discussion window for this application isn't open");
  }

  const [created] = await db
    .insert(objection)
    .values({ formResponseId, raisedBy: actor.id, note: input.note })
    .returning();
  return created;
}

// Holder-only — "visible-to-the-evaluators." raisedBy is deliberately
// never returned: "anonymous" reads unqualified here, the same posture
// the Anonymous task signal already takes, not just "hidden from the
// wider community." See src/db/schema/recruitment.ts's objection
// comment.
export async function listObjections(actor: Member, formResponseId: string) {
  await requireRecruitmentTaskHolder(actor);
  const rows = await db
    .select({ id: objection.id, note: objection.note, raisedAt: objection.raisedAt })
    .from(objection)
    .where(eq(objection.formResponseId, formResponseId));
  return rows;
}
