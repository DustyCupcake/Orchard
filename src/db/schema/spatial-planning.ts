import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";
import { task } from "./task";

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

export const placementShapeTypeEnum = pgEnum("placement_shape_type", [
  "rectangle",
  "circle",
  "polygon",
  "line",
]);
// A closed set, unlike Zone's free-text category — spec.md's Placement
// bullet names exactly these five and ties rendered color to category
// (no separate stored color field), which only works with a fixed
// small palette. Zone stays free-text because it's organizational
// overlay, not an individual object with a category-driven look.
export const placementCategoryEnum = pgEnum("placement_category", [
  "tent",
  "vehicle",
  "structure",
  "furniture",
  "generic",
]);
export const placementStatusEnum = pgEnum("placement_status", ["confirmed", "pending"]);

// An individual shape drawn within a Plot — a tent, vehicle, structure,
// or piece of furniture, sized and positioned to real-world scale (see
// docs/spec.md's Spatial planning). `geometry`'s shape depends on
// `shapeType`: rectangle => {x,y,width,height,rotation} (x,y is the
// center, width/height/position in the Plot's local units, rotation in
// degrees — the one shape type this phase's drag-handle rotation
// actually applies to, since a circle is rotation-invariant and an
// arbitrary polygon/line is reshaped by moving its own points instead,
// the same vertex-editing model Zone already uses); circle =>
// {x,y,radius}; polygon => {points:[{x,y}...]}; line =>
// {points:[{x,y}...]} (an open path, not a closed ring like polygon).
// See src/lib/spatial-planning/geometry.ts for the shared area/length/
// GeoJSON conversions per shape type.
export const placement = pgTable("placement", {
  id: uuid("id").primaryKey().defaultRandom(),
  plotId: uuid("plot_id")
    .notNull()
    .references(() => plot.id),
  // Purely organizational filing, same as Zone's own category — not a
  // rights-granting link. Nullable: plenty of Placements (a communal
  // structure spanning the whole site) don't belong to any one Zone.
  zoneId: uuid("zone_id").references(() => zone.id),
  shapeType: placementShapeTypeEnum("shape_type").notNull(),
  geometry: jsonb("geometry").notNull(),
  label: text("label").notNull(),
  category: placementCategoryEnum("category").notNull(),
  // A fresh schema file — task.ts has no reason to ever import
  // spatial-planning.ts back, so this gets a real FK, the same
  // reasoning Budget's ownerTaskId and Event scheduling's cycleId
  // already relied on, unlike Community's own non-FK task pointers
  // (community.ts genuinely does get imported back by task.ts's
  // siblings). Null = no linked Task — an individual member's own tent,
  // or a communal structure nobody's specifically building.
  linkedTaskId: uuid("linked_task_id").references(() => task.id),
  // `status`/`pending_*` power the propose→approve/revert workflow —
  // Phase 38's, not this one. Every Placement Phase 37 creates or edits
  // stays `confirmed`, the same single-editor-by-the-task-holder model
  // Zone already uses; nothing in this phase ever produces `pending`.
  status: placementStatusEnum("status").notNull().default("confirmed"),
  pendingByMemberId: uuid("pending_by_member_id").references(() => member.id),
  pendingPrevGeometry: jsonb("pending_prev_geometry"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A small Community-scoped reusable-shape library — see docs/spec.md's
// "Shape inventory." Saved from an existing Placement (decoupled, no
// live link back) or seeded as a common default (a 2-person tent, a
// van); starting a new Placement from one just copies these fields
// once as a starting point, still freely resized/rotated/repositioned
// afterward.
export const placementTemplate = pgTable("placement_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  name: text("name").notNull(),
  shapeType: placementShapeTypeEnum("shape_type").notNull(),
  geometry: jsonb("geometry").notNull(),
  category: placementCategoryEnum("category").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const placementMemberStatusEnum = pgEnum("placement_member_status", ["invited", "confirmed"]);

// Join table linking zero or more Members to a Placement — a shared
// tent/vehicle is one Placement with several linked Members, not
// several overlapping Placements (see docs/spec.md's Spatial
// planning). Phase 37 only ever creates `confirmed` rows (the task
// holder places people directly); the `invited` state and the actual
// accept/decline flow that uses it are Phase 38's — see "Shared
// placements: invite → accept."
export const placementMember = pgTable("placement_member", {
  placementId: uuid("placement_id")
    .notNull()
    .references(() => placement.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  status: placementMemberStatusEnum("status").notNull().default("confirmed"),
  invitedBy: uuid("invited_by")
    .notNull()
    .references(() => member.id),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
});

export const sleepArrangementEnum = pgEnum("sleep_arrangement", [
  "solo_tent",
  "shared_tent",
  "solo_vehicle",
  "shared_vehicle",
  "other",
]);

// A member-profile extension, only present when the module is on — see
// docs/spec.md's "Space preferences." One row per member (memberId is
// the primary key, not a separate id — this is a standing profile
// fact like a contact method, always self-editable, not a submission
// history). Purely informational in Phase 37 and beyond: it feeds the
// layout conversation, never grants anything and never auto-places
// anyone on its own — a stated `sharingWith` intent only becomes a
// structural fact through the actual invite/accept flow (Phase 38's
// "Shared placements").
export const spacePreference = pgTable("space_preference", {
  memberId: uuid("member_id")
    .primaryKey()
    .references(() => member.id),
  sleepArrangement: sleepArrangementEnum("sleep_arrangement").notNull(),
  // {length, width, height} in meters, only meaningful for a vehicle
  // arrangement — nullable since a tent-only member has none to give.
  vehicleDimensions: jsonb("vehicle_dimensions"),
  // "Prefer to be placed near" — proximity only, distinct from
  // sharingWith below (see the spec's own "a different question from
  // just wanting to be nearby").
  groupWith: uuid("group_with").array(),
  // Who this member expects to actually occupy the same tent/vehicle
  // with — pre-fills invite suggestions on a shared Placement (Phase
  // 38), but is never by itself confirmation from the other side.
  sharingWith: uuid("sharing_with").array(),
  accessibilityNotes: text("accessibility_notes"),
});

// The one Placement-review outcome that needs a real, persisted
// notice rather than a computed feed read (docs/spec.md's Multi-user
// placement: "revert... notifies whoever made the change why, if they
// leave a note"). Every other notification this module needs — an
// invite awaiting response, a Placement currently `pending` and
// awaiting review — is just a live query over PlacementMember/
// Placement state, the same "computed, never separately maintained"
// posture the rest of this codebase uses (see src/lib/dashboard.ts).
// A revert is different: once it happens, `placement.status` goes
// straight back to `confirmed` and there's no lingering state left to
// read, so the fact that it happened — and any note — has to be
// captured somewhere or it's gone the instant the review completes.
// Visible to its recipient until acknowledged, the same "a real row,
// visible until resolved" shape `coordinatorPing` already established.
export const placementRevertNotice = pgTable("placement_revert_notice", {
  id: uuid("id").primaryKey().defaultRandom(),
  placementId: uuid("placement_id")
    .notNull()
    .references(() => placement.id),
  // Whoever's edit got reverted — always a real Member, whether they
  // held edit rights via a confirmed PlacementMember link or via
  // holding the Placement's linkedTaskId.
  recipientMemberId: uuid("recipient_member_id")
    .notNull()
    .references(() => member.id),
  revertedBy: uuid("reverted_by")
    .notNull()
    .references(() => member.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
});
