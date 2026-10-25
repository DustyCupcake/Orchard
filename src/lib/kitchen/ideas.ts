import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { foodIdea, foodIdeaIngredient } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getMenuPlan, getVisibleMenuPlan, requireEditableMenuPlan, requireKitchenModuleOn } from "./menu";
import { ALLERGEN_FLAGS } from "./allergens";
import { parseAllergenFlags } from "./dishes";

type Member = typeof memberTable.$inferSelect;
export type FoodIdeaRow = typeof foodIdea.$inferSelect;
export type FoodIdeaIngredientRow = typeof foodIdeaIngredient.$inferSelect;
export type FoodIdeaWithIngredients = FoodIdeaRow & { ingredients: FoodIdeaIngredientRow[] };

// One ingredient line on a recipe suggestion. Mirrors dishIngredient, so
// adoption is a copy: free-text name, optional amount (null is "to taste"),
// free-text unit.
export const ideaIngredientInput = z.object({
  name: z.string().min(1),
  amount: z.number().positive().nullable().optional(),
  unit: z.string().nullable().optional(),
});
export type IdeaIngredientInput = z.infer<typeof ideaIngredientInput>;

// The recipe's shape — what only a recipe suggestion carries. A dish
// request or a preference is a title and a body and nothing else.
const recipeFields = {
  serves: z.number().int().positive().nullable().optional(),
  allergenFlags: z.array(z.enum(ALLERGEN_FLAGS)).optional(),
  dietaryNote: z.string().nullable().optional(),
  // A cap, not a design limit: a runaway form shouldn't be able to write
  // thousands of rows from one submit.
  ingredients: z.array(ideaIngredientInput).max(80).optional(),
};

const RECIPE_ONLY = "Only a recipe suggestion carries serves, allergens and ingredients";

function hasRecipeFields(input: {
  serves?: number | null;
  allergenFlags?: string[];
  dietaryNote?: string | null;
  ingredients?: unknown[];
}) {
  return (
    (input.serves ?? null) !== null ||
    (input.allergenFlags?.length ?? 0) > 0 ||
    Boolean(input.dietaryNote) ||
    (input.ingredients?.length ?? 0) > 0
  );
}

export const fileFoodIdeaInput = z
  .object({
    menuPlanId: z.string().uuid(),
    kind: z.enum(["recipe_suggestion", "dish_request", "preference"]),
    title: z.string().min(1),
    body: z.string().nullable().optional(),
    ...recipeFields,
  })
  .superRefine((input, ctx) => {
    if (input.kind !== "recipe_suggestion" && hasRecipeFields(input)) {
      ctx.addIssue({ code: "custom", message: RECIPE_ONLY, path: ["kind"] });
    }
  });
export type FileFoodIdeaInput = z.infer<typeof fileFoodIdeaInput>;

// The kind never changes after filing — a dish request that turns out to be
// a recipe is a new suggestion — so it isn't here, and the recipe fields
// are checked against the kind the idea already has.
export const updateFoodIdeaInput = z.object({
  title: z.string().min(1).optional(),
  body: z.string().nullable().optional(),
  ...recipeFields,
});
export type UpdateFoodIdeaInput = z.infer<typeof updateFoodIdeaInput>;

export const declineFoodIdeaInput = z.object({
  declinedReason: z.string().nullable().optional(),
});
export type DeclineFoodIdeaInput = z.infer<typeof declineFoodIdeaInput>;

async function insertIngredients(tx: DbOrTx, ideaId: string, ingredients: IdeaIngredientInput[]) {
  if (ingredients.length === 0) return;
  await tx.insert(foodIdeaIngredient).values(
    ingredients.map((ing, i) => ({
      ideaId,
      name: ing.name,
      amount: ing.amount == null ? null : String(ing.amount),
      unit: ing.unit ?? null,
      sortOrder: i,
    })),
  );
}

async function withIngredients(ideas: FoodIdeaRow[]): Promise<FoodIdeaWithIngredients[]> {
  if (ideas.length === 0) return [];
  const rows = await db
    .select()
    .from(foodIdeaIngredient)
    .where(inArray(foodIdeaIngredient.ideaId, ideas.map((i) => i.id)))
    .orderBy(asc(foodIdeaIngredient.sortOrder), asc(foodIdeaIngredient.createdAt));
  const byIdea = new Map<string, FoodIdeaIngredientRow[]>();
  for (const row of rows) {
    const list = byIdea.get(row.ideaId) ?? [];
    list.push(row);
    byIdea.set(row.ideaId, list);
  }
  return ideas.map((idea) => ({ ...idea, ingredients: byIdea.get(idea.id) ?? [] }));
}

// D5's open door — "Members can still file food ideas without [the
// grant] set": no owner gate here, any member in the community may file
// against the plan on the page (the community's active plan for the
// scope). Persists until the kitchen holder decides it; the inbox is
// the holder's surface.
export async function fileFoodIdea(actor: Member, input: FileFoodIdeaInput) {
  await requireKitchenModuleOn(actor);
  await getMenuPlan(actor, input.menuPlanId); // community check + 404
  // The zod refinement says this for a form; the function says it for a
  // caller that never parsed.
  if (input.kind !== "recipe_suggestion" && hasRecipeFields(input)) throw new AppError(RECIPE_ONLY);
  const flags = parseAllergenFlags(input.allergenFlags);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(foodIdea)
      .values({
        menuPlanId: input.menuPlanId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        suggestedBy: actor.id,
        serves: input.serves ?? null,
        allergenFlags: flags,
        dietaryNote: input.dietaryNote ?? null,
      })
      .returning();
    await insertIngredients(tx, created.id, input.ingredients ?? []);
    return created;
  });
}

// The holder's inbox — open ideas on a plan they can still act on
// (draft + owned). Published plans lock adoption, so their ideas don't
// queue up as actionable here; the owner starts a new draft for them.
export async function listOpenIdeasForReview(actor: Member, menuPlanId: string): Promise<FoodIdeaWithIngredients[]> {
  await requireEditableMenuPlan(actor, menuPlanId);
  // Open only. This used to return every idea on the plan whatever its
  // status, so a declined or adopted one stayed in the inbox with its adopt
  // and decline buttons, and the count on the Suggestions tab never went
  // down. The decided ones are listIdeasForMenuPlan's.
  return withIngredients(
    await db
      .select()
      .from(foodIdea)
      .where(and(eq(foodIdea.menuPlanId, menuPlanId), eq(foodIdea.status, "open")))
      .orderBy(desc(foodIdea.createdAt)),
  );
}

export async function listIdeasForMenuPlan(actor: Member, menuPlanId: string): Promise<FoodIdeaWithIngredients[]> {
  // Read posture: the plan must be visible, then its ideas list (all
  // statuses — the owner's "what did we do with what people suggested"
  // view on a draft they can still act on).
  await getVisibleMenuPlan(actor, menuPlanId);
  return withIngredients(
    await db.select().from(foodIdea).where(eq(foodIdea.menuPlanId, menuPlanId)).orderBy(desc(foodIdea.createdAt)),
  );
}

/**
 * What this member has suggested on a plan, with how each was decided.
 *
 * The suggester's own view: a suggestion that vanishes into an inbox nobody
 * tells you about reads as ignored. Open, adopted and declined all show,
 * with the decline reason, and it needs only that the plan is in the
 * member's community — these are the member's own rows, not the plan's
 * content, so the draft/published gate doesn't apply.
 */
export async function listMyFoodIdeas(actor: Member, menuPlanId: string): Promise<FoodIdeaWithIngredients[]> {
  await getMenuPlan(actor, menuPlanId);
  return withIngredients(
    await db
      .select()
      .from(foodIdea)
      .where(and(eq(foodIdea.menuPlanId, menuPlanId), eq(foodIdea.suggestedBy, actor.id)))
      .orderBy(desc(foodIdea.createdAt)),
  );
}

async function getIdeaInCommunity(actor: Member, ideaId: string) {
  const [row] = await db.select().from(foodIdea).where(eq(foodIdea.id, ideaId));
  if (!row) throw new NotFoundError("Food idea not found");
  // The idea's own community is its plan's. Resolved here so the author
  // paths below can't be pointed at another community's idea by id.
  await getMenuPlan(actor, row.menuPlanId);
  return row;
}

// Only the person who filed an idea may change or take it back, and only
// while it is open. Once the holder has decided, the idea is the record of
// what was suggested and what happened to it.
async function getOwnOpenIdea(actor: Member, ideaId: string) {
  const idea = await getIdeaInCommunity(actor, ideaId);
  if (idea.suggestedBy !== actor.id) {
    throw new ForbiddenError("Only the person who suggested this can change it");
  }
  if (idea.status !== "open") {
    throw new ConflictError("This idea has already been decided, so it can't be changed");
  }
  return idea;
}

export async function updateFoodIdea(actor: Member, ideaId: string, input: UpdateFoodIdeaInput) {
  await requireKitchenModuleOn(actor);
  const idea = await getOwnOpenIdea(actor, ideaId);
  if (idea.kind !== "recipe_suggestion" && hasRecipeFields(input)) throw new AppError(RECIPE_ONLY);

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(foodIdea)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.body !== undefined && { body: input.body }),
        ...(input.serves !== undefined && { serves: input.serves }),
        ...(input.allergenFlags !== undefined && { allergenFlags: parseAllergenFlags(input.allergenFlags) }),
        ...(input.dietaryNote !== undefined && { dietaryNote: input.dietaryNote }),
      })
      .where(eq(foodIdea.id, ideaId))
      .returning();
    if (input.ingredients !== undefined) {
      // Replaced as a set: the form submits the whole list, so a removed row
      // is simply absent.
      await tx.delete(foodIdeaIngredient).where(eq(foodIdeaIngredient.ideaId, ideaId));
      await insertIngredients(tx, ideaId, input.ingredients);
    }
    return updated;
  });
}

// Taking an open idea back deletes it. Nothing refers to an open idea — a
// dish only links back to an *adopted* one — so there is nothing to orphan.
export async function withdrawFoodIdea(actor: Member, ideaId: string) {
  await requireKitchenModuleOn(actor);
  await getOwnOpenIdea(actor, ideaId);
  await db.transaction(async (tx) => {
    await tx.delete(foodIdeaIngredient).where(eq(foodIdeaIngredient.ideaId, ideaId));
    await tx.delete(foodIdea).where(eq(foodIdea.id, ideaId));
  });
}

export async function declineFoodIdea(actor: Member, ideaId: string, input: DeclineFoodIdeaInput) {
  await requireKitchenModuleOn(actor);
  const idea = await getIdeaInCommunity(actor, ideaId);
  if (idea.status !== "open") {
    throw new ConflictError("This idea has already been decided");
  }
  await requireEditableMenuPlan(actor, idea.menuPlanId);

  const [updated] = await db
    .update(foodIdea)
    .set({ status: "declined", declinedReason: input.declinedReason ?? null })
    .where(eq(foodIdea.id, ideaId))
    .returning();
  return updated;
}
