import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  callSummary,
  callSummaryRead,
  community,
  engagementEvent,
  member,
  schedulingEntry,
  schedulingPoll,
  task,
  taskAssignment,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { listCoordinationBranchIds } from "./coordination";

type Member = typeof memberTable.$inferSelect;
type EngagementEventKind = "task_nomination_expired" | "nudge_ignored" | "call_summary_unread_past_window";

// The one write side of the record — see src/db/schema/engagement-
// event.ts's own comment for the three real, already-produced non-
// response kinds this logs. Takes a plain db/Tx so it composes inside
// whichever caller's own transaction (nominations.ts's) or plain write
// (attention/job.ts's, call.ts's) without forcing a shape on either.
export async function logEngagementEvent(
  executor: Tx | typeof db,
  memberId: string,
  kind: EngagementEventKind,
  taskId?: string | null,
) {
  await executor.insert(engagementEvent).values({ memberId, kind, taskId: taskId ?? null });
}

// "The pattern resets once the person responds and re-engages" — a
// global reset, not per-kind (docs/development-plan.md's Phase 52):
// every one of this member's still-open rows, regardless of kind,
// resolves at once the moment they take any of the real response
// actions this system tracks (resuming/releasing an overdue Waiting
// task, responding to a nomination, marking a call summary read — see
// each call site for exactly which action counts and why).
export async function resolveEngagementForMember(executor: Tx | typeof db, memberId: string) {
  await executor
    .update(engagementEvent)
    .set({ resolvedAt: new Date() })
    .where(and(eq(engagementEvent.memberId, memberId), isNull(engagementEvent.resolvedAt)));
}

export type EngagementPatternLevel = "none" | "noted" | "soft_flag" | "pattern";

function levelForCount(count: number, softFlagThreshold: number, patternThreshold: number): EngagementPatternLevel {
  if (count >= patternThreshold) return "pattern";
  if (count >= softFlagThreshold) return "soft_flag";
  if (count >= 1) return "noted";
  return "none";
}

// Live-computed, never stored — same "count what's open" posture
// every other derived status in this codebase already uses (Budget's
// running totals, Recruitment's pipeline stage, ...).
export async function computeEngagementPattern(
  memberId: string,
  communityId: string,
): Promise<{ level: EngagementPatternLevel; openCount: number }> {
  const [communityRow] = await db.select().from(community).where(eq(community.id, communityId));
  const softFlagThreshold = communityRow?.engagementSoftFlagThreshold ?? 2;
  const patternThreshold = communityRow?.engagementPatternThreshold ?? 3;

  const open = await db
    .select({ id: engagementEvent.id })
    .from(engagementEvent)
    .where(and(eq(engagementEvent.memberId, memberId), isNull(engagementEvent.resolvedAt)));

  return { level: levelForCount(open.length, softFlagThreshold, patternThreshold), openCount: open.length };
}

// Coordination view: "a branch coordination-task holder sees the
// pattern for members whose tasks they coordinate — access-follows-
// the-task, same as every other coordination surface here." Only
// members with a real, non-"none" pattern are returned — surfacing a
// problem, not a full roster status board, the same "signal, not
// noise" posture every other needs-action list in this codebase
// already takes.
export async function listEngagementPatternsForCoordinator(actor: Member) {
  const branchIds = await listCoordinationBranchIds(actor);
  if (branchIds.size === 0) return [];

  const holders = await db
    .selectDistinct({ memberId: taskAssignment.memberId, memberName: member.name })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .innerJoin(member, eq(taskAssignment.memberId, member.id))
    .where(
      and(
        inArray(task.branchId, [...branchIds]),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, actor.communityId),
      ),
    );
  if (holders.length === 0) return [];

  const results = await Promise.all(
    holders.map(async (h) => ({
      memberId: h.memberId,
      memberName: h.memberName,
      ...(await computeEngagementPattern(h.memberId, actor.communityId)),
    })),
  );
  return results.filter((r) => r.level !== "none");
}

// Scheduled job (see src/instrumentation.ts) — the one genuinely new
// detection this phase adds (Phase 19's CallSummaryRead never
// previously tracked "past window", only who's read it so far).
// Checks each published, require_read summary exactly once,
// engagementCheckedAt days after publishedAt — see
// src/db/schema/call.ts's own comment on why a one-shot check (not a
// continuous rescan) is the right shape here, same as Phase 48's
// subscriptionLapseProcessedAt.
export async function logCallSummaryUnreadEngagementEvents() {
  const due = await db
    .select({
      summaryId: callSummary.id,
      pollId: callSummary.pollId,
      publishedAt: callSummary.publishedAt,
      communityId: schedulingPoll.communityId,
    })
    .from(callSummary)
    .innerJoin(schedulingPoll, eq(callSummary.pollId, schedulingPoll.id))
    .where(
      and(
        eq(schedulingPoll.requireRead, true),
        isNull(callSummary.engagementCheckedAt),
        isNotNull(callSummary.publishedAt),
      ),
    );

  let checked = 0;
  let logged = 0;
  for (const row of due) {
    if (!row.publishedAt) continue;
    const [communityRow] = await db.select().from(community).where(eq(community.id, row.communityId));
    const windowDays = communityRow?.callSummaryReadWindowDays ?? 3;
    const dueAt = new Date(row.publishedAt.getTime() + windowDays * 86_400_000);
    if (dueAt > new Date()) continue;

    // "The call's audience" — same population recordAttendance/read-
    // tracking already use: whoever submitted availability for the
    // poll (see src/lib/scheduling-polls/call.ts's own comment on why,
    // no real Branch-membership roster exists to read from instead).
    const audience = await db
      .select({ memberId: schedulingEntry.memberId })
      .from(schedulingEntry)
      .where(eq(schedulingEntry.pollId, row.pollId));
    const readers = await db
      .select({ memberId: callSummaryRead.memberId })
      .from(callSummaryRead)
      .where(eq(callSummaryRead.summaryId, row.summaryId));
    const readerIds = new Set(readers.map((r) => r.memberId));

    for (const a of audience) {
      if (a.memberId && !readerIds.has(a.memberId)) {
        await logEngagementEvent(db, a.memberId, "call_summary_unread_past_window");
        logged++;
      }
    }

    await db.update(callSummary).set({ engagementCheckedAt: new Date() }).where(eq(callSummary.id, row.summaryId));
    checked++;
  }

  return { checked, logged };
}
