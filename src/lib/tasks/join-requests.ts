import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db";
import { member, task, taskAssignment, taskJoinRequest } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConfirmationRequiredError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { isAuthorizedToWaive, isCoordinationHolder, listCoordinatorIdsForScope } from "../coordination";
import { getUnmetRequirements, describeRequirement } from "./requirements";
import { assignmentCount, loadTaskForUpdate, performClaimInTx } from "./lifecycle";
import { requireTaskInCommunity } from "./shared";

// The one definition of "a coordinator is about to self-assign something
// that might suit someone else better" — docs/spec.md's Coordination
// mechanics: "when anyone with placement authority tries to self-assign a
// flagged or unclaimed task". The claim path checks it, and both claim
// surfaces (the task page's header and the board's TaskCard) use it to
// decide whether their Claim button opens a dialog, so the two can't
// disagree about who's asked and who isn't. Deliberately takes only the
// two task fields the rule is about: "flagged" and "unclaimed" are both
// properties of the task, while "does this actor coordinate it" is a
// separate authority check each caller already has.
export function isSelfAssignWorthAskingAbout(task: { status: string; attentionLevel: string }) {
  return task.status === "unclaimed" || task.attentionLevel !== "ok";
}

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
//
// The one exception to "nobody holding it yet claims instantly" is a
// `coordination_approved` task in a scope someone coordinates: there *is*
// somebody to route the first claim to, and that openness exists
// precisely for tasks where who holds them matters (sensitive access), so
// letting the first claimer skip approval and then approve everyone
// after them defeats it. See firstClaimNeedsApproval.
export async function claimOrRequestToJoin(
  actor: Member,
  taskId: string,
  options: { confirmed?: boolean } = {},
) {
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

    // The self-assign confirmation check. Only fires for someone who
    // currently does this task's scope's coordination — an ordinary
    // member claiming a flagged or unclaimed task is just claiming one.
    // Scoped to the ordinary claim/request path, not community_endorsed
    // (already its own, more deliberate process) or shadowing (not a
    // placement act).
    //
    // The message names the dialog rather than the page: the two claim
    // surfaces now ask by *opening* this rather than by being replaced
    // by a standing banner, so the one place a non-dialog caller can still
    // land is the REST API and the board's bulk claim.
    if (
      !options.confirmed &&
      isSelfAssignWorthAskingAbout(current) &&
      (await isCoordinationHolder(actor, { branchId: current.branchId, cycleId: current.cycleId }))
    ) {
      throw new ConfirmationRequiredError(
        "You coordinate this task's scope — confirm before self-assigning a flagged or unclaimed task",
      );
    }

    const holderCount = await assignmentCount(tx, taskId);
    const needsRequest =
      (holderCount > 0 &&
        (current.openness === "request" || current.openness === "coordination_approved")) ||
      (holderCount === 0 && (await firstClaimNeedsApproval(current, actor)));

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

// Whether the first claim on a task nobody holds yet has to be approved.
// Only `coordination_approved` ever does, and only when somebody other
// than the claimer is in a position to approve it. Two cases claim
// directly, both deliberately:
//
// - the claimer *is* the task's coordination (they are the authority a
//   request would be routed to; the self-assign confirmation in
//   claimOrRequestToJoin has already asked whether somebody else is a
//   better fit), and
// - nobody coordinates the scope at all, so a request would wait for
//   nobody. A small community with no coordinator is the ordinary case
//   here, and stranding every such task would be worse than the status
//   quo. This is the same degrade-gracefully shape as the approval
//   fallback below, and it is the one place the bypass remains.
async function firstClaimNeedsApproval(
  taskRow: { id: string; openness: string; branchId: string; cycleId: string | null },
  actor: Member,
) {
  if (taskRow.openness !== "coordination_approved") return false;
  const scope = { branchId: taskRow.branchId, cycleId: taskRow.cycleId };
  if (await isCoordinationHolder(actor, scope)) return false;
  const coordinators = await listCoordinatorIdsForScope(actor.communityId, scope);
  return coordinators.everyone || [...coordinators.memberIds].some((id) => id !== actor.id);
}

// Who may accept or decline a join request on this task.
//
// `request`: any current holder — "request routes to the owner".
//
// `coordination_approved`: the task's coordination, i.e. whoever holds
// branch (or community, or event) coordination over where the task sits,
// or the task's own coordination slot — the same authority that can waive
// a requirement (isAuthorizedToWaive), because both are "coordination
// deciding who may hold something sensitive". Coordination does *not*
// need to hold the task itself, which is what the old rule got wrong: it
// demanded a holder first, so a task whose holders had all left, with a
// request pending, could be resolved by nobody at all.
//
// If nobody *else* has that authority (no coordination covers the scope
// and no slot is filled, leaving the requester out of the count), it
// falls back to an ordinary holder, as it always did. That keeps a
// community without coordinators working; it is not a bypass, because
// anyone coordinating the scope switches it off.
//
// Never the requester, and never a shadow: a shadow is learning the task,
// not placing people on it, and `assignmentCount` already excludes
// shadows from "who holds this".
export async function canResolveJoinRequest(
  dbOrTx: DbOrTx,
  taskRow: { id: string; openness: string; branchId: string; cycleId: string | null },
  actor: Member,
  requesterId: string | null,
): Promise<boolean> {
  if (requesterId !== null && actor.id === requesterId) return false;

  const holders = await dbOrTx
    .select()
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, taskRow.id), eq(taskAssignment.isShadow, false)));
  const actorHolds = holders.some((h) => h.memberId === actor.id);

  if (taskRow.openness !== "coordination_approved") return actorHolds;

  const scope = { branchId: taskRow.branchId, cycleId: taskRow.cycleId };
  if (await isAuthorizedToWaive(actor, scope, taskRow.id)) return true;

  if (holders.some((h) => h.isCoordinationSlot && h.memberId !== requesterId)) return false;
  const coordinators = await listCoordinatorIdsForScope(actor.communityId, scope);
  if (coordinators.everyone || [...coordinators.memberIds].some((id) => id !== requesterId)) return false;
  return actorHolds;
}

// Which of a task's pending requests `actor` may resolve, for the task
// page. Per request rather than per task because the requester is always
// excluded: a coordinator who asked to join is not their own approver.
export async function listResolvableJoinRequestIds(
  actor: Member,
  taskRow: { id: string; openness: string; branchId: string; cycleId: string | null },
  pending: { id: string; memberId: string }[],
): Promise<Set<string>> {
  const verdicts = await Promise.all(
    pending.map(async (r) => ((await canResolveJoinRequest(db, taskRow, actor, r.memberId)) ? r.id : null)),
  );
  return new Set(verdicts.filter((id): id is string => id !== null));
}

async function requireApprover(
  tx: Tx,
  taskRow: { id: string; openness: string; branchId: string; cycleId: string | null },
  actor: Member,
  requesterId: string,
) {
  if (await canResolveJoinRequest(tx, taskRow, actor, requesterId)) return;
  throw new ForbiddenError(
    taskRow.openness === "coordination_approved"
      ? "Only this task's coordination can approve this join request"
      : "Only a current holder can accept or decline a join request",
  );
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
    const request = await loadPendingRequestForUpdate(tx, taskId, requestId);
    await requireApprover(tx, current, actor, request.memberId);

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
    const request = await loadPendingRequestForUpdate(tx, taskId, requestId);
    await requireApprover(tx, current, actor, request.memberId);

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
