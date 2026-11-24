"use client";

import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { BUTTON_GHOST, BUTTON_ICON, INPUT } from "@/components/ui/kit";
import { blankIngredientRows, type IngredientRow } from "@/lib/kitchen/recipe-form";

/**
 * The ingredient lines of a recipe form: add a row, remove a row, nothing
 * else. Rows submit as three parallel repeated fields
 * (`ingredientName`/`ingredientAmount`/`ingredientUnit`) that the action reads
 * back with `getAll`. The values are controlled by the parent so a refused
 * submit can put the exact typed draft back; the parent starts with a few
 * blank rows and this component only grows or trims that list.
 *
 * A blank amount means "to taste" and is a real answer; a row with no name is
 * dropped by the action. That is why there's a placeholder row rather than a
 * "no ingredients" state: an empty form still has somewhere to start typing.
 */
export default function IngredientRows({
  rows,
  onChange,
}: {
  rows: IngredientRow[];
  onChange: (rows: IngredientRow[]) => void;
}) {
  const set = (index: number, field: keyof IngredientRow, value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const add = () => onChange([...rows, { name: "", amount: "", unit: "" }]);
  const remove = (index: number) => {
    const left = rows.filter((_, i) => i !== index);
    // Never leave the list without a row to type into.
    onChange(left.length > 0 ? left : blankIngredientRows().slice(0, 1));
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              name="ingredientAmount"
              inputMode="decimal"
              value={row.amount}
              onChange={(e) => set(i, "amount", e.target.value)}
              placeholder="Amount"
              aria-label={`Ingredient ${i + 1} amount`}
              className={`${INPUT} w-20 shrink-0`}
            />
            <input
              type="text"
              name="ingredientUnit"
              value={row.unit}
              onChange={(e) => set(i, "unit", e.target.value)}
              placeholder="Unit"
              aria-label={`Ingredient ${i + 1} unit`}
              className={`${INPUT} w-20 shrink-0`}
            />
            <input
              type="text"
              name="ingredientName"
              value={row.name}
              onChange={(e) => set(i, "name", e.target.value)}
              placeholder="Ingredient"
              aria-label={`Ingredient ${i + 1} name`}
              className={`${INPUT} min-w-0 flex-1`}
            />
            <button
              type="button"
              className={BUTTON_ICON}
              aria-label={`Remove ingredient ${i + 1}`}
              onClick={() => remove(i)}
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
