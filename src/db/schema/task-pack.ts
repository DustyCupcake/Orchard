import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { dateRelativeBasisEnum } from "./phase";
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
// exactly one Community — see docs/roadmap.md), so every pack row
// that exists in a given database
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

// A pack's own phase spine — timeless, no absolute dates. Each
// boundary carries the canonical relative basis/value recipe.
// `order` doubles as this phase's local reference key within the pack.
export const packPhase = pgTable("pack_phase", {
  id: uuid("id").primaryKey().defaultRandom(),
  packId: uuid("pack_id")
    .notNull()
    .references(() => taskPack.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  startRelativeBasis: dateRelativeBasisEnum("start_relative_basis"),
  startRelativeValue: integer("start_relative_value"),
  endRelativeBasis: dateRelativeBasisEnum("end_relative_basis"),
  endRelativeValue: integer("end_relative_value"),
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
  // [{label, parentType, phaseRef, relativeBasis, relativeValue}] —
  // only relative, confirmed milestones carry into a pack.
  milestones: jsonb("milestones").notNull().default([]),
  // Which modules this task granted at export time — the permission_grant
  // module keys the source task carried (docs/cycle-scope-remediation-
  // plan.md §4.4), so pack import can re-grant the imported task and the
  // imported cycle arrives with its own authorities the same way a
  // cloned cycle does. The imported grant's scope comes from the imported
  // task's own placement (§2.1), never from anything carried here.
  grantModuleKeys: text("grant_module_keys").array().notNull().default([]),
});
