# 🍲 Kitchen redesign — build plan

*A second pass on the Kitchen module (shipped; see [`archive/food-drinks-module-plan.md`](archive/food-drinks-module-plan.md)). The module works, but `/kitchen` is one long stack of `<details>` forms, a member can only suggest a title and a paragraph, and the allergy view is thin. This plan fixes the page, makes suggestions real recipes, and replaces keyword matching on allergy text with structured answers.*

**Status: shipped 2026-10-25 — archived. Everything below was built: dietary signals read by ticked options, structured recipe suggestions, the tabbed page, and (as a follow-on, at the foot) meal headcounts from arrivals and departures. The body is left as written, to show how the decisions were reached; the outcome and verification are in [`CHANGELOG.md`](../../../CHANGELOG.md). Deviations from the plan, and what was deliberately left open (diet tags on dishes, ideas stranded on a published menu, units in the purchase list), are under *What changed from the plan* at the foot.**

---

## What's wrong today (verified against the code)

1. **Suggesting is buried and thin.** "Suggest something" is the last form on the page. It is title + optional free text, with the *kind* (recipe / dish request / preference) as a dropdown. `foodIdea` has no columns for serves, ingredients or allergens, so those only exist after a holder adopts the idea and types the recipe in themselves.
2. **Suggesters never find out what happened.** Nothing renders a member's own ideas or their status or decline reason. A member cannot edit or withdraw one.
3. **The allergy view is weak.**
   - The per-meal constraint box renders only when some dish *conflicts*. With no conflict, a holder cannot tell "nobody has an allergy" from "nobody has told us" from "the community never linked allergies to Kitchen". The count of disclosed eaters is computed and then discarded.
   - It shows member name plus matched flag, never what the member wrote.
   - It works by `FLAG_KEYWORDS` containment over free text, and it reads only `typeof answer.value === "string"`, so **a multi-choice allergy question would be silently ignored**.
   - Every member with a disclosed answer counts as an eater of every meal; there is no attendance. That is a known limit, not something this plan fixes.
4. **The page layout.** Hand-rolled `<h1>` rather than `PageHeader`; every edit is a `<details>`; every action bounces to `/kitchen?saved=1` and loses scroll position.
5. **Recipes are unreachable for members** and holders cannot see a member's recipe as a recipe.

---

## ✅ Resolved decisions (recommended)

### D1 — Structured answers are matched exactly; free text is shown, never matched

The principle for the whole dietary side. A ticked option is a closed vocabulary and can be compared by equality. An "Other" write-in is shown verbatim to the holder as something to read. Nothing in Kitchen guesses at meaning from prose. `FLAG_KEYWORDS`, `matchesFlag` and the containment logic in `dietary.ts` are deleted.

### D2 — Three signals, three questions: allergy, intolerance, dislike

They are different things to a kitchen and need different handling, so they are asked separately.

| Signal | What the cook does with it | Shown as | Matched against dishes? |
|---|---|---|---|
| **Allergy** — a reaction that can be dangerous | Must be safe, labelled, no cross-contact | Red, always itemised by member | Yes — exact, against dish allergen flags |
| **Intolerance** — makes you ill, not dangerous | Offer an alternative or a small portion | Amber, itemised by member | Yes where it maps to a flag (lactose → milk, gluten → wheat/gluten); otherwise shown unmatched |
| **Dislike** — cilantro, spicy, mushrooms | Tune the menu; never a blocker | A tally only ("4 would rather avoid mushrooms"), no names | No — it is menu input, not a safety check |

Each is a profile question, because that is where audience rules, per-answer consent and emergency access already live. Splitting them avoids a per-item severity field the answer shape (an array of option labels) cannot hold.

Question shapes:
- **Allergies** — `multi_choice` + Other, sensitive, restricted to the Kitchen grant, declinable. Options are the dish allergen vocabulary (milk, eggs, fish, shellfish, tree nuts, peanuts, soy, wheat/gluten, sesame) plus the EU-regulated extras (celery, mustard, lupin, sulphites, molluscs) if the community is in the EU — ❓ see Q5.
- **Intolerances** — `multi_choice` + Other, sensitive, Kitchen-restricted, declinable. Options: lactose, gluten, fructose, histamine, FODMAPs, caffeine, alcohol.
- **Dislikes** — `multi_choice` + Other, **not** sensitive by default, declinable. Options: spicy food, cilantro/coriander, mushrooms, olives, onions, strong cheese, raw tomato, offal.

There is no help-text column on `profile_question`, so the label carries the definition: "Allergies (a reaction that could be serious)", "Intolerances (makes you unwell, but isn't dangerous)", "Foods you'd rather avoid".

### D3 — A question can be tagged as feeding the kitchen

This **reverses a decision in the original plan**, which deliberately avoided any identifier for "the allergy question" and matched every readable sensitive answer. That was safe for keyword matching over prose. For exact matching it is wrong: a tick on "Fish" in some unrelated sensitive question would read as a fish allergy.

Add `profile_question.kitchen_signal`, nullable enum `allergy | intolerance | dislike`. An admin sets it in the question editor. Kitchen reads only questions carrying a tag, and still only through the existing gates (audience, per-answer consent, share switch). The tag selects *which* answers Kitchen interprets; it grants no access. At most one question per signal per community.

Open consequence: tagging a question is not a disclosure (it widens nobody's audience), so it needs no consent prompt, but it should show on the question card so an admin can see what is wired to the kitchen.

### D4 — The holder's dietary view always renders, and says what state it is in

Replace the per-meal conflict box with a **Dietary** surface that is never silent. States, in order:
1. Kitchen not wired — "No question is set up to tell the kitchen about allergies. [Settings → Profile & Privacy]".
2. Wired, nobody has disclosed — "0 of 14 members have answered; 3 declined".
3. Wired, answers exist — counts, then the detail.

Detail for the holder:
- **Allergies / intolerances:** per allergen, who (names), then an "Also written in" list of every Other write-in with the member's name, verbatim. This list is always shown whole, because it cannot be matched.
- **Per meal:** dishes whose flags equal a disclosed allergy (red) or intolerance (amber) — exact comparison. A dish with *no* flags at all is marked "not flagged" rather than treated as safe.
- **Dislikes:** tally only.
- A link to `/members/data` for the full table.

Legacy: a text-type allergy question (what the starter set seeds today) is displayed verbatim in "Also written in" and matched against nothing. Communities keep their data; they lose the old fuzzy conflict rows.

### D5 — A recipe suggestion is a structured idea the holder adopts as a pre-filled dish

Add to `food_idea`: `serves int`, `allergen_flags text[]`, `dietary_note text`. Add `food_idea_ingredient` (`idea_id`, `name`, `amount`, `unit`, `sort_order`) mirroring `dish_ingredient`. `body` keeps its job as method and notes.

- Structured fields apply to `recipe_suggestion` only. `dish_request` and `preference` keep title + body.
- `adoptFromIdea` copies serves, flags, note and ingredients into the new dish and `dish_ingredient` rows in its existing transaction.
- **A suggester's allergen flags are a claim, not a fact.** The adopt dialog shows them pre-filled and editable, labelled "suggested — check before keeping", and the dish records the holder's final set.
- Members can **edit or withdraw their own open idea**. Withdraw is a delete of an open idea; decided ideas are immutable, as today.
- Members get a **My suggestions** list with status and the decline reason.

### D6 — The page: header action, tabs, dialogs

Use the existing pieces (`PageHeader`, `Tabs`, `Modal`, the `?compose=` technique from #27); no new design primitives.

- **Header:** title + description left; right, **Suggest a recipe** (primary, `?compose=recipe`). Holders also get **Add meal** as a secondary action while the plan is a draft.
- **Tabs** (`?tab=`): **Menu** (everyone) · **Suggestions** (everyone; the holder's inbox, a member's own list) · **Dietary** (holders) · **Shopping** (holders: purchasing lists + the supply-task lens).
- **Menu:** meals grouped by date, each a card with dishes collapsed to name, serves and allergen tags; recipe detail expands. Holder edits open in a `Modal` instead of `<details>`.
- **Compose** (`?compose=recipe`): the header button swaps the page body for the recipe form with Cancel, as Programme does, and a refused submit lands back on the open form.
- **Recipe form:** title, serves, ingredient rows (add/remove — a small client component, like `OtherFieldInput`), allergen checkboxes, dietary note, method/notes. Copy says what each field does, per the conventions.
- **Where does a suggestion go?** It files against the active plan. With **no plan in the scope** the button is hidden and a non-holder sees "The kitchen hasn't started a menu for this event yet", rather than a button that cannot work.

---

## ✅ Resolved questions

1. **Tag on the question (D3), or something else?** The alternative is a Kitchen-owned dietary table, which would duplicate audience, consent and emergency machinery and recreate the "two places to record an allergy" split the starter set was written to avoid. **Resolved: the tag.**
2. **Dislikes: public or restricted?** **Resolved: public by default and declinable**, since "I don't like cilantro" is not sensitive. Note that diet-type answers (halal, kosher, vegetarian) can reveal religion, which GDPR treats as special-category data, so *Diet* should not be treated like dislikes.
3. **Ingredient amounts optional?** `dish_ingredient.amount` is `NOT NULL` and positive, so "salt, to taste" cannot be entered. Making it nullable is small: null means unscaled and the purchase list shows the line without a number. **Resolved: yes.** It matters most for member-written recipes.
4. **Diet (vegetarian, vegan, halal, kosher) and dish diet tags — in scope?** Dishes carry allergen flags only, so a holder cannot be told "no vegetarian main on Friday". It is probably the most common real constraint. **Resolved: follow-up, not part of this pass.**
5. **Allergen list** — **Resolved: the EU's 14.** The five added are celery, mustard, lupin, sulphites and molluscs; `shellfish` stays and is relabelled "Shellfish (crustaceans)" so it no longer overlaps molluscs. (Was: the nine existing flags only, or the EU's 14?) Adding celery, mustard, lupin, sulphites and molluscs is a one-line change to `ALLERGEN_FLAGS` (a `text[]`, no migration), but it changes the checkbox lists on both sides.
6. **Existing communities.** The starter set seeds at set-up; this plan changes the defaults for *new* communities. Existing ones keep the free-text Allergies question until an admin adds the new ones. **Resolved: build the action, and prompt for it.** Settings → Profile & Privacy gets a *Kitchen questions* panel (one row per signal: the question wired to it, or a one-click add of the starter question, or pick an existing one). It shows only while Kitchen is on. When Kitchen is switched on and a signal is unwired, the Modules tab shows a prompt linking to the panel, and the holder's Dietary tab says the same. (Was: is a "add the new kitchen questions" action worth building, or is the settings editor enough?)

---

## 🗄️ Schema changes

One migration.

- `food_idea`: `+ serves int null`, `+ allergen_flags text[] not null default '{}'`, `+ dietary_note text null`.
- `food_idea_ingredient`: new table, as above. Deleted with its idea.
- `profile_question`: `+ kitchen_signal` enum (`allergy | intolerance | dislike`) null, unique per community where non-null.
- `dish_ingredient.amount`: drop `NOT NULL` (if Q3 is yes).

No change to `menu_plan`, `meal` or `dish`.

---

## 🛠️ Build steps

Lib first with tests, then UI, docs in the same commit as the code (repo convention). Tests run against real Postgres in an isolated container; clean up Docker afterwards.

**Read first:** `AGENTS.md` says this Next.js has breaking changes — read the relevant guides under `node_modules/next/dist/docs/` (forms, server actions, `searchParams`) before writing any page code.

1. **Dietary signals.** Schema + migration for `kitchen_signal`; question editor field; starter set gains the three questions; `dietary.ts` rewritten on exact matching with the D4 states; tests for each state, exact match vs near-miss ("Fish" tick vs "fish sauce" write-in), write-ins shown verbatim, legacy text question shown unmatched, consent and share-switch still honoured, one-tag-per-signal.
2. **Structured ideas.** Schema + migration; `fileFoodIdea` takes structured fields; edit/withdraw own idea; `listMyIdeas`; `adoptFromIdea` copies ingredients; tests including a cross-community check and "decided ideas immutable".
3. **Page.** `PageHeader`, tabs, `Modal` edits, compose form, recipe-rows client component, empty and no-plan states, dietary tab. Verify in the browser at desktop and phone widths, in light and dark.
4. **Docs.** `docs/spec.md` Kitchen section and entity table, `docs/default-profile-questions.md`, `CHANGELOG.md`, the Kitchen paragraph in `src/lib/docs/content/how-it-works.ts`; this plan archived when shipped.
5. **Verification.** Full test pass; manual run against the real Docker Compose stack.

Steps 1 and 2 are independent and can ship separately. Step 3 depends on both.

---

## Out of scope

Diet tags and the vegetarian/vegan view (Q4), per-meal attendance (who actually eats), unit conversion or name merging for ingredients, cost into Budget, table reservations.


---

## What changed from the plan

Written after building, so the next reader has the real state rather than the intent.

**Deviations, each for a reason found while building:**

- **Kitchen signal needs a once-ever question.** The plan said "asked once" only in the copy; it is now enforced (`kitchenSignalBlocker`), because a per-event answer is one the kitchen could never find.
- **The starter review refuses to un-restrict a kitchen health question up front.** The seeder is not transactional, so a refusal from deep inside would leave part of the set written and the review step closed for good. Caught in `preflight`, with a test.
- **The dietary view shows the member's own words.** The first cut showed the dish flag an intolerance maps to ("Milk") rather than what was ticked ("Lactose"). `SignalMember` now carries `ticks`, and a conflict carries `matchedLabels`.
- **`none_known` is selectable for a dish, and exclusive.** The old form hid it, so there was no way to say a dish had been checked. Combining it with an allergen is refused.
- **`listOpenIdeasForReview` now returns open ideas only.** It never filtered by status, so a declined or adopted idea stayed in the holder's inbox with its adopt and decline buttons and the tab count never fell. Found by declining an idea in the browser; there is a regression test.
- **`Modal` uses a per-instance title id.** A page with a dialog per dish otherwise pointed every dialog's `aria-labelledby` at the first heading.
- **Adding a kitchen starter question closes the full starter-set review**, because `hasProfileQuestions` counts any question. That is the guard's existing meaning ("a community that added one by hand has decided"), left as is.

**Known and left alone (not in scope, worth a decision):**

- **Open ideas on a published menu are stranded.** When a holder starts a new draft, the suggestions filed against the old, published plan stay `open` and never reach the new inbox; the suggester sees "waiting" for ever. Carrying open ideas forward in `createMenuPlan` is a few lines but changes behaviour nobody asked about.
- **The purchase list groups by name only, not unit.** "Flour 1 kg" and "flour 2 cups" add to "3 kg". The plan called exact-name grouping honest, but it was written about *names*; mixing units under one name is a different problem.
- **Every member who has shared an answer is treated as eating every meal** — true only on a standing menu now. An event's menu narrows to who could be there (see the follow-on at the foot).
- **Diet (vegetarian, vegan, halal, kosher) and dish diet tags** — Q4, still a follow-up.

---

## Follow-on: meals from arrivals and departures (built 2026-10-25)

Asked for after the redesign: arrival and departure should feed meal numbers when we have them, with optional times, default breakfast/lunch/dinner times, a first and last meal, and overrides. The decisions, as built (`src/lib/kitchen/attendance.ts`; the schema is in migration 0120, with the rest of the Kitchen's; the CHANGELOG entry has the detail):

- **Everything optional on every side; information narrows and absence never excludes.** Dates rule people out, a first/last meal beats a clock time, and an arrival or departure day that can't be placed is counted and flagged as uncertain.
- **Defaults and overrides:** the built-in meal times (08:00, 12:30, 19:00) are overridden per menu (`menu_plan.meal_times`), then per meal (`meal.time`); a person's own first or last meal outranks inference from times.
- **Headcount source** is `manual` or `participation` per meal, plus `guests`; derived on read, never stored; "from arrivals" is refused on a standing menu.
- **Maybes** are shown and never counted. **Coming with no dates** is assumed there throughout the event. **Published menus** keep the number live, since the shopping list is holder-only.
- **The dietary check** covers everyone who could be there (not "not coming", not ruled out by dates), erring wide on purpose; unlike the headcount, which counts only "coming". This closes the attendance gap listed above.

Still open: the arrival-day and departure-day rule counts both days when nothing is said. If over-ordering on those days becomes a real cost, the next step is asking members for a first/last meal at the moment they say they're coming.
