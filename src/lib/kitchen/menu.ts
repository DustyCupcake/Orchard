import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, cycle, dish, dishIngredient, meal, menuPlan } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { requireKitchenOwner } from "./access";

type Member = typeof memberTable.$inferSelect;
export type MenuPlanRow = typeof menuPlan.$inferSelect;

export type MealWithDishes = typeof meal.$inferSelect & {
  dishes: (typeof dish.$inferSelect & { ingredients: (typeof dishIngredient.$inferSelect)[] })[];
};

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// Every kitchen lib's module gate — one little helper instead of each
// function re-fetching the community row (event-scheduling's posture).
export async function requireKitchenModuleOn(actor: Member) {
  requireModuleEnabled(await getCommunityRow(actor.communityId), "kitchen");
}

// The "which scope's rows count" filter every plan-scoped query shares,
// same undefined (any scope) / null (evergreen) / id (that cycle)
// convention as event-scheduling's cycleScopeCondition.
export function menuPlanScopeCondition(cycleId?: string | null) {
  if (cycleId === undefined) return undefined;
  return cycleId === null ? isNull(menuPlan.cycleId) : eq(menuPlan.cycleId, cycleId);
}

async function getMenuPlanInCommunity(actor: Member, menuPlanId: string): Promise<MenuPlanRow> {
  const [row] = await db
    .select()
    .from(menuPlan)
    .where(and(eq(menuPlan.id, menuPlanId), eq(menuPlan.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Menu plan not found");
  }
  return row;
}

export function getMenuPlan(actor: Member, menuPlanId: string): Promise<MenuPlanRow> {
  return getMenuPlanInCommunity(actor, menuPlanId);
}

// Read gate, not an edit gate: a draft plan is owner-visible only; a
// published plan is community-readable (D1). Every read of a plan's
// content funnels through here; every write goes through
// requireEditableMenuPlan below instead.
export async function getVisibleMenuPlan(actor: Member, menuPlanId: string): Promise<MenuPlanRow> {
  const plan = await getMenuPlanInCommunity(actor, menuPlanId);
  if (!plan.publishedAt) {
    await requireKitchenOwner(actor, plan.cycleId);
  }
  return plan;
}

// The write gate for everything under a plan — meals, dishes,
// ingredients, and idea adoption all resolve their plan and come
// through here: only a draft's owner may edit it, and publishing locks
// the whole plan against further edits in one place.
export async function requireEditableMenuPlan(actor: Member, menuPlanId: string): Promise<MenuPlanRow> {
  const plan = await getMenuPlanInCommunity(actor, menuPlanId);
  await requireKitchenOwner(actor, plan.cycleId);
  if (plan.publishedAt) {
    throw new ConflictError(
      "This menu plan is published and can't be edited — start a new draft for changes",
    );
  }
  return plan;
}

export const createMenuPlanInput = z.object({
  title: z.string().min(1),
  cycleId: z.string().uuid().nullable().optional(),
});
export type CreateMenuPlanInput = z.infer<typeof createMenuPlanInput>;

// Owner-only, scope-locked — "nobody can build or publish the menu
// until [the grant] is set." The draft's scope is the granting task's
// own placement: the caller passes the scope the page resolved, and
// requireKitchenOwner enforces that only a holder of that scope's grant
// may create it there.
export async function createMenuPlan(actor: Member, input: CreateMenuPlanInput) {
  await requireKitchenModuleOn(actor);
  await requireKitchenOwner(actor, input.cycleId ?? null);

  if (input.cycleId) {
    const [cycleRow] = await db
      .select({ id: cycle.id })
      .from(cycle)
      .where(and(eq(cycle.id, input.cycleId), eq(cycle.communityId, actor.communityId)));
    if (!cycleRow) {
      throw new NotFoundError("Cycle not found in your community");
    }
  }

  const [created] = await db
    .insert(menuPlan)
    .values({
      communityId: actor.communityId,
      cycleId: input.cycleId ?? null,
      title: input.title,
      createdBy: actor.id,
    })
    .returning();
  return created;
}

// The single status transition — D1's "publishing locks further edits."
export async function publishMenuPlan(actor: Member, menuPlanId: string) {
  await requireKitchenModuleOn(actor);
  const plan = await getMenuPlanInCommunity(actor, menuPlanId);
  await requireKitchenOwner(actor, plan.cycleId);
  if (plan.publishedAt) {
    throw new ConflictError("This menu plan is already published");
  }
  const [updated] = await db
    .update(menuPlan)
    .set({ publishedAt: new Date() })
    .where(eq(menuPlan.id, menuPlanId))
    .returning();
  return updated;
}

// The active plan in a scope, newest first — what the /kitchen page
// shows (and what food ideas file against): the latest draft while one
// is being built, else the latest published menu. Everyone resolves the
// same newest-plan container; visibility of its *content* is then the
// published gate's job (getVisibleMenuPlan).
export async function resolveActiveMenuPlan(actor: Member, cycleId?: string | null): Promise<MenuPlanRow | null> {
  const condition = menuPlanScopeCondition(cycleId);
  return (
    (
      await db
        .select()
        .from(menuPlan)
        .where(and(eq(menuPlan.communityId, actor.communityId), ...(condition ? [condition] : [])))
        .orderBy(desc(menuPlan.createdAt))
        .limit(1)
    )[0] ?? null
  );
}

// The newest *published* plan in a scope — the community-reading
// version of resolveActiveMenuPlan. What a non-owner's /kitchen page
// displays: drafts exist but stay owner-visible (D1).
export async function resolvePublishedMenuPlan(actor: Member, cycleId?: string | null): Promise<MenuPlanRow | null> {
  const condition = menuPlanScopeCondition(cycleId);
  return (
    (
      await db
        .select()
        .from(menuPlan)
        .where(
          and(
            eq(menuPlan.communityId, actor.communityId),
            ...(condition ? [condition] : []),
            isNotNull(menuPlan.publishedAt),
          ),
        )
        .orderBy(desc(menuPlan.createdAt))
        .limit(1)
    )[0] ?? null
  );
}

// One read for the whole page: the visible plan with its meals, each
// meal's dishes, and each dish's ingredients batched — the pattern the
// /schedule page uses for proposals+slots rather than an N+1 loop.
export async function getMenuPlanOverview(actor: Member, menuPlanId: string) {
  const plan = await getVisibleMenuPlan(actor, menuPlanId);

  const meals = (await db
    .select()
    .from(meal)
    .where(eq(meal.menuPlanId, menuPlanId))
    .orderBy(asc(meal.date), asc(meal.createdAt))) as MealWithDishes[];
  if (meals.length === 0) return { plan, meals };

  const dishes = await db.select().from(dish).where(inArray(dish.mealId, meals.map((m) => m.id)));
  const dishesByMeal = new Map<string, (typeof dish.$inferSelect & { ingredients: (typeof dishIngredient.$inferSelect)[] })[]>();
  for (const d of dishes) {
    const list = dishesByMeal.get(d.mealId) ?? [];
    list.push({ ...d, ingredients: [] });
    dishesByMeal.set(d.mealId, list);
  }

  if (dishes.length > 0) {
    const ingredients = await db
      .select()
      .from(dishIngredient)
      .where(inArray(dishIngredient.dishId, dishes.map((d) => d.id)))
      .orderBy(asc(dishIngredient.sortOrder), asc(dishIngredient.createdAt));
    const ingredientsByDish = new Map<string, (typeof dishIngredient.$inferSelect)[]>();
    for (const ing of ingredients) {
      const list = ingredientsByDish.get(ing.dishId) ?? [];
      list.push(ing);
      ingredientsByDish.set(ing.dishId, list);
    }
    for (const d of dishes) {
      const list = dishesByMeal.get(d.mealId)!;
      const dishRow = list.find((x) => x.id === d.id)!;
      dishRow.ingredients = ingredientsByDish.get(d.id) ?? [];
    }
  }

  return { plan, meals: meals.map((m) => ({ ...m, dishes: dishesByMeal.get(m.id) ?? [] })) };
}