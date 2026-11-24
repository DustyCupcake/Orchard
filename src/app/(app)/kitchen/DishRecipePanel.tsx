"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, LABEL, Tag } from "@/components/ui/kit";
import type { DishRecipeLink } from "@/lib/kitchen/recipes";
import type { SimpleFormState } from "@/lib/kitchen/recipe-form";
import { saveDishToRecipeBoxAction, updateDishFromRecipeAction } from "./actions";

// Lives in the dish's native <dialog>, so both actions report in place rather
// than redirecting. After either one the page revalidates and this panel is
// handed the dish's new link, which is what changes what it shows.
const initialState: SimpleFormState = {};

function FormError({ state }: { state: SimpleFormState }) {
  if (!state.error) return null;
  return (
    <p className="text-[length:var(--text-meta)] text-[var(--danger)]" role="alert">
      {state.error}
    </p>
  );
}

function SaveToBox({ dishId }: { dishId: string }) {
  const [state, formAction, pending] = useActionState(saveDishToRecipeBoxAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <input type="hidden" name="dishId" value={dishId} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={BUTTON_SECONDARY} disabled={pending}>
          {pending ? "Saving…" : "Save to the recipe box"}
        </button>
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Adds this dish and its ingredients to the community box, already accepted, so it can go on other menus.
        </span>
      </div>
      <FormError state={state} />
    </form>
  );
}

function UpdateFromBox({ dishId, title }: { dishId: string; title: string }) {
  const [state, formAction, pending] = useActionState(updateDishFromRecipeAction, initialState);
  return (
    <form
      action={formAction}
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        if (
          !window.confirm(
            `Replace this dish's name, notes, flags and ingredients with the box version of “${title}”? ` +
              "Any ingredient changes you made here are lost; your multiplier stays.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="dishId" value={dishId} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={BUTTON_PRIMARY} disabled={pending}>
          {pending ? "Updating…" : "Update from the recipe box"}
        </button>
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          The box version of this recipe was edited after this dish took it.
        </span>
      </div>
      <FormError state={state} />
    </form>
  );
}

export default function DishRecipePanel({ dishId, link }: { dishId: string; link: DishRecipeLink | null }) {
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <span className={LABEL}>Recipe box</span>
      {link ? (
        <>
          <p className="text-[length:var(--text-body)] text-[var(--text)]">
            Copied from{" "}
            <Link href={`/kitchen/recipes/${link.recipeId}`} className="font-medium text-[var(--accent-1)] hover:underline">
              {link.title}
            </Link>{" "}
            {link.changed && <Tag tone="warning">box version changed</Tag>}
          </p>
          {link.changed &&
            (link.status === "accepted" ? (
              <UpdateFromBox dishId={dishId} title={link.title} />
            ) : (
              <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                The box version changed, but it is {link.status} now, so it can&rsquo;t update a dish until a holder
                accepts it again.
              </p>
            ))}
        </>
      ) : (
        <SaveToBox dishId={dishId} />
      )}
    </div>
  );
}
