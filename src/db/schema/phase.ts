import { date, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { cycle } from "./cycle";

// Belongs to a Cycle, not the Community directly — different cycles can
// have different phase spines. Only meaningful if the cycle's Community
// has `phases_enabled`.
export const phase = pgTable("phase", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycle.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
});
