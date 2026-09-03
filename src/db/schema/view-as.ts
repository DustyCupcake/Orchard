import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { member } from "./member";

// The accountability trail for View-as (see docs/spec.md's "View-as
// (support)" and docs/development-plan.md's Phase 54) — same
// activatedBy/targetMemberId/timestamp shape as Phase 46's
// emergencyAccessLog, for a comparably sensitive capability. endedAt
// null means the overlay was still active as of the last check; it's
// set either by an explicit "End View-as" action or, silently, the
// next time getActiveViewAs (src/lib/view-as.ts) notices the real
// member no longer holds a Support task.
export const viewAsLog = pgTable("view_as_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  activatedBy: uuid("activated_by")
    .notNull()
    .references(() => member.id),
  targetMemberId: uuid("target_member_id")
    .notNull()
    .references(() => member.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});
