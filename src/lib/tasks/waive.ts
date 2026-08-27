import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { isAuthorizedToWaive } from "../coordination";
import { performClaimInTx } from "./lifecycle";

type Member = typeof memberTable.$inferSelect;

export const waiveAndClaimInput = z.object({
  memberId: z.string().uuid(),
  reason: z.string().min(1),
});
export type WaiveAndClaimInput = z.infer<typeof waiveAndClaimInput>;

// "Whoever holds branch coordination for the task (or the task's own
// coordination slot, if it has one) can waive an individual_gate
// Requirement... for one specific claim, when nobody who meets it is
// willing to step up" — see docs/spec.md's "Waiving a requirement,
// deliberately". This is coordination claiming the task directly on
// someone else's behalf, the same shape as join-requests.ts's
// acceptJoinRequest() — a coordinator acts, the target member becomes
// the holder — except there's no pending request to accept here, just
// a direct, deliberate override with a required, permanently-visible
// reason.
export async function waiveAndClaim(
  actor: Member,
  taskId: string,
  input: WaiveAndClaimInput,
) {
  const [taskRow] = await db
    .select({ id: task.id, branchId: task.branchId, communityId: task.communityId })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) {
    throw new NotFoundError("Task not found");
  }

  const authorized = await isAuthorizedToWaive(actor, taskRow.branchId, taskId);
  if (!authorized) {
    throw new ForbiddenError(
      "Only that branch's coordination (or this task's own coordination slot) can waive a requirement here",
    );
  }

  const [targetMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, input.memberId), eq(member.communityId, actor.communityId)));
  if (!targetMember) {
    throw new NotFoundError("Member not found in your community");
  }

  return db.transaction((tx) =>
    performClaimInTx(tx, targetMember, taskId, { waivedBy: actor.id, reason: input.reason }),
  );
}
