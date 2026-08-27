import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError } from "../errors";
import { loadTaskForUpdate } from "./lifecycle";

type Member = typeof memberTable.$inferSelect;

// Joining specifically to learn a task, not to carry equal weight this
// time — see docs/spec.md's "Shadow slots & succession". Exempt from
// individual_gate Requirements by design (that exemption is what makes
// it shadowing rather than an easier version of the real thing, so
// there's deliberately no getUnmetRequirements() check here), and
// doesn't count toward capacity — see lifecycle.ts's assignmentCount(),
// which excludes shadow rows everywhere it's used so this composes for
// free with claiming, releasing, and endorsement confirmation.
export async function claimAsShadow(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    // A documented reading of a genuine spec gap: shadowing means
    // learning alongside a current holder, so it only makes sense once
    // the task actually has one to learn from — the same "no owner to
    // route to yet" reasoning join-requests.ts uses for claiming an
    // unclaimed request-gated task, applied in the opposite direction.
    if (current.status !== "claimed" && current.status !== "waiting") {
      throw new ConflictError(
        `Cannot shadow a task that is ${current.status} — shadowing needs a current holder to learn from`,
      );
    }

    const [existing] = await tx
      .select()
      .from(taskAssignment)
      .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, actor.id)));
    if (existing) {
      throw new ConflictError(
        existing.isShadow ? "You're already shadowing this task" : "You already hold this task",
      );
    }

    const [created] = await tx
      .insert(taskAssignment)
      .values({ taskId, memberId: actor.id, isShadow: true })
      .returning();
    return created;
  });
}

// An owner declaring they don't intend to hold this task again next
// cycle — can be set (or unset) with or without a shadow in place. Not
// restricted to non-shadow holders: the schema field lives on the
// assignment row generically, and a shadow declaring they won't shadow
// again next cycle is a legitimate, if less central, use of the same
// flag rather than a case worth rejecting.
export async function setOutgoing(actor: Member, taskId: string, outgoing: boolean) {
  const [updated] = await db
    .update(taskAssignment)
    .set({ isOutgoing: outgoing })
    .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, actor.id)))
    .returning();
  if (!updated) {
    throw new ForbiddenError("You don't hold this task");
  }
  return updated;
}
