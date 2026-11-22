import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import {
  dish,
  dishIngredient,
  meal,
  menuPlan,
  member,
  recipe,
  recipeComment,
  recipeIngredient,
  recipeStatusEnum,
  recipeYum,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { isAnyKitchenHolder, isKitchenOwner, requireAnyKitchenHolder } from "./access";
import { getDish, parseAllergenFlags } from "./dishes";
import { getMeal } from "./meals";
import { requireEditableMenuPlan, requireKitchenModuleOn } from "./menu";
import { resolveMealHeadCount } from "./attendance";
import { suggestedMultiplier } from "./scaling";
import { ALLERGEN_FLAGS } from "./allergens";

type Member = typeof memberTable.$inferSelect;
export type RecipeStatus = (typeof recipeStatusEnum.enumValues)[number];
export type RecipeRow = typeof recipe.$inferSelect;
export type RecipeIngredientRow = typeof recipeIngredient.$inferSelect;
export type RecipeWithIngredients = RecipeRow & { ingredients: RecipeIngredientRow[] };

// The read model deliberately has no Yum author list and no per-Yum rows: only
// a count and this viewer's own toggle state. Attribution belongs on comments,
// where a holder may need to ask what "a handful" means.
export type RecipeListItem = RecipeWithIngredients & {
  authorName: string;
  yumCount: number;
  commentCount: number;
  viewerYummed: boolean;
};

export type RecipeCommentWithAuthor = {
  id: string;
  recipeId: string;
  memberId: string;
  body: string;
  createdAt: Date;
  authorName: string;
};

export type EditableMeal = {
  id: string;
  label: string;
  date: string;
  menuPlanId: string;
};

// One ingredient line, mirroring dishIngredient. A null amount is "to taste"
// and is never scaled.
export const recipeIngredientInput = z.object({
  name: z.string().min(1),
  amount: z.number().positive().nullable().optional(),
  unit: z.string().nullable().optional(),
});
export type RecipeIngredientInput = z.infer<typeof recipeIngredientInput>;

const recipeFields = {
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  serves: z.number().int().positive().nullable().optional(),
  allergenFlags: z.array(z.enum(ALLERGEN_FLAGS)).optional(),
  dietaryNote: z.string().nullable().optional(),
  // A cap, not a design limit: one submit should not be able to write
  // thousands of rows.
  ingredients: z.array(recipeIngredientInput).max(80).optional(),
};

export const createRecipeInput = z.object(recipeFields);
export type CreateRecipeInput = z.infer<typeof createRecipeInput>;
export const updateRecipeInput = z.object(recipeFields).partial();
export type UpdateRecipeInput = z.infer<typeof updateRecipeInput>;
export const declineRecipeInput = z.object({ declineReason: z.string().trim().min(1) });
export type DeclineRecipeInput = z.infer<typeof declineRecipeInput>;

// Half steps from 0.5 upward: the planner can adjust the suggestion, but the
// number shown and the number the shopping list uses are always the same.
const multiplierInput = z
  .number()
  .min(0.5)
  .refine((n) => Number.isInteger(n * 2), "Use a half step such as 0.5, 1 or 1.5");

export const applyRecipeInput = z.object({
  recipeId: z.string().uuid(),
  mealId: z.string().uuid(),
  multiplier: multiplierInput.optional(),
});
export type ApplyRecipeInput = z.infer<typeof applyRecipeInput>;

async function getRecipeInCommunity(actor: Member, id: string): Promise<RecipeRow> {
  const [row] = await db
    .select()
    .from(recipe)
    .where(and(eq(recipe.id, id), eq(recipe.communityId, actor.communityId)));
  if (!row) throw new NotFoundError("Recipe not found");
  return row;
}

async function insertIngredients(tx: DbOrTx, recipeId: string, ingredients: RecipeIngredientInput[]) {
  if (ingredients.length === 0) return;
  await tx.insert(recipeIngredient).values(
    ingredients.map((ing, i) => ({
      recipeId,
      name: ing.name,
      amount: ing.amount == null ? null : String(ing.amount),
      unit: ing.unit ?? null,
      sortOrder: i,
    })),
  );
}

async function withIngredients(rows: RecipeRow[]): Promise<RecipeWithIngredients[]> {
  if (rows.length === 0) return [];
  const found = await db
    .select()
    .from(recipeIngredient)
    .where(inArray(recipeIngredient.recipeId, rows.map((r) => r.id)))
    .orderBy(asc(recipeIngredient.sortOrder), asc(recipeIngredient.createdAt));
  const byRecipe = new Map<string, RecipeIngredientRow[]>();
  for (const row of found) {
    const list = byRecipe.get(row.recipeId) ?? [];
    list.push(row);
    byRecipe.set(row.recipeId, list);
  }
  return rows.map((row) => ({ ...row, ingredients: byRecipe.get(row.id) ?? [] }));
}

// Counts are read in bulk rather than through a correlated subquery per card:
// the browse page can hold the whole box, and this keeps it to three statements
// whatever the number of recipes. Yum rows are counted, never rendered.
async function decorate(actor: Member, rows: RecipeRow[]): Promise<RecipeListItem[]> {
  const full = await withIngredients(rows);
  if (full.length === 0) return [];
  const ids = full.map((r) => r.id);

  const [authors, yums, comments] = await Promise.all([
    db
      .select({ id: member.id, name: member.name })
      .from(member)
      .where(
        and(
          inArray(member.id, full.map((r) => r.suggestedBy)),
          eq(member.communityId, actor.communityId),
        ),
      ),
    // Grouped in the database: only a count and the viewer's own flag come
    // back, never a row per Yum.
    db
      .select({
        recipeId: recipeYum.recipeId,
        count: count(),
        viewerYummed: sql<boolean>`bool_or(${recipeYum.memberId} = ${actor.id})`,
      })
      .from(recipeYum)
      .where(inArray(recipeYum.recipeId, ids))
      .groupBy(recipeYum.recipeId),
    db
      .select({ recipeId: recipeComment.recipeId, count: count() })
      .from(recipeComment)
      .where(inArray(recipeComment.recipeId, ids))
      .groupBy(recipeComment.recipeId),
  ]);

  const names = new Map(authors.map((m) => [m.id, m.name]));
  const yumByRecipe = new Map(yums.map((row) => [row.recipeId, row.count]));
  const viewerYums = new Set(yums.filter((row) => row.viewerYummed).map((row) => row.recipeId));
  const commentsByRecipe = new Map(comments.map((row) => [row.recipeId, row.count]));

  return full.map((row) => ({
    ...row,
    authorName: names.get(row.suggestedBy) ?? "—",
    // The author is an implicit Yum, counted on read so no self-Yum row can
    // ever get out of step with the recipe.
    yumCount: (yumByRecipe.get(row.id) ?? 0) + 1,
    commentCount: commentsByRecipe.get(row.id) ?? 0,
    viewerYummed: row.suggestedBy === actor.id || viewerYums.has(row.id),
  }));
}

export type RecipeFilter = "all" | RecipeStatus;

export async function listRecipes(
  actor: Member,
  options: { status?: RecipeFilter; search?: string } = {},
): Promise<RecipeListItem[]> {
  await requireKitchenModuleOn(actor);
  const status = options.status ?? "all";
  const search = options.search?.trim() ?? "";
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;

  const rows = await db
    .select()
    .from(recipe)
    .where(
      and(
        eq(recipe.communityId, actor.communityId),
        status === "all" ? undefined : eq(recipe.status, status),
        search ? ilike(recipe.title, pattern) : undefined,
      ),
    )
    // Newest first, with no popularity ordering: a Yum is a sign of support,
    // not a vote or a ranking.
    .orderBy(desc(recipe.createdAt));
  return decorate(actor, rows);
}

export async function getRecipe(actor: Member, id: string): Promise<RecipeListItem | null> {
  await requireKitchenModuleOn(actor);
  let row: RecipeRow;
  try {
    row = await getRecipeInCommunity(actor, id);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
  const [decorated] = await decorate(actor, [row]);
  return decorated ?? null;
}

// Any member may add to the box. The row starts as `suggested`; only a holder
// can make it applicable to a menu.
export async function createRecipe(actor: Member, input: CreateRecipeInput) {
  await requireKitchenModuleOn(actor);
  const flags = parseAllergenFlags(input.allergenFlags);
  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(recipe)
      .values({
        communityId: actor.communityId,
        title: input.title,
        body: input.body ?? null,
        serves: input.serves ?? null,
        allergenFlags: flags,
        dietaryNote: input.dietaryNote ?? null,
        status: "suggested",
        suggestedBy: actor.id,
      })
      .returning();
    await insertIngredients(tx, row.id, input.ingredients ?? []);
    return [row];
  });
  return getRecipe(actor, created.id);
}

/**
 * Author or current holder may fix a recipe. The author's edit of a declined
 * recipe resubmits it as suggested and clears the earlier decision; a holder's
 * edit keeps the status, so "fix and accept" stays a separate, deliberate
 * accept rather than a side effect of changing a field.
 */
export async function updateRecipe(actor: Member, id: string, input: UpdateRecipeInput) {
  await requireKitchenModuleOn(actor);
  const existing = await getRecipeInCommunity(actor, id);
  const holder = await isAnyKitchenHolder(actor);
  const author = existing.suggestedBy === actor.id;
  if (!holder && !author) throw new ForbiddenError("Only the author or a kitchen holder can change this recipe");
  if (!holder && existing.status === "accepted") {
    throw new ConflictError("This recipe has been accepted — ask a kitchen holder to change it");
  }

  const resubmit = author && !holder && existing.status === "declined";
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(recipe)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.serves !== undefined && { serves: input.serves }),
        ...(input.allergenFlags !== undefined && { allergenFlags: parseAllergenFlags(input.allergenFlags) }),
        ...(input.dietaryNote !== undefined && { dietaryNote: input.dietaryNote }),
        ...(resubmit && {
          status: "suggested" as const,
          declineReason: null,
          reviewedBy: null,
          reviewedAt: null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(recipe.id, id))
      .returning();
    if (input.ingredients !== undefined) {
      await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, id));
      await insertIngredients(tx, id, input.ingredients);
    }
    return [row];
  });
  return getRecipe(actor, updated.id);
}

export async function acceptRecipe(actor: Member, id: string) {
  await requireKitchenModuleOn(actor);
  await requireAnyKitchenHolder(actor);
  await getRecipeInCommunity(actor, id);
  const [updated] = await db
    .update(recipe)
    .set({ status: "accepted", reviewedBy: actor.id, reviewedAt: new Date(), declineReason: null, updatedAt: new Date() })
    .where(eq(recipe.id, id))
    .returning();
  return getRecipe(actor, updated.id);
}

// Decline is for a duplicate, broken or incomplete recipe, not a rejection of
// its author. The reason is stored with the recipe and shown beside the
// declined status, and it is required rather than optional.
export async function declineRecipe(actor: Member, id: string, input: DeclineRecipeInput) {
  await requireKitchenModuleOn(actor);
  await requireAnyKitchenHolder(actor);
  await getRecipeInCommunity(actor, id);
  const reason = declineRecipeInput.parse(input).declineReason;
  const [updated] = await db
    .update(recipe)
    .set({
      status: "declined",
      reviewedBy: actor.id,
      reviewedAt: new Date(),
      declineReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(recipe.id, id))
    .returning();
  return getRecipe(actor, updated.id);
}

export async function toggleYum(actor: Member, id: string): Promise<{ yummed: boolean }> {
  await requireKitchenModuleOn(actor);
  const row = await getRecipeInCommunity(actor, id);
  if (row.suggestedBy === actor.id) {
    throw new ForbiddenError("Your own recipe already counts as a Yum");
  }
  const [existing] = await db
    .select({ id: recipeYum.id })
    .from(recipeYum)
    .where(and(eq(recipeYum.recipeId, id), eq(recipeYum.memberId, actor.id)));
  if (existing) {
    await db.delete(recipeYum).where(eq(recipeYum.id, existing.id));
    return { yummed: false };
  }
  await db
    .insert(recipeYum)
    .values({ recipeId: id, memberId: actor.id })
    .onConflictDoNothing();
  return { yummed: true };
}

export const addRecipeCommentInput = z.object({ body: z.string().trim().min(1).max(2000) });
export type AddRecipeCommentInput = z.infer<typeof addRecipeCommentInput>;

export async function addRecipeComment(actor: Member, id: string, input: AddRecipeCommentInput) {
  await requireKitchenModuleOn(actor);
  await getRecipeInCommunity(actor, id);
  const [created] = await db
    .insert(recipeComment)
    .values({ recipeId: id, memberId: actor.id, body: input.body })
    .returning();
  return created;
}

export async function listRecipeComments(actor: Member, id: string): Promise<RecipeCommentWithAuthor[]> {
  await requireKitchenModuleOn(actor);
  await getRecipeInCommunity(actor, id);
  return db
    .select({
      id: recipeComment.id,
      recipeId: recipeComment.recipeId,
      memberId: recipeComment.memberId,
      body: recipeComment.body,
      createdAt: recipeComment.createdAt,
      authorName: member.name,
    })
    .from(recipeComment)
    .innerJoin(member, and(eq(member.id, recipeComment.memberId), eq(member.communityId, actor.communityId)))
    .where(eq(recipeComment.recipeId, id))
    .orderBy(asc(recipeComment.createdAt));
}

// The "Add to meal plan…" picker on a recipe page offers only draft meals the
// viewer may actually edit. A holder of a different scope's grant sees none.
export async function listEditableDraftMeals(actor: Member): Promise<EditableMeal[]> {
  await requireKitchenModuleOn(actor);
  const rows = await db
    .select({
      id: meal.id,
      label: meal.label,
      date: meal.date,
      menuPlanId: meal.menuPlanId,
      cycleId: menuPlan.cycleId,
    })
    .from(meal)
    .innerJoin(menuPlan, eq(menuPlan.id, meal.menuPlanId))
    .where(and(eq(menuPlan.communityId, actor.communityId), isNull(menuPlan.publishedAt)))
    .orderBy(asc(meal.date), asc(meal.createdAt));
  const plans = new Map(rows.map((r) => [r.menuPlanId, r.cycleId]));
  const allowed = new Map<string, boolean>();
  for (const [planId, cycleId] of plans) {
    allowed.set(planId, await isKitchenOwner(actor, cycleId));
  }
  return rows
    .filter((r) => allowed.get(r.menuPlanId))
    .map(({ id, label, date, menuPlanId }) => ({ id, label, date, menuPlanId }));
}

/**
 * The multiplier the apply forms offer for one meal, for many recipes at once.
 * The meal, its headcount and its other dishes are read once, however many
 * recipes are offered — the menu page asks this for every accepted recipe on
 * every draft meal.
 */
export async function suggestedMultipliersForMeal<T extends { id: string; serves: number | null }>(
  actor: Member,
  recipes: T[],
  mealId: string,
): Promise<Map<string, number>> {
  await requireKitchenModuleOn(actor);
  const mealRow = await getMeal(actor, mealId);
  const headCount = await resolveMealHeadCount(actor, mealRow);
  const others = await db
    .select({ serves: dish.serves, multiplier: dish.multiplier })
    .from(dish)
    .where(eq(dish.mealId, mealId));
  return new Map(recipes.map((r) => [r.id, suggestedMultiplier(r, headCount, others)]));
}

/** The multiplier the apply form offers for one meal, before it is written. */
export async function suggestedMultiplierForMeal(
  actor: Member,
  recipe: { id: string; serves: number | null },
  mealId: string,
): Promise<number> {
  const suggestions = await suggestedMultipliersForMeal(actor, [recipe], mealId);
  return suggestions.get(recipe.id) ?? 1;
}

/** A planner changes the scale of a dish copied from the recipe box. Plain
 *  dishes keep the older headcount / serves rule and have no multiplier to
 *  edit. The same plan-scoped draft gate applies as to every other dish edit. */
export async function updateDishMultiplier(actor: Member, dishId: string, multiplier: number) {
  await requireKitchenModuleOn(actor);
  const dishRow = await getDish(actor, dishId);
  if (dishRow.multiplier === null) {
    throw new AppError("Only a dish from the recipe box has a multiplier to change");
  }
  const mealRow = await getMeal(actor, dishRow.mealId);
  await requireEditableMenuPlan(actor, mealRow.menuPlanId);
  const parsed = multiplierInput.parse(multiplier);
  const [updated] = await db
    .update(dish)
    .set({ multiplier: String(parsed) })
    .where(eq(dish.id, dishId))
    .returning();
  return updated;
}

/**
 * Copy an accepted recipe into a draft meal. One transaction creates a normal
 * dish with its own ingredient rows, so later edits to the box never rewrite a
 * planned meal. `recipeId` is provenance only. The multiplier is the dish's
 * scale factor itself — headcount has already been used to suggest it, so the
 * shopping list must not scale by headcount again.
 */
export async function applyRecipeToMeal(actor: Member, input: ApplyRecipeInput) {
  await requireKitchenModuleOn(actor);
  const row = await getRecipeInCommunity(actor, input.recipeId);
  if (row.status !== "accepted") {
    throw new ConflictError("Only an accepted recipe can be added to a menu");
  }
  const mealRow = await getMeal(actor, input.mealId);
  await requireEditableMenuPlan(actor, mealRow.menuPlanId);

  const headCount = await resolveMealHeadCount(actor, mealRow);
  const others = await db
    .select({ serves: dish.serves, multiplier: dish.multiplier })
    .from(dish)
    .where(eq(dish.mealId, input.mealId));
  const suggested = suggestedMultiplier(row, headCount, others);
  const multiplier = input.multiplier ?? suggested;
  const parsed = multiplierInput.parse(multiplier);

  const [created] = await db.transaction(async (tx) => {
    const [dishRow] = await tx
      .insert(dish)
      .values({
        mealId: input.mealId,
        name: row.title,
        description: row.body,
        serves: row.serves,
        allergenFlags: parseAllergenFlags(row.allergenFlags),
        dietaryNote: row.dietaryNote,
        source: "from_recipe",
        recipeId: row.id,
        multiplier: String(parsed),
        addedBy: actor.id,
      })
      .returning();
    const ingredients = await tx
      .select()
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, row.id))
      .orderBy(asc(recipeIngredient.sortOrder), asc(recipeIngredient.createdAt));
    if (ingredients.length > 0) {
      await tx.insert(dishIngredient).values(
        ingredients.map((ing, i) => ({
          dishId: dishRow.id,
          name: ing.name,
          amount: ing.amount,
          unit: ing.unit,
          sortOrder: ing.sortOrder ?? i,
        })),
      );
    }
    return [dishRow];
  });
  return { dish: created, suggestedMultiplier: suggested };
}
