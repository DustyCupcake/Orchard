# Recipe box: community recipes, Yums, comments, and applying them to menus

**Status:** built and verified 2026-11-22, pending commit before archiving. Product decisions were
agreed with the product owner the same day; phases 1–6 are implemented, `tsc`, lint and the full
suite are green, and the outcome is recorded in [`../../CHANGELOG.md`](../../CHANGELOG.md). The two
follow-up form-state fixes — rejected recipe submits keeping every field, and dish ingredient edits
staying inside the open dialog — are recorded in the same entry. The body is left as the record of
intent it was; see [`../spec.md`](../spec.md) for what is now true.

> "Members should be able to browse, Yum and comment on recipes in a community-wide recipe box;
> kitchen holders should be able to curate it and apply recipes to draft menus with a sensible
> multiplier. Draft menus should be visible so people can raise concerns early, and we should add a
> public veggie/vegan/omni tally."

## 1. Why this exists

Today `dish` is both a recipe and a meal occurrence. A member's recipe suggestion is a
`foodIdea.recipe_suggestion` attached to one menu plan, visible only to that plan's holder; once
decided it is either copied into a dish or left as a dead idea. There is no community-wide place to
find a recipe again, no lightweight sign of support, no discussion, and no way for a planner to pull
an existing recipe into a meal except retyping it. Draft menus are also invisible to everyone but
the holder, so problems surface after publishing, when the plan is locked.

The fix is a separate, persistent `recipe` entity with its own browse page, community curation,
comments and indicative Yums, plus a copy-on-apply link from a recipe to a meal's `dish`. Draft
menus become readable by everyone; publishing stays the edit lock.

## 2. Decisions

- **D1 — A Yum is indicative, not a vote.** It is the same posture as event interest and budget
  support: a sign of support that does not bind the kitchen, is not ranked, and never decides what
  gets cooked. The UI says "Yum" and shows a count, never "votes", "top recipes", or a leaderboard.
- **D2 — The recipe box is community-wide and has no nav entry.** It has its own pages at
  `/kitchen/recipes` (browse) and `/kitchen/recipes/[id]` (detail), reached from Kitchen's header
  ⋯ menu. The existing `ActionMenu` is the codebase's one overflow pattern, and "Suggest a recipe"
  already owns the Kitchen header's primary button; adding a second prominent button would compete
  with it. Kitchen stays the single nav entry. No cycle scope: a recipe belongs to the Community,
  not an event or a menu.
- **D3 — A recipe is its own entity.** `recipe` + `recipeIngredient` hold the reusable recipe.
  Applying one to a meal creates a normal `dish` + `dishIngredient` copy, so later edits to the box
  do not silently rewrite planned meals. `dish.recipeId` records provenance.
- **D4 — New recipe suggestions create `recipe` rows with `status = suggested`.** No new
  `foodIdea.recipe_suggestion` rows are written. The enum value and existing rows stay for history.
  Dish requests and preferences still use `foodIdea`.
- **D5 — Statuses are `suggested`, `accepted`, `declined`.** All three remain browsable, Yum-able
  and commentable. Only `accepted` recipes are applicable to meals. Decline is for duplicates,
  broken or incomplete recipes, and similar reasons that make a recipe unfit to cook from — not a
  rejection of the person. A decline requires a reason.
- **D6 — Declined recipes can be revived.** The author may edit their own suggested or declined
  recipe and resubmit it as `suggested`. Any current kitchen holder may edit a recipe and accept or
  decline it, including one another holder declined earlier; "fix and accept" is one deliberate
  action, not a loophole around the author's resubmission.
- **D7 — Curation is any current kitchen holder, including holders of event-scoped granting
  tasks.** This mirrors the Kitchen module grant rather than the menu plan's scope. Applying a
  recipe to a meal still goes through the existing meal-plan write gate: the actor must hold the
  `kitchen` grant for *that meal's plan scope* and the plan must still be a draft.
- **D8 — Comments are attributed; Yums are count-only.** Every member can comment on recipes and
  on meals. Comment rows keep the author for display. A Yum row may keep a member id for uniqueness
  only; no recipe UI ever shows who Yummed it.
- **D9 — The author is implicitly a Yum and cannot Yum their own recipe.** The implicit Yum is
  counted on read (`explicit Yums + 1`) rather than stored, so there is no self-Yum row to get out
  of sync if the recipe is later edited. The count does not change when the author clicks.
- **D10 — Draft menus are community-readable.** `publishedAt` becomes the edit lock and a status
  label, not a visibility gate. Members can read draft meals, dishes and meal comments so they can
  raise concerns early. Writing meals/dishes still requires the plan-scoped holder and an
  unpublished plan.
- **D11 — Meal-level concern comments are in scope.** They live on meals, are read by everyone who
  can read the plan, are attributed, and may be written while the plan is a draft. Once published,
  a meal's comments become read-only along with the rest of the locked plan.
- **D12 — Diet is a fourth public, tally-only kitchen signal.** `diet` with the options Veggie,
  Vegan, Omni joins `allergy`, `intolerance` and `dislike` in `KITCHEN_SIGNALS`. It is a public
  single-choice profile question with a starter question, shown as counts only, with no names and
  no sensitive-data blocker. It informs planning; it is not a safety check.
- **D13 — Multiplier is the applied dish's scale, not a second scale on top of headcount.** The
  suggested value is `roundHalf(remaining / recipe.serves)`, where `remaining` is the meal's
  effective headcount minus the effective feeds already covered by the meal's other dishes. That
  value is stored on `dish.multiplier`, shown as e.g. `1.5× · feeds 12`, and used directly as the
  ingredient scale factor. A plain dish without a multiplier keeps the old `headCount / serves`
  rule. No double-scaling.
- **D14 — Half rounding.** `roundHalf(n) = Math.round(n * 2) / 2`, clamped to a minimum of `0.5`
  for an applied recipe. With no usable headcount or serving count, suggest `1` and let the planner
  edit it.

## 3. What exists today

| Concern | Current state | Change |
|---|---|---|
| Recipe reuse | `dish` is the recipe; `foodIdea.recipe_suggestion` is a one-plan suggestion | `recipe` is the reusable thing; `dish` is a meal occurrence with provenance |
| Recipe discovery | None; holder-only suggestions inbox | `/kitchen/recipes` browse + detail pages, no nav item |
| Support | None | Indicative Yum count |
| Discussion | Suggestion has a `body` field only | Attributed recipe comments and meal comments |
| Curation | Plan-scoped holder adopts/declines a `foodIdea` | Any current kitchen holder curates the community box; plan holder still applies |
| Draft visibility | `resolvePublishedMenuPlan` for non-owners; `getVisibleMenuPlan` rejects drafts | Everyone resolves the active plan and reads drafts |
| Publish | Locks edits and gates reads | Locks edits only; status label remains |
| Scaling | `headCount / serves` on read | Plus `dish.multiplier` for applied recipes |
| Diet signals | `allergy`, `intolerance`, `dislike` | Add public tally-only `diet` |

## 4. Data model

All new tables are Community-scoped implicitly through their parent rows, matching `recipe`-adjacent
Kitchen tables. Names below are the intended Drizzle/TypeScript names; the SQL migration follows the
repo's existing naming convention.

```text
recipe
  id, community_id, title, body, serves (nullable),
  allergen_flags text[], dietary_note (nullable),
  status enum('suggested','accepted','declined') default 'suggested',
  suggested_by -> member, reviewed_by -> member (nullable), reviewed_at (nullable),
  decline_reason (nullable), created_at, updated_at

recipe_ingredient
  id, recipe_id -> recipe, name, amount (numeric, nullable), unit (nullable),
  sort_order (nullable), created_at

recipe_yum
  id, recipe_id -> recipe, member_id -> member, created_at
  UNIQUE (recipe_id, member_id)
  -- attribution exists only to enforce one Yum per member; never rendered

recipe_comment
  id, recipe_id -> recipe, author_id -> member, body, created_at

meal_comment
  id, meal_id -> meal, author_id -> member, body, created_at

dish (existing)
  + recipe_id -> recipe (nullable)
  + multiplier numeric (nullable; null keeps the legacy headCount / serves rule)
dish_source enum (existing)
  + 'from_recipe'
```

Legacy `foodIdea.recipe_suggestion` rows, `foodIdeaIngredient`, `source = 'from_idea'`, and the
suggestions inbox remain intact for dish requests, preferences and historical recipes. The Kitchen
page's "Suggest a recipe" action points at the new recipe form instead of `?compose=recipe`; the
other two compose kinds stay where they are.

## 5. Permissions

| Action | Who |
|---|---|
| Browse recipes, read comments/Yum counts | Any member, when the Kitchen module is on |
| Suggest a recipe | Any member |
| Edit own recipe | Author, while status is `suggested` or `declined`; resubmits as `suggested` |
| Accept/decline/edit any recipe | Any current holder of a `kitchen`-granting task, any scope |
| Yum a recipe | Any member except its author; toggle on/off |
| Comment on a recipe | Any member |
| Read a draft menu, its meals/dishes and meal comments | Any member |
| Write meal/dish/ingredient changes | Holder of the `kitchen` grant for that plan's scope, draft only |
| Write meal comments | Any member, draft only |
| Apply an accepted recipe to a meal | Holder of the `kitchen` grant for that meal's plan scope, draft only |

A new `requireAnyKitchenHolder(actor)` helper wraps the existing `isKitchenOwner` resolver with the
scope argument omitted. Do not reuse it for plan writes: those keep calling
`requireEditableMenuPlan`.

## 6. Applying a recipe and the multiplier

- Both apply entry points use one shared `applyRecipeToMeal` server action/lib function:
  1. From a draft meal row in `MenuTab`: a recipe-name typeahead; selecting an accepted recipe
     applies it to that meal.
  2. From the recipe browse/detail page: **Add to meal plan…** opens a picker of the viewer's
     editable draft meals, then calls the same function. Holders who cannot edit any draft meal do
     not see the action.
- The action validates that the recipe exists, belongs to the community and is `accepted`; resolves
  the target meal; calls `requireEditableMenuPlan`; then copies recipe fields and ingredients into
  a `dish` with `source = 'from_recipe'`, `recipeId`, and the suggested multiplier in one
  transaction.
- Suggestion math, in one pure helper so it can be unit-tested:
  - `H = effectiveHeadCount(meal, attendance)`.
  - For each *other* dish on the meal, `feeds = serves * (multiplier ?? H / serves)` when `serves`
    is known and positive; otherwise it contributes `0` (unknown coverage is not guessed).
  - `remaining = max(0, H - sum(feeds))`.
  - `suggested = recipe.serves && H != null ? max(0.5, roundHalf(remaining / recipe.serves)) : 1`.
  - The planner can override with any positive half-step from `0.5` upward.
- Scaling reads use `dish.multiplier` when present, otherwise the legacy `headCount / serves`.
  Display uses `feeds = serves * multiplier`. Ingredient rows with no amount keep their existing
  "to taste" treatment. Purchase lists use the same effective factor as the menu so the two never
  disagree.

## 7. UI shape

- **Kitchen header**: add an `ActionMenu` with **Recipe box** beside the existing primary actions,
  shown when the module is on. No second nav entry and no extra primary button.
- **`/kitchen/recipes`**: browse cards with title, serves, status tag, Yum count, comment count,
  author attribution, tags/flags, and an **Add to meal plan…** action for accepted recipes. Status
  filter (All / Suggested / Accepted / Declined) and a name search. A **Suggest a recipe** button
  opens the recipe form; it uses the same fields today's `RecipeForm` collects.
- **`/kitchen/recipes/[id]`**: full recipe (method/notes, ingredients, serving base), Yum button
  (count only, hidden/disabled for the author with "Your recipe counts as a Yum"), attributed
  comment thread, holder curation controls (accept, decline with reason, edit/fix), author
  resubmit/revive control, and the apply action.
- **Kitchen `/kitchen`**: all viewers see the active plan, including drafts, with a clear
  `draft` / `published` tag; non-holders get a short explanation that the plan is still being
  worked on and that comments are how to raise a concern. `MenuTab` may render the existing
  meal/dish UI read-only for non-holders. Holders get the new per-meal recipe typeahead and keep
  all current edit controls. Published plans stay locked.
- **Dietary view/tab**: add a `Diet` tally block beside Dislikes. Counts only: veggie / vegan /
  omni, answered / withheld / deferred / not answered as for the other tally signals.
- Copy changes: "Start a menu" no longer says drafts are holder-only; publish copy says it locks
  the plan, not that it makes it visible. Yum copy says "a sign of support, not a vote".

## 8. Tests

- **Recipe box lib**: suggest creates `suggested`; list by status/community; holder curation from an
  event-scoped grant; non-holder and wrong-scope holder refused; decline requires a reason;
  author resubmit and holder fix-and-accept; accepted-only apply rule.
- **Yums**: one per member; toggle off; count includes author; author cannot Yum own recipe; no
  names exposed by the read model.
- **Comments**: attributed; any member can comment; meal comments readable on a draft by a
  non-holder and refused after publish.
- **Apply/multiplier**: copies ingredients and provenance; does not mutate the recipe; requires
  plan holder and draft; `effectiveHeadCount`, other-dish coverage, half rounding, minimum `0.5`,
  missing-input fallback, and no double scaling in menu/purchase-list assertions.
- **Draft visibility**: update `tests/kitchen.test.ts`'s "shows only the member's own suggestions to
  them" expectation and related published-only assertions; add tests that a member sees a draft
  plan's meals and status but cannot edit or see holder-only shopping/dietary surfaces.
- **Diet signal**: `diet` is in `SIGNALS`, starter question is public once-only single-choice with
  the three options, special-case blocker does not reject it, overview returns a tally and no
  names.
- **Docs**: update `docs/spec.md`'s Kitchen data model and signals, the design-handoff action
  hierarchy for the Kitchen ⋯ item, and `CHANGELOG.md` with what shipped and how it was verified.

## 9. Phases

1. **Draft menus and meal concerns.** Change read gates, page resolution and copy; add
   `meal_comment`; add UI and tests. Keep all existing write gates.
2. **Diet signal.** Add the enum value, `KITCHEN_SIGNALS`, question special case, starter question,
   dietary tally UI and tests.
3. **Recipe box core.** Schema/migration, recipe + ingredient libs, browse/detail pages, Kitchen ⋯
   entry, suggestion form repoint, curation and tests.
4. **Yums and comments.** Add the two comment/Yum tables, read models, UI, permissions and tests.
5. **Apply and multiplier.** Add dish columns, typeahead/apply actions, scaling changes, purchase
   list alignment and tests.
6. **Documentation and close-out.** Spec, design conventions, changelog, archive this plan once
   committed and verified.

Each phase lands with its own migration/tests where needed and keeps the app green; no phase
depends on a later one to be useful.
