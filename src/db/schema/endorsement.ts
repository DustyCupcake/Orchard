import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { browseInterest } from "./browse-interest";
import { member } from "./member";

// Only ever created against a BrowseInterest row on a `community_endorsed`
// task — see docs/spec.md's "Endorsement-gated tasks". Uniqueness (one
// endorsement per member per candidacy) and the candidate-can't-endorse-
// their-own-candidacy rule are enforced in src/lib/tasks/endorsements.ts,
// app-layer, matching how task-join-request.ts's duplicate-pending-
// request check works — not a DB constraint.
export const endorsement = pgTable("endorsement", {
  id: uuid("id").primaryKey().defaultRandom(),
  browseInterestId: uuid("browse_interest_id")
    .notNull()
    .references(() => browseInterest.id),
  endorsedBy: uuid("endorsed_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
