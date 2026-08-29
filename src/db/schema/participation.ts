import { date, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { cycle } from "./cycle";
import { member } from "./member";

export const participationStatusEnum = pgEnum("participation_status", [
  "unknown",
  "coming",
  "maybe",
  "not_coming",
]);

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
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
