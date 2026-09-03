import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { dateRelativeModeEnum, cycleOffsetAnchorEnum } from "./phase";
import { taskEffortEnum, taskOpennessEnum } from "./task";

// A portable, importable bundle of tasks — see docs/spec.md's "Task
// Pack" and docs/development-plan.md's Phase 55. Phase 6's own
// clone-previous-cycle flow already runs this exact mechanism inline,
// against an in-memory recipe rather than a persisted row — these
// three tables are what finally give it (and a real cross-community
// import) something to persist into and read back from.
//
// communityId is NOT NULL, unlike spec's own "nullable — null for a
// pack authored for cross-community sharing" framing: this codebase
// has explicitly decided against multi-tenancy (one deployment hosts
// exactly one Community — see docs/development-plan.md's "Beyond
// Phase 59"), so every pack row that exists in a given database
// already belongs to the one Community that database hosts. Cross-
// community sharing still works exactly as spec describes — a pack
// round-trips as a downloaded/uploaded JSON file, "link, don't host,"
// the same posture Task Resources already established — it just means
// a *different* real row (with the destination's own communityId) on
// the far end, not a shared null-owner row.
export const taskPack = pgTable("task_pack", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  name: text("name").notNull(),
  description: text("description"),
  // Free text — "where this pack came from" (e.g. "Peach Please 2026
  // Season," or another deployment's name), not a structured reference.
  source: text("source"),
  version: text("version").notNull().default("1"),
  domainTags: text("domain_tags").array().notNull().default([]),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Retiring a pack without losing its history — same posture
  // ShiftSeries.archivedAt already established.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// A pack's own phase spine — timeless, no absolute dates (a pack never
// holds one; see Task Pack in spec.md), only the relative recipe
// Phase 39's dateRelativeModeEnum/cycleOffsetAnchorEnum already define.
// `order` doubles as this phase's local reference key within the pack
// (spec's own words) — TaskPackItem.phaseRef points at it directly, no
// separate id scheme needed.
export const packPhase = pgTable("pack_phase", {
  id: uuid("id").primaryKey().defaultRandom(),
  packId: uuid("pack_id")
    .notNull()
    .references(() => taskPack.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  startRelativeMode: dateRelativeModeEnum("start_relative_mode"),
  startOffsetAnchor: cycleOffsetAnchorEnum("start_offset_anchor"),
  startOffsetDays: integer("start_offset_days"),
  startPercent: integer("start_percent"),
  endRelativeMode: dateRelativeModeEnum("end_relative_mode"),
  endOffsetAnchor: cycleOffsetAnchorEnum("end_offset_anchor"),
  endOffsetDays: integer("end_offset_days"),
  endPercent: integer("end_percent"),
});

// One task, minus every Community/Cycle-specific id — see spec.md's
// "each with the fields above minus Community-specific IDs (owner,
// actual dates)." branchNameHint is matched-or-remapped against the
// destination's real branches on import (see Pack import review);
// phaseRef is a direct, certain reference to a PackPhase.order in this
// *same* pack, never matched by name (the pack owns and defines its
// own phase list, so there's no ambiguity the way there is for
// Branch). wikiSummarySeed/resources/milestones carry no member
// reference at all (unlike the live Task/TaskResource/TaskMilestone
// rows they're drawn from) — deliberately: a pack is meant to travel
// across communities, where an original author's member id would be
// meaningless, so attribution on import always falls to the importing
// actor instead (see src/lib/task-packs/import.ts).
export const taskPackItem = pgTable("task_pack_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  packId: uuid("pack_id")
    .notNull()
    .references(() => taskPack.id),
  branchNameHint: text("branch_name_hint").notNull(),
  phaseRef: integer("phase_ref"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").array().notNull().default([]),
  effort: taskEffortEnum("effort").notNull(),
  effortMagnitude: jsonb("effort_magnitude").notNull(),
  critical: boolean("critical").notNull().default(false),
  capacity: integer("capacity").default(1),
  openness: taskOpennessEnum("openness").notNull().default("request"),
  endorsementThreshold: integer("endorsement_threshold"),
  // [{type, mode, value}] — same shape as the real Requirement table,
  // per task, minus its own id/taskId (see spec's item field list).
  requirements: jsonb("requirements").notNull().default([]),
  wikiSummarySeed: text("wiki_summary_seed"),
  // [{label, url, tag}]
  resources: jsonb("resources").notNull().default([]),
  // [{label, anchorType, relativeMode, offsetDays, percent, phaseRef}]
  // — only relative, confirmed milestones ever carry into a pack (the
  // same rule src/lib/cycles/crud.ts's cloneTaskMilestones already
  // enforces for clone-previous-cycle); phaseRef here is independent
  // of the item's own phaseRef above, since a milestone can anchor to
  // a different phase than its task's own (see Phase 41).
  milestones: jsonb("milestones").notNull().default([]),
});
