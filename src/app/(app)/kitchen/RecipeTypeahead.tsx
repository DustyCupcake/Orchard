"use client";

import { useState } from "react";
import { BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/kit";
import { applyRecipeAction } from "./actions";

export type RecipeOption = {
  id: string;
  title: string;
  serves: number | null;
  suggestedMultiplier: number;
};

/**
 * The per-meal apply control. A planner types a recipe name, picks one of the
 * community's accepted recipes, and can change the multiplier the app suggested
 * from this meal's headcount and the dishes already on it. No network call: the
 * browse page passes the accepted recipes and their suggestions down as props.
 */
export default function RecipeTypeahead({
  mealId,
  options,
  returnTo = "/kitchen?tab=menu",
}: {
  mealId: string;
  options: RecipeOption[];
  returnTo?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RecipeOption | null>(null);
  const [multiplier, setMultiplier] = useState("");
  const matches = selected
    ? []
    : options
        .filter((o) => o.title.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 6);

  return (
    <form action={applyRecipeAction} className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <input type="hidden" name="mealId" value={mealId} />
      <input type="hidden" name="recipeId" value={selected?.id ?? ""} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <span className={LABEL}>Add a recipe from the box</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={selected ? selected.title : query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setMultiplier("");
          }}
          placeholder="Type a recipe name…"
          aria-label="Recipe name"
          className={`${INPUT} min-w-[200px] flex-1`}
          autoComplete="off"
        />
        <input
          type="number"
          name="multiplier"
          min={0.5}
          step={0.5}
          value={multiplier}
          onChange={(e) => setMultiplier(e.target.value)}
          placeholder={selected ? String(selected.suggestedMultiplier) : "1"}
          aria-label="Multiplier"
          className={`${INPUT} w-24`}
        />
        <button type="submit" disabled={!selected} className={BUTTON_SECONDARY}>
          Add to meal
        </button>
      </div>
      {selected ? (
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {selected.serves ? `Feeds ${selected.serves} as written · ` : ""}suggested {selected.suggestedMultiplier}×
          {multiplier === "" ? " — change the number to use your own" : ` — your ${multiplier}× will be used`}.
        </p>
      ) : (
        query.trim().length > 0 && (
          <ul className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-1">
            {matches.length === 0 ? (
              <li className="px-2 py-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                No accepted recipe by that name.
              </li>
            ) : (
              matches.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(option);
                      setQuery(option.title);
                    }}
                    className="w-full rounded-[var(--radius-sm)] px-2 py-1 text-left text-[length:var(--text-body)] text-[var(--text)] hover:bg-[var(--surface-sunken)]"
                  >
                    {option.title}
                    {option.serves ? <span className="text-[var(--text-muted)]"> · serves {option.serves}</span> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        )
      )}
    </form>
  );
}
