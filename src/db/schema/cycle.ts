import { integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
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
// Not yet included: cycle_type_id (→ CycleType) and source_pack_id
// (→ TaskPack) — both point at tables that don't exist until Task Pack /
// Cycle type get built.
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
});
