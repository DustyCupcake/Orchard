import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";

// "Non-responses log against a member's engagement record, visible to
// coordination: one is just noted, a couple becomes a soft flag
// suggesting a different approach, three or more surfaces as a pattern
// worth a human conversation — never an automatic sanction. The
// pattern resets once the person responds and re-engages." — see
// docs/spec.md's Response tracking and docs/development-plan.md's
// Phase 52. Every kind here is a genuine non-response this codebase
// already produces somewhere — this phase adds the logging, not a new
// detection mechanism per kind:
// - task_nomination_expired: src/lib/tasks/nominations.ts's
//   resolveTaskNominationDeadlines, once a nomination's respondByDeadline
//   passes with no reply.
// - nudge_ignored: src/lib/attention/job.ts's recomputeAttentionLevels,
//   the moment a Waiting task's own attention level crosses from
//   not-yet-hard into hard — "ignoring the nudge past a grace period."
// - call_summary_unread_past_window: src/lib/engagement.ts's own
//   logCallSummaryUnreadEngagementEvents, a new scheduled scan (this
//   phase's one genuinely new detection, since nothing previously
//   tracked "past window" for a require_read CallSummary).
export const engagementEventKindEnum = pgEnum("engagement_event_kind", [
  "task_nomination_expired",
  "nudge_ignored",
  "call_summary_unread_past_window",
]);

// resolvedAt is set on every one of a member's open rows at once, the
// moment they take any of the real response actions this system
// tracks (see src/lib/engagement.ts's resolveEngagementForMember) — "a
// global reset, not per-kind" (docs/development-plan.md's Phase 52).
// taskId is nullable and purely contextual (a coordinator glancing at
// *why* — this is never itemized/drilled-into by design, spec frames
// the whole thing as a computed pattern level, not an event log to
// browse).
export const engagementEvent = pgTable("engagement_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  kind: engagementEventKindEnum("kind").notNull(),
  taskId: uuid("task_id").references(() => task.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
