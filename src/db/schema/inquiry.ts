import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";

// "A public inquiry inbox, not a CRM" — see docs/spec.md's Recruitment.
// No application structure, just a message + contact info from a
// visitor who isn't a Member yet. Visible to anyone holding a
// recruitment-facing task, claimable so two holders don't unknowingly
// cold-message the same person — the same low-stakes claiming pattern
// as everywhere else in this codebase.
export const inquiry = pgTable("inquiry", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  message: text("message").notNull(),
  contactInfo: text("contact_info").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  claimedBy: uuid("claimed_by").references(() => member.id),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
