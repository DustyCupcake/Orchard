import { date, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branch } from "./branch";
import { community } from "./community";
import { cycle } from "./cycle";
import { cycleOffsetAnchorEnum, dateRelativeModeEnum, dateTypeEnum } from "./phase";
import { member } from "./member";

export const calendarEventShareTargetEnum = pgEnum("calendar_event_share_target", [
  "personal",
  "branch",
  "community",
]);

// A personal or shared calendar entry that isn't about any one task —
// "applications close," "the potluck" — see docs/spec.md's
// "Freestanding events." Always exactly one owner, its creator; no
// authority-based confirmation gate, unlike Branch creation by non-
// Admins.
//
// Reuses the exact same shape Phase's own start_date/end_date columns
// use (Phase 39) — cycleOffsetAnchorEnum's 2-way cycle-only anchor,
// not TaskMilestone's 4-way one, since spec is explicit an event
// anchors to the Cycle only, never a Phase ("a Phase-scoped date
// belongs on a TaskMilestone instead"). `date` is cached/resolved when
// relative, same as Phase's own boundaries (and unlike TaskMilestone's
// deliberately-never-cached shape) — src/lib/dates/resolve.ts's
// StoredBoundary/dateBoundaryInput/toStoredBoundary/recomputeBoundary/
// isBoundaryDrifted are reused here directly, no new resolution logic
// needed at all.
export const calendarEvent = pgTable("calendar_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  // null = cycle-independent, shown in the Calendar view's Community-
  // wide bucket (Phase 43) — see docs/spec.md.
  cycleId: uuid("cycle_id").references(() => cycle.id),
  shareTarget: calendarEventShareTargetEnum("share_target").notNull().default("personal"),
  sharedBranchId: uuid("shared_branch_id").references(() => branch.id),
  title: text("title").notNull(),
  description: text("description"),
  dateType: dateTypeEnum("date_type").notNull().default("absolute"),
  date: date("date"),
  relativeMode: dateRelativeModeEnum("relative_mode"),
  anchorType: cycleOffsetAnchorEnum("anchor_type"),
  offsetDays: integer("offset_days"),
  percent: integer("percent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calendarEventInviteStatusEnum = pgEnum("calendar_event_invite_status", [
  "invited",
  "confirmed",
  "declined",
]);

// One row per invited Member — mirrors PlacementMember's invited/
// confirmed shape (Phase 38), plus a real `declined` status: unlike
// Placement (where declining just deletes the row), spec's own field
// list for this table names `declined` as a real, persisted outcome —
// a record that stands rather than disappearing, so a bulk (re-)invite
// can tell "never asked" apart from "asked and said no" and skip the
// latter rather than re-asking.
export const calendarEventInvite = pgTable("calendar_event_invite", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => calendarEvent.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  status: calendarEventInviteStatusEnum("status").notNull().default("invited"),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => member.id),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
});
