import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";

// Spatial planning — see docs/spec.md's "Spatial planning" (including
// its "Cloning across cycles" subsection) and docs/development-plan.md's
// Phase 36-38. Phase 36 builds Plot/Zone; Placement/PlacementMember/
// SpacePreference/PlacementTemplate are Phase 37's.

// The base a site gets planned against — one per Cycle, not one per
// Community (docs/development-plan.md's Phase 36: a Community running
// recurring Cycles genuinely re-plans its site each time). cycleId is
// nullable, same "optional association, ties to a real Cycle when
// cycles are on" pattern BudgetCycle/EventProposal already use — a
// Community with cyclesEnabled=false can have zero Cycle rows ever
// (see src/lib/profile-questions/capacity.ts's getCurrentCycle comment),
// so a NOT NULL FK would make Spatial planning uncreatable for it. Null
// means "the one, whole-Community Plot," the same single-Plot shape
// this had before Cycle-scoping — "one per Cycle" enforcement in
// src/lib/spatial-planning/plots.ts treats a null cycleId as just
// another value to be unique per, not a special case. No DB-level
// unique constraint on cycleId, same posture this codebase already
// takes for comparable "one row per X" business rules (BudgetCycle's
// "only one active cycle," Participation's per-(cycle,member) row).
export const plot = pgTable("plot", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  cycleId: uuid("cycle_id").references(() => cycle.id),
  name: text("name").notNull(),
  // Resolved interpretation: this codebase has no object storage /
  // upload infrastructure anywhere yet (checked — no precedent), so for
  // v1 a raster base image is a `data:` URI stored directly in this
  // text column rather than a real hosted URL — the column still holds
  // "whatever string a browser's <img src> can render," same as before,
  // just without inventing filesystem/volume/S3 infrastructure for one
  // feature. Size-capped at the application layer (see plots.ts). Null
  // when a vector import or a hand-drawn boundary is used instead.
  baseImageUrl: text("base_image_url"),
  // GeoJSON import (a Feature or FeatureCollection), used instead of a
  // raster base image. Null when a raster image or hand-drawn boundary
  // is used instead.
  baseVector: jsonb("base_vector"),
  // {pointA:{x,y,lat?,lng?}, pointB:{x,y,lat?,lng?}, realWorldDistanceMeters?} —
  // the two-point calibration spec asks for ("mark two points, enter
  // the real-world distance"), extended with an optional GPS coordinate
  // per point (see docs/spec.md's "Geo-anchoring (optional)"). When
  // both points carry lat/lng, the real-world distance is *derived*
  // (haversine between them) rather than also stored separately, so the
  // two numbers can't drift apart — see
  // src/lib/spatial-planning/geometry.ts's metersPerUnit. Null until a
  // Plot is first calibrated — no area/length math is possible before
  // that (see requireCalibration in plots.ts).
  scaleCalibration: jsonb("scale_calibration"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A named, organizational polygon region within a Plot — camping area,
// kitchen, parking, quiet zone, etc. Purely organizational: no
// overlap/out-of-bounds checking against other Zones (that concept
// only applies to Placements once they exist, and even there it's
// deliberately out of scope for now — see docs/spec.md).
export const zone = pgTable("zone", {
  id: uuid("id").primaryKey().defaultRandom(),
  plotId: uuid("plot_id")
    .notNull()
    .references(() => plot.id),
  name: text("name").notNull(),
  // Free-text, community-defined — no fixed category list to fight
  // against, same posture Resources' own tags already take elsewhere
  // in this codebase.
  category: text("category").notNull(),
  // Array of {x, y} points in the Plot's own local coordinate units
  // (not pixels-on-screen, not lat/lng) — real-world area/length are
  // derived from these via the Plot's scaleCalibration, never stored
  // redundantly here.
  polygon: jsonb("polygon").notNull(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
