import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { member, task, taskAssignment, taskJoinRequest } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getUnmetRequirements, describeRequirement } from "./requirements";
import { assignmentCount, loadTaskForUpdate, performClaimInTx } from "./lifecycle";
import { requireTaskInCommunity } from "./shared";

type Member = typeof memberTable.$inferSelect;

// The claim/request fork described in docs/spec.md's "Task openness"
// and "Request to join": an `open` task (or any task with nobody
// holding it yet — "request routes to the owner" has no owner to route
// to) claims instantly, same as every task did before this existed.
// Once a `request` or `coordination_approved` task has at least one
// holder, a further claim creates a pending request instead.
// `community_endorsed` never claims through here at all, regardless of
// holder count — see src/lib/tasks/endorsements.ts's expressCandidacy(),
// the dedicated entry point Phase 13 built for it.
export async function claimOrRequestToJoin(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.openness === "community_endorsed") {
      throw new ConflictError(
        "This task requires community endorsement — express interest instead of claiming directly",
      );
    }

    if (current.status !== "unclaimed" && current.status !== "claimed") {
      throw new ConflictError(`Cannot claim a task that is ${current.status}`);
    }

    const holderCount = await assignmentCount(tx, taskId);
    const needsRequest =
      holderCount > 0 &&
      (current.openness === "request" || current.openness === "coordination_approved");

    if (!needsRequest) {
      const updated = await performClaimInTx(tx, actor, taskId);
      return { status: "claimed" as const, task: updated };
    }

    const [existingAssignment] = await tx
      .select()
      .from(taskAssignment)
      .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, actor.id)));
    if (existingAssignment) {
      throw new ConflictError("You already hold this task");
    }

    const [existingRequest] = await tx
      .select()
      .from(taskJoinRequest)
      .where(
        and(
          eq(taskJoinRequest.taskId, taskId),
          eq(taskJoinRequest.memberId, actor.id),
          eq(taskJoinRequest.status, "pending"),
        ),
      );
    if (existingRequest) {
      throw new ConflictError("You already have a pending request to join this task");
    }

    const unmet = await getUnmetRequirements(tx, actor, taskId);
    if (unmet.length > 0) {
      const summary = unmet.map((r) => describeRequirement(r)).join("; ");
      throw new ForbiddenError(`You don't meet this task's requirements: ${summary}`);
    }

    const [created] = await tx
      .insert(taskJoinRequest)
      .values({ taskId, memberId: actor.id })
      .returning();
    return { status: "requested" as const, request: created };
  });
}

// coordination_approved: approvable by a holder whose TaskAssignment.
// is_coordination_slot is set, if one exists — falling back to any
// current holder when the task has no coordination slot filled, per
// docs/development-plan.md's Phase 12 scope note. `request` tasks:
// any current holder can accept or decline.
async function requireApprover(
  tx: Tx,
  taskRow: { id: string; openness: string },
  actor: Member,
) {
  const holders = await tx
    .select()
    .from(taskAssignment)
    .where(eq(taskAssignment.taskId, taskRow.id));

  const actorHolds = holders.some((h) => h.memberId === actor.id);
  if (!actorHolds) {
    throw new ForbiddenError("Only a current holder can accept or decline a join request");
  }

  if (taskRow.openness === "coordination_approved") {
    const coordinationHolders = holders.filter((h) => h.isCoordinationSlot);
    if (coordinationHolders.length > 0 && !coordinationHolders.some((h) => h.memberId === actor.id)) {
      throw new ForbiddenError(
        "Only the task's coordination-slot holder can approve this join request",
      );
    }
  }
}

async function loadPendingRequestForUpdate(tx: Tx, taskId: string, requestId: string) {
  const [request] = await tx
    .select()
    .from(taskJoinRequest)
    .where(and(eq(taskJoinRequest.id, requestId), eq(taskJoinRequest.taskId, taskId)))
    .for("update");
  if (!request) {
    throw new NotFoundError("Join request not found");
  }
  if (request.status !== "pending") {
    throw new ConflictError(`Cannot resolve a request that is already ${request.status}`);
  }
  return request;
}

export async function acceptJoinRequest(actor: Member, taskId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);
    await requireApprover(tx, current, actor);
    const request = await loadPendingRequestForUpdate(tx, taskId, requestId);

    const [requester] = await tx.select().from(member).where(eq(member.id, request.memberId));
    if (!requester) {
      throw new NotFoundError("Requester not found");
    }

    const updatedTask = await performClaimInTx(tx, requester, taskId);

    await tx
      .update(taskJoinRequest)
      .set({ status: "accepted", resolvedBy: actor.id, resolvedAt: new Date() })
      .where(eq(taskJoinRequest.id, requestId));

    return updatedTask;
  });
}

export const declineJoinRequestInput = z.object({ reason: z.string().nullable().optional() });
export type DeclineJoinRequestInput = z.infer<typeof declineJoinRequestInput>;

export async function declineJoinRequest(
  actor: Member,
  taskId: string,
  requestId: string,
  input: DeclineJoinRequestInput = {},
) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);
    await requireApprover(tx, current, actor);
    await loadPendingRequestForUpdate(tx, taskId, requestId);

    const [updated] = await tx
      .update(taskJoinRequest)
      .set({
        status: "declined",
        declineReason: input.reason ?? null,
        resolvedBy: actor.id,
        resolvedAt: new Date(),
      })
      .where(eq(taskJoinRequest.id, requestId))
      .returning();
    return updated;
  });
}

// A requester can withdraw their own still-pending request — otherwise
// a mis-sent request has no way back short of the holder declining it.
export async function withdrawJoinRequest(actor: Member, taskId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(taskJoinRequest)
      .where(and(eq(taskJoinRequest.id, requestId), eq(taskJoinRequest.taskId, taskId)))
      .for("update");
    if (!request) {
      throw new NotFoundError("Join request not found");
    }
    if (request.memberId !== actor.id) {
      throw new ForbiddenError("Only the requester can withdraw their own request");
    }
    if (request.status !== "pending") {
      throw new ConflictError(`Cannot withdraw a request that is already ${request.status}`);
    }

    await tx.delete(taskJoinRequest).where(eq(taskJoinRequest.id, requestId));
  });
}

// Task detail view: pending requests for holders to act on, plus the
// resolved history — "declined requests stay visible" per spec, so a
// stalling task with a logged decline reads differently than one
// nobody's offered to help with.
export async function listJoinRequests(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);
  return db
    .select()
    .from(taskJoinRequest)
    .where(eq(taskJoinRequest.taskId, taskId))
    .orderBy(desc(taskJoinRequest.requestedAt));
}

// The board: which currently-visible tasks does the actor already have
// a pending request against, so the card can show "Request pending"
// (with a way to withdraw it) instead of a button that would just 409.
export async function listMyPendingJoinRequests(actor: Member) {
  const rows = await db
    .select({ taskId: taskJoinRequest.taskId, requestId: taskJoinRequest.id })
    .from(taskJoinRequest)
    .innerJoin(task, eq(taskJoinRequest.taskId, task.id))
    .where(
      and(
        eq(task.communityId, actor.communityId),
        eq(taskJoinRequest.memberId, actor.id),
        eq(taskJoinRequest.status, "pending"),
      ),
    );
  return new Map(rows.map((r) => [r.taskId, r.requestId]));
}
