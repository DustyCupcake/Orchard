import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { dish, member, profileAnswer, profileQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import {
  listReadableSensitiveQuestionIds,
  questionsReadableBy,
  resolveReadableAnswersForCommunity,
} from "../sensitive-data";
import { requireKitchenOwner } from "./access";
import { getMenuPlan } from "./menu";
import { getMeal } from "./meals";

type Member = typeof memberTable.$inferSelect;

// The schema's bounded flag vocabulary (docs/food-drinks-module-plan.md
// D4) — a text[] column with application-layer validation, deliberately
// NOT a DB enum so future flags are a one-line change here rather than
// a migration.
export const ALLERGEN_FLAGS = [
  "milk",
  "eggs",
  "fish",
  "shellfish",
  "tree_nuts",
  "peanuts",
  "soy",
  "wheat_gluten",
  "sesame",
  "none_known",
] as const;
export type AllergenFlag = (typeof ALLERGEN_FLAGS)[number];

export const ALLERGEN_FLAG_LABELS: Record<AllergenFlag, string> = {
  milk: "Milk",
  eggs: "Eggs",
  fish: "Fish",
  shellfish: "Shellfish",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  soy: "Soy",
  wheat_gluten: "Wheat / gluten",
  sesame: "Sesame",
  none_known: "None known",
};

// What a dish flag is checked against in a member's free-text answer —
// plain case-insensitive containment ("may conflict, verify"), the D4-D3
// posture: the flag set is bounded, the member text is free.
const FLAG_KEYWORDS: Record<Exclude<AllergenFlag, "none_known">, string[]> = {
  milk: ["milk", "dairy", "lactose", "casein"],
  eggs: ["egg", "eggs"],
  fish: ["fish"],
  shellfish: ["shellfish", "shrimp", "prawn", "crab", "lobster", "mollusc", "mollusk", "squid", "oyster"],
  tree_nuts: ["tree nut", "almond", "cashew", "walnut", "pecan", "hazelnut", "pistachio", "macadamia"],
  peanuts: ["peanut", "groundnut"],
  soy: ["soy", "soya", "tofu", "edamame"],
  wheat_gluten: ["wheat", "gluten", "barley", "rye", "spelt", "couscous"],
  sesame: ["sesame", "tahini"],
};

function matchesFlag(text: string, flag: Exclude<AllergenFlag, "none_known">): boolean {
  const haystack = text.toLowerCase();
  return FLAG_KEYWORDS[flag].some((kw) => haystack.includes(kw));
}

export type MealConstraintPanel = {
  mealId: string;
  // Members who have actually disclosed something readable to this
  // holder, so a "0 eaters flagged" can be told apart from "nobody has
  // disclosed anything you may read."
  disclosedEaters: number;
  totalFlags: number;
  dishes: {
    dishId: string;
    dishName: string;
    flags: AllergenFlag[];
    conflicts: { memberId: string; name: string; matchedFlags: AllergenFlag[] }[];
  }[];
};

// The Kitchen's dietary-constraint surface — D3/D4.
//
// This used to read `member.allergies`, one of the four fixed sensitive
// columns, behind two gates: a SensitiveFieldAccessRule linking
// `allergies` to the `kitchen` grant, and a live per-read consent
// re-check. Those columns are gone, so it reads sensitive *questions*
// instead, through the same two gates — and deliberately without asking
// which question is "the allergies one".
//
// That last part matters. There is no stable identifier on a question to
// mean "the allergies question": the starter set's `key` is a form-field
// name and is not stored, so a lookup by it would be a guess. Instead
// the panel takes *every* sensitive answer this holder's audience covers
// and keyword-matches them. A community that restricted "Allergies" to the
// kitchen gets it checked; so does one that restricted "Dietary needs",
// or "Anything that would affect what you can take on" — which is
// strictly better than before, where a member who recorded a nut allergy
// in the answer form was invisible to the kitchen and one who used the
// text box was not. Non-sensitive questions are excluded on purpose:
// they are readable by everyone, so matching against them would turn
// "languages you speak: soy?" into a food-safety conflict.
export async function getMealConstraintPanel(actor: Member, mealId: string): Promise<MealConstraintPanel | null> {
  const mealRow = await getMeal(actor, mealId);
  const plan = await getMenuPlan(actor, mealRow.menuPlanId);
  await requireKitchenOwner(actor, plan.cycleId);

  // Which sensitive questions this holder is in the audience for. Empty
  // means the panel simply doesn't render and the caller falls back to
  // plain dish flag notes.
  const unlockedQuestionIds = await listReadableSensitiveQuestionIds(actor);
  if (unlockedQuestionIds.size === 0) return null;

  // The full readability resolution, which applies the audience, each
  // member's share switch and each consent gate. Fetched once for the
  // community rather than per member.
  const readable = await resolveReadableAnswersForCommunity(actor);

  const members = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(eq(member.communityId, actor.communityId));
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  const answers = await db
    .select({
      memberId: profileAnswer.memberId,
      questionId: profileAnswer.questionId,
      value: profileAnswer.value,
      // A deferred or declined row stores a null value, so the value check
      // below would skip it anyway — but a status of "answered" is the
      // explicit statement of intent, and costs one projected column.
      status: profileAnswer.status,
    })
    .from(profileAnswer)
    .innerJoin(profileQuestion, eq(profileAnswer.questionId, profileQuestion.id))
    .where(
      and(
        eq(profileQuestion.communityId, actor.communityId),
        isNull(profileQuestion.archivedAt),
        isNull(profileAnswer.cycleId),
        inArray(profileAnswer.questionId, [...unlockedQuestionIds]),
      ),
    );

  // memberId → the text this holder may read for them. A member with two
  // disclosed answers gets both, joined, because either could be the one
  // naming the allergen.
  const disclosed = new Map<string, string>();
  for (const answer of answers) {
    if (answer.status !== "answered") continue;
    if (typeof answer.value !== "string" || answer.value.trim() === "") continue;
    if (!questionsReadableBy(readable, answer.memberId).has(answer.questionId)) continue;
    disclosed.set(answer.memberId, `${disclosed.get(answer.memberId) ?? ""} ${answer.value}`.trim());
  }

  const flaggedDishes = (
    await db.select().from(dish).where(eq(dish.mealId, mealId))
  )
    .map((d) => ({
      dishId: d.id,
      dishName: d.name,
      flags: (d.allergenFlags as AllergenFlag[]).filter((f) => f !== "none_known"),
    }))
    .filter((d) => d.flags.length > 0);

  const disclosedEntries = [...disclosed.entries()]
    .map(([memberId, text]) => ({ memberId, name: nameById.get(memberId) ?? "—", text }))
    .filter((e) => nameById.has(e.memberId));

  const dishes = flaggedDishes
    .map((d) => ({
      ...d,
      conflicts: disclosedEntries
        .filter((e) =>
          d.flags.some((f) => matchesFlag(e.text, f as Exclude<AllergenFlag, "none_known">)),
        )
        .map((e) => ({
          memberId: e.memberId,
          name: e.name,
          matchedFlags: d.flags.filter((f) => matchesFlag(e.text, f as Exclude<AllergenFlag, "none_known">)),
        })),
    }))
    .filter((d) => d.conflicts.length > 0);

  return {
    mealId,
    disclosedEaters: disclosedEntries.length,
    totalFlags: flaggedDishes.reduce((sum, d) => sum + d.flags.length, 0),
    dishes,
  };
}