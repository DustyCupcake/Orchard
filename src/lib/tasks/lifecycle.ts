import { and, count, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { task, taskAssignment, taskDependency } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { resolveEngagementForMember } from "../engagement";
import { getUnmetRequirements, describeRequirement } from "./requirements";

type Member = typeof memberTable.$inferSelect;

// Locks the task row for the duration of the transaction — the lifecycle
// endpoints can run concurrently (two people claiming the last slot at
// once), so every transition reads its starting state through this.
export async function loadTaskForUpdate(tx: Tx, taskId: string, communityId: string) {
  const [row] = await tx
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, communityId)))
    .for("update");
  if (!row) {
    throw new NotFoundError("Task not found");
  }
  return row;
}

// A shadow isn't driving the task, just learning alongside whoever is —
// see docs/spec.md's "Shadow slots & succession". Excluded here so a
// shadow can't park/resume/finish the task themselves.
async function requireHolds(tx: Tx, taskId: string, memberId: string) {
  const [row] = await tx
    .select()
    .from(taskAssignment)
    .where(
      and(
        eq(taskAssignment.taskId, taskId),
        eq(taskAssignment.memberId, memberId),
        eq(taskAssignment.isShadow, false),
      ),
    );
  if (!row) {
    throw new ForbiddenError("You don't hold this task");
  }
}

// Real holders only — a shadow "doesn't count toward the task's
// capacity" (docs/spec.md), so every caller that means "how many
// people actually hold this task" (capacity checks, and releaseTask's
// "does the task still have anyone" check) gets that for free by
// excluding shadow rows here rather than needing to remember to at
// each call site.
export async function assignmentCount(tx: Tx, taskId: string) {
  const [row] = await tx
    .select({ value: count() })
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.isShadow, false)));
  return row.value;
}

// Set when branch coordination is waiving this specific claim's
// individual_gate Requirements — see docs/spec.md's "Waiving a
// requirement, deliberately" (Coordination mechanics). Scoped to this
// one claim, not a permanent change to the task: the Requirement stays
// real for everyone else, this just skips the check for this insert
// and leaves a standing, visible flag on the resulting assignment.
export type WaiverInfo = { waivedBy: string; reason: string };

// The actual act of claiming — insert the assignment, flip the task to
// claimed. Shared by claimTask() (a member claiming for themselves),
// join-requests.ts's acceptJoinRequest() (a holder accepting on behalf
// of the requester), and coordination.ts's waiveAndClaim() (a
// coordinator claiming on behalf of someone who doesn't meet a
// Requirement) so the capacity/Requirement checks live in exactly one
// place regardless of which door someone came in through. Capacity
// still applies even under a waiver — waiving is about the
// Requirement gate specifically, not a capacity override.
export async function performClaimInTx(
  tx: Tx,
  member: Member,
  taskId: string,
  waiver?: WaiverInfo,
) {
  const current = await loadTaskForUpdate(tx, taskId, member.communityId);

  if (current.status !== "unclaimed" && current.status !== "claimed") {
    throw new ConflictError(`Cannot claim a task that is ${current.status}`);
  }

  const [existing] = await tx
    .select()
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, member.id)));
  if (existing) {
    throw new ConflictError(
      existing.isShadow
        ? "You're currently shadowing this task — release that first to claim it for real"
        : "You already hold this task",
    );
  }

  if (current.capacity !== null) {
    const held = await assignmentCount(tx, taskId);
    if (held >= current.capacity) {
      throw new ConflictError("Task is at capacity");
    }
  }

  if (!waiver) {
    const unmet = await getUnmetRequirements(tx, member, taskId);
    if (unmet.length > 0) {
      const summary = unmet.map((r) => describeRequirement(r)).join("; ");
      throw new ForbiddenError(`You don't meet this task's requirements: ${summary}`);
    }
  }

  await tx.insert(taskAssignment).values({
    taskId,
    memberId: member.id,
    ...(waiver && { gateWaivedBy: waiver.waivedBy, gateWaivedReason: waiver.reason }),
  });

  const [updated] = await tx
    .update(task)
    .set({ status: "claimed", statusChangedAt: new Date(), attentionLevel: "ok" })
    .where(eq(task.id, taskId))
    .returning();
  return updated;
}

export async function claimTask(actor: Member, taskId: string) {
  return db.transaction((tx) => performClaimInTx(tx, actor, taskId));
}

// The actual act of releasing one member's assignment — shared by
// releaseTask() (a member releasing their own, actor-gated below) and
// nominations.ts's own decline/not_now/auto-expire paths, none of
// which have a real "acting member" the way releaseTask's caller does
// (a nomination response is authorized by the response itself — an
// accept/decline click, or a consumed one-click-email token — not by
// the responder separately holding the task the way a release does).
// Deletes the given member's own row, unclaimed once nobody's left —
// same rules either way, just keyed by an explicit memberId instead of
// actor.id.
export async function releaseAssignmentInTx(tx: Tx, taskId: string, communityId: string, memberId: string) {
  const current = await loadTaskForUpdate(tx, taskId, communityId);

  if (current.status !== "claimed" && current.status !== "waiting") {
    throw new ConflictError(`Cannot release a task that is ${current.status}`);
  }

  const deleted = await tx
    .delete(taskAssignment)
    .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, memberId)))
    .returning();
  if (deleted.length === 0) {
    throw new ForbiddenError("Doesn't hold this task");
  }

  const remaining = await assignmentCount(tx, taskId);
  if (remaining === 0) {
    const [updated] = await tx
      .update(task)
      .set({
        status: "unclaimed",
        nextCheckinAt: null,
        waitingNote: null,
        statusChangedAt: new Date(),
        attentionLevel: "ok",
      })
      .where(eq(task.id, taskId))
      .returning();
    return updated;
  }
  return current;
}

export async function releaseTask(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    // "Release" is one of the Waiting-nudge's own four named response
    // options (docs/spec.md's Owner-set nudges) — see
    // docs/development-plan.md's Phase 52. Checked before the release
    // itself changes the status out from under this read.
    const before = await loadTaskForUpdate(tx, taskId, actor.communityId);
    const wasWaiting = before.status === "waiting";
    const updated = await releaseAssignmentInTx(tx, taskId, actor.communityId, actor.id);
    if (wasWaiting) {
      await resolveEngagementForMember(tx, actor.id);
    }
    return updated;
  });
}

export async function parkTask(
  actor: Member,
  taskId: string,
  input: { nextCheckinAt: Date; waitingNote?: string | null },
) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "claimed") {
      throw new ConflictError(`Cannot park a task that is ${current.status}`);
    }
    await requireHolds(tx, taskId, actor.id);

    const [updated] = await tx
      .update(task)
      .set({
        status: "waiting",
        nextCheckinAt: input.nextCheckinAt,
        waitingNote: input.waitingNote ?? null,
        statusChangedAt: new Date(),
        attentionLevel: "ok",
      })
      .where(eq(task.id, taskId))
      .returning();
    return updated;
  });
}

export async function resumeTask(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "waiting") {
      throw new ConflictError(`Cannot resume a task that is ${current.status}`);
    }
    await requireHolds(tx, taskId, actor.id);

    const [updated] = await tx
      .update(task)
      .set({
        status: "claimed",
        nextCheckinAt: null,
        waitingNote: null,
        statusChangedAt: new Date(),
        attentionLevel: "ok",
      })
      .where(eq(task.id, taskId))
      .returning();

    // "Update progress (resets the clock)" — the other of the two
    // Waiting-nudge response actions this codebase's actual lifecycle
    // graph makes directly callable from `waiting` (see
    // docs/development-plan.md's Phase 52's own resolved reading —
    // spec's "mark done"/"re-snooze" options both require resuming
    // first in this codebase, so aren't separately hooked here).
    await resolveEngagementForMember(tx, actor.id);

    return updated;
  });
}

export async function finishTask(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.status !== "claimed") {
      throw new ConflictError(`Cannot finish a task that is ${current.status}`);
    }
    await requireHolds(tx, taskId, actor.id);

    const deps = await tx
      .select({ status: task.status })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.dependsOnTaskId, task.id))
      .where(eq(taskDependency.taskId, taskId));
    const openCount = deps.filter((d) => d.status !== "done").length;
    if (openCount > 0) {
      throw new ConflictError(
        `Cannot finish: ${openCount} dependency task(s) not yet done`,
      );
    }

    const [updated] = await tx
      .update(task)
      .set({ status: "done", statusChangedAt: new Date(), attentionLevel: "ok" })
      .where(eq(task.id, taskId))
      .returning();
    return updated;
  });
}
