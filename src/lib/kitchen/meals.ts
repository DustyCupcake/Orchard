import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, dish, dishIngredient, meal, MEAL_SLOTS, phase, shiftSeries } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import { requireEditableMenuPlan, requireKitchenModuleOn, getVisibleMenuPlan, type MenuPlanRow } from "./menu";
import { normaliseTime } from "./attendance";

type Member = typeof memberTable.$inferSelect;

// A meal row's own community scoping happens through its menu plan —
// every create/update/delete resolves the meal to its plan first and
// funnels through requireEditableMenuPlan (owner + draft), so no meal
// access check is duplicated here. Read helpers that pull a meal by id
// (scaling, purchasing, constraints) reach the plan themselves.
async function getMealInCommunity(actor: Member, mealId: string) {
  const [row] = await db.select().from(meal).where(eq(meal.id, mealId));
  void actor;
  if (!row) throw new NotFoundError("Meal not found");
  return row;
}

export function getMeal(actor: Member, mealId: string) {
  return getMealInCommunity(actor, mealId);
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const createMealInput = z.object({
  menuPlanId: z.string().uuid(),
  label: z.string().min(1),
  // D6 — plain absolute date. The shared dates streamline (relative
  // offsets, resolved skips) applies to meal dates later like it does
  // everywhere else; v1 is a plain YYYY-MM-DD input.
  date: dateOnly,
  phaseId: z.string().uuid().nullable().optional(),
  headCount: z.number().int().positive().nullable().optional(),
  // Optional: which of the day's meals this is, and a clock time overriding
  // the menu's default for that slot. Both only matter for telling whether
  // someone arriving or leaving part-way through a day is there (see
  // attendance.ts); a meal needs neither.
  slot: z.enum(MEAL_SLOTS).nullable().optional(),
  time: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || v === "" || normaliseTime(v) !== null, "Use a time like 18:30"),
  // Where the number comes from. "participation" needs an event to read.
  headCountSource: z.enum(["manual", "participation"]).optional(),
  guests: z.number().int().min(0).max(1000).optional(),
  shiftSeriesId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateMealInput = z.infer<typeof createMealInput>;

export const updateMealInput = createMealInput.omit({ menuPlanId: true }).partial();
export type UpdateMealInput = z.infer<typeof updateMealInput>;

// A headcount worked out from arrivals reads the event's Participation, so it
// needs the menu to belong to an event. A standing menu has no event; saying
// "from arrivals" there would silently produce nothing, so it's refused.
function requireSourceFits(plan: MenuPlanRow, input: { headCountSource?: string }) {
  if (input.headCountSource === "participation" && !plan.cycleId) {
    throw new AppError("This is a standing menu, which has no event to take arrivals from — enter the headcount instead");
  }
}

// The zod refinement says this for a form; this is for the caller that never
// parsed. Blank or null is "no time"; anything else must be a real one.
function cleanTime(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const time = normaliseTime(raw);
  if (!time) throw new AppError("Use a time like 18:30");
  return time;
}

async function requireMealReferences(actor: Member, input: { phaseId?: string | null; shiftSeriesId?: string | null }) {
  if (input.phaseId) {
    const [phaseRow] = await db
      .select({ id: phase.id })
      .from(phase)
      .innerJoin(cycle, eq(cycle.id, phase.cycleId))
      .where(and(eq(phase.id, input.phaseId), eq(cycle.communityId, actor.communityId)));
    if (!phaseRow) {
      throw new NotFoundError("Phase not found in your community");
    }
  }
  if (input.shiftSeriesId) {
    const [seriesRow] = await db
      .select({ id: shiftSeries.id })
      .from(shiftSeries)
      .where(and(eq(shiftSeries.id, input.shiftSeriesId), eq(shiftSeries.communityId, actor.communityId)));
    if (!seriesRow) {
      throw new NotFoundError("Shift series not found in your community");
    }
  }
}

export async function createMeal(actor: Member, input: CreateMealInput) {
  await requireKitchenModuleOn(actor);
  const plan = await requireEditableMenuPlan(actor, input.menuPlanId);
  requireSourceFits(plan, input);
  await requireMealReferences(actor, input);

  const [created] = await db
    .insert(meal)
    .values({
      menuPlanId: input.menuPlanId,
      label: input.label,
      date: input.date,
      phaseId: input.phaseId ?? null,
      headCount: input.headCount ?? null,
      slot: input.slot ?? null,
      time: cleanTime(input.time) ?? null,
      headCountSource: input.headCountSource ?? "manual",
      guests: input.guests ?? 0,
      shiftSeriesId: input.shiftSeriesId ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return created;
}

export async function updateMeal(actor: Member, mealId: string, input: UpdateMealInput) {
  await requireKitchenModuleOn(actor);
  const row = await getMealInCommunity(actor, mealId);
  const plan = await requireEditableMenuPlan(actor, row.menuPlanId);
  requireSourceFits(plan, input);
  await requireMealReferences(actor, input);

  const [updated] = await db
    .update(meal)
    .set({
      ...(input.label !== undefined && { label: input.label }),
      ...(input.date !== undefined && { date: input.date }),
      ...(input.phaseId !== undefined && { phaseId: input.phaseId }),
      ...(input.headCount !== undefined && { headCount: input.headCount }),
      ...(input.slot !== undefined && { slot: input.slot }),
      ...(input.time !== undefined && { time: cleanTime(input.time) }),
      ...(input.headCountSource !== undefined && { headCountSource: input.headCountSource }),
      ...(input.guests !== undefined && { guests: input.guests }),
      ...(input.shiftSeriesId !== undefined && { shiftSeriesId: input.shiftSeriesId }),
      ...(input.notes !== undefined && { notes: input.notes }),
    })
    .where(eq(meal.id, mealId))
    .returning();
  return updated;
}

// Meals are deletable; their dishes and ingredients go with them (the
// schema keeps plain FK references with no cascade, so the delete order
// is spelled out here rather than left to the database).
export async function deleteMeal(actor: Member, mealId: string) {
  await requireKitchenModuleOn(actor);
  const row = await getMealInCommunity(actor, mealId);
  await requireEditableMenuPlan(actor, row.menuPlanId);

  await db.transaction(async (tx) => {
    const dishIds = (await tx.select({ id: dish.id }).from(dish).where(eq(dish.mealId, mealId))).map((d) => d.id);
    // One statement per layer: ingredients for every dish on the meal,
    // then the dishes themselves, then the meal. inArray over the whole
    // set (rather than a loop) keeps this at three round trips even for
    // a big meal.
    if (dishIds.length > 0) {
      await tx.delete(dishIngredient).where(inArray(dishIngredient.dishId, dishIds));
      await tx.delete(dish).where(inArray(dish.id, dishIds));
    }
    await tx.delete(meal).where(eq(meal.id, mealId));
  });
}

export async function listMealsForPlan(actor: Member, menuPlanId: string) {
  // Read posture, not write: the plan must be visible (published, or a
  // draft the viewer owns), then all its meals come back by date.
  await getVisibleMenuPlan(actor, menuPlanId);
  return db.select().from(meal).where(eq(meal.menuPlanId, menuPlanId)).orderBy(meal.date, meal.createdAt);
}