import type { EditableMeal } from "@/lib/kitchen";
import { BUTTON_PRIMARY, LABEL, SELECT } from "@/components/ui/kit";
import { applyRecipeAction } from "./actions";
import { TextField } from "./parts";

/**
 * The recipe-first apply door. A member browsing the box picks one of the
 * draft meals they may actually edit; the action re-checks that same gate.
 * The multiplier box is deliberately blank — leaving it blank uses the
 * suggested value shown above it, and typing a half-step overrides it.
 */
export default function RecipeApplyForm({
  recipeId,
  meals,
  suggestions,
  returnTo = "/kitchen/recipes",
  submitLabel = "Add to meal plan",
}: {
  recipeId: string;
  meals: EditableMeal[];
  suggestions: Record<string, number>;
  returnTo?: string;
  submitLabel?: string;
}) {
  if (meals.length === 0) {
    return (
      <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
        You don&rsquo;t currently hold a draft menu you can add this to. Once you&rsquo;re holding one, this action will
        appear here.
      </p>
    );
  }
  return (
    <form action={applyRecipeAction} className="flex flex-col gap-3">
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Meal</span>
        <select name="mealId" required className={SELECT} defaultValue="">
          <option value="" disabled>
            Choose a draft meal…
          </option>
          {meals.map((meal) => (
            <option key={meal.id} value={meal.id}>
              {meal.label} · {meal.date}
            </option>
          ))}
        </select>
      </label>
      <ul className="flex flex-col gap-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        {meals.map((meal) => (
          <li key={meal.id}>
            {meal.label}: suggested {suggestions[meal.id] ?? 1}×
          </li>
        ))}
      </ul>
      <TextField
        label="Multiplier (optional)"
        name="multiplier"
        type="number"
        min={0.5}
        hint="Half steps, at least 0.5. Leave blank to use the suggestion."
        placeholder="Use suggestion"
      />
      <div>
        <button type="submit" className={BUTTON_PRIMARY}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
