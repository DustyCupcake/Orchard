import Link from "next/link";
import { redirect } from "next/navigation";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getViewingContext } from "@/lib/view-as";
import {
  listEditableDraftMeals,
  listRecipes,
  suggestedMultipliersForMeal,
  type EditableMeal,
  type RecipeFilter,
  type RecipeListItem,
} from "@/lib/kitchen";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, Tag } from "@/components/ui/kit";
import { createRecipeAction, toggleYumAction } from "../actions";
import { EmptyState, FlagTags, ingredientText, SectionHeading } from "../parts";
import RecipeForm from "../RecipeForm";
import RecipeApplyForm from "../RecipeApplyForm";

export const dynamic = "force-dynamic";

const FILTERS: { key: RecipeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "suggested", label: "Suggested" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
];

const FLASH = {
  suggested: "Recipe added to the box. A kitchen holder will review it.",
  saved: "Saved",
  applied: "Recipe added to your meal plan",
  commented: "Comment added",
} as const;

function statusTag(status: RecipeListItem["status"]) {
  if (status === "accepted") return <Tag tone="accent">accepted</Tag>;
  if (status === "declined") return <Tag tone="danger">declined</Tag>;
  return <Tag tone="warning">suggested</Tag>;
}

function YumButton({ recipe, returnTo, isAuthor }: { recipe: RecipeListItem; returnTo: string; isAuthor: boolean }) {
  if (isAuthor) {
    return <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Your recipe counts as a Yum · {recipe.yumCount}</span>;
  }
  return (
    <form action={toggleYumAction} className="flex items-center gap-2">
      <input type="hidden" name="recipeId" value={recipe.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button type="submit" className={BUTTON_SECONDARY}>
        {recipe.viewerYummed ? "Remove Yum" : "Yum"}
      </button>
      <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
        {recipe.yumCount} · a sign of support, not a vote
      </span>
    </form>
  );
}

type Viewer = NonNullable<Awaited<ReturnType<typeof getViewingContext>>["viewing"]>;

async function suggestionsFor(
  actor: Viewer,
  recipes: RecipeListItem[],
  meals: EditableMeal[],
): Promise<Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, number>> = {};
  for (const recipe of recipes) result[recipe.id] = {};
  // One read of each meal's headcount and dishes, shared by every recipe.
  await Promise.all(
    meals.map(async (meal) => {
      const suggestions = await suggestedMultipliersForMeal(actor, recipes, meal.id);
      for (const recipe of recipes) result[recipe.id][meal.id] = suggestions.get(recipe.id) ?? 1;
    }),
  );
  return result;
}

export default async function RecipeBoxPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    error?: string;
    compose?: string;
    suggested?: string;
    saved?: string;
    applied?: string;
    commented?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) redirect("/login");
  const params = await searchParams;
  const community = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(community, "kitchen");

  const filter: RecipeFilter = FILTERS.find((f) => f.key === params.status)?.key ?? "all";
  const statusMessage = FILTERS.find((f) => f.key === filter)!.label.toLowerCase();
  const search = params.q?.trim() ?? "";
  const back = `/kitchen/recipes${filter === "all" ? "" : `?status=${filter}`}${search ? `${filter === "all" ? "?" : "&"}q=${encodeURIComponent(search)}` : ""}`;
  const flashKey = (Object.keys(FLASH) as (keyof typeof FLASH)[]).find((key) => params[key]);

  const composing = moduleOn && params.compose === "1";
  const recipes = moduleOn && !composing ? await listRecipes(viewing, { status: filter, search }) : [];
  const meals = moduleOn && !composing ? await listEditableDraftMeals(viewing) : [];
  const accepted = recipes.filter((r) => r.status === "accepted");
  const suggestions = moduleOn && !composing ? await suggestionsFor(viewing, accepted, meals) : {};

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <Link href="/kitchen" className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to Kitchen
      </Link>
      <PageHeader
        title="Recipe box"
        description="Recipes the community has shared. Yum them, talk about them, or add one to a draft menu."
        actions={
          moduleOn ? (
            <Link href="/kitchen/recipes?compose=1" className={BUTTON_PRIMARY}>
              Suggest a recipe
            </Link>
          ) : undefined
        }
      />

      {params.error && <Banner tone="danger">{params.error}</Banner>}
      {flashKey && !params.error && <Banner tone="success">{FLASH[flashKey]}</Banner>}
      {!moduleOn && (
        <Banner tone="warning">
          The Kitchen module isn&rsquo;t enabled for this Community — turn it on under Settings → Modules.
        </Banner>
      )}

      {composing ? (
        <section className="mt-8 flex flex-col gap-4">
          <SectionHeading>Suggest a recipe</SectionHeading>
          <p className="max-w-[640px] text-[length:var(--text-body)] text-[var(--text-muted)]">
            It goes into the shared box as {viewing.name}. A kitchen holder will review it; everyone can Yum and comment
            on it either way.
          </p>
          <RecipeForm
            action={createRecipeAction}
            hidden={{ returnTo: "/kitchen/recipes", compose: "1" }}
            submitLabel="Add to recipe box"
            cancel={
              <Link href="/kitchen/recipes" className={BUTTON_GHOST}>
                Cancel
              </Link>
            }
          />
        </section>
      ) : moduleOn ? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-[length:var(--text-body)]">
            <span className="text-[var(--text-muted)]">Showing</span>
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? "/kitchen/recipes" : `/kitchen/recipes?status=${f.key}`}
                className={`rounded-[var(--radius-md)] px-2 py-1 ${f.key === filter ? "bg-[var(--accent-1)] text-[var(--surface)]" : "border border-[var(--border)] text-[var(--text)]"}`}
              >
                {f.label}
              </Link>
            ))}
            <form action="/kitchen/recipes" method="get" className="ml-auto flex items-center gap-2">
              {filter !== "all" && <input type="hidden" name="status" value={filter} />}
              <input
                type="search"
                name="q"
                defaultValue={search}
                placeholder="Search recipe names"
                aria-label="Search recipe names"
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--text)]"
              />
              <button type="submit" className={BUTTON_GHOST}>
                Search
              </button>
            </form>
          </div>
          <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">{statusMessage} recipes, newest first.</p>

          {recipes.length === 0 ? (
            <div className="mt-6">
              <EmptyState action={<Link href="/kitchen/recipes?compose=1" className={BUTTON_PRIMARY}>Suggest the first one</Link>}>
                No recipes here yet. Add one and the whole community can find it.
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {recipes.map((recipe) => (
                <li key={recipe.id} className={CARD}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/kitchen/recipes/${recipe.id}`}
                      className="text-[length:var(--text-title)] font-semibold text-[var(--text)] hover:text-[var(--accent-1)]"
                    >
                      {recipe.title}
                    </Link>
                    {statusTag(recipe.status)}
                    {recipe.serves && <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">serves {recipe.serves}</span>}
                  </div>
                  <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Suggested by {recipe.authorName} · {recipe.commentCount} comments
                  </p>
                  {recipe.status === "declined" && recipe.declineReason && (
                    <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      Declined: {recipe.declineReason}
                    </p>
                  )}
                  <FlagTags flags={recipe.allergenFlags} />
                  {recipe.ingredients.length > 0 && (
                    <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      {recipe.ingredients.slice(0, 4).map((ing) => ingredientText(ing)).join(" · ")}
                      {recipe.ingredients.length > 4 ? "…" : ""}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <YumButton recipe={recipe} returnTo={back} isAuthor={recipe.suggestedBy === viewing.id} />
                    {recipe.status === "accepted" && meals.length > 0 && (
                      <Modal
                        trigger="Add to meal plan…"
                        triggerClassName={BUTTON_SECONDARY}
                        title={`Add ${recipe.title}`}
                        description="This copies the recipe into the meal. Changes you make to the box later won't rewrite it."
                        wide
                      >
                        <RecipeApplyForm
                          recipeId={recipe.id}
                          meals={meals}
                          suggestions={suggestions[recipe.id] ?? {}}
                          returnTo={back}
                        />
                      </Modal>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}
