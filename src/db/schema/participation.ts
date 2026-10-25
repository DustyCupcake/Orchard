import { date, pgEnum, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { cycle } from "./cycle";
import { member } from "./member";

export const participationStatusEnum = pgEnum("participation_status", [
  "unknown",
  "coming",
  "maybe",
  "not_coming",
]);

// Which of the day's three meals — a person's first or last at an event is
// one of these, and a Kitchen meal can say which it is. Lives here with the
// participation row because "first meal" and "last meal" are things a member
// says about their own plans, in a core table that must not depend on an
// optional module; the Kitchen's schema imports it.
export const MEAL_SLOTS = ["breakfast", "lunch", "dinner"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const mealSlotEnum = pgEnum("meal_slot", MEAL_SLOTS);

// Per cycle, per member: "who's actually planning to be there" — see
// docs/spec.md's "Participation & capacity" under Cycle. Core, not
// gated behind Recruitment. One row per (cycleId, memberId),
// resubmittable as plans change — upserted in place, the same
// select-then-update-or-insert posture Assemblies' submitAssemblyResponse
// / Budget's submitBudgetVote already use, no DB-level unique constraint.
export const participation = pgTable("participation", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycle.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  status: participationStatusEnum("status").notNull().default("unknown"),
  arrivalDate: date("arrival_date"),
  departureDate: date("departure_date"),
  // Optional, and nobody has to give them. A clock time on the day they
  // arrive or leave lets the Kitchen tell whether they are there for a given
  // meal; without one the day is counted and flagged as uncertain.
  arrivalTime: time("arrival_time"),
  departureTime: time("departure_time"),
  // The same thing said in meals instead of clock times, for someone who
  // knows "I'll eat dinner when I get there" better than "I land at 17:40".
  // Beats a time when both are given, because it is the person's own
  // statement of which meals they'll eat. Applies to the arrival / departure
  // date only.
  firstMeal: mealSlotEnum("first_meal"),
  lastMeal: mealSlotEnum("last_meal"),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
