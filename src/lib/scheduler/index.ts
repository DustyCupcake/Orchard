import cron from "node-cron";

// The general "scheduler + due-item polling" infrastructure per
// docs/architecture.md — a lightweight in-process node-cron, not a
// queue system (single community's worth of activity, not SaaS scale).
// The attention-level job (Phase 10) is the first thing registered here;
// later scheduled work (Input round cutoffs, Assembly phase transitions,
// browse-period resolution, invite expiry, ...) should reuse this rather
// than each spinning up its own cron.
export function registerJob(name: string, cronExpression: string, fn: () => Promise<unknown>) {
  let running = false;

  cron.schedule(cronExpression, async () => {
    if (running) {
      console.warn(`[scheduler] ${name} is still running, skipping this tick`);
      return;
    }
    running = true;
    try {
      const result = await fn();
      console.log(`[scheduler] ${name} completed`, result ?? "");
    } catch (err) {
      console.error(`[scheduler] ${name} failed`, err);
    } finally {
      running = false;
    }
  });

  console.log(`[scheduler] registered ${name} (${cronExpression})`);
}
