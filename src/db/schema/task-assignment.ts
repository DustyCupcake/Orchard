import { boolean, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { task } from "./task";
import { member } from "./member";

// Join table between Task and Member — replaces a single owner_id now
// that capacity can exceed 1. See "Multi-slot & collaborative tasks" and
// "Shadow slots & succession" in docs/spec.md.
export const taskAssignment = pgTable(
  "task_assignment",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    isCoordinationSlot: boolean("is_coordination_slot").notNull().default(false),
    isShadow: boolean("is_shadow").notNull().default(false),
    isOutgoing: boolean("is_outgoing").notNull().default(false),
    gateWaivedBy: uuid("gate_waived_by").references(() => member.id),
    gateWaivedReason: text("gate_waived_reason"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.memberId] })],
);
