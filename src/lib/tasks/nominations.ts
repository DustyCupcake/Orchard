import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, member, memberIdentity, task, taskAssignment, taskNomination } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { isCoordinationHolder } from "../coordination";
import { issueActionToken, consumeActionToken } from "../notifications";
import { sendTaskNominationEmail } from "../mailer";
import { performClaimInTx, releaseAssignmentInTx } from "./lifecycle";

type Member = typeof memberTable.$inferSelect;
type TaskNominationRow = typeof taskNomination.$inferSelect;

// Exported so tests can issue a token bound to a real nomination
// without needing a real outbound send to observe one — see
// src/lib/notifications/action-tokens.ts for the generic issue/consume
// pair this is a `kind` for.
export const RESPONSE_TOKEN_KIND = "task_nomination_response";
type NominationResponseKind = "accepted" | "declined" | "not_now";
type NominationResolution = NominationResponseKind | "expired";

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "An existing owner can also nominate a specific person for an open
// slot — a peer-initiated fitted ask, the same mechanism coordination
// uses, just triggered by a collaborator instead" — see docs/spec.md's
// Multi-slot & collaborative tasks. Two doors, same authority level:
// branch coordination for the task's own branch, or any current real
// (non-shadow) holder of the task itself — deliberately broader than
// waive.ts's isAuthorizedToWaive (narrowed to the task's own
// coordination slot specifically), since spec's own language here is
// "an existing owner," not "the coordination slot."
export async function isAuthorizedToNominate(actor: Member, taskRow: { id: string; branchId: string }) {
  if (await isCoordinationHolder(actor, taskRow.branchId)) return true;
  const [holding] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .where(
      and(
        eq(taskAssignment.taskId, taskRow.id),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export const nominateForTaskInput = z.object({
  memberId: z.string().uuid(),
  message: z.string().nullable().optional(),
});
export type NominateForTaskInput = z.infer<typeof nominateForTaskInput>;

async function findMemberEmail(memberId: string): Promise<string | null> {
  const [row] = await db
    .select({ loginEmail: memberIdentity.loginEmail })
    .from(memberIdentity)
    .where(eq(memberIdentity.memberId, memberId));
  return row?.loginEmail ?? null;
}

function buildResponseUrl(appUrl: string, token: string): string {
  const url = new URL("/api/task-nominations/respond", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

// Best-effort — a missing identity/email, or a failed send, never
// blocks the nomination itself from standing (the assignment is
// already real by the time this runs; the nominee can still respond
// from their own Dashboard either way). Not awaited by the caller for
// its own success/failure, just for ordering.
async function sendNominationEmailIfPossible(
  nominatorName: string,
  targetMemberId: string,
  taskTitle: string,
  nomination: TaskNominationRow,
  responseDays: number,
  appUrl: string,
) {
  const email = await findMemberEmail(targetMemberId);
  if (!email) return;

  const ttlMs = Math.max(nomination.respondByDeadline.getTime() - Date.now(), 60_000);
  const payloadFor = (response: NominationResponseKind) => ({ nominationId: nomination.id, response });
  const [acceptToken, declineToken, notNowToken] = await Promise.all([
    issueActionToken(RESPONSE_TOKEN_KIND, payloadFor("accepted"), ttlMs),
    issueActionToken(RESPONSE_TOKEN_KIND, payloadFor("declined"), ttlMs),
    issueActionToken(RESPONSE_TOKEN_KIND, payloadFor("not_now"), ttlMs),
  ]);

  await sendTaskNominationEmail(email, {
    nominatorName,
    taskTitle,
    message: nomination.message,
    responseDays,
    acceptUrl: buildResponseUrl(appUrl, acceptToken),
    declineUrl: buildResponseUrl(appUrl, declineToken),
    notNowUrl: buildResponseUrl(appUrl, notNowToken),
  });
}

// "When a coordinator hands someone a task directly... they get:
// '[Coordinator] thinks this is a fit for you: [task]. A yes, no, or
// not-now are all fine — reply within [N days].'" — see
// docs/spec.md's Task assignment notification, and
// src/db/schema/task-nomination.ts's own comment for the resolved
// "claims immediately, courtesy window on top" interpretation. Claims
// through the exact same performClaimInTx every other claim path uses
// — no waiver, so an unmet individual_gate Requirement fails this
// outright with the same message an ordinary claim would get (use
// waiveAndClaim instead if the point is overriding the gate, not just
// placing a fit).
export async function nominateForTask(
  actor: Member,
  taskId: string,
  input: NominateForTaskInput,
  appUrl: string,
) {
  const [taskRow] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) {
    throw new NotFoundError("Task not found");
  }

  if (taskRow.openness === "community_endorsed") {
    throw new ConflictError(
      "This task requires community endorsement — nomination doesn't apply here",
    );
  }

  if (!(await isAuthorizedToNominate(actor, taskRow))) {
    throw new ForbiddenError(
      "Only this branch's coordination, or a current holder of this task, can nominate someone",
    );
  }

  const [targetMember] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, input.memberId), eq(member.communityId, actor.communityId)));
  if (!targetMember) {
    throw new NotFoundError("Member not found in your community");
  }

  const [existingPending] = await db
    .select({ id: taskNomination.id })
    .from(taskNomination)
    .where(
      and(
        eq(taskNomination.taskId, taskId),
        eq(taskNomination.nominatedMemberId, targetMember.id),
        eq(taskNomination.status, "pending"),
      ),
    );
  if (existingPending) {
    throw new ConflictError("This member already has a pending nomination for this task");
  }

  const communityRow = await getCommunityRow(actor.communityId);
  const respondByDeadline = new Date(
    Date.now() + communityRow.taskNominationResponseDays * 86_400_000,
  );

  const { updatedTask, nomination } = await db.transaction(async (tx) => {
    const updatedTask = await performClaimInTx(tx, targetMember, taskId);
    const [nomination] = await tx
      .insert(taskNomination)
      .values({
        taskId,
        nominatedMemberId: targetMember.id,
        nominatedBy: actor.id,
        message: input.message?.trim() || null,
        respondByDeadline,
      })
      .returning();
    return { updatedTask, nomination };
  });

  await sendNominationEmailIfPossible(
    actor.name,
    targetMember.id,
    taskRow.title,
    nomination,
    communityRow.taskNominationResponseDays,
    appUrl,
  );

  return { task: updatedTask, nomination };
}

// The one place a response — from any of the three entry points below
// — actually resolves a nomination. `accepted` closes the window early
// with no other change (the assignment already exists); anything else
// releases the same assignment nominateForTask created. Row-locked so
// a response and the scheduled expiry job below can never race each
// other into double-releasing.
async function applyNominationResponse(
  nominationId: string,
  resolution: NominationResolution,
): Promise<TaskNominationRow | null> {
  return db.transaction(async (tx) => {
    const [nomination] = await tx
      .select()
      .from(taskNomination)
      .where(eq(taskNomination.id, nominationId))
      .for("update");
    if (!nomination || nomination.status !== "pending") {
      return null;
    }

    if (resolution !== "accepted") {
      const [taskRow] = await tx
        .select({ communityId: task.communityId })
        .from(task)
        .where(eq(task.id, nomination.taskId));
      if (taskRow) {
        await releaseAssignmentInTx(tx, nomination.taskId, taskRow.communityId, nomination.nominatedMemberId);
      }
    }

    const [updated] = await tx
      .update(taskNomination)
      .set({ status: resolution, respondedAt: new Date() })
      .where(eq(taskNomination.id, nominationId))
      .returning();
    return updated;
  });
}

export const respondToNominationInput = z.object({
  response: z.enum(["accepted", "declined", "not_now"]),
});
export type RespondToNominationInput = z.infer<typeof respondToNominationInput>;

// The authenticated path — a nominee responding from their own
// Dashboard, logged in as themselves.
export async function respondToNomination(
  actor: Member,
  nominationId: string,
  input: RespondToNominationInput,
) {
  const [nomination] = await db.select().from(taskNomination).where(eq(taskNomination.id, nominationId));
  if (!nomination) {
    throw new NotFoundError("Nomination not found");
  }
  if (nomination.nominatedMemberId !== actor.id) {
    throw new ForbiddenError("Only the nominated member can respond to this");
  }
  if (nomination.status !== "pending") {
    throw new ConflictError(`This nomination is already ${nomination.status}`);
  }

  const updated = await applyNominationResponse(nominationId, input.response);
  if (!updated) {
    throw new ConflictError("This nomination is no longer pending");
  }
  return updated;
}

// The one-click email path — public, no actor, no login. Each token
// was already issued bound to exactly one response (see
// sendNominationEmailIfPossible above), so consuming it is the only
// authorization this needs — the same "possessing the token is the
// proof" posture a magic link already relies on. Returns null (rather
// than throwing) for an invalid/expired/already-used token or a
// nomination that's no longer pending, so the public route can render
// one plain "that link didn't work" page for every such case without
// needing to distinguish why.
export async function respondToNominationByToken(rawToken: string) {
  const payload = await consumeActionToken<{ nominationId: string; response: NominationResponseKind }>(
    RESPONSE_TOKEN_KIND,
    rawToken,
  );
  if (!payload) {
    return null;
  }
  return applyNominationResponse(payload.nominationId, payload.response);
}

// Task detail view: every nomination against this task, any status —
// "declined requests stay visible to branch coordination" is
// join-requests.ts's own precedent (spec's Request to join), reused
// here as-is so a task's nomination history reads the same way.
export async function listNominationsForTask(actor: Member, taskId: string) {
  const [taskRow] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) {
    throw new NotFoundError("Task not found");
  }
  return db
    .select({
      nomination: taskNomination,
      nomineeName: member.name,
    })
    .from(taskNomination)
    .innerJoin(member, eq(taskNomination.nominatedMemberId, member.id))
    .where(eq(taskNomination.taskId, taskId))
    .orderBy(desc(taskNomination.createdAt));
}

// Dashboard: the nominee's own pending nominations, to respond to
// in-app as an alternative to the emailed one-click links.
export async function listMyPendingNominations(actor: Member) {
  return db
    .select({
      nomination: taskNomination,
      taskTitle: task.title,
      nominatorName: member.name,
    })
    .from(taskNomination)
    .innerJoin(task, eq(taskNomination.taskId, task.id))
    .innerJoin(member, eq(taskNomination.nominatedBy, member.id))
    .where(and(eq(taskNomination.nominatedMemberId, actor.id), eq(taskNomination.status, "pending")))
    .orderBy(desc(taskNomination.createdAt));
}

// Dashboard: "notifies the coordinator" (spec) once a nomination
// expires — this codebase's usual visible-flag-not-push posture, same
// as every other Dashboard section. Bounded to the 5 most recent, same
// precedent src/lib/emergency-access.ts's listEmergencyAccessActivity
// already set for a comparably unbounded-over-time feed.
export async function listMyExpiredNominations(actor: Member) {
  return db
    .select({
      nomination: taskNomination,
      taskTitle: task.title,
      nomineeName: member.name,
    })
    .from(taskNomination)
    .innerJoin(task, eq(taskNomination.taskId, task.id))
    .innerJoin(member, eq(taskNomination.nominatedMemberId, member.id))
    .where(and(eq(taskNomination.nominatedBy, actor.id), eq(taskNomination.status, "expired")))
    .orderBy(desc(taskNomination.respondedAt))
    .limit(5);
}

// Scheduled job (see src/instrumentation.ts). By construction, a
// `pending` nomination's assignment always still exists — the only
// ways to lose it (accept/decline/not_now, or a prior run of this same
// job) all flip status away from `pending` in the same transaction as
// the release, so this never needs to defensively handle "already
// released" the way a human-triggered path might.
export async function resolveTaskNominationDeadlines() {
  const due = await db
    .select({ id: taskNomination.id })
    .from(taskNomination)
    .where(and(eq(taskNomination.status, "pending"), lt(taskNomination.respondByDeadline, new Date())));

  let expired = 0;
  for (const row of due) {
    const updated = await applyNominationResponse(row.id, "expired");
    if (updated) expired++;
  }
  return { checked: due.length, expired };
}
