import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { accompaniment, member, task, taskSuggestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

// docs/plans/accompaniment-plan.md §3.4. People suggested for a task, each with the reason.
// Nothing here assigns anyone: a suggestion is only ever something to ask about, with the
// reason shown so the asking can be kind. There is deliberately no order to the people — who
// is "best" is not something the platform has an opinion on.

export type SuggestionReason = (typeof taskSuggestion.$inferSelect)["reason"];

/** How a reason reads next to a person's name, to someone deciding whom to ask. */
export const SUGGESTION_REASON_LABEL: Record<SuggestionReason, string> = {
  said_yes: "said yes after the interview",
  invited: "invited them",
  supported: "vouched for them",
  proposed: "named when the task was proposed",
  shadowed: "shadowed this last time",
  suggested: "suggested",
};

/** How the same reason reads to the person it is about. */
export const SUGGESTION_REASON_TO_THEM: Record<SuggestionReason, string> = {
  said_yes: "you said yes after their interview",
  invited: "you invited them",
  supported: "you vouched for them",
  proposed: "you were named when the task was proposed",
  shadowed: "you shadowed this last time",
  suggested: "somebody thought you would fit",
};

export function joinReasons(reasons: SuggestionReason[], labels: Record<SuggestionReason, string>): string {
  return reasons.map((r) => labels[r]).join(", ");
}

export type SuggestionEntry = { taskId: string; memberId: string; reason: SuggestionReason };

/** Idempotent: the same person for the same reason on the same task is one suggestion. */
export async function addSuggestions(executor: DbOrTx, entries: SuggestionEntry[]) {
  if (entries.length === 0) return;
  await executor.insert(taskSuggestion).values(entries).onConflictDoNothing();
}

export type SuggestedPerson = { memberId: string; name: string; reasons: SuggestionReason[] };

/**
 * The people suggested for each of these tasks, one entry per person with all their reasons
 * together, in the order they were first suggested. Dismissals are not applied: a dismissal
 * is the person's own and hides only their own prompt (see `listMyAccompanyInvitations`).
 */
export async function listSuggestionsForTasks(taskIds: string[]): Promise<Map<string, SuggestedPerson[]>> {
  const out = new Map<string, SuggestedPerson[]>();
  if (taskIds.length === 0) return out;
  const rows = await db
    .select({ taskId: taskSuggestion.taskId, memberId: taskSuggestion.memberId, reason: taskSuggestion.reason, name: member.name })
    .from(taskSuggestion)
    .innerJoin(member, eq(taskSuggestion.memberId, member.id))
    .where(inArray(taskSuggestion.taskId, taskIds))
    .orderBy(asc(taskSuggestion.createdAt), asc(taskSuggestion.id));
  for (const r of rows) {
    const people = out.get(r.taskId) ?? [];
    const existing = people.find((p) => p.memberId === r.memberId);
    if (existing) existing.reasons.push(r.reason);
    else people.push({ memberId: r.memberId, name: r.name, reasons: [r.reason] });
    out.set(r.taskId, people);
  }
  return out;
}

/**
 * "Not me": the suggested person says this one is not for them. It hides the prompt from their
 * own dashboard and nothing else. It is not logged against their engagement, nobody is told,
 * and coordination still sees the suggestion. Declining a nomination is a real act with a real
 * response window; this is only a person saying no to being nudged.
 */
export async function dismissMySuggestion(actor: Member, taskId: string) {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!row) throw new NotFoundError("Task not found");
  await db
    .update(taskSuggestion)
    .set({ dismissedAt: new Date() })
    .where(and(eq(taskSuggestion.taskId, taskId), eq(taskSuggestion.memberId, actor.id), isNull(taskSuggestion.dismissedAt)));
}

export type AccompanyInvitation = { taskId: string; newcomerName: string; reasons: SuggestionReason[] };

/**
 * A new member who has nobody yet, where this member is among the people with a reason to be
 * asked, and hasn't said "not me". Only accompaniment tasks are offered this way: for any other
 * task a suggestion is for coordination to act on, and telling every suggested person (a cycle
 * clone suggests hundreds) would be noise.
 */
export async function listMyAccompanyInvitations(actor: Member): Promise<AccompanyInvitation[]> {
  const rows = await db
    .select({ taskId: taskSuggestion.taskId, reason: taskSuggestion.reason, newcomerName: member.name })
    .from(taskSuggestion)
    .innerJoin(task, eq(taskSuggestion.taskId, task.id))
    .innerJoin(accompaniment, eq(accompaniment.taskId, task.id))
    .innerJoin(member, eq(accompaniment.memberId, member.id))
    .where(
      and(
        eq(taskSuggestion.memberId, actor.id),
        isNull(taskSuggestion.dismissedAt),
        isNull(accompaniment.endedAt),
        eq(task.status, "unclaimed"),
        eq(task.communityId, actor.communityId),
      ),
    )
    .orderBy(asc(taskSuggestion.createdAt), asc(taskSuggestion.id));
  const byTask = new Map<string, AccompanyInvitation>();
  for (const r of rows) {
    const existing = byTask.get(r.taskId);
    if (existing) existing.reasons.push(r.reason);
    else byTask.set(r.taskId, { taskId: r.taskId, newcomerName: r.newcomerName, reasons: [r.reason] });
  }
  return [...byTask.values()];
}
