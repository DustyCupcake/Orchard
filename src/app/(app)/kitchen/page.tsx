import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/login-destination";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewerClock } from "@/lib/view-clock";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  attendanceForMeal,
  compareMealToOverview,
  effectiveHeadCount,
  getDietaryOverview,
  getMenuPlanOverview,
  isKitchenOwner,
  listIdeasForMenuPlan,
  listDishRecipeLinks,
  listMealCommentsForMeals,
  listMyFoodIdeas,
  listOpenIdeasForReview,
  listRecipes,
  listSupplyTasks,
  loadAttendanceContext,
  NO_ATTENDANCE,
  purchaseList,
  resolveActiveMenuPlan,
  suggestedMultipliersForMeal,
  resolveMealTimes,
  scaledIngredients,
  type DishRecipeLink,
  type FoodIdeaWithIngredients,
  type MealAttendance,
  type MealCommentWithAuthor,
  type MealConstraintPanel,
  type MealWithDishes,
  type MenuPlanRow,
  type PurchaseListRow,
  type ScaledIngredient,
} from "@/lib/kitchen";
import { resolveDefaultScopeSegment, resolveSingleCycleScope } from "@/lib/cycles";
import { switchToLinkedScopeAction } from "@/app/(app)/cycles/scope-actions";
import ActionMenu from "@/components/ui/ActionMenu";
import Modal from "@/components/ui/Modal";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, Tag } from "@/components/ui/kit";
import {
  createMealAction,
  createMenuPlanAction,
  fileFoodIdeaAction,
  publishMenuPlanAction,
  updateMealTimesAction,
} from "./actions";
import { MealForm } from "./MealForm";
import MenuTab from "./MenuTab";
import SuggestionsTab from "./SuggestionsTab";
import DietaryTab from "./DietaryTab";
import ShoppingTab from "./ShoppingTab";
import { LightIdeaForm, SectionHeading, TextField } from "./parts";
import { INPUT, LABEL } from "@/components/ui/kit";
import type { RecipeOption } from "./RecipeTypeahead";

export const dynamic = "force-dynamic";

type TabKey = "menu" | "suggestions" | "dietary" | "shopping";
type ComposeKind = "request" | "preference";

// Recipe suggestions have their own home in the recipe box. These two light
// kinds stay here because they belong to a menu, not to the reusable box.
const COMPOSE_KINDS: { key: ComposeKind; label: string }[] = [
  { key: "request", label: "A dish request" },
  { key: "preference", label: "A preference" },
];

const FLASH = {
  created: "Saved",
  published: "Menu published",
  saved: "Saved",
  suggested: "Thanks — the kitchen will see your suggestion",
  adopted: "Added to the menu",
} as const;

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    published?: string;
    saved?: string;
    suggested?: string;
    adopted?: string;
    tab?: string;
    // Opens a suggestion form in place of the page — the header's "Suggest a
    // recipe" action, the same `?compose=` technique /calendar and /schedule use.
    compose?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  const clock = await getViewerClock();
  if (!real || !viewing) {
    redirect(await loginUrl());
  }

  const params = await searchParams;
  const { error, tab, compose } = params;
  const flashKey = (Object.keys(FLASH) as (keyof typeof FLASH)[]).find((key) => params[key]);

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "kitchen");

  const scopeSegment = await resolveDefaultScopeSegment(viewing);
  const resolution = moduleOn ? await resolveSingleCycleScope(viewing, scopeSegment) : ({ kind: "none" } as const);

  if (moduleOn && resolution.kind === "ambiguous") {
    return (
      <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
        <PageHeader title="Kitchen" description="Scoped to multiple active events — pick one to see its menu:" />
        <div className="flex flex-wrap gap-2">
          {resolution.candidates.map((c) => (
            <form key={c.id} action={switchToLinkedScopeAction}>
              <input type="hidden" name="scope" value={c.id} />
              <input type="hidden" name="returnTo" value="/kitchen" />
              <button type="submit" className={BUTTON_SECONDARY}>
                {c.name}
              </button>
            </form>
          ))}
        </div>
      </main>
    );
  }
  const cycleId = resolution.kind === "resolved" ? resolution.cycle.id : null;

  const isOwner = moduleOn ? await isKitchenOwner(viewing, cycleId) : false;

  // Drafts are community-readable now: everyone resolves the same newest
  // plan. `isOwner` only decides who may write to it.
  const visiblePlan = moduleOn ? await resolveActiveMenuPlan(viewing, cycleId) : null;
  const ideasTarget = visiblePlan;

  const overview = visiblePlan ? await getMenuPlanOverview(viewing, visiblePlan.id) : null;
  const meals: MealWithDishes[] = overview?.meals ?? [];
  const draft = Boolean(visiblePlan && !visiblePlan.publishedAt);

  // Who is eating which meal, from the event's arrivals and departures. Read
  // for every viewer — it yields counts, not names — and null for a standing
  // menu, which has no event. The menu's own breakfast/lunch/dinner times are
  // only used to place someone who arrives or leaves part-way through a day.
  const attendanceCtx = visiblePlan ? await loadAttendanceContext(viewing, visiblePlan) : null;
  const times = resolveMealTimes(visiblePlan?.mealTimes);
  const attendance = new Map<string, MealAttendance>(
    meals.map((m) => [m.id, attendanceCtx ? attendanceForMeal(m, attendanceCtx) : NO_ATTENDANCE]),
  );
  const headCounts = new Map<string, number | null>(
    meals.map((m) => [m.id, effectiveHeadCount(m, attendance.get(m.id)!)]),
  );

  const visibleTabs: { key: TabKey; label: string }[] = [
    { key: "menu", label: "Menu" },
    { key: "suggestions", label: "Suggestions" },
    ...(isOwner
      ? ([
          { key: "dietary", label: "Dietary" },
          { key: "shopping", label: "Shopping" },
        ] as { key: TabKey; label: string }[])
      : []),
  ];

  // The holder's inbox is needed for the tab's count as well as its body, so
  // it is read whichever tab is showing.
  const inbox: FoodIdeaWithIngredients[] =
    isOwner && visiblePlan && draft ? await listOpenIdeasForReview(viewing, visiblePlan.id) : [];
  const tabs = visibleTabs.map((t) =>
    t.key === "suggestions" && inbox.length > 0 ? { ...t, label: `Suggestions (${inbox.length})` } : t,
  );

  const activeTab: TabKey = visibleTabs.find((t) => t.key === tab)?.key ?? "menu";
  const composeKind: ComposeKind | null =
    moduleOn && ideasTarget ? (COMPOSE_KINDS.find((c) => c.key === compose)?.key ?? null) : null;

  // The per-meal typeahead gets the accepted box and each recipe's suggested
  // multiplier for that particular meal. Computing it on the server keeps the
  // same headcount-and-other-dishes rule as the apply action itself.
  const recipeOptions = new Map<string, RecipeOption[]>();
  if (moduleOn && isOwner && draft && activeTab === "menu" && meals.length > 0) {
    const accepted = await listRecipes(viewing, { status: "accepted" });
    await Promise.all(
      meals.map(async (meal) => {
        const suggestions = await suggestedMultipliersForMeal(viewing, accepted, meal.id);
        recipeOptions.set(
          meal.id,
          accepted.map((r) => ({
            id: r.id,
            title: r.title,
            serves: r.serves,
            suggestedMultiplier: suggestions.get(r.id) ?? 1,
          })),
        );
      }),
    );
  }

  // Which dishes came from (or were saved to) the recipe box, and whose box
  // version has changed since. Only an editor can act on it, so only they pay
  // for the read.
  const recipeLinks: Map<string, DishRecipeLink> =
    moduleOn && isOwner && draft && activeTab === "menu"
      ? await listDishRecipeLinks(viewing, meals.flatMap((m) => m.dishes))
      : new Map();

  // Concern threads render only on the Menu tab. Reading them through this
  // helper re-checks plan visibility, so a hand-edited meal id can't pull a
  // different community's comments onto the page.
  const mealComments = new Map<string, MealCommentWithAuthor[]>();
  if (moduleOn && activeTab === "menu" && meals.length > 0) {
    const loaded = await listMealCommentsForMeals(viewing, meals.map((m) => m.id));
    for (const [mealId, comments] of loaded) mealComments.set(mealId, comments);
  }

  // ---- per-tab data, read only for the tab that shows it --------------------
  const dietary =
    isOwner && (activeTab === "menu" || activeTab === "dietary") ? await getDietaryOverview(viewing, cycleId) : null;
  const panels = new Map<string, MealConstraintPanel>();
  if (dietary) {
    for (const meal of meals) {
      // Only narrows, and only when there is an event to narrow by.
      const possible = attendanceCtx ? new Set(attendance.get(meal.id)!.possibleMemberIds) : null;
      panels.set(meal.id, compareMealToOverview(dietary, meal.id, meal.dishes, possible));
    }
  }

  let mine: FoodIdeaWithIngredients[] = [];
  let decided: FoodIdeaWithIngredients[] = [];
  const nameById = new Map<string, string>();
  if (activeTab === "suggestions" && ideasTarget) {
    if (isOwner) {
      decided = visiblePlan
        ? (await listIdeasForMenuPlan(viewing, visiblePlan.id)).filter((i) => i.status !== "open")
        : [];
    } else {
      mine = await listMyFoodIdeas(viewing, ideasTarget.id);
    }
    const ids = [...new Set([...inbox, ...decided].map((i) => i.suggestedBy))];
    if (ids.length > 0) {
      const rows = await db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, ids));
      for (const row of rows) nameById.set(row.id, row.name);
    }
  }

  const purchases = new Map<string, PurchaseListRow[]>();
  const scaled = new Map<string, ScaledIngredient[]>();
  const shopping = isOwner && activeTab === "shopping";
  const supplyTasks = shopping ? await listSupplyTasks(viewing, cycleId) : [];
  if (shopping) {
    for (const meal of meals) {
      purchases.set(meal.id, await purchaseList(viewing, meal.id));
      scaled.set(meal.id, await scaledIngredients(viewing, meal.id));
    }
  }

  // ---- header ---------------------------------------------------------------
  const composing = composeKind !== null;
  const actions =
    moduleOn && !composing ? (
      <>
        {isOwner && !visiblePlan && <StartMenu cycleId={cycleId} primary />}
        {isOwner && draft && visiblePlan && (
          <Modal
            trigger="Add a meal"
            triggerClassName={BUTTON_SECONDARY}
            title="Add a meal"
            description="One dated meal on the menu. Dishes go on it afterwards."
            wide
          >
            <MealForm
              action={createMealAction}
              hidden={{ menuPlanId: visiblePlan.id, tab: "menu" }}
              canUseArrivals={Boolean(visiblePlan.cycleId)}
              times={times}
              submitLabel="Add meal"
            />
          </Modal>
        )}
        {moduleOn && (
          <ActionMenu label="Kitchen actions">
            <Link href="/kitchen/recipes?compose=1">Suggest a recipe</Link>
          </ActionMenu>
        )}
        <Link href="/kitchen/recipes" className={BUTTON_PRIMARY}>
          Recipe box
        </Link>
      </>
    ) : undefined;

  const cancel = (
    <Link href="/kitchen" className={BUTTON_GHOST}>
      Cancel
    </Link>
  );

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Kitchen"
        description="Menus, recipes scaled to the people eating, and anything you'd like to see cooked."
        actions={actions}
      />

      {error && <Banner tone="danger">{error}</Banner>}
      {flashKey && !error && <Banner tone="success">{FLASH[flashKey]}</Banner>}

      {!moduleOn && (
        <Banner tone="warning">
          The Kitchen module isn&rsquo;t enabled for this Community — turn it on under Settings → Modules.
        </Banner>
      )}

      {moduleOn && composeKind && ideasTarget && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <SectionHeading>{composeKind === "request" ? "Ask for a dish" : "Share a preference"}</SectionHeading>
            {cancel}
          </div>
          <Tabs tabs={COMPOSE_KINDS} active={composeKind} hrefFor={(key) => `/kitchen?compose=${key}`} />
          <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
            You&rsquo;re suggesting this as {viewing.name}. Suggestions are attributed — the kitchen may want to ask you
            about it — and you can change or withdraw it until they decide.
          </p>
          <LightIdeaForm
            action={fileFoodIdeaAction}
            hidden={{ menuPlanId: ideasTarget.id, compose: composeKind }}
            kind={composeKind === "request" ? "dish_request" : "preference"}
            submitLabel="Send suggestion"
            cancel={cancel}
          />
        </section>
      )}

      {moduleOn && !composeKind && (
        <>
          {isOwner && <PlanStrip plan={visiblePlan} cycleId={cycleId} times={times} />}
          {!isOwner && visiblePlan && (
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">{visiblePlan.title}</span>
              {visiblePlan.publishedAt ? (
                <Tag tone="accent">published {clock.date(visiblePlan.publishedAt)}</Tag>
              ) : (
                <Tag tone="warning">draft</Tag>
              )}
              <span>
                {visiblePlan.publishedAt
                  ? "This menu is locked."
                  : "The kitchen is still working on this menu — leave a comment on a meal if something looks wrong."}
              </span>
            </div>
          )}

          <Tabs tabs={tabs} active={activeTab} hrefFor={(key) => (key === "menu" ? "/kitchen" : `/kitchen?tab=${key}`)} />

          <div className="mt-6">
            {activeTab === "menu" && (
              <MenuTab
                plan={visiblePlan}
                meals={meals}
                isOwner={isOwner}
                panels={isOwner ? panels : null}
                headCounts={headCounts}
                attendance={attendance}
                times={times}
                comments={mealComments}
                recipeOptions={recipeOptions}
                recipeLinks={recipeLinks}
              />
            )}
            {activeTab === "suggestions" && (
              <SuggestionsTab
                plan={ideasTarget}
                isOwner={isOwner}
                viewerId={viewing.id}
                mine={mine}
                inbox={inbox}
                decided={decided}
                inboxLocked={isOwner && Boolean(visiblePlan?.publishedAt)}
                meals={meals}
                nameById={nameById}
              />
            )}
            {activeTab === "dietary" && dietary && <DietaryTab overview={dietary} meals={meals} panels={panels} />}
            {activeTab === "shopping" && (
              <ShoppingTab
                cycleId={visiblePlan?.cycleId ?? null}
                budgetOn={isModuleEnabled(communityRow, "budget")}
                meals={meals}
                purchases={purchases}
                scaled={scaled}
                supplyTasks={supplyTasks}
                headCounts={headCounts}
                attendance={attendance}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}

function StartMenu({ cycleId, primary = false }: { cycleId: string | null; primary?: boolean }) {
  return (
    <Modal
      trigger="Start a menu"
      triggerClassName={primary ? BUTTON_PRIMARY : BUTTON_GHOST}
      title="Start a menu"
      description="A menu is a draft until you publish it. Everyone can read drafts and leave comments; publishing locks the plan."
    >
      <form action={createMenuPlanAction} className="flex flex-col gap-3">
        <input type="hidden" name="cycleId" value={cycleId ?? ""} />
        <input type="hidden" name="tab" value="menu" />
        <TextField label="Name" name="title" placeholder="e.g. This week's dinners" required />
        <div>
          <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Creating…">
            Create menu
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

// The holder's one-line state of the plan: what it's called, whether it is
// still a draft, and the two things they can do to it as a whole.
function PlanStrip({
  plan,
  cycleId,
  times,
}: {
  plan: MenuPlanRow | null;
  cycleId: string | null;
  times: Record<"breakfast" | "lunch" | "dinner", string>;
}) {
  if (!plan) {
    return (
      <p className="mb-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
        No menu here yet. Start one to add meals and take suggestions.
      </p>
    );
  }
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
      <span className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{plan.title}</span>
      {plan.publishedAt ? <Tag tone="accent">published</Tag> : <Tag tone="warning">draft</Tag>}
      <span className="ml-auto flex items-center gap-1">
        {!plan.publishedAt && plan.cycleId && (
          <Modal
            trigger="Meal times"
            triggerClassName={BUTTON_GHOST}
            title="Meal times"
            description="When breakfast, lunch and dinner usually are on this menu. They're only used to tell whether someone who arrives or leaves part-way through a day is there for a meal. Leave one blank to use the usual time."
          >
            <form action={updateMealTimesAction} className="flex flex-col gap-3">
              <input type="hidden" name="menuPlanId" value={plan.id} />
              <input type="hidden" name="tab" value="menu" />
              {(["breakfast", "lunch", "dinner"] as const).map((slot) => (
                <label key={slot} className="flex flex-col gap-1">
                  <span className={LABEL}>{slot[0].toUpperCase() + slot.slice(1)}</span>
                  <input
                    type="time"
                    name={slot}
                    defaultValue={plan.mealTimes?.[slot] ?? ""}
                    className={`${INPUT} w-fit`}
                  />
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Usual time: {times[slot]}</span>
                </label>
              ))}
              <div>
                <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
                  Save times
                </SubmitButton>
              </div>
            </form>
          </Modal>
        )}
        {!plan.publishedAt && (
          <Modal
            trigger="Publish"
            triggerClassName={BUTTON_PRIMARY}
            title={`Publish “${plan.title}”`}
            description="Publishing locks this menu — meals, dishes and ingredients can't be edited afterwards, so start a new menu for changes. Members can already read the draft and leave comments."
          >
            <form action={publishMenuPlanAction}>
              <input type="hidden" name="menuPlanId" value={plan.id} />
              <input type="hidden" name="tab" value="menu" />
              <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Publishing…">
                Publish menu
              </SubmitButton>
            </form>
          </Modal>
        )}
        <StartMenu cycleId={cycleId} />
      </span>
    </div>
  );
}
