// Pure scaling rules shared by applying a recipe and reading a menu. The
// important distinction is between a dish with its own `multiplier` (copied
// from the recipe box) and a plain dish, which still scales by headCount /
// serves. Keeping the maths here means the apply action and the shopping list
// cannot drift into double-scaling.

export function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** The factor a dish's ingredients are read at. `headCount` is already the
 *  meal's effective headcount; `serves` is the dish's own base. An applied
 *  recipe uses its stored multiplier directly — headcount was already used to
 *  suggest it when the recipe was applied. */
export function effectiveDishFactor(
  dish: { multiplier: string | number | null; serves: number | null },
  headCount: number | null,
): number {
  if (dish.multiplier !== null) {
    const n = Number(dish.multiplier);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return headCount && dish.serves && headCount > 0 && dish.serves > 0 ? headCount / dish.serves : 1;
}

/** How many people one dish at its effective factor feeds. Unknown coverage
 *  contributes zero: guessing at an unlabelled recipe would quietly make the
 *  next dish too small. */
export function dishFeeds(
  dish: { multiplier: string | number | null; serves: number | null },
  headCount: number | null,
): number {
  if (!dish.serves || dish.serves <= 0) return 0;
  return dish.serves * effectiveDishFactor(dish, headCount);
}

/**
 * The multiplier offered when a recipe is applied to a meal. It fills the
 * headcount left over by the meal's *other* dishes, rounded to half steps and
 * clamped to at least half a recipe. With no usable headcount or serving base
 * the planner gets 1 and can edit it.
 */
export function suggestedMultiplier(
  recipe: { serves: number | null },
  headCount: number | null,
  otherDishes: { multiplier: string | number | null; serves: number | null }[],
): number {
  if (!recipe.serves || recipe.serves <= 0 || headCount === null || headCount <= 0) return 1;
  const covered = otherDishes.reduce((sum, d) => sum + dishFeeds(d, headCount), 0);
  const remaining = Math.max(0, headCount - covered);
  return Math.max(0.5, roundHalf(remaining / recipe.serves));
}
