// Next.js calls register() once when the server starts (both `next dev`
// and the standalone production server) — the supported place to kick
// off a long-lived background process like a cron scheduler. See
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  // Only the real Node.js server process should run this — Next also
  // loads instrumentation.ts for the edge runtime, where there's no
  // Postgres connection and node-cron wouldn't run persistently anyway.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { registerJob } = await import("@/lib/scheduler");
  const { recomputeAttentionLevels } = await import("@/lib/attention");
  const { resolveBrowsePeriods } = await import("@/lib/tasks");
  const { resolveInputRounds } = await import("@/lib/input-rounds");
  const { closeDueChecks, updateRecruitmentSubscriptionLapses } = await import("@/lib/recruitment");
  const { resolveTaskNominationDeadlines } = await import("@/lib/tasks");
  const { logCallSummaryUnreadEngagementEvents } = await import("@/lib/engagement");

  // "polled every few minutes" — see CONTRIBUTING.md's "Architecture" section.
  registerJob("attention-level", "*/5 * * * *", recomputeAttentionLevels);
  // Fails any candidacy that never cleared its endorsement threshold
  // before its task's browse window closed — see endorsements.ts.
  registerJob("browse-period-resolution", "*/5 * * * *", resolveBrowsePeriods);
  // Cuts a new Input round whenever a Community's cadence clock comes
  // due — see src/lib/input-rounds/scheduler.ts.
  registerJob("input-round-cutoff", "*/5 * * * *", resolveInputRounds);
  // Increments/resets each active RecruitmentSubscription's
  // consecutiveNoAvailabilityCount once its intro-call poll confirms a
  // slot, auto-lapsing past the configured threshold — see
  // src/lib/recruitment/subscriptions.ts.
  registerJob("recruitment-subscription-lapse", "*/5 * * * *", updateRecruitmentSubscriptionLapses);
  // The one community check (docs/admission-flow.md §5): looks at every open
  // window and does what its record says is due — passes one whose deadline went
  // by with no concern, and finishes any outcome whose last step failed. A concern
  // is never dropped by a clock: a standing one holds its window and stays a duty
  // item for the mediation body. See src/lib/recruitment/check-outcome.ts.
  registerJob("community-check", "*/5 * * * *", closeDueChecks);
  // Auto-releases a nominated-but-unconfirmed task assignment once its
  // response deadline passes with no reply — see
  // src/lib/tasks/nominations.ts.
  registerJob("task-nomination-deadline", "*/5 * * * *", resolveTaskNominationDeadlines);
  // Logs an engagement event for anyone who hasn't read a published,
  // require_read CallSummary once its read window passes — see
  // src/lib/engagement.ts.
  registerJob("call-summary-engagement", "*/5 * * * *", logCallSummaryUnreadEngagementEvents);
}
