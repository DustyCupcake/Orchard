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

  // "polled every few minutes" per docs/architecture.md.
  registerJob("attention-level", "*/5 * * * *", recomputeAttentionLevels);
  // Fails any candidacy that never cleared its endorsement threshold
  // before its task's browse window closed — see endorsements.ts.
  registerJob("browse-period-resolution", "*/5 * * * *", resolveBrowsePeriods);
}
