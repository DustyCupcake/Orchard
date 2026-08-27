import { jsonb, pgEnum, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { community } from "./community";

export const tierCriterionTypeEnum = pgEnum("tier_criterion_type", [
  "manual",
  "tenure",
  "completion",
  "cohort",
  "cycle_type_count",
]);

// A named eligibility level a Community defines for itself (e.g.
// "Experienced"). criterionConfig shape depends on criterionType — e.g.
// {"min_days": 180} for tenure, {"cycle_id": "..."} for cohort.
export const tier = pgTable("tier", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references((): AnyPgColumn => community.id),
  name: text("name").notNull(),
  criterionType: tierCriterionTypeEnum("criterion_type").notNull().default("manual"),
  criterionConfig: jsonb("criterion_config").notNull().default({}),
});
