import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, member, phase, shiftOccurrence, shiftSeries, shiftSignup, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

export const updateContributionVisibilityInput = z.object({ visible: z.boolean() });
export type UpdateContributionVisibilityInput = z.infer<typeof updateContributionVisibilityInput>;

export async function updateContributionVisibility(actor: Member, input: UpdateContributionVisibilityInput) {
  const [updated] = await db
    .update(member)
    .set({ contributionVisible: input.visible })
    .where(eq(member.id, actor.id))
    .returning();
  return updated;
}

export async function listVisibleContributors(actor: Member) {
  return db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(and(eq(member.communityId, actor.communityId), eq(member.contributionVisible, true)))
    .orderBy(member.name);
}

type ContributionTaskEntry = {
  id: string;
  title: string;
  branchName: string;
  effort: string;
  effortMagnitude: unknown;
};
type ContributionBucket = { count: number; hours: number; tasks: ContributionTaskEntry[] };
type ContributionShiftCompletionEntry = {
  id: string;
  seriesTitle: string;
  occurrenceStartsAt: Date;
};
type ContributionShiftBucket = { count: number; completions: ContributionShiftCompletionEntry[] };
export type ContributionCategory = {
  name: string;
  completed: ContributionBucket;
  active: ContributionBucket;
  future: ContributionBucket;
  shiftCompletions: ContributionShiftBucket;
};

function emptyBucket(): ContributionBucket {
  return { count: 0, hours: 0, tasks: [] };
}

function emptyShiftBucket(): ContributionShiftBucket {
  return { count: 0, completions: [] };
}

// Same resolved interpretation src/lib/profile-questions/capacity.ts
// already uses for "current Effort-magnitude load": only ongoing/
// owns_a_thing tasks contribute an hours figure (a one_off's magnitude
// is a duration bucket, not comparable); a flat hours_per_week wins if
// present, else this task's own phase key in the per-phase map.
function taskHours(t: { effort: string; effortMagnitude: unknown; phaseId: string | null }): number {
  if (t.effort !== "ongoing" && t.effort !== "owns_a_thing") return 0;
  const m = t.effortMagnitude as Record<string, unknown> | null;
  if (!m || typeof m !== "object") return 0;
  if (typeof m.hours_per_week === "number") return m.hours_per_week;
  if (t.phaseId && typeof m[t.phaseId] === "number") return m[t.phaseId] as number;
  return 0;
}

// Contribution category = Phase — see docs/development-plan.md's
// Phase 23: spec's own example categories ("planning, build, live
// operation, wind-down") read exactly like Phase names, so this reuses
// Phase 6's schema rather than inventing a second concept. A task with
// no phaseId (phases off, or a phase-less task) falls into a single
// "Overall" category. Categories merge across cycles by Phase *name*
// (not phase id) — "Build" is one conceptual category across seasons,
// not a fresh bucket every time a cycle clones/recreates its phases.
//
// completed/active/future, per task:
// - completed: the assignment's task is Done — wins regardless of the
//   task's own phase timing (a phase misconfigured with a future start
//   date after the fact shouldn't un-complete already-finished work).
// - future: not Done, and the task's phase has a start date that
//   hasn't arrived yet — spec's "later-phase tasks ... not yet
//   started" and Browse-period claims are the same underlying signal
//   here (claimed ahead of the phase actually opening).
// - active: not Done, and not (yet) future — everything else currently
//   held.
//
// Deliberately not scoped to "the current cycle": task.cycleId is
// commonly left unset in practice (Phase 3's create form treats it as
// optional), so filtering by it would silently drop real completed
// work. An honest all-time picture is safer than a guessed cycle
// boundary — proper cycle-scoping needs Participation (arrival/
// departure dates), which Phase 23 already defers along with the
// community-average line.
export async function getContributionBreakdown(memberId: string, communityId: string) {
  const rows = await db
    .select({
      taskId: task.id,
      title: task.title,
      status: task.status,
      effort: task.effort,
      effortMagnitude: task.effortMagnitude,
      phaseId: task.phaseId,
      phaseName: phase.name,
      phaseOrder: phase.order,
      phaseStartDate: phase.startDate,
      branchName: branch.name,
    })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .innerJoin(branch, eq(task.branchId, branch.id))
    .leftJoin(phase, eq(task.phaseId, phase.id))
    .where(
      and(
        eq(taskAssignment.memberId, memberId),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, communityId),
      ),
    );

  const today = new Date().toISOString().slice(0, 10);
  const categories = new Map<string, ContributionCategory & { order: number }>();

  for (const r of rows) {
    const categoryName = r.phaseName ?? "Overall";
    const order = r.phaseOrder ?? Number.MAX_SAFE_INTEGER;
    if (!categories.has(categoryName)) {
      categories.set(categoryName, {
        name: categoryName,
        completed: emptyBucket(),
        active: emptyBucket(),
        future: emptyBucket(),
        shiftCompletions: emptyShiftBucket(),
        order,
      });
    }
    const cat = categories.get(categoryName)!;

    const bucketKey: "completed" | "active" | "future" =
      r.status === "done" ? "completed" : r.phaseStartDate && r.phaseStartDate > today ? "future" : "active";

    const bucket = cat[bucketKey];
    bucket.count += 1;
    bucket.hours += taskHours(r);
    bucket.tasks.push({
      id: r.taskId,
      title: r.title,
      branchName: r.branchName,
      effort: r.effort,
      effortMagnitude: r.effortMagnitude,
    });
  }

  // "Completed task assignments and shift completions" — read
  // together, not folded into the same count (docs/spec.md's
  // Contribution tracking). A shift isn't a Task, so it doesn't
  // inherit a Task's Effort magnitude for an hours figure —
  // completions are counted, not hour-weighted, for v1
  // (docs/development-plan.md's Phase 30). ShiftSeries/ShiftOccurrence
  // carry no Phase association at all, so — same as a phase-less task
  // — every completion lands in "Overall" rather than being silently
  // dropped or guessed into some other category.
  const shiftRows = await db
    .select({
      signupId: shiftSignup.id,
      seriesTitle: shiftSeries.title,
      occurrenceStartsAt: shiftOccurrence.startsAt,
    })
    .from(shiftSignup)
    .innerJoin(shiftOccurrence, eq(shiftSignup.occurrenceId, shiftOccurrence.id))
    .innerJoin(shiftSeries, eq(shiftOccurrence.seriesId, shiftSeries.id))
    .where(
      and(
        eq(shiftSignup.memberId, memberId),
        eq(shiftSignup.status, "completed"),
        eq(shiftSeries.communityId, communityId),
      ),
    );
  if (shiftRows.length > 0) {
    if (!categories.has("Overall")) {
      categories.set("Overall", {
        name: "Overall",
        completed: emptyBucket(),
        active: emptyBucket(),
        future: emptyBucket(),
        shiftCompletions: emptyShiftBucket(),
        order: Number.MAX_SAFE_INTEGER,
      });
    }
    const overall = categories.get("Overall")!;
    for (const r of shiftRows) {
      overall.shiftCompletions.count += 1;
      overall.shiftCompletions.completions.push({
        id: r.signupId,
        seriesTitle: r.seriesTitle,
        occurrenceStartsAt: r.occurrenceStartsAt,
      });
    }
  }

  return Array.from(categories.values())
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((cat): ContributionCategory => ({
      name: cat.name,
      completed: cat.completed,
      active: cat.active,
      future: cat.future,
      shiftCompletions: cat.shiftCompletions,
    }));
}

export async function getOwnContribution(actor: Member) {
  return getContributionBreakdown(actor.id, actor.communityId);
}

// Purpose-bound the other direction from Sensitive data: not "which
// field unlocks this," just a plain per-member opt-in — but the same
// invariant applies (a member always sees their own).
export async function getVisibleContribution(actor: Member, targetMemberId: string) {
  if (targetMemberId === actor.id) {
    return { memberName: actor.name, categories: await getOwnContribution(actor) };
  }

  const [target] = await db
    .select()
    .from(member)
    .where(and(eq(member.id, targetMemberId), eq(member.communityId, actor.communityId)));
  if (!target) {
    throw new NotFoundError("Member not found in your community");
  }
  if (!target.contributionVisible) {
    throw new ForbiddenError("This member hasn't made their contribution picture visible");
  }

  return { memberName: target.name, categories: await getContributionBreakdown(target.id, target.communityId) };
}
