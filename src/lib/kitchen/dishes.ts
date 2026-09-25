import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { dish, dishIngredient, foodIdea } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { requireEditableMenuPlan, requireKitchenModuleOn } from "./menu";
import { getMeal } from "./meals";
import { ALLERGEN_FLAGS, type AllergenFlag } from "./dietary";

type Member = typeof memberTable.$inferSelect;

async function getDishInCommunity(actor: Member, dishId: string) {
  const [row] = await db.select().from(dish).where(eq(dish.id, dishId));
  void actor;
  if (!row) throw new NotFoundError("Dish not found");
  return row;
}

export function getDish(actor: Member, dishId: string) {
  return getDishInCommunity(actor, dishId);
}

const allergenFlagsInput = z.array(z.enum(ALLERGEN_FLAGS));
function parseAllergenFlags(raw: string[] | undefined): AllergenFlag[] {
  const parsed = allergenFlagsInput.safeParse(raw ?? []);
  if (!parsed.success) {
    throw new AppError(`Unknown allergen flag — must be one of: ${ALLERGEN_FLAGS.join(", ")}`);
  }
  return [...new Set(parsed.data)];
}

export const createDishInput = z.object({
  mealId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  // The recipe-as-written serving count — the scale base for the meal's
  // headCount factor (D8). null = no scaling for this dish.
  serves: z.number().int().positive().nullable().optional(),
  allergenFlags: z.array(z.enum(ALLERGEN_FLAGS)).optional(),
  dietaryNote: z.string().nullable().optional(),
});
export type CreateDishInput = z.infer<typeof createDishInput>;

export const updateDishInput = createDishInput.omit({ mealId: true }).partial();
export type UpdateDishInput = z.infer<typeof updateDishInput>;

async function gateDishWrite(actor: Member, mealId: string) {
  const mealRow = await getMeal(actor, mealId);
  await requireEditableMenuPlan(actor, mealRow.menuPlanId);
  return mealRow;
}

function insertDish(tx: DbOrTx, actor: Member, input: CreateDishInput) {
  return tx
    .insert(dish)
    .values({
      mealId: input.mealId,
      name: input.name,
      description: input.description ?? null,
      serves: input.serves ?? null,
      allergenFlags: parseAllergenFlags(input.allergenFlags),
      dietaryNote: input.dietaryNote ?? null,
      source: "seed",
      sourceIdeaId: null,
      addedBy: actor.id,
    })
    .returning();
}

export async function createDish(actor: Member, input: CreateDishInput) {
  await requireKitchenModuleOn(actor);
  await gateDishWrite(actor, input.mealId);
  const [created] = await insertDish(db, actor, input);
  return created;
}

export async function updateDish(actor: Member, dishId: string, input: UpdateDishInput) {
  await requireKitchenModuleOn(actor);
  const row = await getDishInCommunity(actor, dishId);
  await gateDishWrite(actor, row.mealId);

  const [updated] = await db
    .update(dish)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.serves !== undefined && { serves: input.serves }),
      ...(input.allergenFlags !== undefined && { allergenFlags: parseAllergenFlags(input.allergenFlags) }),
      ...(input.dietaryNote !== undefined && { dietaryNote: input.dietaryNote }),
    })
    .where(eq(dish.id, dishId))
    .returning();
  return updated;
}

export async function deleteDish(actor: Member, dishId: string) {
  await requireKitchenModuleOn(actor);
  const row = await getDishInCommunity(actor, dishId);
  await gateDishWrite(actor, row.mealId);
  await db.transaction(async (tx) => {
    await tx.delete(dishIngredient).where(eq(dishIngredient.dishId, dishId));
    await tx.delete(dish).where(eq(dish.id, dishId));
  });
}

export const adoptFromIdeaInput = z.object({
  ideaId: z.string().uuid(),
  mealId: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  serves: z.number().int().positive().nullable().optional(),
  allergenFlags: z.array(z.enum(ALLERGEN_FLAGS)).optional(),
  dietaryNote: z.string().nullable().optional(),
});
export type AdoptFromIdeaInput = z.infer<typeof adoptFromIdeaInput>;

// D5's adopt action — one transaction: the dish is created as
// source='from_idea' back-linked to the idea, and the idea flips to
// adopted with adoptedDishId set. The idea must be open and on the same
// menu plan as the meal it's adopted into, and the plan must still be
// an editable draft.
export async function adoptFromIdea(actor: Member, input: AdoptFromIdeaInput) {
  await requireKitchenModuleOn(actor);

  const [ideaRow] = await db.select().from(foodIdea).where(eq(foodIdea.id, input.ideaId));
  if (!ideaRow) throw new NotFoundError("Food idea not found");
  if (ideaRow.status !== "open") {
    throw new ConflictError("This idea has already been decided");
  }

  const mealRow = await getMeal(actor, input.mealId);
  if (mealRow.menuPlanId !== ideaRow.menuPlanId) {
    throw new AppError("The idea and its target meal must be on the same menu plan");
  }
  await requireEditableMenuPlan(actor, ideaRow.menuPlanId);

  const [created] = await db.transaction(async (tx) => {
    const [dishRow] = await tx
      .insert(dish)
      .values({
        mealId: input.mealId,
        name: input.name ?? ideaRow.title,
        description: input.description ?? ideaRow.body,
        serves: input.serves ?? null,
        allergenFlags: parseAllergenFlags(input.allergenFlags),
        dietaryNote: input.dietaryNote ?? null,
        source: "from_idea",
        sourceIdeaId: ideaRow.id,
        addedBy: actor.id,
      })
      .returning();
    await tx
      .update(foodIdea)
      .set({ status: "adopted", adoptedDishId: dishRow.id })
      .where(eq(foodIdea.id, ideaRow.id));
    return [dishRow];
  });
  return created;
}