import { date, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { cycle } from "./cycle";

// The shared absolute/relative date shape is declared once for Phase
// boundaries and reused for Task milestones and Calendar events. A
// relative recipe has a basis (start, end, or between) and one signed
// integer value: days for start/end, hundredths of a percent for between.
// The parent context is supplied by each consumer's own relationship
// columns.
export const dateTypeEnum = pgEnum("date_type", ["absolute", "relative"]);
// A canonical relative recipe has exactly one basis:
// - start/end: signed whole-day offset from that boundary (one-sided parents
//   are valid here);
// - between: hundredths of a percent through the parent's complete span.
export const dateRelativeBasisEnum = pgEnum("date_relative_basis", ["start", "end", "between"]);

// Belongs to a Cycle, not the Community directly — different cycles can
// have different phase spines. Only meaningful if the cycle's Community
// has `phases_enabled`.
//
// Each boundary independently carries an absolute date or a canonical
// relative recipe. `start_date`/`end_date` are authoritative only in
// absolute mode; in relative mode they are eagerly cached resolved values
// so existing consumers can keep reading plain date columns. See
// `src/lib/dates/resolve.ts` for the shared authoring and resolution rules.
export const phase = pgTable("phase", {
  id: uuid("id").primaryKey().defaultRandom(),
  cycleId: uuid("cycle_id")
    .notNull()
    .references(() => cycle.id),
  name: text("name").notNull(),
  order: integer("order").notNull(),

  startDateType: dateTypeEnum("start_date_type").notNull().default("absolute"),
  startDate: date("start_date"),
  startRelativeBasis: dateRelativeBasisEnum("start_relative_basis"),
  startRelativeValue: integer("start_relative_value"),

  endDateType: dateTypeEnum("end_date_type").notNull().default("absolute"),
  endDate: date("end_date"),
  endRelativeBasis: dateRelativeBasisEnum("end_relative_basis"),
  endRelativeValue: integer("end_relative_value"),

  // Optional — "while this Phase is current, pin this module for
  // everyone actually coming to the Cycle" (e.g. Recruitment during a
  // Recruitment phase, Shifts once sign-ups matter). A plain nav
  // moduleKey (src/components/nav/nav-config.ts's ModuleKey), read by
  // src/lib/nav.ts's getNavContext — never bypasses
  // Community.modulesEnabled, only promotes an already-visible module
  // into the pinned section for Participation.status='coming' members.
  highlightModuleKey: text("highlight_module_key"),
});
