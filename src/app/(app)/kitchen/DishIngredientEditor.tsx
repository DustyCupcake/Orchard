"use client";

import { useActionState, useEffect, useRef } from "react";
import { BUTTON_DESTRUCTIVE, BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/kit";
import type { SimpleFormState } from "@/lib/kitchen/recipe-form";
import {
  createDishIngredientAction,
  deleteDishIngredientAction,
  updateDishIngredientAction,
  updateDishMultiplierAction,
} from "./actions";

// These forms live inside the dish's native <dialog>. Their actions save and
// revalidate in place rather than redirecting: a redirect reloads the page and
// closes the dialog, which is exactly the annoyance this component fixes.
type Ingredient = { id: string; name: string; amount: string | number | null; unit: string | null };
type Dish = { id: string; multiplier: string | number | null; ingredients: Ingredient[] };

const initialState: SimpleFormState = {};

function formatAmount(amount: string | number | null): string {
  if (amount === null || amount === undefined) return "";
  const n = Number(amount);
  return Number.isFinite(n) ? String(n) : String(amount);
}

function Tab() {
  return <input type="hidden" name="tab" value="menu" />;
}

function FormError({ state }: { state: SimpleFormState }) {
  if (!state.error) return null;
  return (
    <p className="text-[length:var(--text-meta)] text-[var(--danger)]" role="alert">
      {state.error}
    </p>
  );
}

function MultiplierForm({ dish }: { dish: Dish }) {
  const [state, formAction, pending] = useActionState(updateDishMultiplierAction, initialState);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
      <Tab />
      <input type="hidden" name="dishId" value={dish.id} />
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Multiplier</span>
        <input
          type="number"
          name="multiplier"
          min={0.5}
          step={0.5}
          defaultValue={formatAmount(dish.multiplier)}
          className={`${INPUT} w-24`}
        />
      </label>
      <button type="submit" className={BUTTON_SECONDARY} disabled={pending}>
        {pending ? "Saving…" : "Save multiplier"}
      </button>
      <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
        Used directly for the shopping list — no second headcount scaling.
      </span>
      <FormError state={state} />
    </form>
  );
}

function IngredientRowForm({ ingredient }: { ingredient: Ingredient }) {
  const [state, formAction, pending] = useActionState(updateDishIngredientAction, initialState);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <form action={formAction} className="flex min-w-0 flex-1 items-center gap-1.5">
          <Tab />
          <input type="hidden" name="ingredientId" value={ingredient.id} />
          <input
            type="text"
            name="amount"
            defaultValue={formatAmount(ingredient.amount)}
            placeholder="Amount"
            aria-label={`${ingredient.name} amount`}
            className={`${INPUT} w-20 shrink-0`}
          />
          <input
            type="text"
            name="unit"
            defaultValue={ingredient.unit ?? ""}
            placeholder="Unit"
            aria-label={`${ingredient.name} unit`}
            className={`${INPUT} w-20 shrink-0`}
          />
          <input
            type="text"
            name="name"
            defaultValue={ingredient.name}
            required
            aria-label="Ingredient"
            className={`${INPUT} min-w-0 flex-1`}
          />
          <button type="submit" className={BUTTON_SECONDARY} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </form>
        <DeleteIngredientForm ingredient={ingredient} />
      </div>
      <FormError state={state} />
    </div>
  );
}

function DeleteIngredientForm({ ingredient }: { ingredient: Ingredient }) {
  const [state, formAction, pending] = useActionState(deleteDishIngredientAction, initialState);
  return (
    <form action={formAction}>
      <Tab />
      <input type="hidden" name="ingredientId" value={ingredient.id} />
      <button
        type="submit"
        className={BUTTON_DESTRUCTIVE}
        aria-label={`Remove ${ingredient.name}`}
        disabled={pending}
      >
        ×
      </button>
      <FormError state={state} />
    </form>
  );
}

function AddIngredientForm({ dishId }: { dishId: string }) {
  const [state, formAction, pending] = useActionState(createDishIngredientAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const handled = useRef(state);

  // A successful add revalidates the dish without navigating, so the inputs
  // would otherwise keep the text of an ingredient that is now in the list.
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Tab />
        <input type="hidden" name="dishId" value={dishId} />
        <input
          type="text"
          name="amount"
          inputMode="decimal"
          placeholder="Amount"
          aria-label="New ingredient amount"
          className={`${INPUT} w-20 shrink-0`}
        />
        <input
          type="text"
          name="unit"
          placeholder="Unit"
          aria-label="New ingredient unit"
          className={`${INPUT} w-20 shrink-0`}
        />
        <input
          type="text"
          name="name"
          required
          placeholder="Add an ingredient"
          aria-label="New ingredient name"
          className={`${INPUT} min-w-0 flex-1`}
        />
        <button type="submit" className={BUTTON_SECONDARY} disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <FormError state={state} />
    </form>
  );
}

export default function DishIngredientEditor({ dish }: { dish: Dish }) {
  return (
    <>
      {dish.multiplier !== null && <MultiplierForm dish={dish} />}

      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
        <span className={LABEL}>Ingredients</span>
        {dish.ingredients.length === 0 && (
          <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">None yet.</p>
        )}
        {dish.ingredients.map((ing) => (
          <IngredientRowForm key={ing.id} ingredient={ing} />
        ))}
        <AddIngredientForm dishId={dish.id} />
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Leave the amount blank for &ldquo;to taste&rdquo;.
        </span>
      </div>
    </>
  );
}
