import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dish, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { listUnlockedFields } from "../sensitive-data";
import { getGatingPurposesForCommunity, listMembersWithActiveConsent } from "../consent";
import { requireKitchenOwner } from "./access";
import { getMenuPlan } from "./menu";
import { getMeal } from "./meals";

type Member = typeof memberTable.$inferSelect;

// The schema's bounded flag vocabulary (docs/food-drinks-module-plan.md
// D4) — a text[] column with application-layer validation, deliberately
// NOT a DB enum so future flags are a one-line change here rather than
// a migration (same const-enum posture as SENSITIVE_FIELD_KEYS).
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

// What a dish flag is checked against in a member's free-text allergies
// field — plain case-insensitive containment ("may conflict, verify"),
// the D4-D3 posture: the flag set is bounded, the member text is free.
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

function matchesFlag(allergies: string | null, flag: Exclude<AllergenFlag, "none_known">): boolean {
  if (!allergies) return false;
  const haystack = allergies.toLowerCase();
  return FLAG_KEYWORDS[flag].some((kw) => haystack.includes(kw));
}

export type MealConstraintPanel = {
  mealId: string;
  // Members whose allergies are actually readable here (the consent
  // re-check below), so a "0 eaters flagged" can be told apart from
  // "nobody has disclosed anything readable."
  disclosedEaters: number;
  totalFlags: number;
  dishes: {
    dishId: string;
    dishName: string;
    flags: AllergenFlag[];
    conflicts: { memberId: string; name: string; matchedFlags: AllergenFlag[] }[];
  }[];
};

// The Kitchen's dietary-constraint surface — D3/D4. Reads member
// allergies ONLY through the sensitive-data module's own gate, twice:
// 1. the field must be unlocked for the kitchen holder's read
//    (community must link `allergies` to the `kitchen` grant via a
//    SensitiveFieldAccessRule's unlockedByGrantModuleKey), and
// 2. per-read consent is re-checked exactly the way
//    getSensitiveDataTable does, so a purpose-linked allergies field
//    only contributes members who currently have active consent (a
//    withdrawal drops them immediately).
// Returns null when allergies isn't unlocked — the constraint panel
// simply doesn't render; the caller shows plain dish flag notes instead.
export async function getMealConstraintPanel(actor: Member, mealId: string): Promise<MealConstraintPanel | null> {
  const mealRow = await getMeal(actor, mealId);
  const plan = await getMenuPlan(actor, mealRow.menuPlanId);
  await requireKitchenOwner(actor, plan.cycleId);

  const unlocked = await listUnlockedFields(actor);
  if (!unlocked.includes("allergies")) return null;

  const gatingPurposes = await getGatingPurposesForCommunity(actor.communityId);
  const purpose = gatingPurposes.get("allergies");
  const consentedIds = purpose ? new Set(await listMembersWithActiveConsent(purpose.id)) : null;

  const flaggedDishes = (
    await db.select().from(dish).where(eq(dish.mealId, mealId))
  )
    .map((d) => ({
      dishId: d.id,
      dishName: d.name,
      flags: (d.allergenFlags as AllergenFlag[]).filter((f) => f !== "none_known"),
    }))
    .filter((d) => d.flags.length > 0);

  const members = await db
    .select({ id: member.id, name: member.name, allergies: member.allergies })
    .from(member)
    .where(eq(member.communityId, actor.communityId));

  const readableMembers = members.filter((m) => !purpose || consentedIds!.has(m.id));
  const disclosedEaters = readableMembers.filter((m) => m.allergies).length;

  const dishes = flaggedDishes
    .map((d) => ({
      ...d,
      conflicts: readableMembers
        .filter((m) => d.flags.some((f) => matchesFlag(m.allergies, f as Exclude<AllergenFlag, "none_known">)))
        .map((m) => ({
          memberId: m.id,
          name: m.name,
          matchedFlags: d.flags.filter((f) => matchesFlag(m.allergies, f as Exclude<AllergenFlag, "none_known">)),
        })),
    }))
    .filter((d) => d.conflicts.length > 0);

  return {
    mealId,
    disclosedEaters,
    totalFlags: flaggedDishes.reduce((sum, d) => sum + d.flags.length, 0),
    dishes,
  };
}