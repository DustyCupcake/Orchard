export type AttentionLevel = "ok" | "soft" | "hard" | "escalated";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}

export type TaskAttentionInput = {
  status: "unclaimed" | "claimed" | "waiting" | "done";
  critical: boolean;
  createdAt: Date;
  statusChangedAt: Date;
  nextCheckinAt: Date | null;
  /** false if any dependency isn't done yet. */
  unblocked: boolean;
  /** The task's phase end date, if it has a phase and phases are on. */
  phaseEndDate: Date | null;
};

export type AttentionThresholds = {
  softDays: number;
  hardDays: number;
};

// The three triggers from docs/spec.md's lifecycle section: staleness
// (days unclaimed/inactive), phase-based (only if the task has a phase
// with a passed end date), and dependency-based — here read as an
// *exemption*: a task blocked on an unfinished dependency isn't
// neglected, it's waiting on something else, so it's held at "ok"
// regardless of age until it unblocks.
//
// "escalated" is never produced here — nothing in the spec's narrative
// text defines what automatically produces it (only "soft-flag" and
// "hard-flag" are ever triggered by a rule); it reads as reserved for a
// deliberate coordinator action from the "Escalation" mechanic, which is
// explicitly second-slice, not this job's job.
export function computeAttentionLevel(
  input: TaskAttentionInput,
  thresholds: AttentionThresholds,
  now: Date = new Date(),
): AttentionLevel {
  if (input.status === "done") {
    return "ok";
  }

  if (input.status === "waiting") {
    return computeWaitingAttentionLevel(input.nextCheckinAt, thresholds, now);
  }

  if (!input.unblocked) {
    return "ok";
  }

  const phaseOverdue = input.phaseEndDate !== null && input.phaseEndDate < now;
  if (phaseOverdue) {
    return "hard";
  }

  const ageDays =
    input.status === "unclaimed"
      ? daysBetween(input.createdAt, now)
      : daysBetween(input.statusChangedAt, now);

  // "A critical task with no owner past its deadline ... escalates hard
  // rather than soft-flagging" — skips the soft stage entirely rather
  // than following the normal soft-then-hard progression.
  if (input.critical && input.status === "unclaimed") {
    return ageDays >= thresholds.hardDays ? "hard" : "ok";
  }

  if (ageDays >= thresholds.hardDays) return "hard";
  if (ageDays >= thresholds.softDays) return "soft";
  return "ok";
}

// "Ignoring the nudge past a grace period re-flags the task" — reuses
// softDays as that grace period rather than adding a third near-
// identical community-configurable column.
function computeWaitingAttentionLevel(
  nextCheckinAt: Date | null,
  thresholds: AttentionThresholds,
  now: Date,
): AttentionLevel {
  if (!nextCheckinAt || nextCheckinAt >= now) {
    return "ok";
  }
  const daysOverdue = daysBetween(nextCheckinAt, now);
  return daysOverdue > thresholds.softDays ? "hard" : "soft";
}
