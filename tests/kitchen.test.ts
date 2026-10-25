import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, dish, dishIngredient, foodIdea, member, menuPlan, taskResource } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import { createConsentPurpose, grantConsent, withdrawConsent } from "@/lib/consent";
import { answerProfileQuestion, createProfileQuestion } from "@/lib/profile-questions";
import { ALLERGY_OPTIONS, DISLIKE_OPTIONS, INTOLERANCE_OPTIONS } from "@/lib/kitchen/allergens";
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
  fileFoodIdeaInput,
  getDietaryOverview,
  getMealConstraintPanel,
  getMenuPlanOverview,
  getVisibleMenuPlan,
  isKitchenOwner,
  listIdeasForMenuPlan,
  listKitchenNeedsAction,
  listMyFoodIdeas,
  listOpenIdeasForReview,
  listSupplyTasks,
  publishMenuPlan,
  purchaseList,
  scaledIngredients,
  updateFoodIdea,
  withdrawFoodIdea,
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
      { name: "flour", unit: "cups", amount: 20, unmeasured: false },
      { name: "plain flour", unit: "cup", amount: 2.5, unmeasured: false },
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

describe("the dietary overview (exact matching, never prose)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  const ALLERGY_QUESTION = {
    label: "Allergies",
    responseType: "multi_choice",
    options: ALLERGY_OPTIONS,
    allowOther: true,
    allowPreferNotToSay: true,
    scope: "once_ever",
    sensitive: true,
    audience: { unlockedByGrantModuleKey: "kitchen" },
    kitchenSignal: "allergy",
  } as const;

  /** A kitchen holder (alice), a second member (bob), the module on and a
   *  draft meal. Questions are wired per test, because "which are wired" is
   *  the thing under test. */
  async function kitchen() {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02", headCount: 12 });
    return { alice, bob, plan, meal };
  }

  async function wireAllergy(alice: Awaited<ReturnType<typeof kitchen>>["alice"]) {
    return createProfileQuestion(alice, { ...ALLERGY_QUESTION });
  }

  it("says plainly that nothing is wired, rather than going quiet", async () => {
    const { alice } = await kitchen();
    const overview = await getDietaryOverview(alice, null);
    expect(overview.wired).toBe(0);
    for (const signal of ["allergy", "intolerance", "dislike"] as const) {
      expect(overview.signals[signal].question).toBeNull();
      expect(overview.signals[signal].readable).toBe(false);
    }
  });

  it("separates a wired question the holder cannot read from an unwired one", async () => {
    const { alice, bob } = await kitchen();
    // Restricted to a grant alice doesn't hold: wired, but not hers to read.
    const question = await createProfileQuestion(alice, {
      ...ALLERGY_QUESTION,
      audience: { unlockedByGrantModuleKey: "admin" },
    });
    await answerProfileQuestion(bob, question.id, { status: "answered", value: ["Peanuts"] });

    const overview = await getDietaryOverview(alice, null);
    const allergy = overview.signals.allergy;
    expect(allergy.question?.id).toBe(question.id);
    expect(allergy.readable).toBe(false);
    // Not even counts: a tally of who answered is information from outside
    // the audience.
    expect(allergy.answered).toBe(0);
    expect(allergy.members).toEqual([]);
  });

  it("counts who answered, declined, deferred, withheld and was never asked", async () => {
    const { alice, bob } = await kitchen();
    const question = await wireAllergy(alice);
    await answerProfileQuestion(alice, question.id, { status: "answered", value: [] });
    let overview = await getDietaryOverview(alice, null);
    // An answer of "nothing to avoid" is still an answer.
    expect(overview.signals.allergy).toMatchObject({ population: 2, answered: 1, notAnswered: 1, declined: 0 });
    expect(overview.signals.allergy.members).toEqual([]);

    await answerProfileQuestion(bob, question.id, { status: "declined" });
    overview = await getDietaryOverview(alice, null);
    expect(overview.signals.allergy).toMatchObject({ answered: 1, declined: 1, notAnswered: 0 });

    // Bob un-shares: his answer exists and is not hers to read.
    await answerProfileQuestion(bob, question.id, { status: "answered", value: ["Peanuts"], shareWithAudience: false });
    overview = await getDietaryOverview(alice, null);
    expect(overview.signals.allergy).toMatchObject({ answered: 1, withheld: 1, declined: 0, notAnswered: 0 });
    expect(overview.signals.allergy.members).toEqual([]);
  });

  it("checks a ticked allergy against a dish flag by equality", async () => {
    const { alice, bob, meal } = await kitchen();
    const question = await wireAllergy(alice);
    await answerProfileQuestion(bob, question.id, { status: "answered", value: ["Peanuts", "Wheat / gluten"] });
    await createDish(alice, { mealId: meal.id, name: "Satay", allergenFlags: ["peanuts"] });
    await createDish(alice, { mealId: meal.id, name: "Almond cake", allergenFlags: ["tree_nuts"] });

    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel.dishes.map((d) => d.dishName)).toEqual(["Satay"]);
    expect(panel.dishes[0].allergy).toEqual([
      { memberId: bob.id, name: "Bob", matchedFlags: ["peanuts"], matchedLabels: ["Peanuts"] },
    ]);
    expect(panel.dishes[0].intolerance).toEqual([]);
  });

  it("shows an Other write-in as written and never matches it", async () => {
    const { alice, bob, meal } = await kitchen();
    const question = await wireAllergy(alice);
    await answerProfileQuestion(bob, question.id, {
      status: "answered",
      // Not an option, so a write-in. A keyword matcher would have taken
      // "fish" for the flag and flagged the dish; this is read, not
      // interpreted.
      value: ["no fish sauce please"],
    });
    await createDish(alice, { mealId: meal.id, name: "Pad thai", allergenFlags: ["fish", "peanuts"] });

    const overview = await getDietaryOverview(alice, null);
    expect(overview.signals.allergy.members).toEqual([
      { memberId: bob.id, name: "Bob", ticks: [], flags: [], listed: [], writeIns: ["no fish sauce please"] },
    ]);
    expect(overview.signals.allergy.writeIns).toEqual([{ name: "Bob", text: "no fish sauce please" }]);
    expect((await getMealConstraintPanel(alice, meal.id)).dishes).toEqual([]);
  });

  it("treats a write-in that spells an option differently as a write-in, not a tick", async () => {
    const { alice, bob, meal } = await kitchen();
    const question = await wireAllergy(alice);
    // Lower-case 'peanuts' is not the option 'Peanuts'. The conservative
    // reading: shown to the cook under what was written, not matched.
    await answerProfileQuestion(bob, question.id, { status: "answered", value: ["peanuts"] });
    await createDish(alice, { mealId: meal.id, name: "Satay", allergenFlags: ["peanuts"] });

    const overview = await getDietaryOverview(alice, null);
    expect(overview.signals.allergy.members[0].flags).toEqual([]);
    expect(overview.signals.allergy.members[0].writeIns).toEqual(["peanuts"]);
    expect((await getMealConstraintPanel(alice, meal.id)).dishes).toEqual([]);
  });

  it("keeps intolerances apart from allergies and lists the ones a dish cannot declare", async () => {
    const { alice, bob, meal } = await kitchen();
    const question = await createProfileQuestion(alice, {
      ...ALLERGY_QUESTION,
      label: "Intolerances",
      options: INTOLERANCE_OPTIONS.map((o) => o.label),
      kitchenSignal: "intolerance",
    });
    await answerProfileQuestion(bob, question.id, { status: "answered", value: ["Lactose", "Fructose"] });
    await createDish(alice, { mealId: meal.id, name: "Cheese pie", allergenFlags: ["milk"] });

    const overview = await getDietaryOverview(alice, null);
    expect(overview.signals.intolerance.members).toEqual([
      {
        memberId: bob.id,
        name: "Bob",
        // Shown as ticked: Lactose, not the Milk flag it is checked against.
        ticks: [
          { label: "Lactose", flag: "milk" },
          { label: "Fructose", flag: null },
        ],
        flags: ["milk"],
        listed: ["Fructose"],
        writeIns: [],
      },
    ]);
    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel.dishes[0].allergy).toEqual([]);
    expect(panel.dishes[0].intolerance).toEqual([
      { memberId: bob.id, name: "Bob", matchedFlags: ["milk"], matchedLabels: ["Lactose"] },
    ]);
  });

  it("counts dislikes and never names anyone", async () => {
    const { alice, bob } = await kitchen();
    const question = await createProfileQuestion(alice, {
      label: "Foods you'd rather avoid",
      responseType: "multi_choice",
      options: DISLIKE_OPTIONS,
      allowOther: true,
      scope: "once_ever",
      kitchenSignal: "dislike",
    });
    await answerProfileQuestion(alice, question.id, { status: "answered", value: ["Mushrooms", "Spicy food"] });
    await answerProfileQuestion(bob, question.id, { status: "answered", value: ["Mushrooms", "celery root"] });

    const dislike = (await getDietaryOverview(alice, null)).signals.dislike;
    expect(dislike.tally).toEqual([
      { option: "Mushrooms", count: 2 },
      { option: "Spicy food", count: 1 },
    ]);
    expect(dislike.writeIns).toEqual([{ name: null, text: "celery root" }]);
    expect(dislike.members).toEqual([]);
  });

  it("shows a legacy written-answer question whole and matches nothing", async () => {
    const { alice, bob, meal } = await kitchen();
    const question = await createProfileQuestion(alice, {
      ...ALLERGY_QUESTION,
      responseType: "text",
      options: undefined,
      multiline: true,
      allowOther: false,
    });
    await answerProfileQuestion(bob, question.id, { status: "answered", value: "Severe peanut allergy" });
    await createDish(alice, { mealId: meal.id, name: "Satay", allergenFlags: ["peanuts"] });

    const overview = await getDietaryOverview(alice, null);
    expect(overview.signals.allergy.members[0].writeIns).toEqual(["Severe peanut allergy"]);
    expect((await getMealConstraintPanel(alice, meal.id)).dishes).toEqual([]);
  });

  it("ignores every question that isn't wired to a signal", async () => {
    const { alice, bob, meal } = await kitchen();
    await wireAllergy(alice);
    // A public question whose answer contains an allergen word, and a
    // restricted one nobody wired. Neither feeds the kitchen.
    const publicQuestion = await createProfileQuestion(alice, {
      label: "Languages you speak",
      responseType: "multi_choice",
      options: ["Soy", "English"],
      scope: "once_ever",
    });
    await answerProfileQuestion(bob, publicQuestion.id, { status: "answered", value: ["Soy"] });
    await createDish(alice, { mealId: meal.id, name: "Tofu", allergenFlags: ["soy"] });

    const overview = await getDietaryOverview(alice, null);
    expect(overview.signals.allergy.members).toEqual([]);
    expect((await getMealConstraintPanel(alice, meal.id)).dishes).toEqual([]);
  });

  it("drops a member whose consent to the gating purpose is withdrawn", async () => {
    const { alice, bob, meal } = await kitchen();
    const question = await wireAllergy(alice);
    const purpose = await createConsentPurpose(alice, {
      key: "kitchen_allergies",
      label: "Kitchen allergy reads",
      noticeText: "Cooks see your allergies to keep the menu safe.",
      gatesQuestionId: question.id,
      requiresExplicit: true,
    });
    await grantConsent(bob, purpose.id);
    await answerProfileQuestion(bob, question.id, { status: "answered", value: ["Peanuts"] });
    await createDish(alice, { mealId: meal.id, name: "Satay", allergenFlags: ["peanuts"] });
    expect((await getMealConstraintPanel(alice, meal.id)).dishes).toHaveLength(1);

    await withdrawConsent(bob, purpose.id);
    const overview = await getDietaryOverview(alice, null);
    expect(overview.signals.allergy.members).toEqual([]);
    expect(overview.signals.allergy.withheld).toBe(1);
    expect((await getMealConstraintPanel(alice, meal.id)).dishes).toEqual([]);
  });

  it("tells a dish that declares nothing from one that declares none", async () => {
    const { alice, meal } = await kitchen();
    await createDish(alice, { mealId: meal.id, name: "Mystery stew" });
    await createDish(alice, { mealId: meal.id, name: "Plain rice", allergenFlags: ["none_known"] });

    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel.unflaggedDishes.map((d) => d.dishName)).toEqual(["Mystery stew"]);
    expect(panel.dishes).toEqual([]);
  });

  it("is owner-only", async () => {
    const { bob, meal } = await kitchen();
    await expect(getDietaryOverview(bob, null)).rejects.toThrow(ForbiddenError);
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
    expect(action.personal).toHaveLength(1);
    expect(action.personal[0].kind).toBe("draft_unpublished");
    expect(await listKitchenNeedsAction(bob)).toEqual({ personal: [], shared: [] });
  });

  it("surfaces an unpublished draft and any open ideas, then goes quiet once published", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    await fileFoodIdea(bob, { menuPlanId: plan.id, kind: "preference", title: "More aubergine" });

    const before = await listKitchenNeedsAction(alice);
    expect(before.personal.map((k) => k.kind).sort()).toEqual(["draft_unpublished", "ideas_awaiting_review"]);
    const ideas = before.personal.find((k) => k.kind === "ideas_awaiting_review")!;
    expect(ideas.openCount).toBe(1);

    await publishMenuPlan(alice, plan.id);
    expect(await listKitchenNeedsAction(alice)).toEqual({ personal: [], shared: [] });
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
    expect(action.personal.map((k) => k.menuPlanId)).toEqual([springPlan.id]);
    expect(action.personal).not.toContainEqual(expect.objectContaining({ menuPlanId: standingPlan.id }));
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

describe("structured recipe suggestions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // alice holds the kitchen; bob is an ordinary member who suggests.
  async function kitchen() {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02", headCount: 12 });
    return { alice, bob, plan, meal };
  }

  const CHILI = {
    kind: "recipe_suggestion" as const,
    title: "Three-bean chili",
    body: "Simmer an hour.",
    serves: 4,
    allergenFlags: ["celery" as const],
    dietaryNote: "Vegan if the stock is",
    ingredients: [
      { name: "Kidney beans", amount: 400, unit: "g" },
      { name: "Cumin", amount: 2, unit: "tsp" },
      { name: "Salt", amount: null, unit: null },
    ],
  };

  it("files a recipe with its serves, flags and ingredients, and the author can read it back", async () => {
    const { bob, plan } = await kitchen();
    const filed = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    expect(filed).toMatchObject({ serves: 4, allergenFlags: ["celery"], dietaryNote: "Vegan if the stock is" });

    const mine = await listMyFoodIdeas(bob, plan.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].ingredients.map((i) => [i.name, i.amount, i.unit])).toEqual([
      ["Kidney beans", "400", "g"],
      ["Cumin", "2", "tsp"],
      ["Salt", null, null],
    ]);
  });

  it("keeps the recipe fields to a recipe suggestion", async () => {
    const { bob, plan } = await kitchen();
    const request = { menuPlanId: plan.id, kind: "dish_request" as const, title: "Something with beans", serves: 4 };
    expect(fileFoodIdeaInput.safeParse(request).success).toBe(false);
    await expect(fileFoodIdea(bob, request)).rejects.toThrow(/Only a recipe suggestion/);
    await expect(
      fileFoodIdea(bob, { ...request, serves: undefined, ingredients: [{ name: "Beans" }] }),
    ).rejects.toThrow(AppError);
    // A request with no recipe fields is the ordinary light idea.
    await expect(fileFoodIdea(bob, { ...request, serves: undefined })).resolves.toBeTruthy();
  });

  it("rejects an allergen flag outside the vocabulary", async () => {
    const { bob, plan } = await kitchen();
    await expect(
      fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI, allergenFlags: ["kiwi" as never] }),
    ).rejects.toThrow(AppError);
  });

  it("adopts into a pre-filled dish, copying serves, flags, note and every ingredient", async () => {
    const { alice, bob, plan, meal } = await kitchen();
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    const adopted = await adoptFromIdea(alice, { ideaId: idea.id, mealId: meal.id });

    expect(adopted).toMatchObject({
      name: "Three-bean chili",
      description: "Simmer an hour.",
      serves: 4,
      allergenFlags: ["celery"],
      dietaryNote: "Vegan if the stock is",
      source: "from_idea",
      sourceIdeaId: idea.id,
    });
    const rows = await db.select().from(dishIngredient).where(eq(dishIngredient.dishId, adopted.id));
    expect(rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((r) => [r.name, r.amount, r.unit])).toEqual([
      ["Kidney beans", "400", "g"],
      ["Cumin", "2", "tsp"],
      ["Salt", null, null],
    ]);
    const [after] = await db.select().from(foodIdea).where(eq(foodIdea.id, idea.id));
    expect(after).toMatchObject({ status: "adopted", adoptedDishId: adopted.id });
  });

  it("records the holder's final allergen set, not the suggester's claim", async () => {
    const { alice, bob, plan, meal } = await kitchen();
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    // The holder saw "celery", checked the recipe, and set what is true.
    const adopted = await adoptFromIdea(alice, {
      ideaId: idea.id,
      mealId: meal.id,
      allergenFlags: ["celery", "mustard"],
    });
    expect(adopted.allergenFlags).toEqual(["celery", "mustard"]);

    const second = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI, title: "Chili two" });
    const cleared = await adoptFromIdea(alice, { ideaId: second.id, mealId: meal.id, allergenFlags: [] });
    expect(cleared.allergenFlags).toEqual([]);
  });

  it("scales the adopted dish and leaves a to-taste line unscaled, flagged on the purchase list", async () => {
    const { alice, bob, plan, meal } = await kitchen();
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    const adopted = await adoptFromIdea(alice, { ideaId: idea.id, mealId: meal.id });

    // 12 eaters on a recipe for 4: ×3.
    const scaled = await scaledIngredients(alice, meal.id);
    const byName = new Map(scaled.map((s) => [s.name, s]));
    expect(byName.get("Kidney beans")).toMatchObject({ scaledAmount: 1200, factor: 3 });
    expect(byName.get("Salt")).toMatchObject({ storedAmount: null, scaledAmount: null, scaled: false });

    const list = await purchaseList(alice, meal.id);
    expect(list.find((r) => r.name === "Salt")).toMatchObject({ amount: null, unmeasured: true });
    expect(list.find((r) => r.name === "Cumin")).toMatchObject({ amount: 6, unmeasured: false });
    expect(adopted.serves).toBe(4);
  });

  it("lets a holder add a to-taste ingredient directly", async () => {
    const { alice, meal } = await kitchen();
    const dishRow = await createDish(alice, { mealId: meal.id, name: "Soup", serves: 6 });
    const created = await createDishIngredient(alice, { dishId: dishRow.id, name: "Pepper" });
    expect(created.amount).toBeNull();
  });

  it("lets the author edit an open idea, replacing its ingredients as a set", async () => {
    const { bob, plan } = await kitchen();
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    await updateFoodIdea(bob, idea.id, {
      title: "Four-bean chili",
      serves: 6,
      allergenFlags: [],
      ingredients: [{ name: "Black beans", amount: 400, unit: "g" }],
    });
    const [mine] = await listMyFoodIdeas(bob, plan.id);
    expect(mine).toMatchObject({ title: "Four-bean chili", serves: 6, allergenFlags: [] });
    expect(mine.ingredients.map((i) => i.name)).toEqual(["Black beans"]);
  });

  it("keeps editing and withdrawing to the author, while the idea is open", async () => {
    const { alice, bob, plan } = await kitchen();
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    // Even the kitchen holder can't rewrite someone else's suggestion.
    await expect(updateFoodIdea(alice, idea.id, { title: "Mine now" })).rejects.toThrow(ForbiddenError);
    await expect(withdrawFoodIdea(alice, idea.id)).rejects.toThrow(ForbiddenError);

    await declineFoodIdea(alice, idea.id, { declinedReason: "Too many beans" });
    await expect(updateFoodIdea(bob, idea.id, { title: "Fewer beans" })).rejects.toThrow(ConflictError);
    await expect(withdrawFoodIdea(bob, idea.id)).rejects.toThrow(ConflictError);

    const [mine] = await listMyFoodIdeas(bob, plan.id);
    expect(mine).toMatchObject({ status: "declined", declinedReason: "Too many beans" });
  });

  it("withdraws an open idea and its ingredient rows", async () => {
    const { bob, plan } = await kitchen();
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    await withdrawFoodIdea(bob, idea.id);
    expect(await listMyFoodIdeas(bob, plan.id)).toEqual([]);
    expect(await db.select().from(foodIdea).where(eq(foodIdea.id, idea.id))).toEqual([]);
  });

  it("takes a decided idea out of the holder's inbox, leaving it in the full list", async () => {
    const { alice, bob, plan, meal } = await kitchen();
    const adopted = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    const declined = await fileFoodIdea(bob, { menuPlanId: plan.id, kind: "preference", title: "More fruit" });
    const waiting = await fileFoodIdea(bob, { menuPlanId: plan.id, kind: "preference", title: "Fewer onions" });
    await adoptFromIdea(alice, { ideaId: adopted.id, mealId: meal.id });
    await declineFoodIdea(alice, declined.id, { declinedReason: "Already plenty" });

    expect((await listOpenIdeasForReview(alice, plan.id)).map((i) => i.id)).toEqual([waiting.id]);
    const all = await listIdeasForMenuPlan(alice, plan.id);
    expect(all.map((i) => i.status).sort()).toEqual(["adopted", "declined", "open"]);
  });

  it("shows only the member's own suggestions to them, and ingredients to the holder's inbox", async () => {
    const { alice, bob, plan } = await kitchen();
    await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    await fileFoodIdea(alice, { menuPlanId: plan.id, kind: "preference", title: "More fruit" });

    expect((await listMyFoodIdeas(bob, plan.id)).map((i) => i.title)).toEqual(["Three-bean chili"]);
    const inbox = await listOpenIdeasForReview(alice, plan.id);
    expect(inbox.find((i) => i.title === "Three-bean chili")!.ingredients).toHaveLength(3);
  });

  it("keeps another community's members out of an idea", async () => {
    const { bob, plan } = await kitchen();
    const idea = await fileFoodIdea(bob, { menuPlanId: plan.id, ...CHILI });
    const other = await createFixtures();
    await updateCommunity(other.alice, { modulesEnabled: ["kitchen"] });
    await expect(updateFoodIdea(other.alice, idea.id, { title: "x" })).rejects.toThrow();
    await expect(withdrawFoodIdea(other.alice, idea.id)).rejects.toThrow();
    await expect(listMyFoodIdeas(other.alice, plan.id)).rejects.toThrow();
  });
});
