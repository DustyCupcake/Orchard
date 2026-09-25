import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, dish, dishIngredient, foodIdea, member, menuPlan, taskResource } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import { createConsentPurpose, grantConsent } from "@/lib/consent";
import { updateOwnSensitiveData } from "@/lib/sensitive-data";
import { createSensitiveFieldAccessRule } from "@/lib/sensitive-data";
import { AppError, ConflictError, ForbiddenError } from "@/lib/errors";
import {
  adoptFromIdea,
  createDish,
  createDishIngredient,
  createMeal,
  createMenuPlan,
  declineFoodIdea,
  deleteMeal,
  fileFoodIdea,
  getMealConstraintPanel,
  getMenuPlanOverview,
  getVisibleMenuPlan,
  isKitchenOwner,
  listKitchenNeedsAction,
  listOpenIdeasForReview,
  listSupplyTasks,
  publishMenuPlan,
  purchaseList,
  scaledIngredients,
} from "@/lib/kitchen";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";

// A kitchen holder for the standing (cycle-less) scope: enable the
// module, put the grant on a task, and (unless asked not to) claim it —
// the one shape the whole module hangs off (D2: whoever currently holds
// a task granting `kitchen` owns that scope). `claim: false` sets up the
// "granted but nobody holds it yet" case, which is a distinct state the
// resolver has to get right.
async function makeKitchenOwner(
  communityId: string,
  branchId: string,
  memberId: string,
  cycleId: string | null = null,
  claim = true,
) {
  const grantTask = await insertTask(communityId, branchId, memberId, {
    cycleId,
    title: "Kitchen",
    effort: "owns_a_thing",
    effortMagnitude: { hours_per_week: 2 },
  });
  await grantPermission(communityId, "kitchen", grantTask.id);
  if (claim) {
    const owner = (await db.select().from(member).where(eq(member.id, memberId)))[0];
    await claimTask(owner, grantTask.id);
  }
  return grantTask;
}

describe("the Kitchen module gate", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects every entry point while the module is off", async () => {
    const { alice, bob, branch } = await createFixtures();
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);

    // Holder of the grant, but the community never turned Kitchen on.
    await expect(createMenuPlan(alice, { title: "Autumn" })).rejects.toThrow(AppError);
    // Even filing an idea needs the module on — filing is open to any
    // member, but only within an enabled module.
    await expect(
      fileFoodIdea(bob, { menuPlanId: "00000000-0000-0000-0000-000000000000", kind: "preference", title: "More aubergine" }),
    ).rejects.toThrow(AppError);
  });

  it("lets a holder build a menu once the module is enabled", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);

    const plan = await createMenuPlan(alice, { title: "Autumn" });
    expect(plan.title).toBe("Autumn");
    expect(plan.cycleId).toBeNull();
    expect(plan.publishedAt).toBeNull();
  });
});

describe("who counts as a Kitchen owner", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is false for everyone until a kitchen-granting task is actually held", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });

    expect(await isKitchenOwner(alice)).toBe(false);
    // Granted but unheld: a grant nobody holds grants nobody.
    const grantTask = await makeKitchenOwner(alice.communityId, branch.id, alice.id, null, false);
    expect(await isKitchenOwner(alice)).toBe(false);
    expect(await isKitchenOwner(bob)).toBe(false);

    await claimTask(alice, grantTask.id);
    expect(await isKitchenOwner(alice)).toBe(true);
  });

  it("follows the hold, not the task's creator", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    const grantTask = await makeKitchenOwner(alice.communityId, branch.id, alice.id, null, false);

    // Alice created the granting task; Bob is the one who holds it.
    expect(await isKitchenOwner(alice)).toBe(false);
    await claimTask(bob, grantTask.id);
    expect(await isKitchenOwner(bob)).toBe(true);
    expect(await isKitchenOwner(alice)).toBe(false);
  });

  it("scopes ownership to the granting task's own placement", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    const [scopeCycle] = await db
      .insert(cycle)
      .values({ communityId: alice.communityId, name: "Spring" })
      .returning();
    await makeKitchenOwner(alice.communityId, branch.id, alice.id, scopeCycle.id);

    // Owner of that cycle, not of the standing menu.
    expect(await isKitchenOwner(alice, scopeCycle.id)).toBe(true);
    expect(await isKitchenOwner(alice, null)).toBe(false);
    // No cycleId argument = any scope, so the cycle grant still answers true.
    expect(await isKitchenOwner(alice)).toBe(true);

    await expect(createMenuPlan(alice, { title: "Standing menu" })).rejects.toThrow(ForbiddenError);
    const plan = await createMenuPlan(alice, { title: "Spring menu", cycleId: scopeCycle.id });
    expect(plan.cycleId).toBe(scopeCycle.id);
  });

  it("honours multi-grant: each holder of any granting task owns the module", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    // Two separate kitchen grants in the same community — neither
    // replaces the other (multi-cardinality, not single-owner).
    const first = await insertTask(alice.communityId, branch.id, alice.id, { title: "Weeknight cook" });
    await grantPermission(alice.communityId, "kitchen", first.id);
    await claimTask(alice, first.id);
    const second = await insertTask(alice.communityId, branch.id, alice.id, { title: "Weekend cook" });
    await grantPermission(alice.communityId, "kitchen", second.id);
    await claimTask(bob, second.id);

    expect(await isKitchenOwner(alice)).toBe(true);
    expect(await isKitchenOwner(bob)).toBe(true);
    // Both can edit the same scope's plan — a full-access grant, not a
    // partitioned one.
    const plan = await createMenuPlan(alice, { title: "Shared" });
    await expect(createMeal(bob, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" })).resolves.toBeTruthy();
  });
});

describe("draft and published menus (D1)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps a draft owner-only, and publishes it into community-readable", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    await createMeal(alice, { menuPlanId: plan.id, label: "Friday dinner", date: "2026-10-02" });

    // Draft: the owner sees it, nobody else does.
    expect((await getVisibleMenuPlan(alice, plan.id)).id).toBe(plan.id);
    await expect(getVisibleMenuPlan(bob, plan.id)).rejects.toThrow(ForbiddenError);

    await publishMenuPlan(alice, plan.id);
    expect((await getVisibleMenuPlan(bob, plan.id)).id).toBe(plan.id);
  });

  it("locks every further edit once published, for the owner too", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" });

    await publishMenuPlan(alice, plan.id);
    // Publishing is the single gate — a second publish, a new meal, and
    // a new dish are all refused against the same plan.
    await expect(publishMenuPlan(alice, plan.id)).rejects.toThrow(ConflictError);
    await expect(
      createMeal(alice, { menuPlanId: plan.id, label: "Saturday", date: "2026-10-03" }),
    ).rejects.toThrow(ConflictError);
    await expect(createDish(alice, { mealId: meal.id, name: "Soup" })).rejects.toThrow(ConflictError);
  });

  it("rejects a non-owner trying to build or publish", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });

    await expect(createMenuPlan(bob, { title: "Bob's" })).rejects.toThrow(ForbiddenError);
    await expect(publishMenuPlan(bob, plan.id)).rejects.toThrow(ForbiddenError);
    await expect(
      createMeal(bob, { menuPlanId: plan.id, label: "Sneaky", date: "2026-10-02" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses another community's cycle without disclosing whether it exists", async () => {
    const { alice, branch } = await createFixtures();
    const { community: strangerCommunity } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const [strangerCycle] = await db
      .insert(cycle)
      .values({ communityId: strangerCommunity.id, name: "Theirs" })
      .returning();

    // Ownership is resolved before the cycle row is ever looked up, so a
    // real foreign cycle and an invented id are indistinguishable to the
    // caller — no cross-community existence disclosure. (The lib's own
    // "cycle not in your community" check stays as defense in depth: a
    // scope an actor can own always resolves to a real same-community
    // cycle, so it's unreachable in normal use.)
    await expect(createMenuPlan(alice, { title: "Borrowed", cycleId: strangerCycle.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      createMenuPlan(alice, { title: "Invented", cycleId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(ForbiddenError);

    expect(await db.select().from(menuPlan).where(eq(menuPlan.communityId, alice.communityId))).toHaveLength(0);
  });
});

describe("meals, dishes, and scaling (D8)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("scales each dish by headCount / serves and groups purchases by exact ingredient name", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, {
      menuPlanId: plan.id,
      label: "Friday",
      date: "2026-10-02",
      headCount: 10,
    });

    const stew = await createDish(alice, { mealId: meal.id, name: "Stew", serves: 4 });
    await createDishIngredient(alice, { dishId: stew.id, name: "flour", amount: 2, unit: "cups" });
    await createDishIngredient(alice, { dishId: stew.id, name: "plain flour", amount: 1, unit: "cup" });
    const bread = await createDish(alice, { mealId: meal.id, name: "Bread", serves: 2 });
    await createDishIngredient(alice, { dishId: bread.id, name: "flour", amount: 3, unit: "cups" });

    // 10 eaters: stew x2.5 (2 cups -> 5), bread x5 (3 -> 15).
    const scaled = await scaledIngredients(alice, meal.id);
    const flourFromStew = scaled.find((s) => s.dishId === stew.id && s.name === "flour")!;
    expect(flourFromStew.factor).toBe(2.5);
    expect(flourFromStew.scaledAmount).toBe(5);
    const flourFromBread = scaled.find((s) => s.dishId === bread.id)!;
    expect(flourFromBread.factor).toBe(5);
    expect(flourFromBread.scaledAmount).toBe(15);

    // Exact-name grouping: the two "flour" rows merge (5 + 15 = 20 in the
    // same unit) while "plain flour" stays its own line.
    const list = await purchaseList(alice, meal.id);
    expect(list).toEqual([
      { name: "flour", unit: "cups", amount: 20 },
      { name: "plain flour", unit: "cup", amount: 2.5 },
    ]);
  });

  it("stays at recipe scale with no headcount, and computes no purchase list at all", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Open fire", date: "2026-10-02" });
    const stew = await createDish(alice, { mealId: meal.id, name: "Stew", serves: 4 });
    await createDishIngredient(alice, { dishId: stew.id, name: "flour", amount: 2, unit: "cups" });

    const scaled = await scaledIngredients(alice, meal.id);
    expect(scaled[0].factor).toBe(1);
    expect(scaled[0].scaledAmount).toBe(2);
    expect(scaled[0].scaled).toBe(false);
    // No headcount means no purchasing list at all.
    expect(await purchaseList(alice, meal.id)).toEqual([]);
  });

  it("leaves a dish without a serves count unscaled rather than dividing by zero", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02", headCount: 8 });
    const dishRow = await createDish(alice, { mealId: meal.id, name: "By eye" });
    await createDishIngredient(alice, { dishId: dishRow.id, name: "salt", amount: 1, unit: "tsp" });

    const scaled = await scaledIngredients(alice, meal.id);
    expect(scaled[0].factor).toBe(1);
    expect(scaled[0].scaledAmount).toBe(1);
  });

  it("rejects an unknown allergen flag", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" });

    await expect(
      createDish(alice, { mealId: meal.id, name: "Mystery", allergenFlags: ["unobtainium" as never] }),
    ).rejects.toThrow();
  });

  it("deletes a meal's dishes and ingredients with it, in dependency order", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" });
    const dishRow = await createDish(alice, { mealId: meal.id, name: "Stew" });
    await createDishIngredient(alice, { dishId: dishRow.id, name: "stock", amount: 1, unit: "litre" });

    await deleteMeal(alice, meal.id);

    // The plain FKs have no cascade, so this asserts the delete order
    // really did clean up every layer.
    expect(await db.select().from(dishIngredient).where(eq(dishIngredient.dishId, dishRow.id))).toHaveLength(0);
    expect(await db.select().from(dish).where(eq(dish.id, dishRow.id))).toHaveLength(0);
    const overview = await getMenuPlanOverview(alice, plan.id);
    expect(overview.meals).toHaveLength(0);
  });
});

describe("food ideas (D5)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets any member file an attributed idea, holder or not", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });

    const idea = await fileFoodIdea(bob, {
      menuPlanId: plan.id,
      kind: "recipe_suggestion",
      title: "The picnic traybake",
      body: "If anyone still has the card",
    });
    expect(idea.suggestedBy).toBe(bob.id);
    expect(idea.status).toBe("open");

    const inbox = await listOpenIdeasForReview(alice, plan.id);
    expect(inbox.map((i) => i.id)).toEqual([idea.id]);
  });

  it("adopts an idea into a dish in one step, linking both sides", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" });
    const idea = await fileFoodIdea(bob, {
      menuPlanId: plan.id,
      kind: "dish_request",
      title: "Mushroom risotto",
      body: "the good way, with the stock cube",
    });

    const adopted = await adoptFromIdea(alice, { ideaId: idea.id, mealId: meal.id, serves: 4 });

    expect(adopted.name).toBe("Mushroom risotto");
    expect(adopted.source).toBe("from_idea");
    expect(adopted.sourceIdeaId).toBe(idea.id);
    expect(adopted.description).toBe("the good way, with the stock cube");
    const [after] = await db.select().from(foodIdea).where(eq(foodIdea.id, idea.id));
    expect(after.status).toBe("adopted");
    expect(after.adoptedDishId).toBe(adopted.id);
  });

  it("refuses a second decision on the same idea, and a cross-plan adoption", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const otherPlan = await createMenuPlan(alice, { title: "Winter" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" });
    const otherMeal = await createMeal(alice, { menuPlanId: otherPlan.id, label: "Friday", date: "2026-12-04" });
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, kind: "preference", title: "Less fish" });

    // Adopting into another plan's meal is a mistake, not a silent move.
    await expect(adoptFromIdea(alice, { ideaId: idea.id, mealId: otherMeal.id })).rejects.toThrow(AppError);
    expect((await db.select().from(foodIdea).where(eq(foodIdea.id, idea.id)))[0].status).toBe("open");

    await adoptFromIdea(alice, { ideaId: idea.id, mealId: meal.id });
    await expect(adoptFromIdea(alice, { ideaId: idea.id, mealId: meal.id })).rejects.toThrow(ConflictError);
  });

  it("declines with a reason and closes the idea", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, kind: "dish_request", title: "Xmas turkey" });

    const declined = await declineFoodIdea(alice, idea.id, { declinedReason: "Already on the December plan" });
    expect(declined.status).toBe("declined");
    expect(declined.declinedReason).toBe("Already on the December plan");
    await expect(declineFoodIdea(alice, idea.id, {})).rejects.toThrow(ConflictError);
  });

  it("keeps the idea inbox to the owner, and only while the plan is a draft", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    await fileFoodIdea(bob, { menuPlanId: plan.id, kind: "preference", title: "More aubergine" });

    await expect(listOpenIdeasForReview(bob, plan.id)).rejects.toThrow(ForbiddenError);

    await publishMenuPlan(alice, plan.id);
    // Published plans lock adoption, so the inbox stops being actionable.
    await expect(listOpenIdeasForReview(alice, plan.id)).rejects.toThrow(ConflictError);
  });
});

describe("the dietary-constraint panel (D3/D4)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function kitchenWithAllergies(aliceAllergies: string | null, bobAllergies: string | null) {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen", "sensitive_data"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const purpose = await createConsentPurpose(alice, {
      key: "kitchen_allergies",
      label: "Kitchen allergy reads",
      noticeText: "Cooks see your allergies to keep the menu safe.",
      gatesSensitiveField: "allergies",
      requiresExplicit: true,
    });
    for (const [who, value] of [
      [alice, aliceAllergies],
      [bob, bobAllergies],
    ] as const) {
      if (value === null) continue;
      await grantConsent(who, purpose.id);
      await updateOwnSensitiveData(who, { allergies: value });
    }
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02", headCount: 12 });
    return { alice, bob, plan, meal };
  }

  it("returns null while allergies aren't linked to the kitchen grant", async () => {
    const { alice, meal } = await kitchenWithAllergies(null, "peanuts");
    // No sensitive-field rule at all: the module can't read the column,
    // so the panel is absent rather than empty.
    expect(await getMealConstraintPanel(alice, meal.id)).toBeNull();
  });

  it("flags a dish against a consented member's disclosed allergy once the grant unlocks the field", async () => {
    const { alice, bob, meal } = await kitchenWithAllergies(null, "peanuts and cashews");
    await createSensitiveFieldAccessRule(alice, {
      fieldKey: "allergies",
      unlockedByGrantModuleKey: "kitchen",
    });
    await createDish(alice, {
      mealId: meal.id,
      name: "Satay",
      allergenFlags: ["peanuts", "tree_nuts"],
    });

    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel).not.toBeNull();
    expect(panel!.disclosedEaters).toBe(1);
    const flagged = panel!.dishes.find((d) => d.dishName === "Satay")!;
    expect(flagged.conflicts).toHaveLength(1);
    expect(flagged.conflicts[0].memberId).toBe(bob.id);
    // Free-text matching catches the synonym too, not just the flag word.
    expect(flagged.conflicts[0].matchedFlags).toEqual(["peanuts", "tree_nuts"]);
  });

  it("counts a member as disclosed but unflagged, and hides a dish nobody conflicts with", async () => {
    const { alice, meal } = await kitchenWithAllergies(null, "lactose");
    await createSensitiveFieldAccessRule(alice, {
      fieldKey: "allergies",
      unlockedByGrantModuleKey: "kitchen",
    });
    await createDish(alice, { mealId: meal.id, name: "Fried rice", allergenFlags: ["peanuts"] });

    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel!.disclosedEaters).toBe(1);
    // Disclosed, but no dish on this meal touches their allergy.
    expect(panel!.dishes).toHaveLength(0);
  });

  it("is owner-only, and refuses a non-holder before the field gate is even consulted", async () => {
    const { bob, meal } = await kitchenWithAllergies(null, "peanuts");
    await expect(getMealConstraintPanel(bob, meal.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("needs-action and the supply lens", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns nothing for a member who isn't a holder", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" });

    // The holder has one live draft and nothing else to decide.
    const action = await listKitchenNeedsAction(alice);
    expect(action).toHaveLength(1);
    expect(action[0].kind).toBe("draft_unpublished");
    expect(await listKitchenNeedsAction(bob)).toEqual([]);
  });

  it("surfaces an unpublished draft and any open ideas, then goes quiet once published", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    await fileFoodIdea(bob, { menuPlanId: plan.id, kind: "preference", title: "More aubergine" });

    const before = await listKitchenNeedsAction(alice);
    expect(before.map((k) => k.kind).sort()).toEqual(["draft_unpublished", "ideas_awaiting_review"]);
    const ideas = before.find((k) => k.kind === "ideas_awaiting_review")!;
    expect(ideas.openCount).toBe(1);

    await publishMenuPlan(alice, plan.id);
    expect(await listKitchenNeedsAction(alice)).toEqual([]);
  });

  it("only surfaces drafts in scopes the holder actually owns", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    const [scopeCycle] = await db
      .insert(cycle)
      .values({ communityId: alice.communityId, name: "Spring" })
      .returning();
    await makeKitchenOwner(alice.communityId, branch.id, alice.id, scopeCycle.id);

    const springPlan = await createMenuPlan(alice, { title: "Spring menu", cycleId: scopeCycle.id });
    // A draft in the standing scope belongs to another role's grant —
    // inserted directly, since Alice may not create one herself.
    const [standingPlan] = await db
      .insert(menuPlan)
      .values({
        communityId: alice.communityId,
        cycleId: null,
        title: "Standing menu",
        createdBy: alice.id,
      })
      .returning();

    const action = await listKitchenNeedsAction(alice);
    expect(action.map((k) => k.menuPlanId)).toEqual([springPlan.id]);
    expect(action).not.toContainEqual(expect.objectContaining({ menuPlanId: standingPlan.id }));
  });

  it("lists supply-tagged tasks with their resources for the holder only", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);

    const ordering = await insertTask(alice.communityId, branch.id, alice.id, {
      title: "Order the big bag of rice",
      tags: ["supply", "shopping"],
    });
    await db.insert(taskResource).values({
      taskId: ordering.id,
      addedBy: alice.id,
      label: "Supplier price list",
      url: "https://example.com/rice",
    });
    await insertTask(alice.communityId, branch.id, alice.id, {
      title: "Fix the hall roof",
      tags: ["maintenance"],
    });

    const supply = await listSupplyTasks(alice, null);
    expect(supply.map((t) => t.id)).toEqual([ordering.id]);
    expect(supply[0].resources.map((r) => r.label)).toEqual(["Supplier price list"]);

    expect(await listSupplyTasks(bob, null)).toEqual([]);
  });

  it("leaves a done supply task out of the lens", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    await insertTask(alice.communityId, branch.id, alice.id, {
      title: "Order the big bag of rice",
      tags: ["supply"],
      status: "done",
    });

    expect(await listSupplyTasks(alice, null)).toEqual([]);
  });
});

describe("cross-community isolation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("never exposes another community's plan, meal, or member", async () => {
    const { alice, bob, branch } = await createFixtures();
    const { alice: stranger, community: strangerCommunity, branch: strangerBranch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02" });
    await createDish(alice, { mealId: meal.id, name: "Stew" });

    // A fully-provisioned stranger kitchen owner still can't reach it.
    await updateCommunity(stranger, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(strangerCommunity.id, strangerBranch.id, stranger.id);

    await expect(getVisibleMenuPlan(stranger, plan.id)).rejects.toThrow(/not found/);
    await expect(getMenuPlanOverview(stranger, plan.id)).rejects.toThrow(/not found/);
    await expect(
      createMeal(stranger, { menuPlanId: plan.id, label: "Theirs", date: "2026-10-02" }),
    ).rejects.toThrow(/not found/);
    // And a plain member of the first community sees only what's published.
    await expect(getVisibleMenuPlan(bob, plan.id)).rejects.toThrow(ForbiddenError);
  });
});
