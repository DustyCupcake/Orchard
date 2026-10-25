import type { FoodIdeaWithIngredients, MealWithDishes, MenuPlanRow } from "@/lib/kitchen";
import Modal from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { BUTTON_DESTRUCTIVE, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, SELECT, Tag } from "@/components/ui/kit";
import { adoptIdeaAction, declineIdeaAction, updateFoodIdeaAction, withdrawFoodIdeaAction } from "./actions";
import { EmptyState, FlagPicker, FlagTags, LightIdeaForm, RecipeForm, TextField, formatAmount, ingredientText } from "./parts";
import Link from "next/link";

type Idea = FoodIdeaWithIngredients;

const KIND_LABEL: Record<Idea["kind"], string> = {
  recipe_suggestion: "Recipe",
  dish_request: "Dish request",
  preference: "Preference",
};

function StatusTag({ idea }: { idea: Idea }) {
  if (idea.status === "adopted") return <Tag tone="success">On the menu</Tag>;
  if (idea.status === "declined") return <Tag tone="danger">Not this time</Tag>;
  return <Tag>Waiting for the kitchen</Tag>;
}

// What a suggestion says, in the same shape wherever it's shown: the
// recipe's facts first, then the words around it.
function IdeaBody({ idea }: { idea: Idea }) {
  const isRecipe = idea.kind === "recipe_suggestion";
  return (
    <div className="flex flex-col gap-2">
      {isRecipe && (idea.serves || idea.allergenFlags.length > 0 || idea.dietaryNote) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {idea.serves && <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">feeds {idea.serves}</span>}
          <FlagTags flags={idea.allergenFlags} />
          {idea.dietaryNote && <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{idea.dietaryNote}</span>}
        </div>
      )}
      {idea.ingredients.length > 0 && (
        <details className="text-[length:var(--text-body)]">
          <summary className="cursor-pointer text-[length:var(--text-meta)] text-[var(--accent-1)]">
            {idea.ingredients.length} ingredient{idea.ingredients.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[var(--text)]">
            {idea.ingredients.map((ing) => (
              <li key={ing.id}>{ingredientText(ing)}</li>
            ))}
          </ul>
        </details>
      )}
      {idea.body && <p className="whitespace-pre-line text-[length:var(--text-body)] text-[var(--text-muted)]">{idea.body}</p>}
    </div>
  );
}

function EditOwn({ idea }: { idea: Idea }) {
  const hidden = { ideaId: idea.id, kind: idea.kind, tab: "suggestions" };
  return (
    <Modal trigger="Edit" triggerClassName={BUTTON_GHOST} title={`Edit “${idea.title}”`} description="You can change this until the kitchen decides." wide>
      {idea.kind === "recipe_suggestion" ? (
        <RecipeForm
          action={updateFoodIdeaAction}
          hidden={hidden}
          submitLabel="Save changes"
          initial={{
            title: idea.title,
            serves: idea.serves,
            ingredients: idea.ingredients.map((i) => ({ name: i.name, amount: formatAmount(i.amount), unit: i.unit ?? "" })),
            allergenFlags: idea.allergenFlags,
            dietaryNote: idea.dietaryNote,
            body: idea.body,
          }}
        />
      ) : (
        <LightIdeaForm
          action={updateFoodIdeaAction}
          hidden={hidden}
          kind={idea.kind}
          submitLabel="Save changes"
          initial={{ title: idea.title, body: idea.body }}
        />
      )}
    </Modal>
  );
}

function Withdraw({ idea }: { idea: Idea }) {
  return (
    <form action={withdrawFoodIdeaAction}>
      <input type="hidden" name="ideaId" value={idea.id} />
      <input type="hidden" name="tab" value="suggestions" />
      <button type="submit" className={BUTTON_GHOST}>
        Withdraw
      </button>
    </form>
  );
}

function IdeaCard({
  idea,
  by,
  viewerIsAuthor,
  actions,
}: {
  idea: Idea;
  by?: string;
  viewerIsAuthor: boolean;
  actions?: React.ReactNode;
}) {
  const open = idea.status === "open";
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{idea.title}</h3>
        <Tag tone="accent2">{KIND_LABEL[idea.kind]}</Tag>
        <StatusTag idea={idea} />
        {by && <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">from {by}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {actions}
          {viewerIsAuthor && open && (
            <>
              <EditOwn idea={idea} />
              <Withdraw idea={idea} />
            </>
          )}
        </span>
      </div>
      <div className="mt-2">
        <IdeaBody idea={idea} />
      </div>
      {idea.status === "declined" && (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {idea.declinedReason ? `The kitchen's reason: ${idea.declinedReason}` : "The kitchen didn't give a reason."}
        </p>
      )}
    </div>
  );
}

function AdoptDialog({ idea, meals, by }: { idea: Idea; meals: MealWithDishes[]; by: string }) {
  return (
    <Modal
      trigger="Add to the menu"
      triggerClassName={BUTTON_PRIMARY}
      title={`Add “${idea.title}” to the menu`}
      description="This creates a dish on the meal you choose. The ingredients come across as written, and you can edit them on the dish afterwards."
      wide
    >
      {meals.length === 0 ? (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          There are no meals on this menu yet. Add one from the Menu tab first, so there&rsquo;s somewhere to put it.
        </p>
      ) : (
        <form action={adoptIdeaAction} className="flex flex-col gap-4">
          <input type="hidden" name="ideaId" value={idea.id} />
          <input type="hidden" name="tab" value="suggestions" />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Which meal?</span>
            <select name="mealId" required className={SELECT} defaultValue="">
              <option value="" disabled>
                Choose a meal…
              </option>
              {meals.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.date}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Dish name" name="name" defaultValue={idea.title} required />
          <TextField label="Serves" name="serves" type="number" min={1} defaultValue={idea.serves ? String(idea.serves) : ""} />
          <div className="flex flex-col gap-2">
            <span className={LABEL}>Contains</span>
            <FlagPicker defaultValue={idea.allergenFlags} allowNone />
            <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
              {idea.allergenFlags.length > 0
                ? `${by} ticked these, as far as they know. Check them against the recipe — what you save is what goes on the menu.`
                : `${by} didn't tick anything, which doesn't mean it's free of allergens. Check the recipe and tick what applies.`}
            </span>
          </div>
          <TextField label="Diet note" name="dietaryNote" defaultValue={idea.dietaryNote ?? ""} />
          <TextField label="Description" name="description" rows={3} defaultValue={idea.body ?? ""} />
          <div>
            <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Adding…">
              Add to the menu
            </SubmitButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

function DeclineDialog({ idea }: { idea: Idea }) {
  return (
    <Modal
      trigger="Decline"
      triggerClassName={BUTTON_SECONDARY}
      title={`Decline “${idea.title}”`}
      description="The person who suggested it will see this. A reason is optional but kind."
    >
      <form action={declineIdeaAction} className="flex flex-col gap-3">
        <input type="hidden" name="ideaId" value={idea.id} />
        <input type="hidden" name="tab" value="suggestions" />
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Reason</span>
          <input type="text" name="declinedReason" placeholder="e.g. we already have a bean dish that night" className={INPUT} />
        </label>
        <div>
          <button type="submit" className={BUTTON_DESTRUCTIVE}>
            Decline
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function SuggestionsTab({
  plan,
  isOwner,
  viewerId,
  mine,
  inbox,
  decided,
  inboxLocked,
  meals,
  nameById,
}: {
  plan: MenuPlanRow | null;
  isOwner: boolean;
  viewerId: string;
  mine: Idea[];
  inbox: Idea[];
  decided: Idea[];
  // The holder's plan is published, so nothing on it can be adopted.
  inboxLocked: boolean;
  meals: MealWithDishes[];
  nameById: Map<string, string>;
}) {
  if (!plan) {
    return <EmptyState>Suggestions open up once the kitchen starts a menu for this event.</EmptyState>;
  }

  if (!isOwner) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Your suggestions</h2>
          <span className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Or
            <Link href="/kitchen?compose=request" className="font-medium text-[var(--accent-1)] hover:underline">
              ask for a dish
            </Link>
            or
            <Link href="/kitchen?compose=preference" className="font-medium text-[var(--accent-1)] hover:underline">
              share a preference
            </Link>
          </span>
        </div>
        {mine.length === 0 ? (
          <EmptyState action={<Link href="/kitchen?compose=recipe" className={BUTTON_PRIMARY}>Suggest a recipe</Link>}>
            You haven&rsquo;t suggested anything yet. A recipe you love, a dish you&rsquo;d like to see, or something you
            can&rsquo;t eat — the kitchen reads all of it.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {mine.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} viewerIsAuthor />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">
          Waiting for a decision{inbox.length > 0 ? ` (${inbox.length})` : ""}
        </h2>
        {inboxLocked ? (
          <EmptyState>
            This menu is published, so suggestions can&rsquo;t be added to it. Start a new menu to work through what
            people have suggested.
          </EmptyState>
        ) : inbox.length === 0 ? (
          <EmptyState>Nothing waiting. New suggestions from the community land here.</EmptyState>
        ) : (
          inbox.map((idea) => {
            const by = nameById.get(idea.suggestedBy) ?? "A member";
            return (
              <IdeaCard
                key={idea.id}
                idea={idea}
                by={by}
                viewerIsAuthor={idea.suggestedBy === viewerId}
                actions={
                  <>
                    <AdoptDialog idea={idea} meals={meals} by={by} />
                    <DeclineDialog idea={idea} />
                  </>
                }
              />
            );
          })
        )}
      </section>

      {decided.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Decided</h2>
          {decided.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} by={nameById.get(idea.suggestedBy) ?? "A member"} viewerIsAuthor={false} />
          ))}
        </section>
      )}
    </div>
  );
}
