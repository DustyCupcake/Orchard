import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dish, dishIngredient } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { requireEditableMenuPlan, requireKitchenModuleOn } from "./menu";
import { getMeal } from "./meals";
import { getDish } from "./dishes";
import { resolveMealHeadCount } from "./attendance";

type Member = typeof memberTable.$inferSelect;

export const createDishIngredientInput = z.object({
  dishId: z.string().uuid(),
  name: z.string().min(1),
  // Stored as recipe-as-written scale — amounts read back as strings
  // from the numeric column and only scale on read (D8), never written
  // back. Null or absent is "to taste": the line is listed as written and
  // left out of scaling.
  amount: z.number().positive().nullable().optional(),
  unit: z.string().nullable().optional(),
  sortOrder: z.number().int().nullable().optional(),
});
export type CreateDishIngredientInput = z.infer<typeof createDishIngredientInput>;

export const updateDishIngredientInput = createDishIngredientInput.omit({ dishId: true }).partial();
export type UpdateDishIngredientInput = z.infer<typeof updateDishIngredientInput>;

async function getIngredientInCommunity(actor: Member, ingredientId: string) {
  const [row] = await db.select().from(dishIngredient).where(eq(dishIngredient.id, ingredientId));
  void actor;
  if (!row) throw new NotFoundError("Ingredient not found");
  return row;
}

async function gateIngredientWrite(actor: Member, dishId: string) {
  const dishRow = await getDish(actor, dishId);
  const mealRow = await getMeal(actor, dishRow.mealId);
  await requireEditableMenuPlan(actor, mealRow.menuPlanId);
}

export async function createDishIngredient(actor: Member, input: CreateDishIngredientInput) {
  await requireKitchenModuleOn(actor);
  await gateIngredientWrite(actor, input.dishId);
  const [created] = await db
    .insert(dishIngredient)
    .values({
      dishId: input.dishId,
      name: input.name,
      amount: input.amount == null ? null : String(input.amount),
      unit: input.unit ?? null,
      sortOrder: input.sortOrder ?? null,
    })
    .returning();
  return created;
}

export async function updateDishIngredient(actor: Member, ingredientId: string, input: UpdateDishIngredientInput) {
  await requireKitchenModuleOn(actor);
  const row = await getIngredientInCommunity(actor, ingredientId);
  await gateIngredientWrite(actor, row.dishId);

  const [updated] = await db
    .update(dishIngredient)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.amount !== undefined && { amount: input.amount === null ? null : String(input.amount) }),
      ...(input.unit !== undefined && { unit: input.unit }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    })
    .where(eq(dishIngredient.id, ingredientId))
    .returning();
  return updated;
}

export async function deleteDishIngredient(actor: Member, ingredientId: string) {
  await requireKitchenModuleOn(actor);
  const row = await getIngredientInCommunity(actor, ingredientId);
  await gateIngredientWrite(actor, row.dishId);
  await db.delete(dishIngredient).where(eq(dishIngredient.id, ingredientId));
}

export type ScaledIngredient = {
  dishId: string;
  dishName: string;
  name: string;
  unit: string | null;
  // What the recipe lists — the numeric column's raw string, or null for a
  // line with no amount ("to taste").
  storedAmount: string | null;
  scaledAmount: number | null;
  // headCount / serves; 1 when either side is unset (recipe scale).
  factor: number;
  scaled: boolean;
};

function roundAmount(n: number): number {
  return Math.round(n * 100) / 100;
}

// D8's scale-on-read: each dish's ingredients multiplied by the meal's
// headCount / dish.serves. A meal with no headCount (or a dish with no
// serves) stays at recipe scale — factor 1. Nothing is ever written
// back; this is a pure read transform.
export async function scaledIngredients(actor: Member, mealId: string): Promise<ScaledIngredient[]> {
  const mealRow = await getMeal(actor, mealId);
  // The meal's effective headcount: typed, or worked out from arrivals.
  const headCount = await resolveMealHeadCount(actor, mealRow);
  const dishes = await db.select().from(dish).where(eq(dish.mealId, mealId)).orderBy(dish.createdAt);
  if (dishes.length === 0) return [];

  const ingredients = await db
    .select()
    .from(dishIngredient)
    .where(inArray(dishIngredient.dishId, dishes.map((d) => d.id)))
    .orderBy(asc(dishIngredient.sortOrder), asc(dishIngredient.createdAt));

  const dishById = new Map(dishes.map((d) => [d.id, d]));
  return ingredients.map((ing) => {
    const dishRow = dishById.get(ing.dishId)!;
    const factor =
      headCount && dishRow.serves && headCount > 0 && dishRow.serves > 0
        ? headCount / dishRow.serves
        : 1;
    return {
      dishId: ing.dishId,
      dishName: dishRow.name,
      name: ing.name,
      unit: ing.unit,
      storedAmount: ing.amount,
      scaledAmount: ing.amount === null ? null : roundAmount(Number(ing.amount) * factor),
      factor: roundAmount(factor),
      scaled: factor !== 1 && ing.amount !== null,
    };
  });
}

export type PurchaseListRow = {
  name: string;
  unit: string | null;
  // The sum of the lines that have an amount; null when none of them do.
  amount: number | null;
  // At least one contributing line had no amount ("to taste"), so the
  // number is a floor, not the whole need.
  unmeasured: boolean;
};

// The purchasing list — scaled amounts grouped by exact ingredient
// name across every dish on the meal (D8): "flour" and "plain flour"
// deliberately don't merge. Only meaningful with a headcount — a meal
// with no headcount ("open fire, cook what you like") renders at recipe
// scale and computes no purchase list at all.
export async function purchaseList(actor: Member, mealId: string): Promise<PurchaseListRow[]> {
  const mealRow = await getMeal(actor, mealId);
  if (!(await resolveMealHeadCount(actor, mealRow))) return [];

  const byName = new Map<string, PurchaseListRow>();
  for (const item of await scaledIngredients(actor, mealId)) {
    const existing = byName.get(item.name);
    if (existing) {
      if (item.scaledAmount === null) {
        existing.unmeasured = true;
      } else {
        existing.amount = roundAmount((existing.amount ?? 0) + item.scaledAmount);
      }
      if (existing.unit === null && item.unit) existing.unit = item.unit;
    } else {
      byName.set(item.name, {
        name: item.name,
        unit: item.unit,
        amount: item.scaledAmount,
        unmeasured: item.scaledAmount === null,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
