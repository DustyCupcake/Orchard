import { redirect } from "next/navigation";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  getMealConstraintPanel,
  getMenuPlanOverview,
  isKitchenOwner,
  listOpenIdeasForReview,
  listSupplyTasks,
  purchaseList,
  resolveActiveMenuPlan,
  resolvePublishedMenuPlan,
  scaledIngredients,
} from "@/lib/kitchen";
import { ALLERGEN_FLAGS, ALLERGEN_FLAG_LABELS, type AllergenFlag } from "@/lib/kitchen/dietary";
import { resolveDefaultScopeSegment, resolveSingleCycleScope } from "@/lib/cycles";
import { switchToLinkedScopeAction } from "@/app/(app)/cycles/scope-actions";
import { Banner, BUTTON_DESTRUCTIVE, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL, SELECT, Tag } from "@/components/ui/kit";
import {
  adoptIdeaAction,
  createDishAction,
  createDishIngredientAction,
  createMealAction,
  createMenuPlanAction,
  declineIdeaAction,
  deleteDishAction,
  deleteDishIngredientAction,
  deleteMealAction,
  fileFoodIdeaAction,
  publishMenuPlanAction,
  updateDishAction,
  updateDishIngredientAction,
  updateMealAction,
} from "./actions";
import type { MealWithDishes, PurchaseListRow, ScaledIngredient, MealConstraintPanel } from "@/lib/kitchen";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  rows,
  required,
  min,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  rows?: number;
  required?: boolean;
  min?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {rows ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          rows={rows}
          className={INPUT}
        />
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          required={required}
          min={min}
          className={INPUT}
        />
      )}
    </label>
  );
}

// The bounded flag vocabulary rendered as checkboxes sharing one name —
// unchecked boxes simply don't submit (see actions.ts's allergenFlags).
function FlagPicker({
  defaultValue,
  excludeNone = false,
}: {
  defaultValue: string[];
  excludeNone?: boolean;
}) {
  const flags = excludeNone ? ALLERGEN_FLAGS.filter((f) => f !== "none_known") : ALLERGEN_FLAGS;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {flags.map((flag) => (
        <CheckField
          key={flag}
          name="allergenFlags"
          value={flag}
          label={ALLERGEN_FLAG_LABELS[flag]}
          defaultChecked={defaultValue.includes(flag)}
        />
      ))}
    </div>
  );
}

function FlagTags({ flags }: { flags: string[] }) {
  const visible = flags.filter((f) => f !== "none_known");
  if (visible.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {visible.map((f) => (
        <Tag key={f} tone={f === "milk" || f === "peanuts" || f === "shellfish" || f === "tree_nuts" ? "warning" : "neutral"}>
          {ALLERGEN_FLAG_LABELS[f as AllergenFlag] ?? f}
        </Tag>
      ))}
    </div>
  );
}

function MealBlock({
  meal,
  isOwner,
  panels,
  purchases,
  scaled,
}: {
  meal: MealWithDishes;
  isOwner: boolean;
  panels: Map<string, MealConstraintPanel>;
  purchases: Map<string, PurchaseListRow[]>;
  scaled: Map<string, ScaledIngredient[]>;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-[15px] font-medium text-[var(--text)]">{meal.label}</span>
          <span className="ml-2 text-[13px] text-[var(--text-muted)]">
            {new Date(meal.date).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
        <Tag tone={meal.headCount ? "accent" : "neutral"}>{meal.headCount ? `${meal.headCount} eaters` : "no headcount"}</Tag>
      </div>
      {meal.notes && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{meal.notes}</p>}

      {meal.dishes.map((dishRow) => (
        <div key={dishRow.id} className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[14px] font-medium text-[var(--text)]">{dishRow.name}</span>
              {dishRow.serves && <span className="ml-2 text-[12px] text-[var(--text-muted)]">serves {dishRow.serves}</span>}
              {dishRow.dietaryNote && (
                <span className="ml-2 text-[12px] text-[var(--text-muted)]">— {dishRow.dietaryNote}</span>
              )}
            </div>
            {dishRow.source === "from_idea" && <Tag tone="accent2">from a suggestion</Tag>}
          </div>
          {dishRow.description && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{dishRow.description}</p>}
          <FlagTags flags={dishRow.allergenFlags} />

          {dishRow.ingredients.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[13px] text-[var(--text)]">
              {dishRow.ingredients.map((ing) => (
                <li key={ing.id} className="flex items-center justify-between gap-2">
                  <span>
                    {ing.amount} {ing.unit} {ing.name}
                  </span>
                  {isOwner && (
                    <span className="flex items-center gap-1">
                      <details className="text-[12px]">
                        <summary className="cursor-pointer text-[var(--text-muted)]">edit</summary>
                        <form
                          action={updateDishIngredientAction}
                          className="mt-1 flex max-w-[420px] flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2"
                        >
                          <input type="hidden" name="ingredientId" value={ing.id} />
                          <div className="flex gap-1">
                            <input type="number" name="amount" defaultValue={ing.amount} step="any" min={0} required className={`${INPUT} w-24`} />
                            <input type="text" name="unit" defaultValue={ing.unit ?? ""} placeholder="unit" className={`${INPUT} w-24`} />
                            <input type="text" name="name" defaultValue={ing.name} required className={`${INPUT} flex-1`} />
                            <button type="submit" className={BUTTON_SECONDARY}>
                              Save
                            </button>
                          </div>
                        </form>
                      </details>
                      {isOwner && (
                        <form action={deleteDishIngredientAction}>
                          <input type="hidden" name="ingredientId" value={ing.id} />
                          <button type="submit" className={BUTTON_DESTRUCTIVE}>
                            ×
                          </button>
                        </form>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {isOwner && (
            <>
              <form action={createDishIngredientAction} className="mt-2 flex max-w-[520px] items-end gap-1">
                <input type="hidden" name="dishId" value={dishRow.id} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Add ingredient</span>
                  <div className="flex gap-1">
                    <input type="number" name="amount" step="any" min={0} required placeholder="amount" className={`${INPUT} w-24`} />
                    <input type="text" name="unit" placeholder="unit" className={`${INPUT} w-24`} />
                    <input type="text" name="name" required placeholder="name" className={`${INPUT} flex-1`} />
                  </div>
                </label>
                <button type="submit" className={BUTTON_SECONDARY}>
                  Add
                </button>
              </form>

              {scaled.get(meal.id)?.some((s) => s.dishId === dishRow.id && s.scaled) && (
                <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                  {scaled
                    .get(meal.id)!
                    .filter((s) => s.dishId === dishRow.id)
                    .map((s) => `${s.name} → ${s.scaledAmount} ${s.unit ?? ""} (×${s.factor})`)
                    .join(" · ")}
                </p>
              )}

              <details className="mt-2 text-[12px]">
                <summary className="cursor-pointer text-[var(--text-muted)]">edit dish</summary>
                <form action={updateDishAction} className="mt-1 flex max-w-[560px] flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <input type="hidden" name="dishId" value={dishRow.id} />
                  <TextField label="Name" name="name" defaultValue={dishRow.name} required />
                  <TextField label="Description (optional)" name="description" defaultValue={dishRow.description ?? ""} rows={2} />
                  <TextField label="Serves (optional — the scaling base)" name="serves" type="number" defaultValue={dishRow.serves ? String(dishRow.serves) : ""} min={1} />
                  <span className={LABEL}>Allergen flags</span>
                  <FlagPicker defaultValue={dishRow.allergenFlags} excludeNone />
                  <TextField label="Dietary note (optional)" name="dietaryNote" defaultValue={dishRow.dietaryNote ?? ""} />
                  <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                    Save dish
                  </button>
                </form>
              </details>

              <form action={deleteDishAction} className="mt-1">
                <input type="hidden" name="dishId" value={dishRow.id} />
                <button type="submit" className={BUTTON_DESTRUCTIVE}>
                  Remove dish
                </button>
              </form>
            </>
          )}
        </div>
      ))}

      {isOwner && (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-[var(--text-muted)]">add a dish</summary>
          <form action={createDishAction} className="mt-1 flex max-w-[560px] flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <input type="hidden" name="mealId" value={meal.id} />
            <TextField label="Name" name="name" required />
            <TextField label="Description (optional)" name="description" rows={2} />
            <TextField label="Serves (optional — the scaling base)" name="serves" type="number" min={1} />
            <span className={LABEL}>Allergen flags</span>
            <FlagPicker defaultValue={[]} excludeNone />
            <TextField label="Dietary note (optional)" name="dietaryNote" />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Add dish
            </button>
          </form>
        </details>
      )}

      {isOwner && meal.headCount !== null && (purchases.get(meal.id) ?? []).length > 0 && (
        <div className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
          <span className={LABEL}>Purchasing list ({meal.headCount} eaters)</span>
          <ul className="mt-1 space-y-0.5 text-[13px] text-[var(--text)]">
            {(purchases.get(meal.id) ?? []).map((row) => (
              <li key={row.name}>
                {row.amount} {row.unit} {row.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isOwner && panels.has(meal.id) && panels.get(meal.id)!.dishes.length > 0 && (
        <div className="mt-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
          <span className={LABEL}>Constraint check ({panels.get(meal.id)!.disclosedEaters} eaters with disclosed allergies)</span>
          <ul className="mt-1 space-y-1 text-[13px] text-[var(--text)]">
            {panels.get(meal.id)!.dishes.map((d) => (
              <li key={d.dishId}>
                <Tag tone="warning">{d.dishName}</Tag> may conflict with{" "}
                {d.conflicts.map((c) => (
                  <span key={c.memberId}>
                    {c.name}
                    {c.matchedFlags.length > 0 ? ` (${c.matchedFlags.map((f) => ALLERGEN_FLAG_LABELS[f]).join(", ")})` : ""}
                    {", "}
                  </span>
                ))}
                — verify before serving
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, created, published, saved, suggested, adopted } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "kitchen");

  const scopeSegment = await resolveDefaultScopeSegment(viewing);
  const resolution = moduleOn ? await resolveSingleCycleScope(viewing, scopeSegment) : ({ kind: "none" } as const);

  if (moduleOn && resolution.kind === "ambiguous") {
    return (
      <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Kitchen</h1>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Scoped to multiple active events — pick one to see its menu:
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
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

  const [visiblePlan, ideasTarget, supplyTasks] = await Promise.all([
    moduleOn
      ? isOwner
        ? resolveActiveMenuPlan(viewing, cycleId)
        : resolvePublishedMenuPlan(viewing, cycleId)
      : Promise.resolve(null),
    moduleOn ? resolveActiveMenuPlan(viewing, cycleId) : Promise.resolve(null),
    moduleOn ? listSupplyTasks(viewing, cycleId) : Promise.resolve([]),
  ]);

  const overview = visiblePlan ? await getMenuPlanOverview(viewing, visiblePlan.id) : null;
  const openIdeas = isOwner && visiblePlan && !visiblePlan.publishedAt ? await listOpenIdeasForReview(viewing, visiblePlan.id) : [];

  const ideaMemberIds = [...new Set(openIdeas.map((i) => i.suggestedBy))];
  const ideaMembers =
    ideaMemberIds.length > 0
      ? await db
          .select({ id: member.id, name: member.name })
          .from(member)
          .where(inArray(member.id, ideaMemberIds))
      : [];
  const memberNameById = new Map(ideaMembers.map((m) => [m.id, m.name]));

  const panels = new Map<string, NonNullable<Awaited<ReturnType<typeof getMealConstraintPanel>>>>();
  const purchases = new Map<string, Awaited<ReturnType<typeof purchaseList>>>();
  const scaled = new Map<string, Awaited<ReturnType<typeof scaledIngredients>>>();
  if (isOwner && overview) {
    for (const mealRow of overview.meals) {
      panels.set(mealRow.id, (await getMealConstraintPanel(viewing, mealRow.id)) ?? { mealId: mealRow.id, disclosedEaters: 0, totalFlags: 0, dishes: [] });
      purchases.set(mealRow.id, await purchaseList(viewing, mealRow.id));
      scaled.set(mealRow.id, await scaledIngredients(viewing, mealRow.id));
    }
  }

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Kitchen</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        The community&rsquo;s food schedule — menus, recipes scaled to the eaters, and food ideas anyone can suggest. See
        docs/spec.md&rsquo;s &ldquo;Food &amp; drinks&rdquo; and docs/food-drinks-module-plan.md.
      </p>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}
      {(created || published || saved || suggested || adopted) && (
        <div className="mt-4">
          <Banner tone="success">
            {created ? "Saved" : published ? "Menu plan published" : saved ? "Saved" : suggested ? "Suggestion filed" : "Adopted"}
          </Banner>
        </div>
      )}

      {!moduleOn && (
        <div className="mt-4">
          <Banner tone="warning">
            The Kitchen module isn&rsquo;t enabled for this Community — turn it on under Settings → Modules.
          </Banner>
        </div>
      )}

      {moduleOn && (
        <section className="mt-6">
          <SectionHeading>{isOwner ? "Menu workspace" : "The menu"}</SectionHeading>

          {isOwner && (
            <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
              {visiblePlan ? (
                <>
                  <span className="flex-1 text-[15px] font-medium text-[var(--text)]">{visiblePlan.title}</span>
                  {visiblePlan.publishedAt ? (
                    <Tag tone="accent">published</Tag>
                  ) : (
                    <>
                      <Tag tone="warning">draft</Tag>
                      <form action={publishMenuPlanAction}>
                        <input type="hidden" name="menuPlanId" value={visiblePlan.id} />
                        <button type="submit" className={BUTTON_PRIMARY}>
                          Publish menu
                        </button>
                      </form>
                    </>
                  )}
                </>
              ) : (
                <span className="flex-1 text-[13px] text-[var(--text-muted)]">No menu plan here yet.</span>
              )}
              <details className="text-[12px]">
                <summary className="cursor-pointer text-[var(--text-muted)]">start a new menu plan</summary>
                <form action={createMenuPlanAction} className="mt-2 flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <input type="hidden" name="cycleId" value={cycleId ?? ""} />
                  <TextField label="Title" name="title" placeholder="e.g. This week's dinners" required />
                  <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                    Create menu plan
                  </button>
                </form>
              </details>
            </div>
          )}

          {visiblePlan && visiblePlan.publishedAt && !isOwner && (
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">
              {visiblePlan.title} — published {new Date(visiblePlan.publishedAt).toLocaleDateString()}.
            </p>
          )}
          {visiblePlan && isOwner && visiblePlan.publishedAt && (
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">
              Published menus lock further edits — start a new draft above for the next menu.
            </p>
          )}

          {overview && overview.meals.length > 0 ? (
            <div className="mt-3 flex flex-col gap-3">
              {overview.meals.map((mealRow) => (
                <MealBlock key={mealRow.id} meal={mealRow} isOwner={isOwner} panels={panels} purchases={purchases} scaled={scaled} />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-[var(--text-muted)]">
              No meals on this menu yet.
            </p>
          )}

          {isOwner && visiblePlan && !visiblePlan.publishedAt && (
            <details className="mt-4 text-[12px]">
              <summary className="cursor-pointer text-[var(--text-muted)]">add a meal</summary>
              <form action={createMealAction} className="mt-2 flex max-w-[560px] flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <input type="hidden" name="menuPlanId" value={visiblePlan.id} />
                <TextField label="Label" name="label" placeholder="e.g. Friday dinner" required />
                <TextField label="Date" name="date" type="date" required />
                <TextField label="Headcount (optional — scales recipes into a purchasing list)" name="headCount" type="number" min={1} />
                <TextField label="Notes (optional)" name="notes" rows={2} />
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Add meal
                </button>
              </form>
            </details>
          )}

          {isOwner && visiblePlan && !visiblePlan.publishedAt && overview && (
            <div className="mt-4 flex flex-col gap-1">
              {overview.meals.map((m) => (
                <details key={`edit-${m.id}`} className="text-[12px]">
                  <summary className="cursor-pointer text-[var(--text-muted)]">edit/remove {m.label}</summary>
                  <form action={updateMealAction} className="mt-1 flex max-w-[560px] flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <input type="hidden" name="mealId" value={m.id} />
                    <TextField label="Label" name="label" defaultValue={m.label} required />
                    <TextField label="Date" name="date" type="date" defaultValue={m.date} required />
                    <TextField label="Headcount (optional)" name="headCount" type="number" min={1} defaultValue={m.headCount ? String(m.headCount) : ""} />
                    <TextField label="Notes (optional)" name="notes" defaultValue={m.notes ?? ""} rows={2} />
                    <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                      Save meal
                    </button>
                  </form>
                  <form action={deleteMealAction} className="mt-1">
                    <input type="hidden" name="mealId" value={m.id} />
                    <button type="submit" className={BUTTON_DESTRUCTIVE}>
                      Remove meal
                    </button>
                  </form>
                </details>
              ))}
            </div>
          )}
        </section>
      )}

      {moduleOn && ideasTarget && (
        <section className="mt-8">
          <SectionHeading>Suggest something</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Open-ended and attributed — recipes, requests, or preferences for the menu. No login-gated anonymity; a cook
            may need to ask about your suggestion.
          </p>
          <form action={fileFoodIdeaAction} className="mt-2 flex max-w-[560px] flex-col gap-2">
            <input type="hidden" name="menuPlanId" value={ideasTarget.id} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Kind</span>
              <select name="kind" className={SELECT}>
                <option value="recipe_suggestion">Recipe suggestion</option>
                <option value="dish_request">Dish request</option>
                <option value="preference">Preference</option>
              </select>
            </label>
            <TextField label="What" name="title" placeholder="e.g. that chickpea traybake we had at the picnic (if you have the recipe…)" required />
            <TextField label="Details (optional)" name="body" rows={2} placeholder="recipe link, occasion, who it serves…" />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              File suggestion
            </button>
          </form>
        </section>
      )}

      {moduleOn && isOwner && openIdeas.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Ideas inbox</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            On {visiblePlan!.title}. Adopting creates the dish on a meal of this draft; declining closes it with an
            optional reason.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {openIdeas.map((idea) => (
              <div key={idea.id} className={CARD}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[14px] font-medium text-[var(--text)]">{idea.title}</span>
                    <Tag tone="accent2">{idea.kind.replace("_", " ")}</Tag>
                    <span className="ml-2 text-[12px] text-[var(--text-muted)]">
                      from {memberNameById.get(idea.suggestedBy) ?? "a member"}
                    </span>
                  </div>
                </div>
                {idea.body && <p className="mt-1 text-[13px] text-[var(--text-muted)]">{idea.body}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-[var(--text-muted)]">adopt into a meal</summary>
                    <form action={adoptIdeaAction} className="mt-1 flex items-end gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2">
                      <input type="hidden" name="ideaId" value={idea.id} />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Dish name (default: the suggestion)</span>
                        <input type="text" name="name" defaultValue={idea.title} className={INPUT} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Meal</span>
                        <select name="mealId" className={SELECT}>
                          {overview!.meals.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label} — {new Date(m.date).toLocaleDateString()}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Adopt
                      </button>
                    </form>
                  </details>
                  <details className="text-[12px]">
                    <summary className="cursor-pointer text-[var(--text-muted)]">decline</summary>
                    <form action={declineIdeaAction} className="mt-1 flex items-end gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2">
                      <input type="hidden" name="ideaId" value={idea.id} />
                      <input type="text" name="declinedReason" placeholder="reason (optional)" className={INPUT} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Decline
                      </button>
                    </form>
                  </details>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {moduleOn && isOwner && supplyTasks.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Ordering &amp; equipment</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Open tasks in this scope tagged as supply work (ordering/equipment/supply), with their resources.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {supplyTasks.map((t) => (
              <div key={t.id} className={CARD}>
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/tasks/${t.id}`}
                    className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
                  >
                    {t.title}
                  </Link>
                  <div className="flex gap-1">
                    {t.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </div>
                </div>
                {t.resources.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[13px] text-[var(--text-muted)]">
                    {t.resources.map((r) => (
                      <li key={r.id}>
                        <a href={r.url} className="text-[var(--accent-1)] hover:underline" target="_blank" rel="noreferrer">
                          {r.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}