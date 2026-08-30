import { date, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycleType } from "./cycle-type";
import { member } from "./member";

export const cycleStatusEnum = pgEnum("cycle_status", [
  "draft",
  "round_0",
  "round_1",
  "round_2",
  "active",
  "archived",
]);
export const cycleSourceTypeEnum = pgEnum("cycle_source_type", ["blank", "pack"]);

// A discrete run of production (a season, a reunion weekend, a one-off
// event). Optional — a Community with `cycles_enabled = false` runs one
// permanent default Cycle instead. See docs/spec.md's "Cycle" section.
//
// Not yet included: source_pack_id (→ TaskPack) — points at a table
// that doesn't exist until Task Pack, as a portable cross-community
// mechanism, gets built (see docs/development-plan.md's "Beyond
// Phase 45"). cycle_type_id landed in Phase 40.
export const cycle = pgTable("cycle", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  name: text("name").notNull(),
  status: cycleStatusEnum("status").notNull().default("draft"),
  startedBy: uuid("started_by").references(() => member.id),
  startedAt: timestamp("started_at", { withTimezone: true }),
  sourceType: cycleSourceTypeEnum("source_type").notNull().default("blank"),
  capacity: integer("capacity"),
  returningWindowClosesAt: timestamp("returning_window_closes_at", { withTimezone: true }),
  cycleTypeId: uuid("cycle_type_id").references(() => cycleType.id),
  // The event's own working dates — distinct from `started_at` (an
  // admin log entry of when the Cycle row itself was created). Neither
  // is required to start a cycle; missing one just means Phase
  // auto-placement, relative Task milestones/CalendarEvents, and the
  // Pack import date preview have nothing to resolve against yet. See
  // docs/spec.md's "Event window" and docs/development-plan.md's
  // Phase 39.
  startDate: date("start_date"),
  endDate: date("end_date"),
});
