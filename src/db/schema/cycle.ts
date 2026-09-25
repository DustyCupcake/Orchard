import { date, integer, pgEnum, pgTable, text, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycleType } from "./cycle-type";
import { member } from "./member";

export const cycleStatusEnum = pgEnum("cycle_status", [
  "draft",
  "round_0",
  "round_1",
  "round_2",
  "active",
  "archived",
]);
export const cycleSourceTypeEnum = pgEnum("cycle_source_type", ["blank", "pack"]);

// A discrete run of production (a season, a reunion weekend, a one-off
// event). Optional — a Community with `cycles_enabled = false` runs one
// permanent default Cycle instead. See docs/spec.md's "Cycle" section.
//
// cycle_type_id landed in Phase 40; source_pack_id (Phase 55) below.
export const cycle = pgTable("cycle", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  name: text("name").notNull(),
  status: cycleStatusEnum("status").notNull().default("draft"),
  startedBy: uuid("started_by").references(() => member.id),
  startedAt: timestamp("started_at", { withTimezone: true }),
  sourceType: cycleSourceTypeEnum("source_type").notNull().default("blank"),
  capacity: integer("capacity"),
  returningWindowClosesAt: timestamp("returning_window_closes_at", { withTimezone: true }),
  // Per-cycle joining configuration (docs/cycle-scope-remediation-plan.md
  // §4.3/D13, work-plan step 8c) — how and when this cycle admits new
  // members. The application-form pointer is a plain uuid, the same
  // non-FK pattern as community.recruitmentApplicationFormId (form.ts
  // imports community.ts, so community.ts/cycle.ts can't import form.ts
  // back); null falls back to the community's standing form. A cycle's
  // joining period runs from the close of its returning-priority window
  // (returningWindowClosesAt above — existing members declare first) or
  // its start if none, until `joiningWindowClosesAt` (null = until the
  // cycle closes). Both doors are shut outside that period and once
  // capacity is reached — see src/lib/recruitment/joining.ts.
  //
  // Invites-only: an invite's *lane* (fixed by the inviter's marks at
  // creation) decides how it behaves — the community's per-lane rules
  // live on `joining_lane` (docs/joining-admission-plan.md §2/§4.1),
  // with per-cycle overrides falling back to the community-wide rows.
  // The retired `joiningInviteMode` (direct | referral) that used to
  // sit here was replaced by lanes × verification in the same migration
  // that introduced the lane table.
  recruitmentApplicationFormId: uuid("recruitment_application_form_id"),
  applicationsOpen: boolean("applications_open").notNull().default(true),
  invitesOpen: boolean("invites_open").notNull().default(true),
  joiningWindowClosesAt: timestamp("joining_window_closes_at", { withTimezone: true }),
  cycleTypeId: uuid("cycle_type_id").references(() => cycleType.id),
  // The event's own working dates — distinct from `started_at` (an
  // admin log entry of when the Cycle row itself was created). Neither
  // is required to start a cycle; missing one just means Phase
  // auto-placement, relative Task milestones/CalendarEvents, and the
  // Pack import date preview have nothing to resolve against yet. See
  // docs/spec.md's "Event window" and docs/development-plan.md's
  // Phase 39.
  startDate: date("start_date"),
  endDate: date("end_date"),
  // Plain uuid, no `.references()` — task_pack.ts already has to
  // import task.ts (for TaskPackItem's effort/openness enums), and
  // task.ts already imports cycle.ts for its own cycleId, so cycle.ts
  // importing task_pack.ts back would be a real circular import
  // between schema files. Same non-FK pattern (and same "the earlier,
  // more-core file holds the non-FK side") Community's own
  // conflictTeamTaskId/etc. already establish. Validated at the
  // application layer instead — see src/lib/task-packs/import.ts. Null
  // for a `blank` cycle or one built via the older, narrower
  // clone-previous-cycle path (Phase 6), which still runs entirely
  // in-memory and creates no real TaskPack row; set only when a cycle
  // is actually created by importing a saved TaskPack (Phase 55).
  sourcePackId: uuid("source_pack_id"),
  // The real open/closed lifecycle (Phase 65) — distinct from `status`
  // above, which already has its own unrelated "archived" value. A
  // cycle stays fully open/writable past its own end_date until
  // someone deliberately closes it; nothing auto-closes it. closedBy
  // has no circular-import concern (member.ts doesn't import cycle.ts)
  // so it's a normal FK. See src/lib/cycles/lifecycle.ts's closeCycle.
  closedBy: uuid("closed_by").references(() => member.id),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  // The shift roster's one-way open act (docs/cycle-scope-remediation-
  // plan.md §2.6/D11): null = collecting (any member can place series
  // in this cycle's roster, and they open together); set once by the
  // cycle's shift_management holder, after which new placements land
  // as proposals awaiting that same holder's confirmation. Never
  // unset — the act is deliberately irreversible.
  shiftSignupsOpenedAt: timestamp("shift_signups_opened_at", { withTimezone: true }),
});
