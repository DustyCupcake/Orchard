import { boolean, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";

export const browseInterestStatusEnum = pgEnum("browse_interest_status", [
  "open",
  "confirmed",
  "failed",
]);

// Expressing interest during a task's browse period — see docs/spec.md's
// "Browse mode" and "Endorsement-gated tasks". Phase 13 only builds the
// `community_endorsed` candidacy path (every row this phase creates
// gets a real `status`); ordinary Browse mode's own auto-claim-on-
// window-close and single-slot contested resolution stay deferred, per
// Phase 12's own scope note — so `reached_out` (that flow's "I've
// reached out" signal) is included here for shape-fidelity with the
// spec's table but has no reader yet.
export const browseInterest = pgTable("browse_interest", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  expressedAt: timestamp("expressed_at", { withTimezone: true }).notNull().defaultNow(),
  reachedOut: boolean("reached_out").notNull().default(false),
  status: browseInterestStatusEnum("status").notNull().default("open"),
});
