import { pgTable, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { member } from "./member";

/**
 * Standing availability — a rolling grid a recruitment holder edits themselves.
 * Unlike per-poll availability (schedulingEntry), this is a single grid per
 * member that applies to all incoming interviews.
 *
 * The grid covers a rolling window (e.g., next 14 days). When a new interview
 * needs scheduling, the system reads this grid to see which holders have
 * availability matching the applicant, rather than re-painting availability
 * onto each poll.
 */
export const recruitmentStandingAvailability = pgTable(
  "recruitment_standing_availability",
  {
    memberId: uuid("member_id")
      .primaryKey()
      .references(() => member.id),
    // JSON array of ISO datetime strings (slot start times, 30-min granularity)
    availableSlots: jsonb("available_slots").notNull().default([]),
    // The window this grid covers — [windowStart, windowEnd]
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [],
);