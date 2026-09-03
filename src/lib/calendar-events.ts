import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, calendarEvent, calendarEventInvite, cycle, member, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { dateBoundaryInput, isBoundaryDrifted, recomputeBoundary, toStoredBoundary, type DateBoundaryInput } from "./dates";

type Member = typeof memberTable.$inferSelect;
type CalendarEventRow = typeof calendarEvent.$inferSelect;

// See docs/spec.md's "Freestanding events." Reuses the exact
// absolute/relative date shape Phase's own boundaries use (Phase 39) —
// a CalendarEvent's anchor is always the Cycle, never a Phase, so this
// is `dateBoundaryInput` itself, not TaskMilestone's own 4-way variant.
const shareTargetSchema = z.enum(["personal", "branch", "community"]);

export const createCalendarEventInput = z
  .object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    cycleId: z.string().uuid().nullable().optional(),
    date: dateBoundaryInput,
    shareTarget: shareTargetSchema.optional(),
    sharedBranchId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.shareTarget !== "branch" || v.sharedBranchId, {
    message: "sharedBranchId is required when shareTarget is 'branch'",
  });
export type CreateCalendarEventInput = z.infer<typeof createCalendarEventInput>;

export const updateCalendarEventInput = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  cycleId: z.string().uuid().nullable().optional(),
  date: dateBoundaryInput.optional(),
  shareTarget: shareTargetSchema.optional(),
  sharedBranchId: z.string().uuid().nullable().optional(),
});
export type UpdateCalendarEventInput = z.infer<typeof updateCalendarEventInput>;

async function requireCycleInCommunity(communityId: string, cycleId: string) {
  const [row] = await db
    .select({ id: cycle.id, startDate: cycle.startDate, endDate: cycle.endDate })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found in your community");
  }
  return row;
}

async function requireBranchInCommunity(communityId: string, branchId: string) {
  const [row] = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.id, branchId), eq(branch.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Branch not found in your community");
  }
}

async function dateColumns(communityId: string, cycleId: string | null | undefined, date: DateBoundaryInput) {
  let anchorStart: string | null = null;
  let anchorEnd: string | null = null;
  if (cycleId) {
    const cycleRow = await requireCycleInCommunity(communityId, cycleId);
    anchorStart = cycleRow.startDate;
    anchorEnd = cycleRow.endDate;
  }
  const boundary = toStoredBoundary(date, anchorStart, anchorEnd);
  return {
    dateType: boundary.dateType,
    date: boundary.date,
    relativeMode: boundary.relativeMode,
    anchorType: boundary.offsetAnchor,
    offsetDays: boundary.offsetDays,
    percent: boundary.percent,
  };
}

async function requireEvent(actor: Member, eventId: string): Promise<CalendarEventRow> {
  const [row] = await db
    .select()
    .from(calendarEvent)
    .where(and(eq(calendarEvent.id, eventId), eq(calendarEvent.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Event not found");
  }
  return row;
}

function requireOwner(actor: Member, event: CalendarEventRow) {
  if (event.memberId !== actor.id) {
    throw new ForbiddenError("Only this event's creator can do this");
  }
}

// "Bulk-invite a whole Branch's current roster" — no real Branch
// roster/membership table exists in this codebase (see docs/spec.md's
// Branch section and src/lib/composition.ts's own comment on why
// Branch spread is a holdings count, not a roster). Resolved the same
// way Phase 24's own Branch-spread metric already did: the distinct
// members currently holding a real (non-shadow, not-done) task in that
// Branch — the only honest, queryable stand-in for "who's in this
// Branch" this schema can produce without inventing new tracked state.
// Exported since Phase 53's `branch`-scoped targeted messages reuse
// this exact definition rather than re-deriving it a third time.
export async function branchRosterMemberIds(communityId: string, branchId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.communityId, communityId),
        eq(task.branchId, branchId),
        eq(taskAssignment.isShadow, false),
        ne(task.status, "done"),
      ),
    );
  return rows.map((r) => r.memberId);
}

// Fans out invite rows to every id in `targetMemberIds`, skipping the
// event's own creator and anyone who already has an invite row (any
// status) — a decline stands rather than being silently re-asked, and
// re-running a bulk invite is naturally idempotent. Never throws for
// an individual skip; this is the bulk path, not inviteMember's own
// single-target one (which does reject a genuine duplicate).
async function fanOutInvites(event: CalendarEventRow, actor: Member, targetMemberIds: string[]) {
  if (targetMemberIds.length === 0) return;

  const existing = await db
    .select({ memberId: calendarEventInvite.memberId })
    .from(calendarEventInvite)
    .where(eq(calendarEventInvite.eventId, event.id));
  const alreadyInvited = new Set(existing.map((r) => r.memberId));

  const toInvite = [...new Set(targetMemberIds)].filter((id) => id !== event.memberId && !alreadyInvited.has(id));
  if (toInvite.length === 0) return;

  await db.insert(calendarEventInvite).values(
    toInvite.map((memberId) => ({ eventId: event.id, memberId, invitedBy: actor.id })),
  );
}

// A CalendarEvent has exactly one owner, its creator, always — no
// approval step anywhere in this flow (docs/spec.md). shareTarget's
// initial fan-out happens here, in the same act as setting it; further
// invites (individual, or a repeat bulk pass to catch new members) are
// separate, explicitly-triggered actions below — see
// inviteMemberToCalendarEvent and friends. Updating shareTarget later
// via updateCalendarEvent does NOT itself re-fan-out, to keep "editing
// a field" and "sharing" as two distinct, predictable actions.
export async function createCalendarEvent(actor: Member, rawInput: CreateCalendarEventInput) {
  const input = createCalendarEventInput.parse(rawInput);
  if (input.sharedBranchId) {
    await requireBranchInCommunity(actor.communityId, input.sharedBranchId);
  }
  const columns = await dateColumns(actor.communityId, input.cycleId, input.date);

  const [created] = await db
    .insert(calendarEvent)
    .values({
      communityId: actor.communityId,
      memberId: actor.id,
      cycleId: input.cycleId ?? null,
      shareTarget: input.shareTarget ?? "personal",
      sharedBranchId: input.shareTarget === "branch" ? (input.sharedBranchId ?? null) : null,
      title: input.title,
      description: input.description ?? null,
      ...columns,
    })
    .returning();

  if (created.shareTarget === "branch" && created.sharedBranchId) {
    await fanOutInvites(created, actor, await branchRosterMemberIds(actor.communityId, created.sharedBranchId));
  } else if (created.shareTarget === "community") {
    const members = await db.select({ id: member.id }).from(member).where(eq(member.communityId, actor.communityId));
    await fanOutInvites(created, actor, members.map((m) => m.id));
  }

  return created;
}

export async function updateCalendarEvent(actor: Member, eventId: string, rawInput: UpdateCalendarEventInput) {
  const input = updateCalendarEventInput.parse(rawInput);
  const existing = await requireEvent(actor, eventId);
  requireOwner(actor, existing);

  if (input.sharedBranchId) {
    await requireBranchInCommunity(actor.communityId, input.sharedBranchId);
  }

  const nextCycleId = input.cycleId !== undefined ? input.cycleId : existing.cycleId;
  const columns = input.date ? await dateColumns(actor.communityId, nextCycleId, input.date) : undefined;

  const nextShareTarget = input.shareTarget ?? existing.shareTarget;

  const [updated] = await db
    .update(calendarEvent)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.cycleId !== undefined && { cycleId: input.cycleId }),
      ...(columns ?? {}),
      ...(input.shareTarget !== undefined && { shareTarget: input.shareTarget }),
      ...((input.sharedBranchId !== undefined || input.shareTarget !== undefined) && {
        // Recomputed whenever either field moves, not just sharedBranchId
        // on its own — otherwise switching shareTarget away from
        // 'branch' without also explicitly clearing sharedBranchId
        // would leave a stale Branch reference on a non-branch event.
        sharedBranchId: nextShareTarget === "branch" ? (input.sharedBranchId ?? existing.sharedBranchId) : null,
      }),
    })
    .where(eq(calendarEvent.id, eventId))
    .returning();
  return updated;
}

export async function deleteCalendarEvent(actor: Member, eventId: string) {
  const existing = await requireEvent(actor, eventId);
  requireOwner(actor, existing);

  await db.transaction(async (tx) => {
    await tx.delete(calendarEventInvite).where(eq(calendarEventInvite.eventId, eventId));
    await tx.delete(calendarEvent).where(eq(calendarEvent.id, eventId));
  });
}

export interface CalendarEventResolution {
  drifted: boolean;
}

function resolveEventFlags(event: CalendarEventRow, anchorStart: string | null, anchorEnd: string | null): CalendarEventResolution {
  return {
    drifted: isBoundaryDrifted(
      {
        dateType: event.dateType,
        date: event.date,
        relativeMode: event.relativeMode,
        offsetAnchor: event.anchorType,
        offsetDays: event.offsetDays,
        percent: event.percent,
      },
      anchorStart,
      anchorEnd,
    ),
  };
}

async function withFlags(event: CalendarEventRow) {
  if (!event.cycleId) return { ...event, drifted: false };
  const [cycleRow] = await db.select({ startDate: cycle.startDate, endDate: cycle.endDate }).from(cycle).where(eq(cycle.id, event.cycleId));
  return { ...event, ...resolveEventFlags(event, cycleRow?.startDate ?? null, cycleRow?.endDate ?? null) };
}

// Visible to its creator always; to anyone with an invite (any status,
// so a decline can still be seen/reviewed by the invitee themselves);
// and, for a `community`-shared event, to any member at all — see
// docs/spec.md's "personal = visible only to the creator... branch/
// community" framing, read as implying the other two are visible
// beyond just the creator. A `branch`-shared event stays invite-only
// for viewing (same reasoning inviteBranchRosterToCalendarEvent's own
// comment gives for why there's no real roster to check against).
export async function getCalendarEvent(actor: Member, eventId: string) {
  const event = await requireEvent(actor, eventId);
  if (event.memberId === actor.id || event.shareTarget === "community") {
    return withFlags(event);
  }
  const [invite] = await db
    .select({ id: calendarEventInvite.id })
    .from(calendarEventInvite)
    .where(and(eq(calendarEventInvite.eventId, eventId), eq(calendarEventInvite.memberId, actor.id)));
  if (!invite) {
    throw new NotFoundError("Event not found");
  }
  return withFlags(event);
}

// A member's own calendar — events they created, plus events they've
// actually accepted ("accepting is what actually puts the event on
// that member's own calendar" — docs/spec.md). A still-pending invite
// is surfaced separately, see listMyCalendarEventInvites below.
export async function listMyCalendarEvents(actor: Member) {
  const created = await db.select().from(calendarEvent).where(eq(calendarEvent.memberId, actor.id));
  const acceptedRows = await db
    .select({ event: calendarEvent })
    .from(calendarEventInvite)
    .innerJoin(calendarEvent, eq(calendarEvent.id, calendarEventInvite.eventId))
    .where(and(eq(calendarEventInvite.memberId, actor.id), eq(calendarEventInvite.status, "confirmed")));

  const byId = new Map(created.map((e) => [e.id, e]));
  for (const { event } of acceptedRows) {
    byId.set(event.id, event);
  }
  return Promise.all([...byId.values()].map(withFlags));
}

// The Dashboard feed helper — "a still-pending invite surfaces on the
// invitee's Dashboard" (docs/spec.md), the same "read live state, never
// a separately-maintained to-do list" posture Phase 38's own
// listMyPlacementInvites already established.
export async function listMyCalendarEventInvites(actor: Member) {
  return db
    .select({
      eventId: calendarEventInvite.eventId,
      eventTitle: calendarEvent.title,
      invitedByName: member.name,
      invitedAt: calendarEventInvite.invitedAt,
    })
    .from(calendarEventInvite)
    .innerJoin(calendarEvent, eq(calendarEvent.id, calendarEventInvite.eventId))
    .innerJoin(member, eq(member.id, calendarEventInvite.invitedBy))
    .where(and(eq(calendarEventInvite.memberId, actor.id), eq(calendarEventInvite.status, "invited")));
}

// Creator-only — the full roster for managing an event, invited or
// otherwise responded.
export async function listCalendarEventInvites(actor: Member, eventId: string) {
  const event = await requireEvent(actor, eventId);
  requireOwner(actor, event);
  return db
    .select({ invite: calendarEventInvite, memberName: member.name })
    .from(calendarEventInvite)
    .innerJoin(member, eq(member.id, calendarEventInvite.memberId))
    .where(eq(calendarEventInvite.eventId, eventId));
}

// "The creator can invite more people at any time" — a single named
// individual, available regardless of the event's own shareTarget.
export async function inviteMemberToCalendarEvent(actor: Member, eventId: string, memberId: string) {
  const event = await requireEvent(actor, eventId);
  requireOwner(actor, event);

  const [memberRow] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.communityId, actor.communityId)));
  if (!memberRow) {
    throw new NotFoundError("Member not found in your community");
  }
  if (memberId === actor.id) {
    throw new AppError("The creator doesn't need an invite to their own event");
  }

  const [existingInvite] = await db
    .select({ id: calendarEventInvite.id })
    .from(calendarEventInvite)
    .where(and(eq(calendarEventInvite.eventId, eventId), eq(calendarEventInvite.memberId, memberId)));
  if (existingInvite) {
    throw new ConflictError("This member has already been invited");
  }

  const [created] = await db
    .insert(calendarEventInvite)
    .values({ eventId, memberId, invitedBy: actor.id })
    .returning();
  return created;
}

// Re-triggerable at any time — catches anyone who's newly holding a
// task in the Branch since the last invite pass; already-invited or
// already-declined members are silently skipped (see fanOutInvites).
export async function inviteBranchRosterToCalendarEvent(actor: Member, eventId: string, branchId: string) {
  const event = await requireEvent(actor, eventId);
  requireOwner(actor, event);
  await requireBranchInCommunity(actor.communityId, branchId);
  await fanOutInvites(event, actor, await branchRosterMemberIds(actor.communityId, branchId));
}

export async function inviteCommunityToCalendarEvent(actor: Member, eventId: string) {
  const event = await requireEvent(actor, eventId);
  requireOwner(actor, event);
  const members = await db.select({ id: member.id }).from(member).where(eq(member.communityId, actor.communityId));
  await fanOutInvites(event, actor, members.map((m) => m.id));
}

export async function acceptCalendarEventInvite(actor: Member, eventId: string) {
  const [row] = await db
    .select()
    .from(calendarEventInvite)
    .where(and(eq(calendarEventInvite.eventId, eventId), eq(calendarEventInvite.memberId, actor.id)));
  if (!row || row.status !== "invited") {
    throw new NotFoundError("No pending invite found for you on this event");
  }
  const [updated] = await db
    .update(calendarEventInvite)
    .set({ status: "confirmed", respondedAt: new Date() })
    .where(and(eq(calendarEventInvite.eventId, eventId), eq(calendarEventInvite.memberId, actor.id)))
    .returning();
  return updated;
}

// Declining just drops it, no explanation required — same as declining
// a Placement invite (docs/spec.md). Unlike Placement, the row itself
// stays (status: declined) rather than being deleted — see
// src/db/schema/calendar-event.ts's own comment on why.
export async function declineCalendarEventInvite(actor: Member, eventId: string) {
  const [row] = await db
    .select()
    .from(calendarEventInvite)
    .where(and(eq(calendarEventInvite.eventId, eventId), eq(calendarEventInvite.memberId, actor.id)));
  if (!row || row.status !== "invited") {
    throw new NotFoundError("No pending invite found for you on this event");
  }
  const [updated] = await db
    .update(calendarEventInvite)
    .set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(calendarEventInvite.eventId, eventId), eq(calendarEventInvite.memberId, actor.id)))
    .returning();
  return updated;
}

// Called whenever the anchor Cycle's own start_date/end_date change
// (see src/lib/cycles/crud.ts's updateCycleSettings) — the same
// cascading-recompute posture Phase 39 already established for Phase's
// own boundaries, since CalendarEvent.date is cached the same way.
export async function recomputeCalendarEventDatesForCycle(
  cycleId: string,
  anchorStart: string | null,
  anchorEnd: string | null,
) {
  const events = await db.select().from(calendarEvent).where(eq(calendarEvent.cycleId, cycleId));
  for (const e of events) {
    const recomputed = recomputeBoundary(
      {
        dateType: e.dateType,
        date: e.date,
        relativeMode: e.relativeMode,
        offsetAnchor: e.anchorType,
        offsetDays: e.offsetDays,
        percent: e.percent,
      },
      anchorStart,
      anchorEnd,
    );
    if (recomputed.date === e.date) continue;
    await db.update(calendarEvent).set({ date: recomputed.date }).where(eq(calendarEvent.id, e.id));
  }
}
