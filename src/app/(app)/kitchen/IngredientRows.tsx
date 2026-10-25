"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { BUTTON_GHOST, BUTTON_ICON, INPUT } from "@/components/ui/kit";

export type IngredientRow = { name: string; amount: string; unit: string };

/**
 * The ingredient lines of a recipe form: add a row, remove a row, nothing
 * else. Rows submit as three parallel repeated fields
 * (`ingredientName`/`ingredientAmount`/`ingredientUnit`) that the action
 * reads back with `getAll`, so the form works without any state of its own
 * being sent anywhere — this component only exists so the list can grow.
 *
 * A blank amount means "to taste" and is a real answer; a row with no name
 * is dropped by the action. That is why there's a placeholder row rather than
 * a "no ingredients" state: an empty form still has somewhere to start typing.
 *
 * Keys are a counter rather than the array index, so removing a row in the
 * middle doesn't hand its typed text to the row that slid up into its place.
 */
type Row = IngredientRow & { key: number };
type State = { rows: Row[]; next: number };

// Keys come from the state itself rather than a ref or a global, so the
// initialiser is pure: the next unused key is always `next`.
function initialState(initial?: IngredientRow[]): State {
  const seed = initial && initial.length > 0 ? initial : [0, 1, 2].map(() => ({ name: "", amount: "", unit: "" }));
  return { rows: seed.map((r, i) => ({ ...r, key: i })), next: seed.length };
}

export default function IngredientRows({ initial }: { initial?: IngredientRow[] }) {
  const [{ rows }, setState] = useState(() => initialState(initial));
  const add = () =>
    setState((s) => ({ rows: [...s.rows, { name: "", amount: "", unit: "", key: s.next }], next: s.next + 1 }));
  const remove = (key: number) =>
    setState((s) => {
      const left = s.rows.filter((r) => r.key !== key);
      // Never leave the list without a row to type into.
      return left.length > 0
        ? { rows: left, next: s.next }
        : { rows: [{ name: "", amount: "", unit: "", key: s.next }], next: s.next + 1 };
    });

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={row.key} className="flex items-center gap-1.5">
            <input
              type="text"
              name="ingredientAmount"
              inputMode="decimal"
              defaultValue={row.amount}
              placeholder="Amount"
              aria-label={`Ingredient ${i + 1} amount`}
              className={`${INPUT} w-20 shrink-0`}
            />
            <input
              type="text"
              name="ingredientUnit"
              defaultValue={row.unit}
              placeholder="Unit"
              aria-label={`Ingredient ${i + 1} unit`}
              className={`${INPUT} w-20 shrink-0`}
            />
            <input
              type="text"
              name="ingredientName"
              defaultValue={row.name}
              placeholder="Ingredient"
              aria-label={`Ingredient ${i + 1} name`}
              className={`${INPUT} min-w-0 flex-1`}
            />
            <button
              type="button"
              className={BUTTON_ICON}
              aria-label={`Remove ingredient ${i + 1}`}
              onClick={() => remove(row.key)}
            >
              <XIcon size={14} weight="bold" />
            </button>
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className={`${BUTTON_GHOST} inline-flex items-center gap-1`} onClick={add}>
          <PlusIcon size={14} weight="bold" /> Add an ingredient
        </button>
      </div>
    </div>
  );
}
