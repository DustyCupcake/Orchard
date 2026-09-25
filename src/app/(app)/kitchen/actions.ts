"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  adoptFromIdea,
  adoptFromIdeaInput,
  createDish,
  createDishIngredient,
  createDishIngredientInput,
  createDishInput,
  createMeal,
  createMealInput,
  createMenuPlan,
  createMenuPlanInput,
  declineFoodIdea,
  declineFoodIdeaInput,
  deleteDish,
  deleteDishIngredient,
  deleteMeal,
  fileFoodIdea,
  fileFoodIdeaInput,
  publishMenuPlan,
  updateDish,
  updateDishInput,
  updateDishIngredient,
  updateDishIngredientInput,
  updateMeal,
  updateMealInput,
} from "@/lib/kitchen";
import { AppError } from "@/lib/errors";

// Phase 54 (View-as): every write goes through requireMember() below so
// a session actively rendering as someone else can never perform one —
// the same wrapper every module's actions.ts established.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/kitchen?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/kitchen?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Submit forms carry the page's resolved scope as a hidden cycleId;
// "" (no cycle resolve / cycles off) means the evergreen scope.
function scope(formData: FormData): string | null {
  const raw = String(formData.get("cycleId") ?? "").trim();
  return raw || null;
}

function parsePositiveInt(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Checkbox groups — unchecked boxes send nothing, so the parsed list is
// just whichever flags were checked (an edit that unchecks everything
// clears the field, since the action always passes the array).
function allergenFlags(formData: FormData): string[] {
  return formData.getAll("allergenFlags").map(String);
}

export async function createMenuPlanAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = createMenuPlanInput.parse({
      title: String(formData.get("title") ?? "").trim(),
      cycleId: scope(formData),
    });
    await createMenuPlan(actor, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?created=1");
}

export async function publishMenuPlanAction(formData: FormData) {
  const actor = await requireMember();
  const menuPlanId = String(formData.get("menuPlanId"));
  try {
    await publishMenuPlan(actor, menuPlanId);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?published=1");
}

export async function createMealAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = createMealInput.parse({
      menuPlanId: String(formData.get("menuPlanId")),
      label: String(formData.get("label") ?? "").trim(),
      date: String(formData.get("date") ?? "").trim(),
      headCount: parsePositiveInt(String(formData.get("headCount") ?? "")),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    await createMeal(actor, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?created=1");
}

export async function updateMealAction(formData: FormData) {
  const actor = await requireMember();
  const mealId = String(formData.get("mealId"));
  try {
    const input = updateMealInput.parse({
      label: String(formData.get("label") ?? "").trim(),
      date: String(formData.get("date") ?? "").trim(),
      headCount: parsePositiveInt(String(formData.get("headCount") ?? "")),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    await updateMeal(actor, mealId, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?saved=1");
}

export async function deleteMealAction(formData: FormData) {
  const actor = await requireMember();
  const mealId = String(formData.get("mealId"));
  try {
    await deleteMeal(actor, mealId);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?saved=1");
}

export async function createDishAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = createDishInput.parse({
      mealId: String(formData.get("mealId")),
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      serves: parsePositiveInt(String(formData.get("serves") ?? "")),
      allergenFlags: allergenFlags(formData),
      dietaryNote: String(formData.get("dietaryNote") ?? "").trim() || null,
    });
    await createDish(actor, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?created=1");
}

export async function updateDishAction(formData: FormData) {
  const actor = await requireMember();
  const dishId = String(formData.get("dishId"));
  try {
    const input = updateDishInput.parse({
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      serves: parsePositiveInt(String(formData.get("serves") ?? "")),
      allergenFlags: allergenFlags(formData),
      dietaryNote: String(formData.get("dietaryNote") ?? "").trim() || null,
    });
    await updateDish(actor, dishId, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?saved=1");
}

export async function deleteDishAction(formData: FormData) {
  const actor = await requireMember();
  const dishId = String(formData.get("dishId"));
  try {
    await deleteDish(actor, dishId);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?saved=1");
}

export async function createDishIngredientAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = createDishIngredientInput.parse({
      dishId: String(formData.get("dishId")),
      name: String(formData.get("name") ?? "").trim(),
      amount: Number(formData.get("amount") ?? NaN),
      unit: String(formData.get("unit") ?? "").trim() || null,
    });
    await createDishIngredient(actor, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?created=1");
}

export async function updateDishIngredientAction(formData: FormData) {
  const actor = await requireMember();
  const ingredientId = String(formData.get("ingredientId"));
  try {
    const input = updateDishIngredientInput.parse({
      name: String(formData.get("name") ?? "").trim(),
      amount: Number(formData.get("amount") ?? NaN),
      unit: String(formData.get("unit") ?? "").trim() || null,
    });
    await updateDishIngredient(actor, ingredientId, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?saved=1");
}

export async function deleteDishIngredientAction(formData: FormData) {
  const actor = await requireMember();
  const ingredientId = String(formData.get("ingredientId"));
  try {
    await deleteDishIngredient(actor, ingredientId);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?saved=1");
}

// Any member — D5's "suggest something" door.
export async function fileFoodIdeaAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = fileFoodIdeaInput.parse({
      menuPlanId: String(formData.get("menuPlanId")),
      kind: String(formData.get("kind") ?? "preference"),
      title: String(formData.get("title") ?? "").trim(),
      body: String(formData.get("body") ?? "").trim() || null,
    });
    await fileFoodIdea(actor, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?suggested=1");
}

// Owner-only, enforced inside adoptFromIdea.
export async function adoptIdeaAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = adoptFromIdeaInput.parse({
      ideaId: String(formData.get("ideaId")),
      mealId: String(formData.get("mealId")),
      name: String(formData.get("name") ?? "").trim() || undefined,
    });
    await adoptFromIdea(actor, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?adopted=1");
}

// Owner-only, enforced inside declineFoodIdea.
export async function declineIdeaAction(formData: FormData) {
  const actor = await requireMember();
  const ideaId = String(formData.get("ideaId"));
  try {
    const input = declineFoodIdeaInput.parse({
      declinedReason: String(formData.get("declinedReason") ?? "").trim() || null,
    });
    await declineFoodIdea(actor, ideaId, input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/kitchen");
  redirect("/kitchen?saved=1");
}