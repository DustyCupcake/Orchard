// The Kitchen's closed vocabularies, with no database anywhere in them.
//
// Split out of dietary.ts for the same build reason defaults-table.ts is
// split from defaults.ts: the starter question set is imported by a client
// component, and dietary.ts reaches `@/db`. The starter set needs these
// lists to word its options, so they live here and dietary.ts re-exports
// them — every existing `@/lib/kitchen/dietary` import keeps working.
//
// This is the whole of how the kitchen "understands" a member's answer: an
// option the member ticked is compared for equality against these labels.
// Nothing here is a keyword, and nothing is matched against prose — an
// "Other" write-in is shown to the cook as written and never interpreted
// (docs/plans/archive/kitchen-redesign-plan.md, D1).

// The dish allergen vocabulary (docs/plans/archive/food-drinks-module-plan.md
// D4): a text[] column with application-layer validation, deliberately NOT
// a DB enum, so adding a flag is a one-line change here rather than a
// migration. The first nine are the original set; celery, mustard, lupin,
// sulphites and molluscs complete the EU's fourteen regulated allergens
// (`shellfish` stays as the crustaceans entry, and is labelled so, so the
// two no longer overlap).
export const ALLERGEN_FLAGS = [
  "milk",
  "eggs",
  "fish",
  "shellfish",
  "molluscs",
  "tree_nuts",
  "peanuts",
  "soy",
  "wheat_gluten",
  "sesame",
  "celery",
  "mustard",
  "lupin",
  "sulphites",
  "none_known",
] as const;
export type AllergenFlag = (typeof ALLERGEN_FLAGS)[number];

export const ALLERGEN_FLAG_LABELS: Record<AllergenFlag, string> = {
  milk: "Milk",
  eggs: "Eggs",
  fish: "Fish",
  shellfish: "Shellfish (crustaceans)",
  molluscs: "Molluscs",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  soy: "Soy",
  wheat_gluten: "Wheat / gluten",
  sesame: "Sesame",
  celery: "Celery",
  mustard: "Mustard",
  lupin: "Lupin",
  sulphites: "Sulphites",
  none_known: "None known",
};

/** A flag a dish can carry and a member can be allergic to — i.e. every
 *  flag but the "none known" marker. */
export type ConcreteAllergenFlag = Exclude<AllergenFlag, "none_known">;

export const CONCRETE_ALLERGEN_FLAGS = ALLERGEN_FLAGS.filter(
  (f): f is ConcreteAllergenFlag => f !== "none_known",
);

/** The options the starter *Allergies* question offers: the dish
 *  vocabulary's own labels, so a tick and a flag are the same word. */
export const ALLERGY_OPTIONS = CONCRETE_ALLERGEN_FLAGS.map((f) => ALLERGEN_FLAG_LABELS[f]);

// Intolerances. Two of these correspond to a dish flag and so can be
// checked against a menu; the rest are things a cook should read and plan
// around but a dish has no way to declare, so they are listed, not matched.
export const INTOLERANCE_OPTIONS: { label: string; flag?: ConcreteAllergenFlag }[] = [
  { label: "Lactose", flag: "milk" },
  { label: "Gluten", flag: "wheat_gluten" },
  { label: "Fructose" },
  { label: "Histamine" },
  { label: "FODMAPs" },
  { label: "Caffeine" },
  { label: "Alcohol" },
];

// Dislikes are menu input, never a safety check, so there is no mapping
// to a dish anywhere: the kitchen counts them.
export const DISLIKE_OPTIONS = [
  "Spicy food",
  "Cilantro / coriander",
  "Mushrooms",
  "Olives",
  "Onions",
  "Strong cheese",
  "Raw tomato",
  "Offal",
];

function normal(label: string) {
  return label.trim().toLowerCase();
}

const FLAG_BY_ALLERGY_LABEL = new Map<string, ConcreteAllergenFlag>(
  CONCRETE_ALLERGEN_FLAGS.map((f) => [normal(ALLERGEN_FLAG_LABELS[f]), f]),
);
const FLAG_BY_INTOLERANCE_LABEL = new Map<string, ConcreteAllergenFlag>(
  INTOLERANCE_OPTIONS.flatMap((o) => (o.flag ? [[normal(o.label), o.flag] as const] : [])),
);

/** The dish flag a ticked allergy option stands for, by label equality
 *  (case and surrounding space ignored, nothing looser). */
export function flagForAllergyOption(label: string): ConcreteAllergenFlag | null {
  return FLAG_BY_ALLERGY_LABEL.get(normal(label)) ?? null;
}

/** As above, for an intolerance option. Most return null: "Fructose" has no
 *  dish flag, and that is a fact to show the cook, not something to guess. */
export function flagForIntoleranceOption(label: string): ConcreteAllergenFlag | null {
  return FLAG_BY_INTOLERANCE_LABEL.get(normal(label)) ?? null;
}
