import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";

export const taskJoinRequestStatusEnum = pgEnum("task_join_request_status", [
  "pending",
  "accepted",
  "declined",
]);

// A pending request to join an already-held `request` or
// `coordination_approved` task — see docs/spec.md's "Request to join"
// (Coordination mechanics). Deliberately its own table rather than
// reusing BrowseInterest: BrowseInterest is specifically the
// browse-period / community-endorsed candidacy shape (reached_out,
// status only meaningful for community_endorsed), a different,
// still-deferred mechanism per docs/development-plan.md's Phase 12.
export const taskJoinRequest = pgTable("task_join_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  status: taskJoinRequestStatusEnum("status").notNull().default("pending"),
  declineReason: text("decline_reason"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedBy: uuid("resolved_by").references(() => member.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
