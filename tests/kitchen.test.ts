import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, dish, dishIngredient, foodIdea, member, menuPlan, profileQuestion, taskResource } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import { createConsentPurpose, grantConsent, listConsentPurposes, withdrawConsent } from "@/lib/consent";
import { createSensitiveFieldAccessRule } from "@/lib/sensitive-data";
import { answerProfileQuestion } from "@/lib/profile-questions";
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

  /** A kitchen holder, a sensitive "Allergies" question, and answers on it.
   *
   *  This used to write `member.allergies` through updateOwnSensitiveData.
   *  Those columns are gone, so the fixture now does what a real community
   *  does: creates a sensitive question, restricts it to the kitchen
   *  grant, and answers it. The panel reads it back through the same
   *  audience resolution as every other surface.
   */
  async function kitchenWithAllergies(
    aliceAllergies: string | null,
    bobAllergies: string | null,
    // Whether the kitchen grant can read the question at all. False is the
    // "not linked yet" case; the one test that wants it answers *before*
    // anyone can read, which is the fail-closed state.
    options: { linkedToKitchen?: boolean } = {},
  ) {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen"] });
    await makeKitchenOwner(alice.communityId, branch.id, alice.id);
    // Inserted raw rather than through createProfileQuestion, because the
    // library refuses a sensitive question with no audience and this
    // fixture needs to build that state on purpose.
    const [question] = await db
      .insert(profileQuestion)
      .values({
        communityId: alice.communityId,
        label: "Allergies",
        responseType: "text",
        multiline: true,
        scope: "once_ever",
        sensitive: true,
      })
      .returning();
    if (options.linkedToKitchen !== false) {
      // Before the answers, not after. A rule added later cannot reach
      // answers that predate it — each of those is asked separately — so a
      // fixture that answered first would be modelling a different
      // community than a real one.
      await createSensitiveFieldAccessRule(alice, {
        questionId: question.id,
        unlockedByGrantModuleKey: "kitchen",
      });
    }
    const purpose = await createConsentPurpose(alice, {
      key: "kitchen_allergies",
      label: "Kitchen allergy reads",
      noticeText: "Cooks see your allergies to keep the menu safe.",
      gatesQuestionId: question.id,
      requiresExplicit: true,
    });
    for (const [who, value] of [
      [alice, aliceAllergies],
      [bob, bobAllergies],
    ] as const) {
      if (value === null) continue;
      await grantConsent(who, purpose.id);
      await answerProfileQuestion(who, question.id, { status: "answered", value });
    }
    const plan = await createMenuPlan(alice, { title: "Autumn" });
    const meal = await createMeal(alice, { menuPlanId: plan.id, label: "Friday", date: "2026-10-02", headCount: 12 });
    return { alice, bob, plan, meal, question };
  }

  it("returns null while the allergies question isn't linked to the kitchen grant", async () => {
    const { alice, meal, question } = await kitchenWithAllergies(null, "peanuts", { linkedToKitchen: false });
    // The question is sensitive but has no rule, so it resolves to
    // nobody-but-the-owner and the panel is absent rather than empty.
    // That is the same fail-closed reading as before, now expressed
    // through the question system.
    expect(question.sensitive).toBe(true);
    expect(await getMealConstraintPanel(alice, meal.id)).toBeNull();
  });

  it("does not read an answer that predates the kitchen being given the question", async () => {
    // The kitchen is the case where getting this wrong hurts somebody —
    // a nut allergy nobody could see — so the widening is worth asserting
    // here rather than only in the resolution tests. The panel is absent
    // rather than wrong, which is the honest shape: there is nothing to
    // show because nobody has agreed to be shown.
    const { alice, bob, meal, question } = await kitchenWithAllergies(null, "peanuts and cashews", {
      linkedToKitchen: false,
    });
    await createDish(alice, { mealId: meal.id, name: "Satay", allergenFlags: ["peanuts"] });
    // No panel at all: the question is restricted to nobody, so the page
    // falls back to the dish's own flag notes.
    expect(await getMealConstraintPanel(alice, meal.id)).toBeNull();

    await createSensitiveFieldAccessRule(alice, {
      questionId: question.id,
      unlockedByGrantModuleKey: "kitchen",
    });
    // A panel now, with nobody in it: the rule exists, the answer predates
    // it, and Bob has not been asked. Which is the honest shape — a dish to
    // check and no allergy anyone has agreed to show.
    expect((await getMealConstraintPanel(alice, meal.id))!.disclosedEaters).toBe(0);

    // He answers again — which is him agreeing to the audience that exists
    // now — and the panel appears.
    await answerProfileQuestion(bob, question.id, { status: "answered", value: "peanuts and cashews" });
    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel!.disclosedEaters).toBe(1);
    expect(panel!.dishes[0].conflicts[0].memberId).toBe(bob.id);
  });

  it("flags a dish against a consented member's disclosed allergy once the grant unlocks it", async () => {
    const { alice, bob, meal, question } = await kitchenWithAllergies(null, "peanuts and cashews");
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

  it("drops a member whose consent to the gating purpose is withdrawn", async () => {
    // The consent gate that the four columns had and question-keyed
    // purposes never did. Withdrawing has to take effect on the next read,
    // not never.
    const { alice, bob, meal } = await kitchenWithAllergies(null, "peanuts");
    await createDish(alice, { mealId: meal.id, name: "Satay", allergenFlags: ["peanuts"] });
    expect((await getMealConstraintPanel(alice, meal.id))!.disclosedEaters).toBe(1);

    const purposes = await listConsentPurposes(alice);
    await withdrawConsent(bob, purposes[0].id);
    const after = await getMealConstraintPanel(alice, meal.id);
    expect(after!.disclosedEaters).toBe(0);
    expect(after!.dishes).toHaveLength(0);
  });

  it("drops a member who unticks their share box, while keeping their own answer", async () => {
    // The per-answer lever. Un-ticking reduces the answer to
    // emergency-only; it does not remove it from the member's own profile.
    const { alice, bob, meal, question } = await kitchenWithAllergies(null, "peanuts");
    await createDish(alice, { mealId: meal.id, name: "Satay", allergenFlags: ["peanuts"] });
    expect((await getMealConstraintPanel(alice, meal.id))!.disclosedEaters).toBe(1);

    await answerProfileQuestion(bob, question.id, {
      status: "answered",
      value: "peanuts",
      shareWithAudience: false,
    });
    expect((await getMealConstraintPanel(alice, meal.id))!.disclosedEaters).toBe(0);
  });

  it("ignores non-sensitive answers, so unrelated free text can't become a conflict", async () => {
    // A community with a public "languages you speak" question would
    // otherwise match "soy" in someone's answer against a soy dish and
    // invent a food-safety incident out of a translation preference.
    const { alice, meal } = await kitchenWithAllergies(null, "peanuts");
    const [publicQuestion] = await db
      .insert(profileQuestion)
      .values({
        communityId: alice.communityId,
        label: "Languages you speak",
        responseType: "text",
        scope: "once_ever",
        sensitive: false,
      })
      .returning();
    await answerProfileQuestion(alice, publicQuestion.id, { status: "answered", value: "soy, soy sauce" });
    await createDish(alice, { mealId: meal.id, name: "Tofu", allergenFlags: ["soy"] });

    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel!.dishes).toHaveLength(0);
  });

  it("counts a member as disclosed but unflagged, and hides a dish nobody conflicts with", async () => {
    const { alice, meal } = await kitchenWithAllergies(null, "lactose");
    await createDish(alice, { mealId: meal.id, name: "Fried rice", allergenFlags: ["peanuts"] });

    const panel = await getMealConstraintPanel(alice, meal.id);
    expect(panel!.disclosedEaters).toBe(1);
    // Disclosed, but no dish on this meal touches their allergy.
    expect(panel!.dishes).toHaveLength(0);
  });

  it("is owner-only, and refuses a non-holder before the audience is even resolved", async () => {
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
