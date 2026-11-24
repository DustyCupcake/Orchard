import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { meal, mealComment, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { getVisibleMenuPlan, requireKitchenModuleOn } from "./menu";

type Member = typeof memberTable.$inferSelect;

export type MealCommentWithAuthor = {
  id: string;
  mealId: string;
  memberId: string;
  body: string;
  createdAt: Date;
  authorName: string;
};

// A meal concern is the draft-menu counterpart of a task comment: open to
// every member, attributed, and chronological. Unlike a task comment it stops
// accepting new rows when the plan is published — publishing locks the menu,
// and a concern raised afterwards belongs in a new draft or a conversation.
export const addMealCommentInput = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type AddMealCommentInput = z.infer<typeof addMealCommentInput>;

async function getMealForComment(mealId: string) {
  const [row] = await db.select().from(meal).where(eq(meal.id, mealId));
  if (!row) throw new NotFoundError("Meal not found");
  return row;
}

export async function addMealComment(actor: Member, mealId: string, input: AddMealCommentInput) {
  await requireKitchenModuleOn(actor);
  const row = await getMealForComment(mealId);
  const plan = await getVisibleMenuPlan(actor, row.menuPlanId);
  if (plan.publishedAt) {
    throw new ConflictError("This menu is published and locked — start a new draft to raise a concern");
  }
  const [created] = await db
    .insert(mealComment)
    .values({ mealId, memberId: actor.id, body: input.body })
    .returning();
  return created;
}

// One batched read for the menu page — comments are only rendered on the
// Menu tab, but every meal on it gets the same attributed thread.
export async function listMealCommentsForMeals(
  actor: Member,
  mealIds: string[],
): Promise<Map<string, MealCommentWithAuthor[]>> {
  const byMeal = new Map<string, MealCommentWithAuthor[]>();
  if (mealIds.length === 0) return byMeal;

  const mealRows = await db
    .select({ id: meal.id, menuPlanId: meal.menuPlanId })
    .from(meal)
    .where(inArray(meal.id, mealIds));
  if (mealRows.length !== new Set(mealIds).size) throw new NotFoundError("Meal not found");
  const planIds = new Set(mealRows.map((row) => row.menuPlanId));
  if (planIds.size !== 1) throw new AppError("Comments can only be listed for one menu at a time");
  await getVisibleMenuPlan(actor, [...planIds][0]);

  const rows = await db
    .select({
      id: mealComment.id,
      mealId: mealComment.mealId,
      memberId: mealComment.memberId,
      body: mealComment.body,
      createdAt: mealComment.createdAt,
      authorName: member.name,
    })
    .from(mealComment)
    .innerJoin(member, and(eq(member.id, mealComment.memberId), eq(member.communityId, actor.communityId)))
    .where(inArray(mealComment.mealId, mealIds))
    .orderBy(asc(mealComment.createdAt));
  for (const row of rows) {
    const list = byMeal.get(row.mealId) ?? [];
    list.push(row);
    byMeal.set(row.mealId, list);
  }
  return byMeal;
}
