import { integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { member } from "./member";
import { traitAxis } from "./trait-axis";

// A member's own position on one TraitAxis — their stated preference,
// not something assigned to them (docs/spec.md's "the member defines
// their own tags and availability; this is the matching input"). One
// row per member per axis they've actually answered; unanswered axes
// just have no row, contributing nothing to matching rather than a
// guessed default.
export const memberAxisValue = pgTable(
  "member_axis_value",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    axisId: uuid("axis_id")
      .notNull()
      .references(() => traitAxis.id),
    value: integer("value").notNull(),
  },
  (t) => [uniqueIndex("member_axis_value_member_axis_idx").on(t.memberId, t.axisId)],
);
