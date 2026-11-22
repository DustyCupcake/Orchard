// The shared shape of a recipe form's visible fields. The form keeps these as
// strings (including the raw amount text) so a refused submit can be put back
// exactly as the member typed it — a rejected "two cups" must not come back as
// an empty row or a silently parsed number.

export type IngredientRow = { name: string; amount: string; unit: string };

export type RecipeFormInitial = {
  title: string;
  serves: number | null;
  ingredients: IngredientRow[];
  allergenFlags: string[];
  dietaryNote: string | null;
  body: string | null;
};

export type RecipeFormValues = {
  title: string;
  serves: string;
  ingredients: IngredientRow[];
  allergenFlags: string[];
  dietaryNote: string;
  body: string;
};

export type RecipeFormState = {
  error?: string;
  /** Present only on a refused submit, so the form can restore the draft. */
  values?: RecipeFormValues;
};

export type SimpleFormState = { error?: string; ok?: boolean };

export function blankIngredientRows(): IngredientRow[] {
  return [0, 1, 2].map(() => ({ name: "", amount: "", unit: "" }));
}

export function initialRecipeFormValues(initial?: RecipeFormInitial): RecipeFormValues {
  return {
    title: initial?.title ?? "",
    serves: initial?.serves ? String(initial.serves) : "",
    ingredients:
      initial && initial.ingredients.length > 0
        ? initial.ingredients.map((row) => ({ ...row }))
        : blankIngredientRows(),
    allergenFlags: initial?.allergenFlags ?? [],
    dietaryNote: initial?.dietaryNote ?? "",
    body: initial?.body ?? "",
  };
}
