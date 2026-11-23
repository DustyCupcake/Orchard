"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  acceptRecipe,
  adoptFromIdea,
  adoptFromIdeaInput,
  addMealComment,
  addMealCommentInput,
  addRecipeComment,
  addRecipeCommentInput,
  applyRecipeInput,
  applyRecipeToMeal,
  createDish,
  createDishIngredient,
  createDishIngredientInput,
  createDishInput,
  createMeal,
  createMealInput,
  createMenuPlan,
  createMenuPlanInput,
  createRecipe,
  createRecipeInput,
  declineFoodIdea,
  declineFoodIdeaInput,
  declineRecipe,
  declineRecipeInput,
  deleteDish,
  deleteDishIngredient,
  deleteMeal,
  fileFoodIdea,
  fileFoodIdeaInput,
  publishMenuPlan,
  saveDishToRecipeBox,
  toggleYum,
  updateDish,
  updateDishFromRecipe,
  updateDishInput,
  updateDishMultiplier,
  updateRecipe,
  updateRecipeInput,
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
import type { RecipeFormState, RecipeFormValues, SimpleFormState } from "@/lib/kitchen/recipe-form";

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

// Recipe forms live on their own pages, so their failures return to the form
// that was submitted rather than to Kitchen's default tab. `returnTo` is always
// a hidden field written by our own page, but check the prefix anyway: an
// action must not become an open redirect.
function returnTo(formData: FormData, fallback: string): string {
  const raw = String(formData.get("returnTo") ?? "").trim();
  return raw.startsWith("/kitchen") ? raw : fallback;
}

function withMessage(path: string, key: string): string {
  const url = new URL(path, "http://kitchen.local");
  url.searchParams.set(key, "1");
  return `${url.pathname}${url.search}`;
}

function redirectRecipeError(err: unknown, formData: FormData): never {
  const message = formErrorMessage(err);
  const url = new URL(returnTo(formData, "/kitchen/recipes"), "http://kitchen.local");
  url.searchParams.set("error", message);
  redirect(`${url.pathname}${url.search}`);
}

// Stateful forms report a refusal in place instead of redirecting, so the
// member keeps what they typed. Unknown errors still throw — a form state is
// not a place to hide a bug.
function formErrorMessage(err: unknown): string {
  if (err instanceof ZodError) return err.issues[0]?.message ?? "Invalid input";
  if (err instanceof AppError) return err.message;
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

// Blank means "use the suggestion the planner was shown"; a value goes through
// the schema's half-step rule so the UI cannot store 0.3× and show 0.5×.
function parseMultiplier(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  return Number(trimmed);
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

// The recipe form's ingredient rows arrive as three parallel repeated fields.
// The raw version is what goes back into a refused form — including half-typed
// rows — so a rejected "two cups" is still there to correct.
function rawIngredientRows(formData: FormData) {
  const names = formData.getAll("ingredientName").map(String);
  const amounts = formData.getAll("ingredientAmount").map(String);
  const units = formData.getAll("ingredientUnit").map(String);
  const length = Math.max(1, names.length, amounts.length, units.length);
  return Array.from({ length }, (_, i) => ({
    name: names[i] ?? "",
    amount: amounts[i] ?? "",
    unit: units[i] ?? "",
  }));
}

// A row with no name is an empty row the member never filled in and is dropped
// on save; a row with a name and a blank amount is "to taste".
function ingredientRows(formData: FormData) {
  return rawIngredientRows(formData)
    .map((row) => ({
      name: row.name.trim(),
      amount: parseAmount(row.amount),
      unit: row.unit.trim() || null,
    }))
    .filter((row) => row.name !== "");
}

// Everything the recipe form shows, kept as text. Returned with an error so
// the client can restore a rejected submit byte for byte.
function recipeFormValues(formData: FormData): RecipeFormValues {
  return {
    title: String(formData.get("title") ?? ""),
    serves: String(formData.get("serves") ?? ""),
    ingredients: rawIngredientRows(formData),
    allergenFlags: allergenFlags(formData),
    dietaryNote: String(formData.get("dietaryNote") ?? ""),
    body: String(formData.get("body") ?? ""),
  };
}

function recipeFormFailure(err: unknown, formData: FormData): RecipeFormState {
  return { error: formErrorMessage(err), values: recipeFormValues(formData) };
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

export async function createMealCommentAction(formData: FormData) {
  const actor = await requireMember();
  const mealId = String(formData.get("mealId"));
  try {
    const input = addMealCommentInput.parse({ body: String(formData.get("body") ?? "") });
    await addMealComment(actor, mealId, input);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(landing(formData, { tab: "menu" }));
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

// Ingredient rows are edited inside a native <dialog>. A redirect would
// reload the page and close it, so this action reports back in place; the
// caller revalidates /kitchen and keeps the dialog open.
export async function createDishIngredientAction(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
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
    return { error: formErrorMessage(err) };
  }
  revalidatePath("/kitchen");
  return { ok: true };
}

export async function updateDishIngredientAction(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
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
    return { error: formErrorMessage(err) };
  }
  revalidatePath("/kitchen");
  return { ok: true };
}

export async function deleteDishIngredientAction(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const actor = await requireMember();
  const ingredientId = String(formData.get("ingredientId"));
  try {
    await deleteDishIngredient(actor, ingredientId);
  } catch (err) {
    return { error: formErrorMessage(err) };
  }
  revalidatePath("/kitchen");
  return { ok: true };
}

// Any member — D5's "suggest something" door. Recipe suggestions now go to
// the community recipe box (createRecipeAction); this action remains for dish
// requests and preferences, and for editing historical ideas.
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

// The author only, enforced inside updateFoodIdea. Both the short idea form
// and the structured recipe form save through this one parse; the recipe form
// needs the stateful wrapper below so a refused edit keeps its draft.
async function saveFoodIdeaFromForm(formData: FormData) {
  const actor = await requireMember();
  const ideaId = String(formData.get("ideaId"));
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
}

export async function updateFoodIdeaAction(formData: FormData) {
  try {
    await saveFoodIdeaFromForm(formData);
  } catch (err) {
    redirectWithError(err, formData);
  }
  revalidatePath("/kitchen");
  redirect(`/kitchen?tab=suggestions&saved=1`);
}

export async function updateFoodIdeaRecipeFormAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  try {
    await saveFoodIdeaFromForm(formData);
  } catch (err) {
    return recipeFormFailure(err, formData);
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

// Recipe box. Any member can suggest and discuss; only a current holder can
// curate. All of those rules live in the lib, so these actions only parse and
// choose where a success or refusal lands.
function recipeFields(formData: FormData) {
  return {
    title: String(formData.get("title") ?? "").trim(),
    body: String(formData.get("body") ?? "").trim() || null,
    serves: parsePositiveInt(String(formData.get("serves") ?? "")),
    allergenFlags: allergenFlags(formData),
    dietaryNote: String(formData.get("dietaryNote") ?? "").trim() || null,
    ingredients: ingredientRows(formData),
  };
}

export async function createRecipeAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const actor = await requireMember();
  let id: string;
  try {
    const created = await createRecipe(actor, createRecipeInput.parse(recipeFields(formData)));
    if (!created) throw new AppError("Recipe could not be saved");
    id = created.id;
  } catch (err) {
    return recipeFormFailure(err, formData);
  }
  revalidatePath("/kitchen/recipes");
  revalidatePath("/kitchen");
  redirect(withMessage(`/kitchen/recipes/${id}`, "suggested"));
}

export async function updateRecipeAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const actor = await requireMember();
  const id = String(formData.get("recipeId"));
  try {
    await updateRecipe(actor, id, updateRecipeInput.parse(recipeFields(formData)));
  } catch (err) {
    return recipeFormFailure(err, formData);
  }
  revalidatePath("/kitchen/recipes");
  revalidatePath(`/kitchen/recipes/${id}`);
  revalidatePath("/kitchen");
  redirect(withMessage(`/kitchen/recipes/${id}`, "saved"));
}

export async function acceptRecipeAction(formData: FormData) {
  const actor = await requireMember();
  const id = String(formData.get("recipeId"));
  try {
    await acceptRecipe(actor, id);
  } catch (err) {
    redirectRecipeError(err, formData);
  }
  revalidatePath("/kitchen/recipes");
  revalidatePath(`/kitchen/recipes/${id}`);
  redirect(withMessage(`/kitchen/recipes/${id}`, "saved"));
}

export async function declineRecipeAction(formData: FormData) {
  const actor = await requireMember();
  const id = String(formData.get("recipeId"));
  try {
    const input = declineRecipeInput.parse({ declineReason: String(formData.get("declineReason") ?? "").trim() });
    await declineRecipe(actor, id, input);
  } catch (err) {
    redirectRecipeError(err, formData);
  }
  revalidatePath("/kitchen/recipes");
  revalidatePath(`/kitchen/recipes/${id}`);
  redirect(withMessage(`/kitchen/recipes/${id}`, "saved"));
}

export async function toggleYumAction(formData: FormData) {
  const actor = await requireMember();
  const id = String(formData.get("recipeId"));
  try {
    await toggleYum(actor, id);
  } catch (err) {
    redirectRecipeError(err, formData);
  }
  revalidatePath("/kitchen/recipes");
  revalidatePath(`/kitchen/recipes/${id}`);
  redirect(returnTo(formData, `/kitchen/recipes/${id}`));
}

export async function addRecipeCommentAction(formData: FormData) {
  const actor = await requireMember();
  const id = String(formData.get("recipeId"));
  try {
    const input = addRecipeCommentInput.parse({ body: String(formData.get("body") ?? "") });
    await addRecipeComment(actor, id, input);
  } catch (err) {
    redirectRecipeError(err, formData);
  }
  revalidatePath(`/kitchen/recipes/${id}`);
  redirect(withMessage(`/kitchen/recipes/${id}`, "commented"));
}

export async function applyRecipeAction(formData: FormData) {
  const actor = await requireMember();
  const back = returnTo(formData, "/kitchen?tab=menu");
  try {
    const input = applyRecipeInput.parse({
      recipeId: String(formData.get("recipeId")),
      mealId: String(formData.get("mealId")),
      multiplier: parseMultiplier(String(formData.get("multiplier") ?? "")),
    });
    await applyRecipeToMeal(actor, input);
  } catch (err) {
    redirectRecipeError(err, formData);
  }
  revalidatePath("/kitchen");
  revalidatePath("/kitchen/recipes");
  redirect(withMessage(back, "applied"));
}

export async function updateDishMultiplierAction(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const actor = await requireMember();
  const dishId = String(formData.get("dishId"));
  try {
    const multiplier = parseMultiplier(String(formData.get("multiplier") ?? ""));
    if (multiplier === undefined) throw new AppError("Enter a multiplier");
    await updateDishMultiplier(actor, dishId, multiplier);
  } catch (err) {
    return { error: formErrorMessage(err) };
  }
  revalidatePath("/kitchen");
  return { ok: true };
}

// Both dish <-> box actions report in place, like the other dish-editor forms:
// a redirect would reload the page and close the dialog. The editor re-reads
// the dish's link after the revalidate, so the panel changes by itself.
export async function saveDishToRecipeBoxAction(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const actor = await requireMember();
  try {
    await saveDishToRecipeBox(actor, String(formData.get("dishId")));
  } catch (err) {
    return { error: formErrorMessage(err) };
  }
  revalidatePath("/kitchen");
  revalidatePath("/kitchen/recipes");
  return { ok: true };
}

export async function updateDishFromRecipeAction(
  _prev: SimpleFormState,
  formData: FormData,
): Promise<SimpleFormState> {
  const actor = await requireMember();
  try {
    await updateDishFromRecipe(actor, String(formData.get("dishId")));
  } catch (err) {
    return { error: formErrorMessage(err) };
  }
  revalidatePath("/kitchen");
  return { ok: true };
}
