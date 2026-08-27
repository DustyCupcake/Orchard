import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";

// "Talk to my coordinator" — see docs/spec.md's Coordination mechanics:
// "any task owner can trigger a conversation with their branch
// coordinator via one button... notifies the coordinator." A routing
// mechanic, not a chat system — this row is the notification itself
// (visible to the task's branch coordination holders until resolved),
// not a message thread; the actual conversation happens elsewhere, per
// spec. Not anonymous — unlike TaskSignal, spec's own example message
// ("[Member] would like to talk about [task]") names the requester.
export const coordinatorPing = pgTable("coordinator_ping", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => task.id),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
