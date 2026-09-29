import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  branch,
  coordinatorPing,
  cycle,
  member,
  task,
  taskAssignment,
  taskJoinRequest,
  taskNomination,
  taskSignal,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { listCoordinationScopeIds } from "../coordination";
import type { taskAttentionLevelEnum, taskStatusEnum } from "@/db/schema/task";

type Member = typeof memberTable.$inferSelect;

// The Coordination view's own reads — one module per question a
// coordinator actually opens the page to answer, rather than the two
// flat lists it started with (engagement patterns + availability, neither
// of them about a single task).
//
// Every query here is the same shape of scope: the actor's own
// coordination coverage (src/lib/coordination.ts's CoordinationCoverage)
// narrowed to the view-scope cycle the page is being read at, the same
// intersection listEscalatedTasks does for the escalated queue. A branch
// column and a cycle row are OR'd rather than intersected with each
// other — holding both is two overlapping authorities, and the tasks you
// can act on are the union of what you're accountable for.

export type CoordinationTaskStatus = (typeof taskStatusEnum)["enumValues"][number];
export type CoordinationAttentionLevel = (typeof taskAttentionLevelEnum)["enumValues"][number];

/**
 * The actor's coordination coverage narrowed to the cycle(s) the view
 * scope points at, as a single SQL condition.
 *
 * `reachesAnything: false` is the load-bearing half: an authority whose
 * only cycle isn't among the view's must get an empty segment rather than
 * another cycle's rows (docs/cycle-scope-remediation-plan.md §2.1's
 * strict rule), and `condition: undefined` is overloaded to mean "match
 * everything" for a community-wide coordinator, so callers must check
 * `reachesAnything` before trusting an empty result.
 */
async function scopedTaskCondition(
  actor: Member,
  viewCycleIds: string[],
): Promise<{ condition: SQL | undefined; reachesAnything: boolean }> {
  const { communityWide, branchIds, cycleIds } = await listCoordinationScopeIds(actor);
  if (communityWide) return { condition: undefined, reachesAnything: true };

  const parts: SQL[] = [];
  if (branchIds.size > 0) parts.push(inArray(task.branchId, [...branchIds]));
  const view = new Set(viewCycleIds);
  for (const cid of cycleIds) {
    if (view.has(cid)) parts.push(eq(task.cycleId, cid));
  }
  if (parts.length === 0) return { condition: undefined, reachesAnything: false };
  return { condition: or(...parts)!, reachesAnything: true };
}

export interface CoordinationScopeTask {
  id: string;
  title: string;
  status: CoordinationTaskStatus;
  attentionLevel: CoordinationAttentionLevel;
  critical: boolean;
  capacity: number | null;
  holderCount: number;
  holderNames: string[];
  branchId: string;
  branchName: string;
  cycleId: string | null;
  cycleName: string | null;
  nextCheckinAt: Date | null;
  waitingNote: string | null;
  statusChangedAt: Date;
  suggestedMemberId: string | null;
  suggestedMemberName: string | null;
}

export interface CoordinationTaskCounts {
  total: number;
  unclaimed: number;
  claimed: number;
  waiting: number;
  done: number;
  /** Attention other than ok — the number a coordinator acts on. */
  flagged: number;
  /** Unclaimed AND flagged: genuinely stuck, the worst overlap. */
  stuck: number;
}

export function emptyCoordinationCounts(): CoordinationTaskCounts {
  return { total: 0, unclaimed: 0, claimed: 0, waiting: 0, done: 0, flagged: 0, stuck: 0 };
}

// The headline module: "status of the tasks in the coordination task's
// scope". Counts are derived from the rows the list needs anyway, so the
// summary above a list can never disagree with the list — a dashboard
// that says "3 unclaimed" over a list of 4 is one nobody trusts twice.
export async function listCoordinationScopeTasks(actor: Member, viewCycleIds: string[]) {
  const { condition, reachesAnything } = await scopedTaskCondition(actor, viewCycleIds);
  if (!reachesAnything) return { tasks: [] as CoordinationScopeTask[], counts: emptyCoordinationCounts() };

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      status: task.status,
      attentionLevel: task.attentionLevel,
      critical: task.critical,
      capacity: task.capacity,
      branchId: task.branchId,
      branchName: branch.name,
      cycleId: task.cycleId,
      cycleName: cycle.name,
      nextCheckinAt: task.nextCheckinAt,
      waitingNote: task.waitingNote,
      statusChangedAt: task.statusChangedAt,
      suggestedMemberId: task.suggestedMemberId,
    })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .leftJoin(cycle, eq(task.cycleId, cycle.id))
    .where(and(eq(task.communityId, actor.communityId), condition))
    .orderBy(asc(task.title));

  const tasks: CoordinationScopeTask[] = rows.length === 0 ? [] : await withHoldersAndSuggestions(rows);

  return { tasks, counts: countCoordinationTasks(tasks) };
}

// Two batch lookups rather than a join that would fan the task rows out
// per holder — a task with three holders would otherwise come back three
// times and be counted three times in the summary. Generic over the
// caller's row shape so the two extra fields can be added to whatever the
// select() returned, rather than requiring it to be a full task row.
async function withHoldersAndSuggestions<Row extends { id: string; suggestedMemberId: string | null }>(
  rows: Row[],
): Promise<(Row & { holderCount: number; holderNames: string[]; suggestedMemberName: string | null })[]> {
  const suggestedIds = rows.map((r) => r.suggestedMemberId).filter((id): id is string => id !== null);
  const [assignments, suggestedMembers] = await Promise.all([
    db
      .select({
        taskId: taskAssignment.taskId,
        memberName: member.name,
      })
      .from(taskAssignment)
      .innerJoin(member, eq(taskAssignment.memberId, member.id))
      .where(
        and(
          // Real holders only — a shadow isn't who "held by" means and
          // doesn't count toward capacity, same as assignmentCount().
          eq(taskAssignment.isShadow, false),
          inArray(
            taskAssignment.taskId,
            rows.map((r) => r.id),
          ),
        ),
      ),
    suggestedIds.length > 0
      ? db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, suggestedIds))
      : Promise.resolve([]),
  ]);

  const byTask = new Map<string, string[]>();
  for (const a of assignments) {
    const list = byTask.get(a.taskId) ?? [];
    list.push(a.memberName);
    byTask.set(a.taskId, list);
  }
  const nameById = new Map(suggestedMembers.map((s) => [s.id, s.name]));

  return rows.map((r) => ({
    ...r,
    holderCount: (byTask.get(r.id) ?? []).length,
    holderNames: byTask.get(r.id) ?? [],
    suggestedMemberName: r.suggestedMemberId ? (nameById.get(r.suggestedMemberId) ?? null) : null,
  }));
}

export function countCoordinationTasks(tasks: CoordinationScopeTask[]): CoordinationTaskCounts {
  const counts = emptyCoordinationCounts();
  for (const t of tasks) {
    counts.total++;
    counts[t.status]++;
    if (t.attentionLevel !== "ok") counts.flagged++;
    if (t.status === "unclaimed" && t.attentionLevel !== "ok") counts.stuck++;
  }
  return counts;
}

// How much a coordinator should care, worst first. Critical-but-unowned
// outranks merely-old: it's the case coordination exists for, and putting
// a 90-day-old nobody-cares above a critical nobody's touching inverts
// the point of the queue.
function severity(t: Pick<CoordinationScopeTask, "attentionLevel" | "critical" | "status">): number {
  if (t.attentionLevel === "escalated") return 3;
  if (t.attentionLevel === "hard") return 2;
  if (t.critical && t.status === "unclaimed") return 1;
  return 0;
}

/** Unclaimed tasks, worst-first then longest-sitting. */
export function needsAnOwner(tasks: CoordinationScopeTask[]): CoordinationScopeTask[] {
  return tasks
    .filter((t) => t.status === "unclaimed")
    .sort(
      (a, b) =>
        severity(b) - severity(a) ||
        a.statusChangedAt.getTime() - b.statusChangedAt.getTime() ||
        a.title.localeCompare(b.title),
    );
}

/**
 * Flagged and still live. Done work keeps the attention level it earned
 * but isn't a queue — including it would put finished tasks above live
 * ones in the one list meant to be worked top-down.
 */
export function flaggedTasks(tasks: CoordinationScopeTask[]): CoordinationScopeTask[] {
  return tasks
    .filter((t) => t.attentionLevel !== "ok" && t.status !== "done")
    .sort((a, b) => severity(b) - severity(a) || a.statusChangedAt.getTime() - b.statusChangedAt.getTime());
}

export interface OverdueCheckin {
  id: string;
  title: string;
  branchName: string;
  holderName: string;
  nextCheckinAt: Date | null;
  waitingNote: string | null;
}

/**
 * Waiting tasks whose owner-set check-in date has passed *plus* the grace
 * window, i.e. the nudge went unanswered — same "forgiving of a missed
 * check-in, not indifferent to it" posture as the owner-set nudge itself
 * (docs/spec.md's Lifecycle & attention). Cut at `nextCheckinAt + grace`
 * rather than at the date itself, so a coordinator doesn't see a check-in
 * that was due an hour ago as overdue.
 */
export async function listOverdueCheckins(
  actor: Member,
  viewCycleIds: string[],
  graceDays: number,
): Promise<OverdueCheckin[]> {
  const { condition, reachesAnything } = await scopedTaskCondition(actor, viewCycleIds);
  if (!reachesAnything) return [];

  const cutoff = new Date(Date.now() - graceDays * 86_400_000);
  return db
    .select({
      id: task.id,
      title: task.title,
      branchName: branch.name,
      holderName: member.name,
      nextCheckinAt: task.nextCheckinAt,
      waitingNote: task.waitingNote,
    })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .innerJoin(taskAssignment, and(eq(taskAssignment.taskId, task.id), eq(taskAssignment.isShadow, false)))
    .innerJoin(member, eq(taskAssignment.memberId, member.id))
    .where(
      and(
        eq(task.communityId, actor.communityId),
        eq(task.status, "waiting"),
        isNotNull(task.nextCheckinAt),
        lt(task.nextCheckinAt, cutoff),
        condition,
      ),
    )
    .orderBy(task.nextCheckinAt);
}

export interface PendingSuggestion {
  id: string;
  title: string;
  branchName: string;
  suggestedMemberId: string | null;
  suggestedMemberName: string;
}

/**
 * Suggestions awaiting a coordinator's judgment — the bridge from "a
 * proposer named someone for this idea" to "does that look right, and
 * should I ask them?"
 *
 * A suggestion is only actionable while the task is genuinely open, so
 * this filters on exactly that: nobody holding it (a real, non-shadow
 * holder means the suggestion was acted on or overtaken) and no live
 * nomination against it (the ask has already been made). `task
 * .suggested_member_id` is written by proposal activation, cycle cloning
 * and recruitment, but read nowhere else in the app — this is the module
 * that makes it a signal rather than a column.
 */
export async function listPendingSuggestions(actor: Member, viewCycleIds: string[]): Promise<PendingSuggestion[]> {
  const { condition, reachesAnything } = await scopedTaskCondition(actor, viewCycleIds);
  if (!reachesAnything) return [];

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      branchName: branch.name,
      suggestedMemberId: task.suggestedMemberId,
    })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(
      and(
        eq(task.communityId, actor.communityId),
        isNotNull(task.suggestedMemberId),
        eq(task.status, "unclaimed"),
        condition,
      ),
    )
    .orderBy(asc(task.title));

  if (rows.length === 0) return [];
  const taskIds = rows.map((r) => r.id);

  const [nominated, held, suggestedMembers] = await Promise.all([
    db
      .selectDistinct({ taskId: taskNomination.taskId })
      .from(taskNomination)
      .where(
        and(
          inArray(taskNomination.taskId, taskIds),
          inArray(taskNomination.status, ["pending", "accepted"]),
        ),
      ),
    db
      .selectDistinct({ taskId: taskAssignment.taskId })
      .from(taskAssignment)
      .where(and(inArray(taskAssignment.taskId, taskIds), eq(taskAssignment.isShadow, false))),
    db
      .select({ id: member.id, name: member.name })
      .from(member)
      .where(
        inArray(
          member.id,
          rows.map((r) => r.suggestedMemberId).filter((id): id is string => id !== null),
        ),
      ),
  ]);

  const alreadyAsked = new Set(nominated.map((n) => n.taskId));
  const hasHolder = new Set(held.map((h) => h.taskId));
  const nameById = new Map(suggestedMembers.map((s) => [s.id, s.name]));

  return rows
    .filter((r) => !alreadyAsked.has(r.id) && !hasHolder.has(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title,
      branchName: r.branchName,
      suggestedMemberId: r.suggestedMemberId,
      suggestedMemberName: (r.suggestedMemberId ? nameById.get(r.suggestedMemberId) : null) ?? "a member",
    }));
}

export interface CoordinationResponseItem {
  id: string;
  taskId: string;
  taskTitle: string;
  detail: string;
  who: string | null;
  createdAt: Date;
}

export interface CoordinationResponseQueue {
  /** Anonymous signals on in-scope tasks, still unresolved. */
  signals: CoordinationResponseItem[];
  /** "Talk to my coordinator" pings on in-scope tasks, still unresolved. */
  pings: CoordinationResponseItem[];
  /** Declined request-to-join on in-scope tasks — spec's "a stalling
   *  task with a logged decline is a different situation than a stalling
   *  task nobody's offered to help with". */
  declinedRequests: CoordinationResponseItem[];
  /** Nominations this coordinator sent that nobody answered. */
  expiredNominations: CoordinationResponseItem[];
  total: number;
}

const SIGNAL_DETAIL: Record<string, string> = {
  stalled: "looks stalled",
  might_need_help: "owner might need help",
  something_feels_off: "something feels off",
  worth_a_look: "worth a coordinator look",
};
const PING_DETAIL = "would like to talk about this task";
const DECLINED_WITH_REASON = "asked to join — declined, with a reason";
const DECLINED_NO_REASON = "asked to join — declined";
const EXPIRED_DETAIL = "nomination went unanswered";

/**
 * The four things a coordinator is being waited on for. Four tables, one
 * call — the page needs all four to decide whether the module shows at
 * all, and four separate round-trips to decide "is there anything here?"
 * would be the same answer four times over.
 */
export async function listCoordinationResponseQueue(
  actor: Member,
  viewCycleIds: string[],
): Promise<CoordinationResponseQueue> {
  const { condition, reachesAnything } = await scopedTaskCondition(actor, viewCycleIds);
  if (!reachesAnything) {
    return { signals: [], pings: [], declinedRequests: [], expiredNominations: [], total: 0 };
  }

  const [signals, pings, declinedRequests, expiredNominations] = await Promise.all([
    db
      .select({
        id: taskSignal.id,
        taskId: taskSignal.taskId,
        taskTitle: task.title,
        kind: taskSignal.kind,
        createdAt: taskSignal.createdAt,
      })
      .from(taskSignal)
      .innerJoin(task, eq(taskSignal.taskId, task.id))
      .where(and(eq(task.communityId, actor.communityId), isNull(taskSignal.resolvedAt), condition))
      .orderBy(desc(taskSignal.createdAt)),

    db
      .select({
        id: coordinatorPing.id,
        taskId: coordinatorPing.taskId,
        taskTitle: task.title,
        who: member.name,
        createdAt: coordinatorPing.createdAt,
      })
      .from(coordinatorPing)
      .innerJoin(task, eq(coordinatorPing.taskId, task.id))
      .innerJoin(member, eq(coordinatorPing.requestedBy, member.id))
      .where(and(eq(task.communityId, actor.communityId), isNull(coordinatorPing.resolvedAt), condition))
      .orderBy(desc(coordinatorPing.createdAt)),

    db
      .select({
        id: taskJoinRequest.id,
        taskId: taskJoinRequest.taskId,
        taskTitle: task.title,
        who: member.name,
        declineReason: taskJoinRequest.declineReason,
        resolvedAt: taskJoinRequest.resolvedAt,
        requestedAt: taskJoinRequest.requestedAt,
      })
      .from(taskJoinRequest)
      .innerJoin(task, eq(taskJoinRequest.taskId, task.id))
      .innerJoin(member, eq(taskJoinRequest.memberId, member.id))
      .where(
        and(
          eq(task.communityId, actor.communityId),
          eq(taskJoinRequest.status, "declined"),
          // Only while the task is still going — a decline against a
          // finished task is history, not a stalling signal.
          inArray(task.status, ["unclaimed", "claimed", "waiting"]),
          condition,
        ),
      )
      .orderBy(desc(taskJoinRequest.resolvedAt)),

    db
      .select({
        id: taskNomination.id,
        taskId: taskNomination.taskId,
        taskTitle: task.title,
        who: member.name,
        respondedAt: taskNomination.respondedAt,
      })
      .from(taskNomination)
      .innerJoin(task, eq(taskNomination.taskId, task.id))
      .innerJoin(member, eq(taskNomination.nominatedMemberId, member.id))
      .where(
        and(
          eq(task.communityId, actor.communityId),
          eq(taskNomination.nominatedBy, actor.id),
          eq(taskNomination.status, "expired"),
          condition,
        ),
      )
      .orderBy(desc(taskNomination.respondedAt))
      .limit(20),
  ]);

  return {
    signals: signals.map((s) => ({
      id: s.id,
      taskId: s.taskId,
      taskTitle: s.taskTitle,
      detail: SIGNAL_DETAIL[s.kind] ?? s.kind,
      // Deliberately null: the signal is anonymous by design, and
      // resolving a name from anywhere would defeat that.
      who: null,
      createdAt: s.createdAt,
    })),
    pings: pings.map((p) => ({ ...p, detail: PING_DETAIL })),
    declinedRequests: declinedRequests.map((d) => ({
      id: d.id,
      taskId: d.taskId,
      taskTitle: d.taskTitle,
      detail: d.declineReason ? DECLINED_WITH_REASON : DECLINED_NO_REASON,
      who: d.who,
      createdAt: d.resolvedAt ?? d.requestedAt,
    })),
    expiredNominations: expiredNominations.map((n) => ({
      id: n.id,
      taskId: n.taskId,
      taskTitle: n.taskTitle,
      detail: EXPIRED_DETAIL,
      who: n.who,
      createdAt: n.respondedAt ?? new Date(0),
    })),
    total: signals.length + pings.length + declinedRequests.length + expiredNominations.length,
  };
}

export interface CoordinationCoverageSummary {
  communityWide: boolean;
  branches: { id: string; name: string }[];
  cycles: { id: string; name: string }[];
}

/**
 * Which branches and events the numbers on this page were computed over.
 * Community-wide is its own case rather than a long list, because it
 * genuinely is a different arrangement — one grant instead of one per
 * branch (src/lib/coordination.ts) — and a coordinator holding it should
 * see that it's wider than any enumeration of branches would suggest.
 */
export async function listCoordinationCoverage(actor: Member): Promise<CoordinationCoverageSummary> {
  const { communityWide, branchIds, cycleIds } = await listCoordinationScopeIds(actor);
  const [branchRows, cycleRows] = await Promise.all([
    branchIds.size > 0
      ? db.select({ id: branch.id, name: branch.name }).from(branch).where(inArray(branch.id, [...branchIds]))
      : Promise.resolve([] as { id: string; name: string }[]),
    cycleIds.size > 0
      ? db.select({ id: cycle.id, name: cycle.name }).from(cycle).where(inArray(cycle.id, [...cycleIds]))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  return { communityWide, branches: branchRows, cycles: cycleRows };
}
