import { date, integer, numeric, pgEnum, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";
import { phase } from "./phase";
import { shiftSeries } from "./shift";

// The Kitchen module — the spec's "Food & drinks (Fruit)" restored as an
// optional module of the generic engine. See docs/spec.md's "Kitchen" and
// docs/food-drinks-module-plan.md's D1-D9 for the resolved design: a
// per-scope menu plan (draft → published, event-scheduling's publish-gate
// posture), meals on a plain absolute date (D6), dishes as recipes with
// serving counts that scale to a meal's headcount into a purchasing list
// (D8), a food-ideas inbox (D5), and a dietary-constraint surface that
// only ever reads member allergies through the sensitive-data module's
// own gate (D3/D4). This file imports community/cycle/phase/member/
// shift — none of which import it back.

export const dishSourceEnum = pgEnum("dish_source", ["seed", "from_idea"]);
export const foodIdeaKindEnum = pgEnum("food_idea_kind", [
  "recipe_suggestion",
  "dish_request",
  "preference",
]);
export const foodIdeaStatusEnum = pgEnum("food_idea_status", ["open", "adopted", "declined"]);

// One per scope (cycle-placed, or the cycle-less standing menu), the
// module's named container and its only publish gate — D1. A single
// publishedAt timestamp does double duty the way eventProposal.publishedAt
// does: null = draft, owner-visible and editable only; set = published,
// community-readable and locked against further edits. No separate status
// column — one gate, not two. Owner always comes from the `kitchen`
// permission grant for the plan's scope (task.cycleId); deliberately NO
// ownerTaskId pointer here, unlike legacy budgetCycle — D2.
export const menuPlan = pgTable("menu_plan", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // null = the standing/evergreen menu (cycles off, or the cycle-less
  // role) — see docs/cycle-scope-remediation-plan.md's §2.1 placement
  // convention, mirrored from task.cycleId/shift_series.cycleId.
  cycleId: uuid("cycle_id").references(() => cycle.id),
  title: text("title").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per dated meal on the menu — the "food schedule". D6: v1 uses a
// plain absolute date (folds into the shared date recipe's later
// streamline) plus an optional phase anchor. headCount is the planner-
// entered expected eaters that scaling reads (D8); a null headCount means
// "no scaling, recipe scale only".
export const meal = pgTable("meal", {
  id: uuid("id").primaryKey().defaultRandom(),
  menuPlanId: uuid("menu_plan_id")
    .notNull()
    .references(() => menuPlan.id),
  label: text("label").notNull(),
  date: date("date").notNull(),
  phaseId: uuid("phase_id").references(() => phase.id),
  headCount: integer("head_count"),
  // D7: optional link to a ShiftSeries (the shifts module) so the cooking
  // roster for "Friday dinner" is one click from the meal. Meaningless
  // when the shifts module is off — the field stays null and the meal
  // stands alone.
  shiftSeriesId: uuid("shift_series_id").references(() => shiftSeries.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A menu item on a meal — a recipe. allergenFlags is a text[] bounded to
// the ALLERGEN_FLAGS const in src/lib/kitchen/dietary.ts (validated at the
// application layer), deliberately NOT a DB enum so future flag additions
// are a one-line change rather than a migration (same const-enum posture
// as SENSITIVE_FIELD_KEYS). source records where the dish came from —
// owner-entered ("seed") or adopted from a foodIdea ("from_idea", D5),
// which links back through sourceIdeaId.
export const dish = pgTable("dish", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealId: uuid("meal_id")
    .notNull()
    .references(() => meal.id),
  name: text("name").notNull(),
  description: text("description"),
  // People this recipe as written feeds — the scale base for the meal's
  // headCount factor (D8). null = no scaling for this dish.
  serves: integer("serves"),
  allergenFlags: text("allergen_flags").array().notNull().default([]),
  dietaryNote: text("dietary_note"),
  source: dishSourceEnum("source").notNull().default("seed"),
  // AnyPgColumn escape hatch for the dish ↔ foodIdea back-link pair
  // (dish.sourceIdeaId ↔ foodIdea.adoptedDishId), the same
  // self-referential-FK treatment task.ts's parentTaskId uses.
  sourceIdeaId: uuid("source_idea_id").references((): AnyPgColumn => foodIdea.id),
  addedBy: uuid("added_by")
    .notNull()
    .references(() => member.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A recipe's ingredient, recorded at recipe-as-written scale (D8). name is
// free text — the purchasing list groups by exact name, and "flour" vs
// "plain flour" deliberately don't merge (the plan calls that honest).
// amount scales by headCount / serves on read only, never written back.
export const dishIngredient = pgTable("dish_ingredient", {
  id: uuid("id").primaryKey().defaultRandom(),
  dishId: uuid("dish_id")
    .notNull()
    .references(() => dish.id),
  name: text("name").notNull(),
  amount: numeric("amount").notNull(),
  unit: text("unit"),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The participatory-input inbox (D5) — open-ended, persistent until
// decided on, deliberately separate from Input rounds (batched/closed-
// choice questions). Attributed (no anonymity — a cook may need to ask
// about a recipe, same posture as task comments). status is reviewable
// until the owner adopts (creates the dish + links adoptedDishId in one
// transaction, from dishes.ts) or declines with an optional reason.
export const foodIdea = pgTable("food_idea", {
  id: uuid("id").primaryKey().defaultRandom(),
  menuPlanId: uuid("menu_plan_id")
    .notNull()
    .references(() => menuPlan.id),
  kind: foodIdeaKindEnum("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  suggestedBy: uuid("suggested_by")
    .notNull()
    .references(() => member.id),
  status: foodIdeaStatusEnum("status").notNull().default("open"),
  declinedReason: text("declined_reason"),
  adoptedDishId: uuid("adopted_dish_id").references((): AnyPgColumn => dish.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});