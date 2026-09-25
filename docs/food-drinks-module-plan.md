# 🍲 Food & drinks module — build plan

*Restoring module 9 of the original Peach Please spec (`docs/peach-please-platform-spec_v0.5.md`), which was dropped during genericization, as a real optional module of the generic engine — permission-grant-gated by a task like every other module here. Not a Peach-Please-specific script: it fits any community that serves shared food — a camp kitchen, a coop's communal dinners, a retreat — with the same task-granted access model every other module uses.*

---

## Why this exists

`docs/spec.md` (the genericized spec) kept most of the Peach Please design, generalized. One module didn't survive the extraction: **Food & drinks (Fruit)**. The roadmap doesn't list it as deliberately deferred — it was simply never picked up, so it's a genuine gap, not a ruled-out stretch goal.

The original spec's text (v0.5, §9, with the Fruit branch and privacy passages):

> **9. Food & drinks (Fruit)**
> Menu with dietary/allergy constraints from module 7. Food schedule. Ordering and equipment lists (tasks). Cooking (shifts).
>
> **Participatory input** — members can suggest recipes, request a dish, and indicate preferences for drinks, snacks, and breakfast items. This feeds the planning process rather than replacing it — the person owning the relevant menu task reviews input and makes decisions, but the input comes from the community. How these inputs map to specific tasks (main menu, snacks/breakfast, drinks) is left for the Fruit coordinator to define — the module just needs to collect and surface that input.

With, elsewhere in the same document:

- **Fruit branch**: "Everything eaten and drunk." tags: `menu` `ordering` `kitchen` `food shifts` `equipment`.
- **Transparency & access**: "Access follows the task, not the role. Owning a task in Fruit gives you the dietary access you need to do it. Not working on food, no access."

Two of the five spec'd features already have generic homes and need no new machinery — the plan below reuses them deliberately:

| Spec feature | Already exists in the engine | This module adds |
|---|---|---|
| Ordering & equipment lists | Ordinary Tasks (+ Task resources for order forms/links) | A "supply tasks" lens on the menu page |
| Cooking | Shifts module's `ShiftSeries` (a cooking roster is just a series) | An optional meal → series link field |
| Dietary/allergy constraints | Sensitive-data module already collects `member.allergies` | The menu constraint panel, unlocked by a new field→grant route in the sensitive-data module (D3) |
| Menu + food schedule | — | `menuPlan` / `meal` / `dish` entities (the genuinely new surface) |
| Participatory input | Input rounds exist, but are batched question rounds, not a reviewable inbox | `foodIdea` (suggestion box with adopt-into-menu) |

The menu-with-dietary-constraints is the one feature that had no generic home — that's why the module was lost wholesale rather than partially. This plan builds exactly that, on the engine's own primitives.

---

## 🎯 Goal

A **Kitchen** optional module: a per-scope menu plan (draft → published), meals on a plain absolute date, dishes as recipes (ingredients with amounts + a serving count) that scale to each meal's headcount into a purchasing list, dietary-conflict surfacing gated by the existing sensitive-data machinery, participatory input members can file and the kitchen owner reviews (adopt → menu), and a published read view for everyone — all gated the same way every other module is: one `kitchen` grant that any task working in the module can carry (multi-grant, `branch_coordination`'s shape), and whoever currently holds one of those tasks is a kitchen owner for its scope.

**Scope boundary:** meals, recipes (ingredients + serving counts) with headcount scaling into a purchasing list, ideas inbox, dietary constraints, supply-task lens, cooking-roster link. Out of scope (deliberately): table reservations, per-dish cost tracking (Budget's `lineItems` already covers food cost), anything that needs member health data beyond allergies, and the shared date-recipe streamline (D6 — a separate cross-cutting sweep that `meal` folds into).

---

## ✅ Resolved decisions

The original spec is a draft, not a schema — the codebase's convention is to resolve ambiguity in the doc, with reasons, before building. Each decision below names what the spec leaves open and why this resolution.

### D1 — One `menuPlan` container per scope, publish-gated like event scheduling

A `menuPlan` row is the named, dated container the meal schedule lives in (mirrors `budgetCycle`'s one-per-cycle shape). It carries a single `publishedAt` timestamp that does double duty the way `eventProposal.publishedAt` does: **a draft menu is owner-visible only; a published menu is community-readable, and publishing locks further edits.** No separate `status` field — one gate, not two.

*Spec basis:* "Food schedule" (§9) and event planning's own "locks proposals, and the schedule is published" (a pattern the spec already establishes, so the food module inherits the same posture rather than inventing a second publish mechanism).

### D2 — One `kitchen` grant, multi-grant: any task that works in the module can carry it

The module is granted the way `branch_coordination` is: **a new `kitchen` module key in `permissionGrantModuleEnum`, multi-cardinality (added to `MULTI_CARDINALITY_MODULES`), `cycle` tier** — scope travels on each granting task's own placement (`task.cycleId`): a task placed in cycle C owns cycle C's menu, a cycle-less task is the community/evergreen "standing menu" role. **Every holder of any task carrying the grant exercises the full module for that scope** — build/publish the menu, review the ideas inbox, and (once the community links the allergies field to the kitchen grant, D3) the dietary read. One grant, full access, on however many tasks the community decides; no per-feature or per-view splitting.

*"Single vs multi" is a setting, not a kind:* every module here is the same mechanism — one `permissionGrant` row (task grants module), the same enforcement helpers, the same settings UI. Phase 63 retired the old mixed shapes (Community's scalar `conflictTeamTaskId`/etc. columns and the tag-match gates for admin/branch_coordination/support) in favor of this one table. What still varies per module is two policy knobs on it: **cardinality** (can more than one task grant this at a time? admin/branch_coordination/support yes, everyone else at most one per scope) and **scope tier** (what the granted task's placement means — `cycle`, `community`, or `cycle_variant`). `kitchen` simply gets one combination of those knobs; it is not a new kind of grant. (The one intentional oddity: `budgetCycle.ownerTaskId` is a pre-grant-table per-entity pointer that predates this model and was never migrated — the menu plan below deliberately does *not* copy it; owner comes from the grant, full stop.)

*Why the coordinator task isn't the grant:* branch coordination and menu planning are different jobs. The Fruit **coordinator coordinates tasks** — waiving requirements, pings, escalations — which is the existing `branch_coordination` grant's business, not this module's. The `kitchen` grant belongs on the **menu-planning task**, and on any task that actually works in the module (a snacks/breakfast task, a drinks task). A coordinator who also plans menus holds a slot of the menu task like anyone else; coordinating Fruit does not, by itself, open menus or allergies.

*Spec basis:* Food & drinks' authority follows the food-working task — §9's reviewer is "the person owning the relevant menu task" — and the branch-coordination passages never claim menu access. The kitchen is split across several tasks (main menu, snacks/breakfast, drinks) but the spec names no permission wall between them: "How these inputs map to specific tasks ... is left for the Fruit coordinator to define" is about *which task reviews which input* — routing the coordinator handles inside the module, not a permission split. Hence one key — `kitchen` — rather than a settings panel of near-identical modules.

*Why it's cheap:* every surface that manages grants — the settings **Access & permissions** tab, the task-detail **"Permissions granted by this task"** checkboxes, the **proposal activation** flow — renders from `PERMISSION_MODULE_KEYS`/`PERMISSION_MODULE_LABELS`/`PERMISSION_MODULE_HINTS`/`PERMISSION_MODULE_SCOPE_TIER` (`src/lib/permissions.ts`) and already branches on `allowsMultipleGrants` for multi-cardinality modules. Adding `kitchen` to those constants makes it appear everywhere with the existing multi-grant semantics (`addPermissionGrant`) — no bespoke grant UI anywhere.

### D3 — Dietary constraints: the sensitive-data module gains a "field unlocked by a permission grant" route

"Menu with dietary/allergy constraints from module 7" (§7 is Health/emergency/allergies). Allergies are already collected by the sensitive-data module (`member.allergies`) and gated by `SensitiveFieldAccessRule` + per-read consent re-check (`getSensitiveDataTable`). The food module **does not collect or bypass any of that** — instead, the sensitive-data module grows its third unlock route so fields can hang off a *grant* rather than a specific task:

1. **The new route:** `SensitiveFieldAccessRule` currently unlocks a field by `unlockedByTaskId` (hold this task → field) or `unlockedByTierId` (be in this tier → field). It gains **`unlockedByGrantModuleKey`** (hold any task granting this permission module → field), with the same "exactly one of the three routes per row" rule. That's the general capability — any permission grant can unlock any field, and Kitchen is the first consumer — and it's the answer to multi-grant awkwardness: the community links the `allergies` field to the `kitchen` grant **once**, in the same sensitive-data settings editor. No per-task rules to keep in sync as tasks get granted or un-granted.
2. **Field scope is deliberately community-wide:** a sensitive field is one community record — a member's allergies don't differ by cycle — so the grant route checks "does the actor currently hold any task granting `kitchen` in this community," with placement not narrowing it. That is the spec's "access follows the task" made concrete one level up: hold any kitchen task → allergies; stop holding them all → the access is gone. (The task/tier routes stay for communities that want a narrower or non-grant-driven unlock.)
3. **Reads:** `src/lib/kitchen/dietary.ts` computes the constraint panel through `listUnlockedFields(actor)` — the same gate the `/sensitive-data` page uses, extended for the new route — plus the same per-read active-consent re-check. A kitchen holder who isn't unlocked for `allergies` (or a community with the sensitive-data module off) gets the menu with dishes but no "may conflict with N members" column. Nothing in the food module ever sidesteps consent.

*Honest limit, named:* the constraint panel is a *signal for the planner*, never a medical guarantee — see D4.

### D4 — Dish dietary flags: a small fixed allergen set + free-text note; matching is keyword containment, surfaced as a signal

Each `dish` carries `allergenFlags` from ONE fixed enum — `milk · eggs · fish · shellfish · tree_nuts · peanuts · soy · wheat_gluten · sesame · none_known` — plus a free-text `dietaryNote`. The constraint panel then matches each flag's keyword against `member.allergies` free text (plain case-insensitive containment) and shows: *"Contains peanuts — 3 members have nuts/peanuts recorded; verify before serving."*

*Resolved because:* the alternative — free-form tags per dish — forfeits the one thing the spec explicitly asks for ("dietary/allergy constraints"), since nothing can cross-reference free-text against free-text without a shared vocabulary. A fixed, small set is the same posture the codebase already takes on the other side of this wall: `SensitiveFieldKey` is a fixed enum with "spec's own example list is short" as the stated reason. `member.allergies` stays free text (it's about what *one person* can't eat), the flags are bounded (about what *a dish* demonstrably contains), and the match between them is deliberately plain — flagged as "may conflict, check", never asserted as fact. A community that doesn't want allergen modeling simply leaves the flags empty and uses it as a plain menu.

*The less-common case, handled:* a member with an allergy outside the known set already types it into `member.allergies` — free text, the sensitive-data module's collection, no change here. That text can't keyword-match a dish flag, so the panel is honest about it: known-set matches are automatic, and the panel invites the holder (who holds allergy read access via the rule) to consult the underlying records for what the flags couldn't catch. The dish side is symmetric — `allergenFlags` for the common set, `dietaryNote` free text for everything else ("contains celery", "cooked with mustard"). The enum is a convenience shortcut for the 90% case, never the boundary of what gets recorded.

### D5 — Participatory input is a dedicated `foodIdea` inbox, deliberately separate from Input rounds

The spec asks the module to "collect and surface that input" where the owner reviews and decides. That's a **persistent, reviewable suggestion inbox**, not a batch. A dedicated `foodIdea` row (kind: `recipe_suggestion · dish_request · preference` — the spec's own three kinds), with an owner review flow: adopt (creates a `dish` in one step, links back) or decline (optional reason, same optional-reason precedent as join-request declines).

*Why not just Input rounds?* The two mechanisms are genuinely different jobs, and the spec's own later design already sorts them: Input rounds are batched, weekly, closed-choice-leaning questions whose answers inform a task owner's existing decision ("the breakfast case"). Food ideas are open-ended, persist until acted on, and the platform *does* act on them (adopt → dish) — which is exactly the test `spec.md`'s Forms section draws for when a thing earns its own shape over a generic input mechanism ("does the platform need to act on the specific fields, or does a human just need to read them?"). They compose rather than compete: a food owner can still pose "pancakes / oatmeal / eggs" as a quick Input-round poll on their menu task, while `foodIdea` carries the open-ended suggestions that need a review decision. That boundary is documented here so the next person touching either mechanism doesn't blur them.

### D6 — Meal dates: v1 is a plain absolute date; the shared date shape's streamline comes later

`meal.date` is a straightforward absolute date in v1, plus an optional `phaseId` when a phase is the natural anchor ("build-week dinners"). The shared absolute/relative recipe (`src/lib/dates/resolve.ts`) is getting an acknowledge pass at streamlining separately — it's clunky today and touches every dated entity — so `meal` deliberately doesn't bake today's recipe shape in; when that sweep lands, `meal` folds into it like every other dated table. Skipping the relative modes for v1 costs nothing: they were the "2 days before Teardown" nicety, and a menu plan is editable when the schedule shifts anyway.

### D7 — Cooking and supply are lenses over existing primitives, not new entities

- **Cooking** → a `ShiftSeries` (shifts module). `meal` gets an optional `shiftSeriesId` so the roster for "Friday dinner" is one click from the meal. Meaningless when the shifts module is off (field stays null; the meal stands alone).
- **Ordering & equipment** → ordinary tasks. The menu page adds a "supply" lens: tasks in the menu's scope tagged/branched for food supply (the Fruit branch's `ordering`/`equipment` tags in the reference case — community-defined, never hardcoded), with their Task resources visible. One database, many lenses — zero new storage.

### D8 — Recipes with serving counts scale to a meal's headcount and inform purchasing

The menu isn't just what gets eaten — it's the source of the shopping list. Each `dish` is a recipe: `serves` (how many people the recipe as written feeds) plus `dishIngredient` rows — free-text `name`, numeric `amount`, free-text `unit` — each recorded at recipe-as-written scale. Each `meal` carries an optional `headCount` (planner-entered expected eaters). The scale factor is `meal.headCount / dish.serves`, and the menu page renders:

- **Per dish:** the scaled ingredient amounts ("chili — 3× → 1.5 kg"), clearly derived — amounts are stored at recipe scale, scaling is a read, never written back.
- **Per meal:** a purchasing list — scaled amounts across the meal's dishes grouped by exact ingredient name, with a per-dish breakdown alongside. Grouping by exact text name is deliberate and honest: "flour" and "plain flour" don't merge, and a glance catches it.

That list is what actually guides the ordering task (the D7 supply lens) — a community copies or links it into its supply task's notes/resources. When a meal has no headcount, its dishes render at recipe scale and no purchase list is computed — the machinery stays dormant rather than guessing. *Spec basis:* §9 lists "ordering" as part of the module; the headcount/scale mechanism is the bridge between the two halves (menu → purchasing), resolving the spec's silence on quantities with the engine's own free-text-preferred primitives.

### D9 — Module wiring is constants-driven; the spec doc gets restored alongside the code

`kitchen` lands in `MODULE_DEFINITIONS` (settings Modules tab) and the permission constants (grant surfaces) — both already render any entry generically, so there is no bespoke settings UI. And `docs/spec.md` gets the module restored (Optional modules list + a module-entities block) in the same step, since that's where the loss happened — a plan is only complete if the spec and the build agree.

---

## 🗄️ Data model

New file `src/db/schema/kitchen.ts`, one table at a time in the codebase's existing style (real FKs, inline rationale comments, no circular imports — this file imports `community`/`cycle`/`phase`/`member`/`task`/`shift`, none of which import it back).

**`menuPlan`** — one per scope (cycle-placed or the cycle-less standing menu), the publish gate:

| Field | Type | Notes |
|---|---|---|
| id | uuid pk | |
| communityId | uuid → community | |
| cycleId | uuid → cycle, nullable | null = standing menu (cycles off, or the evergreen role) |
| title | text | e.g. "Season 2027 menu" |
| publishedAt | timestamp, nullable | null = draft, owner-only + editable; set = published, community-readable + locked (event-scheduling posture) |
| createdBy | uuid → member | |
| createdAt | timestamp | |

**`meal`** — one row per dated meal on the menu, the "food schedule":

| Field | Type | Notes |
|---|---|---|
| id | uuid pk | |
| menuPlanId | uuid → menuPlan | |
| label | text | free-form — "Friday dinner", "Build-week lunch"; no fixed meal-type list (no-fixed-category-list precedent) |
| date | date, not null | plain absolute date in v1, D6 (folds into the shared date shape's later streamline) |
| phaseId | uuid → phase, nullable | optional phase anchor |
| headCount | int, nullable | planner-entered expected eaters — the scale baseline, D8 |
| shiftSeriesId | uuid → shiftSeries, nullable | optional cooking-roster link, D7 (only meaningful with shifts on) |
| notes | text, nullable | |
| createdAt | timestamp | |

**`dish`** — a menu item on a meal:

| Field | Type | Notes |
|---|---|---|
| id | uuid pk | |
| mealId | uuid → meal | |
| name | text | |
| description | text, nullable | |
| serves | int, nullable | people this recipe as written feeds — the scale base, D8 (null = no scaling) |
| allergenFlags | text[], default [] | bounded to `ALLERGEN_FLAGS` (D4) — validated at the application layer |
| dietaryNote | text, nullable | free-text extra ("served with bread, optional") |
| source | enum(seed, from_idea), default seed | seed = owner-entered; from_idea = adopted from a foodIdea |
| sourceIdeaId | uuid → foodIdea, nullable | set when source = from_idea |
| addedBy | uuid → member | |
| createdAt | timestamp | |

**`dishIngredient`** — a recipe's ingredient, recorded at recipe-as-written scale (D8):

| Field | Type | Notes |
|---|---|---|
| id | uuid pk | |
| dishId | uuid → dish | |
| name | text | free-form — "chili", "plain flour"; the purchase list groups by exact name |
| amount | numeric | at recipe-as-written scale; scaled by `headCount / serves` on read |
| unit | text, nullable | free-form — "kg", "tbsp", "clove" |
| sortOrder | int, nullable | keeps the recipe's written order |
| createdAt | timestamp | |

**`foodIdea`** — the participatory-input inbox (D5):

| Field | Type | Notes |
|---|---|---|
| id | uuid pk | |
| menuPlanId | uuid → menuPlan | |
| kind | enum(recipe_suggestion, dish_request, preference) | the spec's three kinds |
| title | text | |
| body | text, nullable | recipe details, context |
| suggestedBy | uuid → member | attributed — a cook may need to ask about a recipe; same no-anonymity posture as task comments |
| status | enum(open, adopted, declined), default open | reviewable inbox until decided |
| declinedReason | text, nullable | owner's optional note (join-request-decline precedent) |
| adoptedDishId | uuid → dish, nullable | set by the adopt action, which creates the dish in the same transaction |
| createdAt | timestamp | |

Plus `ALLERGEN_FLAGS` as a const in `src/lib/kitchen/dietary.ts` (same const-enum posture as `SENSITIVE_FIELD_KEYS`), NOT a DB enum — the flags are the schema's bounded vocabulary, and a `text[]` column with application-layer validation keeps future flag additions a one-line change rather than a migration.

---

## 🪪 Permission & access model

This is the load-bearing part, restated precisely:

1. **New module key `kitchen`** in `permissionGrantModuleEnum` (`src/db/schema/permission-grant.ts`).
2. **`PERMISSION_MODULE_KEYS`/`PERMISSION_MODULE_LABELS`/`PERMISSION_MODULE_HINTS`/`PERMISSION_MODULE_SCOPE_TIER`** in `src/lib/permissions.ts` — label "Kitchen", scope tier `"cycle"`, ADDED to `MULTI_CARDINALITY_MODULES` (D2 — one key, grantable to any task that works in the module, branch_coordination's shape). Hint, mirroring `branch_coordination`:
   > "Cycle-shaped — placed in a cycle, it owns that cycle's menu; cycle-less, the community/evergreen scope. Grant it to the menu-planning task and any task that works in the module. Members can still file food ideas without this set, but nobody can build or publish the menu until it is. A Fruit coordinator's task keeps its own branch_coordination grant — coordinating tasks isn't menu access."
3. **`MODULE_DEFINITIONS`** in `src/lib/modules.ts` — `{ key: "kitchen", label: "Kitchen" }`.
4. **`src/lib/kitchen/access.ts`** — `isKitchenOwner(actor, cycleId?)` / `requireKitchenOwner(actor, cycleId)`: **any** current holder of a task granting `kitchen` in the scope is an owner (multi-grant — resolve like `branch_coordination`'s holder lookup: `listGrantingTaskIdsForScope` + non-shadow `taskAssignment` join), with `event-scheduling/crud.ts`'s `cycleScopeCondition` deciding "which menu's meals count in this view." A `cycleId` of undefined = any scope; null = cycle-less/evergreen only.
5. **Dietary access:** no module-level shortcut. `src/lib/kitchen/dietary.ts` reads `member.allergies` only through `listUnlockedFields(actor)` — the sensitive-data gate with its D3 `unlockedByGrantModuleKey` route, which the community points at the `kitchen` grant once — **and** the same per-read active-consent re-check `getSensitiveDataTable` performs. Not unlocked → no constraint column, dish flags still render as plain notes.

All five land by editing constants + one small access lib. Every existing grant surface (settings Access & permissions tab, task-detail permission checkboxes, proposal-activation grant picker) picks the module up with zero bespoke UI — the Access tab's existing multi-cardinality rendering shows each granted task as its own row with a derived scope, exactly as `branch_coordination` does today.

---

## 🧭 UI surfaces

- **`/kitchen`** — the module's single surface (route named after the module, like `/event-schedule`).
  - *Everyone:* the published menu — meals in date order, dishes per meal, supply-task lens, published lookups only.
  - *Kitchen holder (per scope):* draft editing — create/publish the menu plan, add/edit/remove meals (absolute date + optional headcount), recipes (serves + ingredients), the **ideas inbox** (open ideas → adopt into a dish or decline), the **scaled purchasing list** per meal (D8), and (when unlocked for allergies) the **constraint panel** on each meal: dishes whose flags may conflict with members' recorded allergies, member count + names.
  - *Any member:* "Suggest something" — file a `foodIdea` against the active menu plan. Low-friction, one title; body optional.
- **Dashboard needs-action** — `listKitchenNeedsAction(actor)` mirroring `listEventSchedulingNeedsAction`: graceful `[]` for non-holders; for holders, open ideas awaiting review and draft menu plans awaiting publish ("draft menu for [scope] isn't published yet").
- **Nav** — one new entry in `src/lib/nav.ts`: `kitchen: isModuleEnabled(community, "kitchen")` (visible to all members once the module's on, like event scheduling; owner-only surfaces live inside the page).
- **Cycle scope** — same handling as event scheduling: an optional cycle filter on `/kitchen`, not a `[cycleScope]` path rewrite; the active scope resolves from the granting task's placement.

---

## 🛠️ Build steps

Sized the way the codebase already works — lib-first with tests, then UI, verification and CHANGELOG in the same commit as the code. (Per the repo's current convention, these are features, not numbered "Phase N" entries — and new work is documented in its own per-feature doc like this one, not in `docs/development-plan.md` anymore, which now only records the original phased build. This plan is the feature's living document; `CHANGELOG.md` records what got built.)

**Status: Step 1 complete** — `docs/spec.md` now restores the module: an Optional-modules entry (Kitchen, right after Spatial planning), a five-table module-entities block (`MenuPlan`, `Meal`, `Dish`, `DishIngredient`, `FoodIdea`), the sensitive-data field→grant route, and the module list line. Steps 2–7 remain.

**Step 1 — Spec restoration.** Re-add the module to `docs/spec.md`: Optional-modules list ("Kitchen — the spec's Food & drinks module: menu planning with dietary constraints, food schedule, participatory input, ordering/cooking as tasks + shifts"), a module-entities block (the five tables above), and a line in the Sensitive data section noting allergies now feed the menu via a field→grant route. *Done when:* spec and this plan agree; a reader of `spec.md` can find the module in the same place as Budget/Events.

**Step 2 — Schema + migration.** `permissionGrantModuleEnum` += `kitchen`; `kitchen.ts` (five tables — `menuPlan`, `meal`, `dish`, `dishIngredient`, `foodIdea`); `sensitive-field-access-rule.ts` += `unlockedByGrantModuleKey` (D3). *Done when:* migration up; tables present and commented.

**Step 3 — Permission wiring (incl. sensitive-data's third route).** `permissions.ts` constants (+ `MULTI_CARDINALITY_MODULES`), `modules.ts` definition, `nav.ts` entry, a smoking test that the three grant surfaces render it, **and** the sensitive-data field editor's third route — link a field to a grant module, honored by `listUnlockedFields`. *Done when:* an Admin can designate one or more tasks as kitchen grants from settings and the task detail page (multi-grant semantics, each row scoped by its task's placement — `branch_coordination` UX), and can link `allergies` to the `kitchen` grant in the sensitive-data settings; no module nav entry until the module is enabled.

**Step 4 — Access + menu/meal libs.** `access.ts` (owner resolution + scope condition); `menu.ts` (resolve active menu plan per scope — `getCurrentBudgetCycle` pattern, create, publish); `meals.ts` (CRUD on the shared date recipe, reusing `src/lib/dates/resolve.ts`). Tests against the disposable-Postgres harness used across `tests/*.test.ts`. *Done when:* owner logic and cycle-scope resolution covered; meals resolve relative dates correctly.

**Step 5 — Recipes, ideas, dietary libs.** `dishes.ts` (CRUD incl. `serves`, `ALLERGEN_FLAGS` validation, `adoptFromIdea` — creates dish + flips the idea in one transaction); `ingredients.ts` (ingredient CRUD at recipe scale + the `scaledIngredients`/`purchaseList` reads — scale factor `headCount / serves`, grouped by exact ingredient name); `ideas.ts` (file, list-for-review, decline-with-reason); `dietary.ts` (constraint panel behind the D3 `listUnlockedFields` route + consent re-check, keyword containment). Tests. *Done when:* adopt/decline flows, allergen validation, scaling correctness (incl. no-headcount → recipe scale), and the "not unlocked → no constraint data" path all pass.

**Step 6 — UI.** `/kitchen` (published read view, owner editing surface, recipe editor, ideas inbox + "Suggest something", scaled purchasing list, constraint panel, supply-task lens), dashboard needs-action wiring (`dashboard.ts` + the two existing surfaces that render it). *Done when:* a member can file an idea; the holder can review/adopt it onto a published menu; a meal with a headcount shows scaled amounts and a purchase list; non-holders see exactly the published view and never a constraint or purchasing surface; dashboard shows the holder's open work.

**Step 7 — Verification + docs.** Full test pass, manual verification against the real Docker Compose stack (per repo convention), `README.md`/`CHANGELOG.md` updated in the same commit, roadmap note that the module is restored (it was never listed as deferred). *Done when:* the module is demoable end-to-end, documented, and recorded.

---

## 🔭 Follow-ups (tracked, not open questions)

1. **Dates streamline (cross-cutting, separate effort).** The shared absolute/relative date recipe is getting an overhaul; `meal` starts with a plain absolute date (D6) and folds into that sweep like every other dated table. Nothing else on this module waits on it.
2. **Per-dish cost into Budget.** The scaled purchasing list is the natural input to a meal's cost line items (Budget's `lineItems` already covers food cost) — a copy/link when the purchase list lands in an ordering task via the D7 supply lens. Deliberately out of scope here.

Decision log: allergen flags — fixed set + free text (D4), ideas — attributed, no anonymity (D5), headcounts/recipes/scaling — built (D8), dates — absolute v1, streamline later (D6). Nothing in this module is left undecided.

---

*Living document. Grounded in §9 of the original Peach Please spec, generalized onto the engine's own permission-grant and sensitive-data machinery so it stays consistent with every other module here.*