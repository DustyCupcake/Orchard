import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";

// The reporting/recusal flow — see docs/spec.md's "Conflict management".
// No dedicated team-membership table: "the conflict team" is just
// whoever currently holds Community.conflictTeamTaskId, the same
// tag/pointer-based pattern every other coordination role in this
// codebase already uses instead of a real relationship table.
export const conflictReport = pgTable("conflict_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // Recorded, not anonymous — spec: "visible only to the reporter and
  // whoever's handling it," which means access-restricted, not
  // identity-omitted (contrast with task_signal, which really is
  // anonymous).
  reportedBy: uuid("reported_by")
    .notNull()
    .references(() => member.id),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgedBy: uuid("acknowledged_by").references(() => member.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNote: text("resolution_note"),
  // Widens visibility from the single point-of-contact to the whole
  // non-excluded team — see docs/development-plan.md's Phase 21 ("a
  // resolved interpretation for a case spec names but doesn't fully
  // define the mechanics of: escalating widens visibility ... rather
  // than to some undefined higher authority").
  escalated: boolean("escalated").notNull().default(false),
});

// One table for all three exclusion routes spec describes (reporter-
// excludes-at-creation, self-recusal, peer-recusal) — differentiated
// only by who added the row and when, not a type enum, matching spec's
// "all three routes land in the same place."
export const conflictReportExclusion = pgTable("conflict_report_exclusion", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => conflictReport.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => member.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});
