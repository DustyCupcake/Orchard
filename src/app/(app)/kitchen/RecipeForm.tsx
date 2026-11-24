"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Banner, BUTTON_PRIMARY, CheckField, INPUT, LABEL } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ALLERGEN_FLAGS, ALLERGEN_FLAG_LABELS } from "@/lib/kitchen/allergens";
import {
  initialRecipeFormValues,
  type RecipeFormInitial,
  type RecipeFormState,
  type RecipeFormValues,
} from "@/lib/kitchen/recipe-form";
import IngredientRows from "./IngredientRows";

/**
 * The recipe form, for suggesting a recipe and for editing one already in the
 * box (or a historical structured suggestion). The fields are controlled and
 * the server action returns the typed draft alongside a validation error, so
 * a refused submit puts back exactly what the member wrote instead of
 * redirecting to a blank form. Success still redirects to the saved recipe.
 *
 * Fields are ordered by what a person knows first: what it is, who it feeds,
 * what goes in it, what's in it that matters, then the method. Allergens sit
 * after ingredients on purpose, so they are ticked while looking at the list
 * they come from.
 */
export default function RecipeForm({
  action,
  hidden,
  initial,
  submitLabel,
  cancel,
}: {
  action: (prev: RecipeFormState, formData: FormData) => Promise<RecipeFormState>;
  hidden: Record<string, string>;
  initial?: RecipeFormInitial;
  submitLabel: string;
  cancel?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, {} as RecipeFormState);
  const [values, setValues] = useState<RecipeFormValues>(() => initialRecipeFormValues(initial));

  // Only a *new* result should replace what is on screen: a re-render for
  // another reason must not throw away typing since the last submit. Compared
  // by identity, so two rejected submits in a row each restore their own draft.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state.values) setValues(state.values);
  }

  const set = <K extends keyof RecipeFormValues>(field: K, value: RecipeFormValues[K]) =>
    setValues((prev) => ({ ...prev, [field]: value }));
  const toggleFlag = (flag: string, checked: boolean) =>
    set(
      "allergenFlags",
      checked ? [...values.allergenFlags, flag] : values.allergenFlags.filter((f) => f !== flag),
    );

  return (
    <form action={formAction} className="flex max-w-[640px] flex-col gap-5">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.error && <Banner tone="danger">{state.error}</Banner>}

      <label className="flex flex-col gap-1">
        <span className={LABEL}>What is it called?</span>
        <input
          type="text"
          name="title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Three-bean chili"
          required
          className={INPUT}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>How many people does it feed?</span>
        <input
          type="number"
          name="serves"
          min={1}
          value={values.serves}
          onChange={(e) => set("serves", e.target.value)}
          className={INPUT}
        />
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          The kitchen scales the amounts below to however many are eating.
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Ingredients</span>
        <IngredientRows rows={values.ingredients} onChange={(rows) => set("ingredients", rows)} />
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Leave the amount blank for things like salt, to taste. Amounts must be numbers.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className={LABEL}>Contains</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ALLERGEN_FLAGS.filter((flag) => flag !== "none_known").map((flag) => (
            <CheckField
              key={flag}
              name="allergenFlags"
              value={flag}
              label={ALLERGEN_FLAG_LABELS[flag]}
              checked={values.allergenFlags.includes(flag)}
              onChange={(checked) => toggleFlag(flag, checked)}
            />
          ))}
        </div>
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Tick what you know is in it. The kitchen will check this before it goes on the menu.
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Anything else about diet?</span>
        <input
          type="text"
          name="dietaryNote"
          value={values.dietaryNote}
          onChange={(e) => set("dietaryNote", e.target.value)}
          placeholder="e.g. vegan if you use vegetable stock"
          className={INPUT}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL}>Method and notes</span>
        <textarea
          name="body"
          rows={4}
          value={values.body}
          onChange={(e) => set("body", e.target.value)}
          placeholder="How it's made, where it's from, a link"
          className={INPUT}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
        {cancel}
      </div>
    </form>
  );
}
