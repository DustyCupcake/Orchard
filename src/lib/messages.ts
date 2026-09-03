import { and, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  branch,
  community,
  member,
  memberIdentity,
  outboundMessage,
  participation,
  task,
  taskAssignment,
} from "@/db/schema";
import type { member as memberTable, outboundMessage as outboundMessageTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { isCoordinationHolder, listCoordinationBranchIds } from "./coordination";
import { requireCycleInitiationEligibility } from "./cycles";
import { getCurrentCycle } from "./profile-questions";
import { branchRosterMemberIds } from "./calendar-events";
import { sendOutboundMessageEmail } from "./mailer";

type Member = typeof memberTable.$inferSelect;
type OutboundMessageRow = typeof outboundMessageTable.$inferSelect;
type OutboundMessageScope = OutboundMessageRow["scope"];

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "Sending an announcement is itself a task on the board... whoever
// holds that task can send" — same "the task is the authority" check
// isEventSchedulingOwner/isBudgetOwner already establish, baked into
// this module rather than left to each caller.
export async function isAnnouncementTaskHolder(actor: Member): Promise<boolean> {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.announcementTaskId) return false;

  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.id, communityRow.announcementTaskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function requireAnnouncementTaskHolder(actor: Member) {
  if (!(await isAnnouncementTaskHolder(actor))) {
    throw new ForbiddenError("Only the current announcement-task holder can do this");
  }
}

// The live recipient-resolution this module's schema comment promises
// — "never a stored roster." Used both to actually deliver a send and,
// later, to decide whether a given viewer belongs in a targeted
// message's own read-visibility check. Deliberately takes no `actor`:
// this is a pure "who does this scope currently mean," the authority
// check for *sending* lives in resolveScopeForSend below.
export async function resolveRecipientMemberIds(
  communityId: string,
  scope: OutboundMessageScope,
  scopeRef: unknown,
): Promise<string[]> {
  switch (scope) {
    case "branch": {
      const { branchId } = scopeRef as { branchId: string };
      return branchRosterMemberIds(communityId, branchId);
    }
    case "task_holders": {
      const { taskId } = scopeRef as { taskId: string };
      const rows = await db
        .select({ memberId: taskAssignment.memberId })
        .from(taskAssignment)
        .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.isShadow, false)));
      return rows.map((r) => r.memberId);
    }
    case "arrival_window": {
      const { cycleId, start, end } = scopeRef as { cycleId: string; start: string; end: string };
      // "Arrival window" reads as being about the arrival event
      // itself, not full-stay overlap with departure too — a member
      // with no declared arrival date can't honestly be said to be
      // arriving in any particular window, and one who's declared
      // `not_coming` shouldn't get a "welcome" message regardless of
      // any leftover stale date, so both are excluded rather than only
      // gated by the date range.
      const rows = await db
        .select({ memberId: participation.memberId })
        .from(participation)
        .where(
          and(
            eq(participation.cycleId, cycleId),
            inArray(participation.status, ["coming", "maybe"]),
            isNotNull(participation.arrivalDate),
            gte(participation.arrivalDate, start),
            lte(participation.arrivalDate, end),
          ),
        );
      return rows.map((r) => r.memberId);
    }
    case "community": {
      const rows = await db.select({ id: member.id }).from(member).where(eq(member.communityId, communityId));
      return rows.map((r) => r.id);
    }
  }
}

export const sendMessageInput = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("branch"),
    branchId: z.string().uuid(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    scope: z.literal("task_holders"),
    taskId: z.string().uuid(),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    scope: z.literal("arrival_window"),
    start: z.string().min(1),
    end: z.string().min(1),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  z.object({
    scope: z.literal("community"),
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
]);
export type SendMessageInput = z.infer<typeof sendMessageInput>;

// Checks the sender's own authority for the requested scope (a real
// 403 if they lack it) and resolves the concrete scopeRef + recipient
// set together, since deriving one basically requires the other
// anyway (e.g. task_holders needs the task row regardless).
async function resolveScopeForSend(
  actor: Member,
  input: SendMessageInput,
): Promise<{ scopeRef: Record<string, unknown>; recipientIds: string[] }> {
  if (input.scope === "branch") {
    const [branchRow] = await db
      .select({ id: branch.id })
      .from(branch)
      .where(and(eq(branch.id, input.branchId), eq(branch.communityId, actor.communityId)));
    if (!branchRow) {
      throw new NotFoundError("Branch not found in your community");
    }
    if (!(await isCoordinationHolder(actor, input.branchId))) {
      throw new ForbiddenError("Only that branch's coordination holder can message it");
    }
    const scopeRef = { branchId: input.branchId };
    const recipientIds = await resolveRecipientMemberIds(actor.communityId, "branch", scopeRef);
    return { scopeRef, recipientIds: recipientIds.filter((id) => id !== actor.id) };
  }

  if (input.scope === "task_holders") {
    const [taskRow] = await db
      .select({ id: task.id, communityId: task.communityId })
      .from(task)
      .where(eq(task.id, input.taskId));
    if (!taskRow || taskRow.communityId !== actor.communityId) {
      throw new NotFoundError("Task not found in your community");
    }
    const [holding] = await db
      .select({ taskId: taskAssignment.taskId })
      .from(taskAssignment)
      .where(
        and(
          eq(taskAssignment.taskId, input.taskId),
          eq(taskAssignment.memberId, actor.id),
          eq(taskAssignment.isShadow, false),
        ),
      );
    if (!holding) {
      throw new ForbiddenError("Only a current holder of this task can message its co-holders");
    }
    const scopeRef = { taskId: input.taskId };
    const recipientIds = await resolveRecipientMemberIds(actor.communityId, "task_holders", scopeRef);
    return { scopeRef, recipientIds: recipientIds.filter((id) => id !== actor.id) };
  }

  if (input.scope === "arrival_window") {
    await requireCycleInitiationEligibility(actor);
    const currentCycle = await getCurrentCycle(actor.communityId);
    if (!currentCycle) {
      throw new ConflictError("No current cycle to declare an arrival window against");
    }
    if (input.end < input.start) {
      throw new ConflictError("End date must be on or after the start date");
    }
    const scopeRef = { cycleId: currentCycle.id, start: input.start, end: input.end };
    const recipientIds = await resolveRecipientMemberIds(actor.communityId, "arrival_window", scopeRef);
    return { scopeRef, recipientIds: recipientIds.filter((id) => id !== actor.id) };
  }

  // "community"
  await requireAnnouncementTaskHolder(actor);
  const scopeRef = {};
  const recipientIds = await resolveRecipientMemberIds(actor.communityId, "community", scopeRef);
  return { scopeRef, recipientIds: recipientIds.filter((id) => id !== actor.id) };
}

// Best-effort, per-recipient — a missing identity, an opted-out
// member, or one failed send never blocks the others, since this is
// now a genuine many-recipient batch rather than Phase 51's own
// single-nominee send. The OutboundMessage row itself already stands
// by the time this runs regardless of how delivery goes.
async function deliverToRecipients(recipientIds: string[], senderName: string, subject: string, body: string) {
  if (recipientIds.length === 0) return;

  const members = await db
    .select({ id: member.id, emailNotificationsEnabled: member.emailNotificationsEnabled })
    .from(member)
    .where(inArray(member.id, recipientIds));
  const enabledIds = members.filter((m) => m.emailNotificationsEnabled).map((m) => m.id);
  if (enabledIds.length === 0) return;

  const identities = await db
    .select({ loginEmail: memberIdentity.loginEmail })
    .from(memberIdentity)
    .where(inArray(memberIdentity.memberId, enabledIds));

  await Promise.allSettled(
    identities.map((i) => sendOutboundMessageEmail(i.loginEmail, { senderName, subject, body })),
  );
}

// "Every send resolves its recipient set live at send time... and
// logs itself, per spec's 'all outbound messages get logged either
// way'" — see docs/development-plan.md's Phase 53.
export async function sendOutboundMessage(actor: Member, rawInput: SendMessageInput) {
  const input = sendMessageInput.parse(rawInput);
  const { scopeRef, recipientIds } = await resolveScopeForSend(actor, input);

  const [created] = await db
    .insert(outboundMessage)
    .values({
      communityId: actor.communityId,
      sentBy: actor.id,
      scope: input.scope,
      scopeRef,
      subject: input.subject,
      body: input.body,
    })
    .returning();

  await deliverToRecipients(recipientIds, actor.name, input.subject, input.body);

  return created;
}

// "An announcement's log visible to everyone... a targeted message's
// log visible only to its sender and recipients" — recomputes each
// targeted row's live audience the same way sending itself does,
// rather than trusting anything stored, since this module never
// stores a roster.
export async function listOutboundMessagesVisibleTo(actor: Member): Promise<OutboundMessageRow[]> {
  const rows = await db
    .select()
    .from(outboundMessage)
    .where(eq(outboundMessage.communityId, actor.communityId))
    .orderBy(desc(outboundMessage.sentAt));

  const visible: OutboundMessageRow[] = [];
  for (const row of rows) {
    if (row.sentBy === actor.id || row.scope === "community") {
      visible.push(row);
      continue;
    }
    const recipientIds = await resolveRecipientMemberIds(actor.communityId, row.scope, row.scopeRef);
    if (recipientIds.includes(actor.id)) {
      visible.push(row);
    }
  }
  return visible;
}

// UI-gating helpers — which scope-specific forms /messages should even
// offer this actor, without duplicating resolveScopeForSend's own
// authority checks.
export async function listMyCoordinatedBranches(actor: Member) {
  const branchIds = await listCoordinationBranchIds(actor);
  if (branchIds.size === 0) return [];
  return db
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(inArray(branch.id, [...branchIds]));
}

export async function listMyHeldTasksForMessaging(actor: Member) {
  return db
    .select({ id: task.id, title: task.title })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, actor.communityId),
      ),
    )
    .orderBy(task.title);
}
