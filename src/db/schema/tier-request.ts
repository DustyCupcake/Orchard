import { pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { member } from "./member";
import { tier } from "./tier";

export const tierRequestDecisionEnum = pgEnum("tier_request_decision", ["approved", "declined"]);

// A member asking to be in a manual-criterion tier. Manual tiers gate real
// things — sensitive-data audiences, who may start an event — so a member
// ticking one on their own profile was a way to grant themselves access.
// The spec says leads designate members into a manual tier by hand; this
// is that, made workable: the member asks, and an Admin or someone already
// in the tier confirms.
//
// A request is pending until decided (`decidedAt` null), and a pending one
// grants nothing: the member's tierIds only change when it is approved.
// Declined rows are kept rather than deleted so the member can be told, and
// so a repeat request doesn't read as the first.
export const tierRequest = pgTable(
  "tier_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    // Cascade: a tier that is deleted takes its pending requests with it,
    // rather than the delete failing on rows nobody can see.
    tierId: uuid("tier_id")
      .notNull()
      .references(() => tier.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => member.id),
    decision: tierRequestDecisionEnum("decision"),
  },
  (t) => [
    // At most one *pending* request per member per tier. A partial index
    // rather than a plain unique one, because a declined or approved row
    // must not stop the member from asking again later.
    uniqueIndex("tier_request_pending_member_tier_unique")
      .on(t.memberId, t.tierId)
      .where(sql`${t.decidedAt} is null`),
  ],
);
