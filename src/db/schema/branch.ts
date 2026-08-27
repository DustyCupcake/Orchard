import { boolean, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";

export const branchStatusEnum = pgEnum("branch_status", ["confirmed", "pending"]);

// A category of work, community-defined at setup (e.g. Seed/Fruit/Blossom/Wood).
export const branch = pgTable("branch", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  name: text("name").notNull(),
  description: text("description"),
  // `pending` when created via pack import by someone who doesn't hold
  // Admins — see docs/spec.md's Pack import review. No pack import yet,
  // so this always ends up `confirmed` for now.
  status: branchStatusEnum("status").notNull().default("confirmed"),
  defaultCallHasAgenda: boolean("default_call_has_agenda"),
  defaultCallNeedsSummary: boolean("default_call_needs_summary"),
  defaultCallRequireRead: boolean("default_call_require_read"),
});
