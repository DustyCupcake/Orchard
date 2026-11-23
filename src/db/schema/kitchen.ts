import { date, integer, jsonb, numeric, pgEnum, pgTable, text, time, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { community } from "./community";
import { cycle } from "./cycle";
import { member } from "./member";
import { mealSlotEnum, type MealSlot } from "./participation";
import { phase } from "./phase";
import { shiftSeries } from "./shift";

// The Kitchen module — the spec's "Food & drinks (Fruit)" restored as an
// optional module of the generic engine. See docs/spec.md's "Kitchen" and
// docs/plans/archive/food-drinks-module-plan.md's D1-D9 for the resolved design: a
// per-scope menu plan (draft → published, event-scheduling's publish-gate
// posture), meals on a plain absolute date (D6), dishes as recipes with
// serving counts that scale to a meal's headcount into a purchasing list
// (D8), a food-ideas inbox (D5), and a dietary-constraint surface that
// only ever reads member allergies through the sensitive-data module's
// own gate (D3/D4). This file imports community/cycle/phase/member/
// shift — none of which import it back.

export const dishSourceEnum = pgEnum("dish_source", ["seed", "from_idea", "from_recipe"]);
// Curation states for the community recipe box. Suggested and declined recipes
// stay visible, Yum-able and discussable; only accepted recipes can be applied
// to a meal. Decline is about a recipe unfit to cook from, not its author.
export const recipeStatusEnum = pgEnum("recipe_status", ["suggested", "accepted", "declined"]);
export const foodIdeaKindEnum = pgEnum("food_idea_kind", [
  "recipe_suggestion",
  "dish_request",
  "preference",
]);
export const foodIdeaStatusEnum = pgEnum("food_idea_status", ["open", "adopted", "declined"]);
// Where a meal's headcount comes from: typed by the holder, or worked out from
// the event's Participation (arrival and departure) when the plan belongs to
// an event. Derived on read in both cases — nothing is written back.
export const mealHeadCountSourceEnum = pgEnum("meal_head_count_source", ["manual", "participation"]);

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
  // role) — see docs/plans/archive/cycle-scope-remediation-plan.md's §2.1 placement
  // convention, mirrored from task.cycleId/shift_series.cycleId.
  cycleId: uuid("cycle_id").references(() => cycle.id),
  title: text("title").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  // This menu's default clock times for breakfast, lunch and dinner, as
  // "HH:MM" strings; a slot left out falls back to the built-in default
  // (src/lib/kitchen/attendance.ts). Used only to decide whether someone who
  // arrives or leaves part-way through a day is there for a meal.
  mealTimes: jsonb("meal_times").$type<Partial<Record<MealSlot, string>>>(),
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
  // Optional: which of the day's meals this is, and a clock time that
  // overrides the menu's default for that slot. Both exist only to tell
  // whether a part-day arrival or departure is there for the meal; a meal
  // with neither is still a perfectly good meal, and its arrival and
  // departure days are counted and flagged as uncertain.
  slot: mealSlotEnum("slot"),
  time: time("time"),
  // "participation" works the headcount out from the event's arrivals and
  // departures, plus `guests`; "manual" uses `headCount` as typed.
  headCountSource: mealHeadCountSourceEnum("head_count_source").notNull().default("manual"),
  // People who eat but aren't members with a Participation row — visitors,
  // day helpers. Added to the worked-out number; ignored for a manual count.
  guests: integer("guests").notNull().default(0),
  // D7: optional link to a ShiftSeries (the shifts module) so the cooking
  // roster for "Friday dinner" is one click from the meal. Meaningless
  // when the shifts module is off — the field stays null and the meal
  // stands alone.
  shiftSeriesId: uuid("shift_series_id").references(() => shiftSeries.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Concern comments on a meal. Draft menus are community-readable so a member
// can raise "this clashes with X" before publishing locks the plan; comments
// stay attributed, like task comments, because the planner may need to ask.
// Writes are allowed only while the plan is a draft (enforced in the lib).
export const mealComment = pgTable("meal_comment", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealId: uuid("meal_id")
    .notNull()
    .references(() => meal.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The community recipe box. This is the reusable recipe, unlike `dish`, which
// is one meal's occurrence of it. It belongs to the Community rather than a
// menu or a cycle, so a good recipe survives the event it was suggested in.
// `communityId` is explicit (unlike the meal's implicit scoping) because the
// box has no parent plan to inherit it from.
export const recipe = pgTable("recipe", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  title: text("title").notNull(),
  body: text("body"),
  serves: integer("serves"),
  allergenFlags: text("allergen_flags").array().notNull().default([]),
  dietaryNote: text("dietary_note"),
  status: recipeStatusEnum("status").notNull().default("suggested"),
  suggestedBy: uuid("suggested_by")
    .notNull()
    .references(() => member.id),
  reviewedBy: uuid("reviewed_by").references(() => member.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  declineReason: text("decline_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Amounts are recorded at the recipe's own `serves`, like dishIngredient.
// Null amount is "to taste" — never scaled, and shown as written.
export const recipeIngredient = pgTable("recipe_ingredient", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipe.id),
  name: text("name").notNull(),
  amount: numeric("amount"),
  unit: text("unit"),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A Yum is an indicative sign of support, not a vote. The member id exists only
// to make one Yum per member possible; no recipe view ever shows who Yummed it.
export const recipeYum = pgTable(
  "recipe_yum",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipe.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => member.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("recipe_yum_recipe_member_idx").on(table.recipeId, table.memberId)],
);

// Recipe discussion is attributed, like the Kitchen's other comment threads —
// a holder may need to ask what "a handful" means.
export const recipeComment = pgTable("recipe_comment", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipe.id),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A menu item on a meal — a recipe. allergenFlags is a text[] bounded to
// the ALLERGEN_FLAGS const in src/lib/kitchen/dietary.ts (validated at the
// application layer), deliberately NOT a DB enum so future flag additions
// are a one-line change rather than a migration (same const-enum posture
// as SENSITIVE_FIELD_KEYS). source records where the dish came from —
// owner-entered ("seed"), adopted from a foodIdea ("from_idea", D5), or copied
// from the community recipe box ("from_recipe", which links through recipeId).
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
  // Provenance for a dish copied from the community recipe box. The dish keeps
  // its own copy of every field, so later edits to the box don't rewrite a
  // planned meal.
  recipeId: uuid("recipe_id").references(() => recipe.id),
  // When this dish last took its content from the linked recipe (applied,
  // saved to the box, or updated from it). The recipe has changed since if its
  // `updatedAt` is later. Null on a dish linked before this column existed,
  // which reads as "synced when the dish was created".
  recipeSyncedAt: timestamp("recipe_synced_at", { withTimezone: true }),
  // The dish's own scale factor for a recipe applied to a meal. Null means a
  // plain dish, which keeps the older headCount / serves scaling on read.
  // Applied recipes store the suggested (or planner-edited) multiplier here.
  multiplier: numeric("multiplier"),
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
  // Nullable for "salt, to taste": a line with no amount is listed as written
  // and left out of scaling, and a purchase list shows it without a number.
  // Member-written recipes hit this immediately.
  amount: numeric("amount"),
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
  // A recipe suggestion carries a recipe's shape — serves, allergen flags, a
  // note, and ingredient rows (foodIdeaIngredient) — so adopting it creates a
  // pre-filled dish rather than an empty one. Only `recipe_suggestion` uses
  // these; a dish request or a preference stays a title and a body. The
  // flags are the suggester's claim, not a fact: the holder sees them
  // pre-filled and editable at adoption, and the dish records the holder's
  // final set. `body` keeps its job as method and notes.
  serves: integer("serves"),
  allergenFlags: text("allergen_flags").array().notNull().default([]),
  dietaryNote: text("dietary_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// An ingredient on a recipe suggestion, mirroring dishIngredient so adoption
// is a copy. Recorded at the recipe's own scale (against `foodIdea.serves`);
// amount is nullable for "to taste". Deleted with its idea — an open idea
// is withdrawn by its author, and an adopted one keeps these rows as the
// record of what was suggested (the dish gets its own copies).
export const foodIdeaIngredient = pgTable("food_idea_ingredient", {
  id: uuid("id").primaryKey().defaultRandom(),
  ideaId: uuid("idea_id")
    .notNull()
    .references(() => foodIdea.id),
  name: text("name").notNull(),
  amount: numeric("amount"),
  unit: text("unit"),
  sortOrder: integer("sort_order"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});