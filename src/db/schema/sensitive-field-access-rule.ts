import { pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { task } from "./task";
import { tier } from "./tier";

// The fixed field set — see member.ts and docs/spec.md's "Sensitive
// data". Not user-definable (spec's own example list is short).
export const sensitiveFieldKeyEnum = pgEnum("sensitive_field_key", [
  "health_conditions",
  "allergies",
  "emergency_contact",
  "orientation",
]);

// "A Community defines which task or tier unlocks which field" — one
// row is one unlock route (exactly one of unlockedByTaskId/
// unlockedByTierId set, enforced at the application layer). A field
// can have more than one rule — e.g. both a task and a tier can each
// independently unlock it.
export const sensitiveFieldAccessRule = pgTable("sensitive_field_access_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  fieldKey: sensitiveFieldKeyEnum("field_key").notNull(),
  unlockedByTaskId: uuid("unlocked_by_task_id").references(() => task.id),
  unlockedByTierId: uuid("unlocked_by_tier_id").references(() => tier.id),
});
