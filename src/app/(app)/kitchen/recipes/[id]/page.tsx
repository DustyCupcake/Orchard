import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loginUrl } from "@/lib/login-destination";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getViewingContext } from "@/lib/view-as";
import { getViewerClock } from "@/lib/view-clock";
import {
  getRecipe,
  isAnyKitchenHolder,
  listEditableDraftMeals,
  listRecipeComments,
  suggestedMultiplierForMeal,
  type RecipeListItem,
} from "@/lib/kitchen";
import PageHeader from "@/components/ui/PageHeader";
import Modal from "@/components/ui/Modal";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, LABEL, Tag } from "@/components/ui/kit";
import {
  acceptRecipeAction,
  addRecipeCommentAction,
  declineRecipeAction,
  toggleYumAction,
  updateRecipeAction,
} from "../../actions";
import { EmptyState, FlagTags, formatAmount, ingredientText, SectionHeading } from "../../parts";
import RecipeForm from "../../RecipeForm";
import RecipeApplyForm from "../../RecipeApplyForm";

export const dynamic = "force-dynamic";

const FLASH = {
  suggested: "Recipe added to the box. A kitchen holder will review it.",
  saved: "Saved",
  applied: "Recipe added to your meal plan",
  commented: "Comment added",
} as const;

function StatusTag({ status }: { status: RecipeListItem["status"] }) {
  if (status === "accepted") return <Tag tone="accent">accepted</Tag>;
  if (status === "declined") return <Tag tone="danger">declined</Tag>;
  return <Tag tone="warning">suggested</Tag>;
}

function IngredientList({ recipe, multiplier }: { recipe: RecipeListItem; multiplier?: number }) {
  if (recipe.ingredients.length === 0) {
    return <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">No ingredient list yet.</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5 text-[length:var(--text-body)] text-[var(--text)]">
      {recipe.ingredients.map((ing) => (
        <li key={ing.id}>
          {ingredientText(ing)}
          {multiplier !== undefined && ing.amount !== null && (
            <span className="text-[var(--text-muted)]">
              {" "}
              → {formatAmount(Number(ing.amount) * multiplier)} {ing.unit ?? ""}
              {ing.unit ? "" : " "} at {multiplier}×
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function RecipeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    suggested?: string;
    saved?: string;
    applied?: string;
    commented?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) redirect(await loginUrl());
  const { id } = await params;
  const paramsIn = await searchParams;
  const community = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(community, "kitchen");
  if (!moduleOn) notFound();

  const recipe = await getRecipe(viewing, id);
  if (!recipe) notFound();
  const clock = await getViewerClock();
  const comments = await listRecipeComments(viewing, id);
  const isAuthor = recipe.suggestedBy === viewing.id;
  const isHolder = await isAnyKitchenHolder(viewing);
  const canEdit = isHolder || (isAuthor && recipe.status !== "accepted");
  const meals = recipe.status === "accepted" ? await listEditableDraftMeals(viewing) : [];
  const suggestions: Record<string, number> = {};
  await Promise.all(
    meals.map(async (meal) => {
      suggestions[meal.id] = await suggestedMultiplierForMeal(viewing, recipe, meal.id);
    }),
  );
  const flashKey = (Object.keys(FLASH) as (keyof typeof FLASH)[]).find((key) => paramsIn[key]);

  const recipeForm = (mode: "edit" | "resubmit") => (
    <RecipeForm
      action={updateRecipeAction}
      hidden={{ recipeId: recipe.id, returnTo: `/kitchen/recipes/${recipe.id}` }}
      initial={{
        title: recipe.title,
        serves: recipe.serves,
        allergenFlags: recipe.allergenFlags,
        dietaryNote: recipe.dietaryNote,
        body: recipe.body,
        ingredients: recipe.ingredients.map((ing) => ({
          name: ing.name,
          amount: ing.amount === null ? "" : String(Number(ing.amount)),
          unit: ing.unit ?? "",
        })),
      }}
      submitLabel={mode === "resubmit" ? "Resubmit recipe" : "Save changes"}
      cancel={
        <Link href={`/kitchen/recipes/${recipe.id}`} className={BUTTON_GHOST}>
          Cancel
        </Link>
      }
    />
  );

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <Link href="/kitchen/recipes" className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to Recipe box
      </Link>

      {paramsIn.error && <Banner tone="danger">{paramsIn.error}</Banner>}
      {flashKey && !paramsIn.error && <Banner tone="success">{FLASH[flashKey]}</Banner>}

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {recipe.title} <StatusTag status={recipe.status} />
          </span>
        }
        description={`Suggested by ${recipe.authorName} · ${clock.date(recipe.createdAt)}`}
        actions={
          <>
            {isAuthor ? (
              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Your recipe counts as a Yum · {recipe.yumCount}</span>
            ) : (
              <form action={toggleYumAction}>
                <input type="hidden" name="recipeId" value={recipe.id} />
                <input type="hidden" name="returnTo" value={`/kitchen/recipes/${recipe.id}`} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  {recipe.viewerYummed ? "Remove Yum" : "Yum"} · {recipe.yumCount}
                </button>
              </form>
            )}
            {recipe.status === "accepted" && meals.length > 0 && (
              <Modal
                trigger="Add to meal plan…"
                triggerClassName={BUTTON_PRIMARY}
                title={`Add ${recipe.title}`}
                description="The recipe is copied into the meal, so later edits to the box won't rewrite it."
                wide
              >
                <RecipeApplyForm
                  recipeId={recipe.id}
                  meals={meals}
                  suggestions={suggestions}
                  returnTo={`/kitchen/recipes/${recipe.id}`}
                />
              </Modal>
            )}
          </>
        }
      />

      {recipe.status === "declined" && recipe.declineReason && (
        <Banner tone="warning">Declined for this reason: {recipe.declineReason}</Banner>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
        <section className={CARD}>
          <SectionHeading>Recipe</SectionHeading>
          {recipe.serves && (
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">As written, serves {recipe.serves}.</p>
          )}
          <div className="mt-3">
            <span className={LABEL}>Ingredients</span>
            <div className="mt-1">
              <IngredientList recipe={recipe} />
            </div>
          </div>
          {recipe.body && (
            <div className="mt-4">
              <span className={LABEL}>Method and notes</span>
              <p className="mt-1 whitespace-pre-line text-[length:var(--text-body)] text-[var(--text)]">{recipe.body}</p>
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <div className={CARD}>
            <span className={LABEL}>At a glance</span>
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
              {recipe.yumCount} Yum{recipe.yumCount === 1 ? "" : "s"} · a sign of support, not a vote. {recipe.commentCount}{" "}
              comment{recipe.commentCount === 1 ? "" : "s"}.
            </p>
            <div className="mt-2">
              <FlagTags flags={recipe.allergenFlags} />
            </div>
            {recipe.dietaryNote && <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">{recipe.dietaryNote}</p>}
            {recipe.reviewedAt && (
              <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                {recipe.status === "accepted" ? "Accepted" : "Reviewed"} {clock.date(recipe.reviewedAt)}
              </p>
            )}
          </div>

          {(isHolder || canEdit) && (
            <div className={`${CARD} flex flex-col gap-2`}>
              <span className={LABEL}>Curation</span>
              {isHolder && recipe.status !== "accepted" && (
                <form action={acceptRecipeAction}>
                  <input type="hidden" name="recipeId" value={recipe.id} />
                  <input type="hidden" name="returnTo" value={`/kitchen/recipes/${recipe.id}`} />
                  <button type="submit" className={BUTTON_PRIMARY}>
                    Accept recipe
                  </button>
                </form>
              )}
              {isHolder && recipe.status !== "declined" && (
                <Modal
                  trigger="Decline…"
                  triggerClassName={BUTTON_SECONDARY}
                  title="Decline this recipe"
                  description="Decline is for a duplicate, broken or incomplete recipe — never a judgment on the person who shared it."
                >
                  <form action={declineRecipeAction} className="flex flex-col gap-3">
                    <input type="hidden" name="recipeId" value={recipe.id} />
                    <input type="hidden" name="returnTo" value={`/kitchen/recipes/${recipe.id}`} />
                    <textarea
                      name="declineReason"
                      rows={3}
                      required
                      placeholder="e.g. duplicate of the three-bean chili already in the box"
                      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
                    />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Decline with reason
                    </button>
                  </form>
                </Modal>
              )}
              {canEdit && (
                <Modal
                  trigger={isAuthor && recipe.status === "declined" ? "Fix and resubmit…" : "Edit recipe…"}
                  triggerClassName={BUTTON_SECONDARY}
                  title={isAuthor && recipe.status === "declined" ? "Fix and resubmit" : "Edit recipe"}
                  description={
                    isAuthor && recipe.status === "declined"
                      ? "Saving puts it back to suggested for a holder to review again."
                      : "Changes save straight to the recipe box."
                  }
                  wide
                >
                  {recipeForm(isAuthor && recipe.status === "declined" ? "resubmit" : "edit")}
                </Modal>
              )}
            </div>
          )}
        </aside>
      </div>

      <section className="mt-6 flex flex-col gap-3">
        <SectionHeading>Comments</SectionHeading>
        {comments.length === 0 ? (
          <EmptyState>No comments yet. Ask about an ingredient, a step, or how it went.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((comment) => (
              <li key={comment.id} className={CARD}>
                <p className="text-[length:var(--text-body)] whitespace-pre-line text-[var(--text)]">{comment.body}</p>
                <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {comment.authorName} · {clock.dateTime(comment.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <form action={addRecipeCommentAction} className="flex flex-col items-start gap-2">
          <input type="hidden" name="recipeId" value={recipe.id} />
          <input type="hidden" name="returnTo" value={`/kitchen/recipes/${recipe.id}`} />
          <textarea
            name="body"
            rows={3}
            required
            maxLength={2000}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)]"
          />
          <button type="submit" className={BUTTON_SECONDARY}>
            Add comment
          </button>
        </form>
      </section>
    </main>
  );
}
