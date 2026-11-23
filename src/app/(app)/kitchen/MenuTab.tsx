import type {
  MealAttendance,
  MealCommentWithAuthor,
  MealConstraintPanel,
  MealWithDishes,
  MenuPlanRow,
} from "@/lib/kitchen";
import { MEAL_SLOT_LABELS } from "@/lib/kitchen/attendance";
import { dishFeeds } from "@/lib/kitchen/scaling";
import type { MealSlot } from "@/db/schema";
import Modal from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { BUTTON_DESTRUCTIVE, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import {
  createMealCommentAction,
  createDishAction,
  deleteDishAction,
  deleteMealAction,
  updateDishAction,
  updateMealAction,
} from "./actions";
import { getDayLabeler } from "@/lib/day-labeler";
import { dayHeading } from "@/lib/kitchen/day-heading";
import { EmptyState, FlagPicker, FlagTags, TextField, formatAmount, ingredientText } from "./parts";
import { HeadCountWorking, MealForm } from "./MealForm";
import RecipeTypeahead, { type RecipeOption } from "./RecipeTypeahead";
import DishIngredientEditor from "./DishIngredientEditor";
import DishRecipePanel from "./DishRecipePanel";
import type { DishRecipeLink } from "@/lib/kitchen/recipes";

type Dish = MealWithDishes["dishes"][number];

// Every form on this tab says which tab it came from, so a save lands back
// here rather than on the default one.
function Tab() {
  return <input type="hidden" name="tab" value="menu" />;
}

function DishForm({ dish, mealId }: { dish?: Dish; mealId?: string }) {
  return (
    <form action={dish ? updateDishAction : createDishAction} className="flex flex-col gap-3">
      <Tab />
      {dish ? <input type="hidden" name="dishId" value={dish.id} /> : <input type="hidden" name="mealId" value={mealId} />}
      <TextField label="Name" name="name" defaultValue={dish?.name} required />
      <TextField label="Description" name="description" rows={2} defaultValue={dish?.description ?? ""} />
      <TextField
        label="Serves"
        name="serves"
        type="number"
        min={1}
        defaultValue={dish?.serves ? String(dish.serves) : ""}
        hint="How many people the ingredients below feed. The shopping list scales from this."
      />
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Contains</span>
        <FlagPicker defaultValue={dish?.allergenFlags ?? []} allowNone />
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Tick &ldquo;None known&rdquo; once you&rsquo;ve checked and the dish contains none of these. Leaving everything
          unticked means nobody has checked yet.
        </span>
      </div>
      <TextField label="Diet note" name="dietaryNote" defaultValue={dish?.dietaryNote ?? ""} placeholder="e.g. served with bread, optional" />
      <div>
        <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
          {dish ? "Save dish" : "Add dish"}
        </SubmitButton>
      </div>
    </form>
  );
}

function DishEditor({ dish, link }: { dish: Dish; link: DishRecipeLink | null }) {
  return (
    <Modal
      trigger="Edit"
      triggerClassName={BUTTON_GHOST}
      title={dish.name}
      description="Changes save to the draft menu."
      wide
    >
      <DishForm dish={dish} />
      <DishIngredientEditor dish={dish} />
      <DishRecipePanel dishId={dish.id} link={link} />

      <form action={deleteDishAction} className="border-t border-[var(--border)] pt-3">
        <Tab />
        <input type="hidden" name="dishId" value={dish.id} />
        <button type="submit" className={BUTTON_DESTRUCTIVE}>
          Remove this dish
        </button>
      </form>
    </Modal>
  );
}

function MealEditor({
  meal,
  canUseArrivals,
  times,
  attendance,
}: {
  meal: MealWithDishes;
  canUseArrivals: boolean;
  times: Record<MealSlot, string>;
  attendance: MealAttendance;
}) {
  return (
    <Modal trigger="Edit meal" triggerClassName={BUTTON_GHOST} title={`Edit ${meal.label}`} description="Removing a meal removes its dishes and ingredients." wide>
      <MealForm
        action={updateMealAction}
        hidden={{ tab: "menu", mealId: meal.id }}
        meal={meal}
        canUseArrivals={canUseArrivals}
        times={times}
        attendance={attendance}
        submitLabel="Save meal"
      />
      <form action={deleteMealAction} className="border-t border-[var(--border)] pt-3">
        <Tab />
        <input type="hidden" name="mealId" value={meal.id} />
        <button type="submit" className={BUTTON_DESTRUCTIVE}>
          Remove this meal
        </button>
      </form>
    </Modal>
  );
}

function DishRow({
  dish,
  editable,
  headCount,
  link,
}: {
  dish: Dish;
  editable: boolean;
  headCount: number | null;
  link: DishRecipeLink | null;
}) {
  const feeds = dishFeeds(dish, headCount);
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{dish.name}</span>
        {dish.serves && <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">serves {dish.serves}</span>}
        {dish.multiplier !== null && (
          <Tag tone="accent2">
            {formatAmount(dish.multiplier)}×{feeds > 0 ? ` · feeds ${Math.round(feeds)}` : ""}
          </Tag>
        )}
        {dish.source === "from_idea" && <Tag tone="accent2">from a suggestion</Tag>}
        {dish.source === "from_recipe" && <Tag tone="accent2">from the recipe box</Tag>}
        {editable && link?.changed && <Tag tone="warning">box version changed</Tag>}
        {editable && <span className="ml-auto"><DishEditor dish={dish} link={link} /></span>}
      </div>
      <FlagTags flags={dish.allergenFlags} />
      {dish.dietaryNote && <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">{dish.dietaryNote}</p>}
      {(dish.description || dish.ingredients.length > 0) && (
        <details className="text-[length:var(--text-body)]">
          <summary className="cursor-pointer text-[length:var(--text-meta)] text-[var(--accent-1)]">Recipe</summary>
          {dish.description && <p className="mt-1.5 whitespace-pre-line text-[var(--text-muted)]">{dish.description}</p>}
          {dish.ingredients.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[var(--text)]">
              {dish.ingredients.map((ing) => (
                <li key={ing.id}>{ingredientText(ing)}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </li>
  );
}

// What the cook needs to know about this meal at a glance, and nothing the
// viewer isn't allowed to read: the panel only exists for a holder, and its
// conflicts only name people whose answers the holder may read.
export function MealDietary({ panel }: { panel: MealConstraintPanel }) {
  if (panel.dishes.length === 0 && panel.unflaggedDishes.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
      <span className={LABEL}>Dietary check</span>
      {panel.dishes.map((d) => (
        <p key={d.dishId} className="flex flex-wrap items-center gap-1.5 text-[length:var(--text-body)] text-[var(--text)]">
          <span className="font-medium">{d.dishName}</span>
          {d.allergy.map((c) => (
            <Tag key={`a-${c.memberId}`} tone="danger">
              {c.name} — allergy: {c.matchedLabels.join(", ")}
            </Tag>
          ))}
          {d.intolerance.map((c) => (
            <Tag key={`i-${c.memberId}`} tone="warning">
              {c.name} — intolerance: {c.matchedLabels.join(", ")}
            </Tag>
          ))}
        </p>
      ))}
      {panel.unflaggedDishes.length > 0 && (
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Not checked yet: {panel.unflaggedDishes.map((d) => d.dishName).join(", ")}. A dish with nothing ticked hasn&rsquo;t been
          looked at, so it isn&rsquo;t counted as safe.
        </p>
      )}
    </div>
  );
}

// Draft plans are deliberately readable so members can raise a concern before
// the plan locks. The thread is attributed and the form is offered on drafts
// to holders and non-holders alike.
function MealComments({
  mealId,
  comments,
  canComment,
}: {
  mealId: string;
  comments: MealCommentWithAuthor[];
  canComment: boolean;
}) {
  return (
    <section className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <span className={LABEL}>Concerns</span>
      {comments.length === 0 ? (
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Nothing flagged yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {comments.map((comment) => (
            <li key={comment.id} className="text-[length:var(--text-body)] text-[var(--text)]">
              <span className="font-medium">{comment.authorName}</span>{" "}
              <span className="whitespace-pre-line text-[var(--text-muted)]">{comment.body}</span>
            </li>
          ))}
        </ul>
      )}
      {canComment ? (
        <form action={createMealCommentAction} className="flex flex-col items-start gap-2">
          <Tab />
          <input type="hidden" name="mealId" value={mealId} />
          <textarea
            name="body"
            rows={2}
            required
            maxLength={2000}
            placeholder="Something this meal needs the planner to know…"
            aria-label="Add a concern"
            className={`${INPUT} w-full`}
          />
          <SubmitButton className={BUTTON_SECONDARY} pendingLabel="Adding…">
            Add concern
          </SubmitButton>
        </form>
      ) : (
        comments.length > 0 && (
          <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            This menu is published, so the thread is read-only.
          </p>
        )
      )}
    </section>
  );
}

function MealCard({
  meal,
  editable,
  panel,
  headCount,
  attendance,
  canUseArrivals,
  times,
  isOwner,
  comments,
  canComment,
  recipeOptions,
  recipeLinks,
}: {
  meal: MealWithDishes;
  editable: boolean;
  panel: MealConstraintPanel | null;
  headCount: number | null;
  attendance: MealAttendance;
  canUseArrivals: boolean;
  times: Record<MealSlot, string>;
  isOwner: boolean;
  comments: MealCommentWithAuthor[];
  canComment: boolean;
  recipeOptions: RecipeOption[];
  recipeLinks: Map<string, DishRecipeLink>;
}) {
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{meal.label}</h3>
        <Tag tone={headCount ? "accent" : "neutral"}>{headCount ? `${headCount} eating` : "no headcount"}</Tag>
        {meal.headCountSource === "participation" && attendance.available && <Tag tone="accent2">from arrivals</Tag>}
        {(meal.slot || meal.time) && (
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            {[meal.slot ? MEAL_SLOT_LABELS[meal.slot] : null, meal.time?.slice(0, 5)].filter(Boolean).join(" · ")}
          </span>
        )}
        {editable && (
          <span className="ml-auto flex items-center gap-1">
            <Modal trigger="Add a dish" triggerClassName={BUTTON_SECONDARY} title={`Add a dish to ${meal.label}`} wide>
              <DishForm mealId={meal.id} />
            </Modal>
            <MealEditor meal={meal} canUseArrivals={canUseArrivals} times={times} attendance={attendance} />
          </span>
        )}
      </div>
      {isOwner && meal.headCountSource === "participation" && (
        <div className="mt-1">
          <HeadCountWorking attendance={attendance} guests={meal.guests} />
        </div>
      )}
      {meal.notes && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{meal.notes}</p>}

      {meal.dishes.length > 0 ? (
        <ul className="mt-3 divide-y divide-[var(--border)] border-t border-[var(--border)] pt-3">
          {meal.dishes.map((dish) => (
            <DishRow key={dish.id} dish={dish} editable={editable} headCount={headCount} link={recipeLinks.get(dish.id) ?? null} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">No dishes on this meal yet.</p>
      )}

      {editable && <RecipeTypeahead mealId={meal.id} options={recipeOptions} />}

      {panel && <MealDietary panel={panel} />}
      <MealComments mealId={meal.id} comments={comments} canComment={canComment} />
    </div>
  );
}

export default async function MenuTab({
  plan,
  meals,
  isOwner,
  panels,
  headCounts,
  attendance,
  times,
  comments,
  recipeOptions,
  recipeLinks,
}: {
  plan: MenuPlanRow | null;
  meals: MealWithDishes[];
  isOwner: boolean;
  panels: Map<string, MealConstraintPanel> | null;
  headCounts: Map<string, number | null>;
  attendance: Map<string, MealAttendance>;
  times: Record<MealSlot, string>;
  comments: Map<string, MealCommentWithAuthor[]>;
  recipeOptions: Map<string, RecipeOption[]>;
  recipeLinks: Map<string, DishRecipeLink>;
}) {
  const draft = Boolean(plan && !plan.publishedAt);
  const editable = isOwner && draft;
  const canComment = draft;
  const labeler = await getDayLabeler();

  if (!plan) {
    return (
      <EmptyState>
        {isOwner
          ? "There's no menu for this event yet. Start one from the button above, then add the meals."
          : "No menu has been started for this event yet. You can still suggest a recipe, and the kitchen will see it."}
      </EmptyState>
    );
  }
  if (meals.length === 0) {
    return (
      <EmptyState>
        {isOwner
          ? "No meals on this menu yet. Add the first one from the button above."
          : "This menu has no meals on it yet."}
      </EmptyState>
    );
  }

  // Meals arrive in date order; grouping by day keeps a lunch and a dinner
  // together under one heading instead of repeating the date on each card.
  const days: { date: string; meals: MealWithDishes[]; phaseId: string | null }[] = [];
  for (const meal of meals) {
    const last = days[days.length - 1];
    if (last && last.date === meal.date) last.meals.push(meal);
    else days.push({ date: meal.date, meals: [meal], phaseId: null });
  }
  // A day belongs to a phase of its own only when every meal on it says the
  // same one; otherwise it is left to the day's own dates.
  for (const day of days) {
    const phaseIds = new Set(day.meals.map((m) => m.phaseId));
    day.phaseId = phaseIds.size === 1 ? [...phaseIds][0] : null;
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map((day) => (
        <section key={day.date} className="flex flex-col gap-3">
          <h2 className="text-[length:var(--text-heading)] font-semibold text-[var(--text-muted)]">{dayHeading(labeler, day.date, { cycleId: plan.cycleId, phaseId: day.phaseId })}</h2>
          {day.meals.map((meal) => (
            <MealCard
              key={meal.id}
              meal={meal}
              editable={editable}
              panel={panels?.get(meal.id) ?? null}
              headCount={headCounts.get(meal.id) ?? null}
              attendance={attendance.get(meal.id) as MealAttendance}
              canUseArrivals={Boolean(plan.cycleId)}
              times={times}
              isOwner={isOwner}
              comments={comments.get(meal.id) ?? []}
              canComment={canComment}
              recipeOptions={recipeOptions.get(meal.id) ?? []}
              recipeLinks={recipeLinks}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
