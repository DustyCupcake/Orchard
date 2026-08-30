import { date, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { cycle } from "./cycle";

// The shared absolute/relative date shape spec defines once for Phase
// boundaries and reuses for Task milestones (Phase 41) and Freestanding
// events (Phase 42) — see docs/spec.md's "Absolute"/"Relative" and
// docs/development-plan.md's Phase 39. Each consumer still declares its
// own columns (Phase's anchor is always its own Cycle, so it only needs
// a 2-way anchor enum; Task milestone's anchor can also be a Phase
// boundary, a 4-way enum) — these two enums aren't literally shared
// across tables, just the same conceptual shape.
export const dateTypeEnum = pgEnum("date_type", ["absolute", "relative"]);
export const dateRelativeModeEnum = pgEnum("date_relative_mode", ["offset", "percent"]);
export const cycleOffsetAnchorEnum = pgEnum("cycle_offset_anchor", ["cycle_start", "cycle_end"]);

// Belongs to a Cycle, not the Community directly — different cycles can
// have different phase spines. Only meaningful if the cycle's Community
// has `phases_enabled`.
//
// Each boundary (start/end) independently carries the full shape: a
// hand-typed absolute date, or relative — an offset (signed day count
// from one of the Cycle's own boundaries) or a percent of the way
// between the Cycle's start and end. `start_date`/`end_date` are
// authoritative only in absolute mode; in relative mode they're a
// resolved value **eagerly cached and recomputed on every write that
// could move it** (this boundary's own mode/anchor/offset/percent
// changing, or the anchor Cycle's own start_date/end_date changing) —
// a deliberate exception to this codebase's usual "never persist
// derived state" posture, since `src/lib/contribution.ts` and
// `src/lib/attention/job.ts` already do plain reads against these two
// columns expecting a real date, not a live computation. See
// src/lib/dates/resolve.ts for the resolution helper and
// src/lib/cycles/phases.ts for what recomputes it.
export const phase = pgTable("phase", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycle.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),

  startDateType: dateTypeEnum("start_date_type").notNull().default("absolute"),
  startDate: date("start_date"),
  startRelativeMode: dateRelativeModeEnum("start_relative_mode"),
  startOffsetAnchor: cycleOffsetAnchorEnum("start_offset_anchor"),
  startOffsetDays: integer("start_offset_days"),
  startPercent: integer("start_percent"),

  endDateType: dateTypeEnum("end_date_type").notNull().default("absolute"),
  endDate: date("end_date"),
  endRelativeMode: dateRelativeModeEnum("end_relative_mode"),
  endOffsetAnchor: cycleOffsetAnchorEnum("end_offset_anchor"),
  endOffsetDays: integer("end_offset_days"),
  endPercent: integer("end_percent"),
});
