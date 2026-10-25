import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { dish, dishIngredient, foodIdea, foodIdeaIngredient } from "@/db/schema";
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
export function parseAllergenFlags(raw: string[] | undefined): AllergenFlag[] {
  const parsed = allergenFlagsInput.safeParse(raw ?? []);
  if (!parsed.success) {
    throw new AppError(`Unknown allergen flag — must be one of: ${ALLERGEN_FLAGS.join(", ")}`);
  }
  const flags = [...new Set(parsed.data)];
  // "None known" is a statement that the list is complete and empty, so it
  // can't stand beside an allergen — a dish tagged both would be telling the
  // cook two opposite things.
  if (flags.includes("none_known") && flags.length > 1) {
    throw new AppError("“None known” can't be combined with an allergen — either the dish contains one or it doesn't");
  }
  return flags;
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
// source='from_idea' back-linked to the idea, the idea's ingredient rows are
// copied onto it, and the idea flips to adopted with adoptedDishId set. The
// idea must be open and on the same menu plan as the meal it's adopted
// into, and the plan must still be an editable draft.
//
// A field the caller leaves out (`undefined`) falls back to what the
// suggester wrote; an explicit `null` or an empty list is the holder
// clearing it. The allergen flags are the part that matters: they are the
// suggester's claim, so the adopt form shows them pre-filled and editable
// and the dish records whatever set the holder submits — never a flag the
// holder didn't see.
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
        description: input.description !== undefined ? input.description : ideaRow.body,
        serves: input.serves !== undefined ? input.serves : ideaRow.serves,
        allergenFlags: parseAllergenFlags(input.allergenFlags ?? ideaRow.allergenFlags),
        dietaryNote: input.dietaryNote !== undefined ? input.dietaryNote : ideaRow.dietaryNote,
        source: "from_idea",
        sourceIdeaId: ideaRow.id,
        addedBy: actor.id,
      })
      .returning();

    const ingredients = await tx
      .select()
      .from(foodIdeaIngredient)
      .where(eq(foodIdeaIngredient.ideaId, ideaRow.id))
      .orderBy(asc(foodIdeaIngredient.sortOrder), asc(foodIdeaIngredient.createdAt));
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

    await tx
      .update(foodIdea)
      .set({ status: "adopted", adoptedDishId: dishRow.id })
      .where(eq(foodIdea.id, ideaRow.id));
    return [dishRow];
  });
  return created;
}
