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
  updateFoodIdea,
  updateFoodIdeaInput,
  updateMeal,
  updateMealInput,
  updateMealTimesInput,
  updateMenuPlanMealTimes,
  withdrawFoodIdea,
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

// Where a form sends the member back to. A submit carries the tab it came
// from (and, for the recipe form, `compose`), so saving a dish doesn't drop
// the holder onto a different tab and a refused suggestion lands back on the
// open form rather than on the list.
function landing(formData: FormData, params: Record<string, string>): string {
  const query = new URLSearchParams();
  const tab = String(formData.get("tab") ?? "").trim();
  if (tab) query.set("tab", tab);
  const compose = String(formData.get("compose") ?? "").trim();
  if (compose && params.error) query.set("compose", compose);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  const qs = query.toString();
  return qs ? `/kitchen?${qs}` : "/kitchen";
}

function redirectWithError(err: unknown, formData: FormData): never {
  if (err instanceof ZodError) {
    redirect(landing(formData, { error: err.issues[0]?.message ?? "Invalid input" }));
  }
  if (err instanceof AppError) {
    redirect(landing(formData, { error: err.message }));
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

// Guests may be none, so zero is a number here and blank is zero.
function parseCount(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// The fields a meal form shares between adding and editing. Blank slot and
// time mean "not specified" and clear what was there, like every other
// optional field on these forms.
function mealTiming(formData: FormData) {
  const source = String(formData.get("headCountSource") ?? "manual");
  return {
    slot: String(formData.get("slot") ?? "").trim() || null,
    time: String(formData.get("time") ?? "").trim() || null,
    headCountSource: source === "participation" ? "participation" : "manual",
    guests: parseCount(String(formData.get("guests") ?? "")),
  };
}

// An ingredient amount: blank is "to taste" (null), a positive number is an
// amount, and anything else is refused by the schema as NaN rather than
// quietly becoming "to taste".
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

// Checkbox groups — unchecked boxes send nothing, so the parsed list is
// just whichever flags were checked (an edit that unchecks everything
// clears the field, since the action always passes the array).
function allergenFlags(formData: FormData): string[] {
  return formData.getAll("allergenFlags").map(String);
}

// The recipe form's ingredient rows arrive as three parallel repeated
// fields. A row with no name is an empty row the member never filled in, and
// is dropped; a row with a name and a blank amount is "to taste".
function ingredientRows(formData: FormData) {
  const names = formData.getAll("ingredientName").map(String);
  const amounts = formData.getAll("ingredientAmount").map(String);
  const units = formData.getAll("ingredientUnit").map(String);
  return names
    .map((name, i) => ({
      name: name.trim(),
      amount: parseAmount(amounts[i] ?? ""),
      unit: (units[i] ?? "").trim() || null,
    }))
    .filter((row) => row.name !== "");
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
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { created: "1" }));
}

export async function publishMenuPlanAction(formData: FormData) {
  const actor = await requireMember();
  const menuPlanId = String(formData.get("menuPlanId"));
  try {
    await publishMenuPlan(actor, menuPlanId);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { published: "1" }));
}

export async function createMealAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = createMealInput.parse({
      menuPlanId: String(formData.get("menuPlanId")),
      label: String(formData.get("label") ?? "").trim(),
      date: String(formData.get("date") ?? "").trim(),
      headCount: parsePositiveInt(String(formData.get("headCount") ?? "")),
      ...mealTiming(formData),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    await createMeal(actor, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { created: "1" }));
}

export async function updateMealAction(formData: FormData) {
  const actor = await requireMember();
  const mealId = String(formData.get("mealId"));
  try {
    const input = updateMealInput.parse({
      label: String(formData.get("label") ?? "").trim(),
      date: String(formData.get("date") ?? "").trim(),
      headCount: parsePositiveInt(String(formData.get("headCount") ?? "")),
      ...mealTiming(formData),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    await updateMeal(actor, mealId, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { saved: "1" }));
}

// The menu's default breakfast, lunch and dinner times. A blank leaves that
// meal on the built-in default.
export async function updateMealTimesAction(formData: FormData) {
  const actor = await requireMember();
  const menuPlanId = String(formData.get("menuPlanId"));
  try {
    const input = updateMealTimesInput.parse({
      breakfast: String(formData.get("breakfast") ?? "").trim() || null,
      lunch: String(formData.get("lunch") ?? "").trim() || null,
      dinner: String(formData.get("dinner") ?? "").trim() || null,
    });
    await updateMenuPlanMealTimes(actor, menuPlanId, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { saved: "1" }));
}

export async function deleteMealAction(formData: FormData) {
  const actor = await requireMember();
  const mealId = String(formData.get("mealId"));
  try {
    await deleteMeal(actor, mealId);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { saved: "1" }));
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
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { created: "1" }));
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
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { saved: "1" }));
}

export async function deleteDishAction(formData: FormData) {
  const actor = await requireMember();
  const dishId = String(formData.get("dishId"));
  try {
    await deleteDish(actor, dishId);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { saved: "1" }));
}

export async function createDishIngredientAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = createDishIngredientInput.parse({
      dishId: String(formData.get("dishId")),
      name: String(formData.get("name") ?? "").trim(),
      amount: parseAmount(String(formData.get("amount") ?? "")),
      unit: String(formData.get("unit") ?? "").trim() || null,
    });
    await createDishIngredient(actor, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { created: "1" }));
}

export async function updateDishIngredientAction(formData: FormData) {
  const actor = await requireMember();
  const ingredientId = String(formData.get("ingredientId"));
  try {
    const input = updateDishIngredientInput.parse({
      name: String(formData.get("name") ?? "").trim(),
      amount: parseAmount(String(formData.get("amount") ?? "")),
      unit: String(formData.get("unit") ?? "").trim() || null,
    });
    await updateDishIngredient(actor, ingredientId, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { saved: "1" }));
}

export async function deleteDishIngredientAction(formData: FormData) {
  const actor = await requireMember();
  const ingredientId = String(formData.get("ingredientId"));
  try {
    await deleteDishIngredient(actor, ingredientId);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { saved: "1" }));
}

// Any member — D5's "suggest something" door. The recipe form is the same
// form with the kind fixed to a recipe suggestion; the light kinds (a dish
// request, a preference) send no recipe fields.
export async function fileFoodIdeaAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const kind = String(formData.get("kind") ?? "recipe_suggestion");
    const input = fileFoodIdeaInput.parse({
      menuPlanId: String(formData.get("menuPlanId")),
      kind,
      title: String(formData.get("title") ?? "").trim(),
      body: String(formData.get("body") ?? "").trim() || null,
      ...(kind === "recipe_suggestion" && {
        serves: parsePositiveInt(String(formData.get("serves") ?? "")),
        allergenFlags: allergenFlags(formData),
        dietaryNote: String(formData.get("dietaryNote") ?? "").trim() || null,
        ingredients: ingredientRows(formData),
      }),
    });
    await fileFoodIdea(actor, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(`/kitchen?tab=suggestions&suggested=1`);
}

// The author only, enforced inside updateFoodIdea.
export async function updateFoodIdeaAction(formData: FormData) {
  const actor = await requireMember();
  const ideaId = String(formData.get("ideaId"));
  try {
    const recipe = String(formData.get("kind") ?? "") === "recipe_suggestion";
    const input = updateFoodIdeaInput.parse({
      title: String(formData.get("title") ?? "").trim(),
      body: String(formData.get("body") ?? "").trim() || null,
      ...(recipe && {
        serves: parsePositiveInt(String(formData.get("serves") ?? "")),
        allergenFlags: allergenFlags(formData),
        dietaryNote: String(formData.get("dietaryNote") ?? "").trim() || null,
        ingredients: ingredientRows(formData),
      }),
    });
    await updateFoodIdea(actor, ideaId, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(`/kitchen?tab=suggestions&saved=1`);
}

// The author only, and only while the idea is open.
export async function withdrawFoodIdeaAction(formData: FormData) {
  const actor = await requireMember();
  const ideaId = String(formData.get("ideaId"));
  try {
    await withdrawFoodIdea(actor, ideaId);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(`/kitchen?tab=suggestions&saved=1`);
}

// Owner-only, enforced inside adoptFromIdea. The adopt dialog pre-fills the
// suggester's recipe and submits every field back, so what is saved is what
// the holder saw — in particular the allergen flags.
export async function adoptIdeaAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = adoptFromIdeaInput.parse({
      ideaId: String(formData.get("ideaId")),
      mealId: String(formData.get("mealId")),
      name: String(formData.get("name") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? "").trim() || null,
      serves: parsePositiveInt(String(formData.get("serves") ?? "")),
      allergenFlags: allergenFlags(formData),
      dietaryNote: String(formData.get("dietaryNote") ?? "").trim() || null,
    });
    await adoptFromIdea(actor, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(`/kitchen?tab=suggestions&adopted=1`);
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
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(`/kitchen?tab=suggestions&saved=1`);
}
