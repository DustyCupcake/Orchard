import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { cycle, member, phase, profileAnswer, profileQuestion, task, taskAssignment } from "@/db/schema";
import type { member as memberTable, phase as phaseTable } from "@/db/schema";
import { requireCoordinationHolder } from "../coordination";

type Member = typeof memberTable.$inferSelect;
type Phase = typeof phaseTable.$inferSelect;

// "The current cycle" for phase-name matching purposes — the same
// "most recent by startedAt" resolution cloneMostRecentCycle() already
// uses (src/lib/cycles/crud.ts). A community with no cycle at all (e.g.
// cyclesEnabled=false and none ever created) has no current cycle,
// which is a real, honest state, not an error — phase/per_cycle
// questions just don't surface for it.
export async function getCurrentCycle(communityId: string) {
  const [row] = await db
    .select()
    .from(cycle)
    .where(eq(cycle.communityId, communityId))
    .orderBy(desc(cycle.startedAt))
    .limit(1);
  return row ?? null;
}

// A resolved interpretation, not stated explicitly in spec: "current
// phase" = the current cycle's earliest-ordered phase that hasn't
// ended yet (no end date, or an end date still in the future). If every
// phase has already ended (schedule slipped) or the cycle has no
// phases, there's no current phase — degrades the same way a missing
// cycle does, rather than guessing.
export async function getCurrentPhase(communityId: string): Promise<Phase | null> {
  const currentCycle = await getCurrentCycle(communityId);
  if (!currentCycle) return null;

  const phases = await db
    .select()
    .from(phase)
    .where(eq(phase.cycleId, currentCycle.id))
    .orderBy(phase.order);

  const now = new Date();
  return phases.find((p) => !p.endDate || new Date(p.endDate) >= now) ?? null;
}

// The one real, concrete Coordination-mechanics consumer this phase
// exists to unblock — see docs/spec.md's "Capacity-aware fitted asks"
// and "Availability non-response". Not hardcoded to a question named
// "Availability": any scope='phase' question with feeds_capacity_signal
// set, whose phase_name_hint matches the current phase's name
// case-insensitively, qualifies.
export async function getCurrentCapacityQuestion(communityId: string) {
  const currentPhase = await getCurrentPhase(communityId);
  if (!currentPhase) return { phase: null, question: null };

  const candidates = await db
    .select()
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, communityId),
        eq(profileQuestion.scope, "phase"),
        eq(profileQuestion.feedsCapacitySignal, true),
        isNull(profileQuestion.archivedAt),
      ),
    );

  const question =
    candidates.find(
      (q) => q.phaseNameHint?.toLowerCase() === currentPhase.name.toLowerCase(),
    ) ?? null;

  return { phase: currentPhase, question };
}

// A member's current Effort-magnitude load: hours/week across
// currently-held (real, non-shadow; claimed or waiting still counts as
// held) ongoing/owns_a_thing tasks. effort_magnitude is always an
// object (see src/lib/format.ts's effortSummary) — either
// {hours_per_week: N} (the flat case, everything this codebase
// actually creates today) or a per-phase map ({[phase_id]: hours}, per
// the schema comment, not yet produced by any real UI/API), so a flat
// number under hours_per_week wins if present, else the current
// phase's own key. one_off tasks are deliberately excluded — their
// magnitude is a duration bucket (under_hour/few_hours/...), not an
// hours/week number, so there's nothing comparable to sum. A resolved
// interpretation, not spelled out in spec, but necessary for "minus
// current Effort magnitude" to be arithmetic rather than a metaphor.
async function currentLoadHours(memberId: string, communityId: string, currentPhaseId: string) {
  const held = await db
    .select({ effort: task.effort, effortMagnitude: task.effortMagnitude })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, memberId),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, communityId),
        or(eq(task.status, "claimed"), eq(task.status, "waiting")),
      ),
    );

  let total = 0;
  for (const t of held) {
    if (t.effort !== "ongoing" && t.effort !== "owns_a_thing") continue;
    const magnitude = t.effortMagnitude as Record<string, unknown> | null;
    if (!magnitude || typeof magnitude !== "object") continue;
    if (typeof magnitude.hours_per_week === "number") {
      total += magnitude.hours_per_week;
    } else if (typeof magnitude[currentPhaseId] === "number") {
      total += magnitude[currentPhaseId] as number;
    }
  }
  return total;
}

function parseDeclaredHours(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export type CapacitySignalEntry = {
  memberId: string;
  memberName: string;
  hasAnswer: boolean;
  deferred: boolean;
  capacityVisibility: "flag_only" | "open";
  declaredHours: number | null;
  loadHours: number | null;
  flag: "has_room" | "about_right" | "over" | null;
};

// The Coordination view's combined capacity-aware-asks + availability-
// non-response list, in one pass — spec presents them as the same
// view, not two separate mechanisms (see docs/spec.md's Coordination
// mechanics). Community-wide (branchId=null), same scope as the
// Escalation view Phase 15 already built — Availability isn't
// branch-scoped data, so there's no branch to narrow it by.
export async function listCapacitySignal(actor: Member): Promise<{
  phaseName: string | null;
  questionLabel: string | null;
  entries: CapacitySignalEntry[];
}> {
  await requireCoordinationHolder(actor, null);

  const { phase: currentPhase, question } = await getCurrentCapacityQuestion(actor.communityId);
  if (!currentPhase || !question) {
    return { phaseName: currentPhase?.name ?? null, questionLabel: null, entries: [] };
  }

  const communityMembers = await db
    .select()
    .from(member)
    .where(eq(member.communityId, actor.communityId));

  const answers = await db
    .select()
    .from(profileAnswer)
    .where(and(eq(profileAnswer.questionId, question.id), eq(profileAnswer.cycleId, currentPhase.cycleId)));
  const answerByMember = new Map(answers.map((a) => [a.memberId, a]));

  const entries: CapacitySignalEntry[] = [];
  for (const m of communityMembers) {
    const answer = answerByMember.get(m.id);
    if (!answer || answer.status === "deferred") {
      entries.push({
        memberId: m.id,
        memberName: m.name,
        hasAnswer: Boolean(answer),
        deferred: answer?.status === "deferred",
        capacityVisibility: answer?.capacityVisibility ?? "flag_only",
        declaredHours: null,
        loadHours: null,
        flag: null,
      });
      continue;
    }

    const declaredHours = parseDeclaredHours(answer.value);
    const loadHours =
      declaredHours === null
        ? null
        : await currentLoadHours(m.id, actor.communityId, currentPhase.id);
    const remaining = declaredHours === null || loadHours === null ? null : declaredHours - loadHours;
    // "has room / about right / over" thresholds aren't numerically
    // specified in spec — a resolved interpretation: within 2 hours of
    // the declared figure counts as "about right", clearly under counts
    // as "over", clearly above counts as "has room".
    const flag: CapacitySignalEntry["flag"] =
      remaining === null ? null : remaining < 0 ? "over" : remaining <= 2 ? "about_right" : "has_room";

    entries.push({
      memberId: m.id,
      memberName: m.name,
      hasAnswer: true,
      deferred: false,
      capacityVisibility: answer.capacityVisibility,
      declaredHours,
      loadHours,
      flag,
    });
  }

  return { phaseName: currentPhase.name, questionLabel: question.label, entries };
}
