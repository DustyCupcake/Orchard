# Cycle-Scope Remediation Plan — Task-Associated Permissions

**Scope of this plan:** every "task is the authority" permission — the nine current `PermissionGrant` modules plus Budget's owner task — and how their authority relates to cycles. It also designs two new modules — `backstop` (§2.5), the answer to `docs/spec.md:262`'s round-0 "fall-back holder" (implemented nowhere today), and `shift_management` (§2.6), which gives a cycle's shift roster a task-granted manager. The working principle, agreed with the user:

> **A permission granted by a task is scoped by where the task sits.** A task placed in a cycle scopes its permission to that cycle; a task placed in no cycle is a community/evergreen role. One placement field (`task.cycleId`) is the single source of truth — replacing the current two disconnected cycle notions.

This is a model change, not a bug-fix list, so it reads differently from the two audit remediation plans: current state → target model → backend work → interface work → locked decisions.

---

## 1. Current state: two disconnected cycle notions

The schema has **two** separate cycle associations, and the permission layer reads at most one of them:

| Mechanism | Where | Who reads it |
|-----------|-------|--------------|
| `permission_grant.cycleId` — a scope *on the grant row* ("this task's authority covers cycle X") | `src/db/schema/permission-grant.ts:47` | Only `event_scheduling_owner` + `spatial_planning` (Phase 68). Every other grant row has `NULL`. |
| `task.cycleId` — placement of the *task itself* | `src/db/schema/task.ts:45` | **No permission check anywhere** — the board (Phase 67), dashboard, and contribution read it; the permission resolvers never do. |

They can even disagree today: a scheduling-owner task can sit in cycle A while its grant names cycle B. Nothing in the code or UI connects them.

### 1.1 The nine PermissionGrant modules

All resolve "whoever — non-shadow — currently holds a granted task," via `listGrantingTaskIds` + a `taskAssignment` join. The only differences are which dimension the resolver keys on and whether a cycle is ever consulted.

| Module | Resolver | Locked onto | Cycle-aware? |
|--------|----------|-------------|--------------|
| `admin` | `settings/admins.ts:20` | any granted task | ❌ community-wide, all cycles |
| `branch_coordination` | `coordination.ts:21` | `task.branchId` of the granted task | ❌ branch-column; **spans every cycle** of that branch |
| `conflict_team` | `conflict.ts:18` | any granted task | ❌ community-wide |
| `feedback_review` | `forms.ts:370` | any granted task | ❌ community-wide — one reviewer reads every response |
| `recruitment` | `recruitment/access.ts:22` | any granted task | ❌ community-wide |
| `event_scheduling_owner` | `event-scheduling/conflicts.ts:23` | **grant row's** `cycleId` | ✅ per-cycle (Phase 68) |
| `spatial_planning` | `spatial-planning/access.ts:25` | **grant row's** `cycleId` | ✅ per-cycle (Phase 68) |
| `announcements` | `messages.ts:30` | any granted task | ❌ community-wide sends only |
| `support` (View-as) | `view-as.ts:20` | any granted task | ❌ community-wide (whole platform by design) |

Non-grant task authorities: **Budget owner** is genuinely per-cycle already — but via `BudgetCycle.ownerTaskId` + `BudgetCycle.cycleId` (`budget/voting.ts:28`), i.e. scoped through the BudgetCycle row, not the task's placement. **Shift coordinator** (`shifts/series.ts:142`) has no cycle association at all — per-series creator-or-`sourceTaskId` authority, standing work only. The plan's cycle form: shift series gain their own placement and roster management becomes a `shift_management` grant module (§2.6).

### 1.2 The interface is where the confusion is visible

- **Settings → Access & permissions** (`settings/page.tsx:145` `GrantField`): each row renders `task — branch`, and only for the two Phase 68 modules an extra `— cycle` segment from a **separate cycle picker**. The task's *own* placement is never shown, and the picker can name a cycle the task doesn't sit in. Single-cardinality copy says "only one task can hold this **per cycle**" — a scope concept none of the other seven modules have words for.
- **Task detail → "Permissions granted by this task"** (`tasks/[id]/page.tsx:1202`): one **"Cycle"** dropdown captioned "applies to Event scheduling owner / Spatial planning only," a checkbox per module whose checked state for those two is `scopes[moduleKey].includes(selectedCycleId)`, backed by `listGrantedCycleScopesForTask` — the API that exists *only* because one task can hold a module for several cycles via multiple grant rows. Three concepts (task's own cycle, the dropdown's cycle, checkbox scope) on one form.
- **Proposal activation** and **pack import**: the same `grantCycleId` plumbing (`proposals/crud.ts:122`, `tasks/[id]/actions.ts:785`).
- **Module hint copy** (`permissions.ts:36`): none of it mentions cycles, even for the two that are cycle-scoped.
- **Coordination surfaces**: `/coordination` and `/escalation` gate on `isCoordinationHolder(actor, null)` (any branch, any cycle); board badges use `listCoordinationBranchIds` (branch sets, all cycles); the coordinator's *own* scope is never visualized.

### 1.3 Known adjacent bug

The spec-audit plan (§3, `docs/spec-audit-remediation-plan.md`) already records that **cycle clone does not copy `PermissionGrant` rows** — a cloned cycle's coordination/admin tasks win candidacy but confer nothing. Per-cycle authority makes this bug central, not peripheral (see §4.4).

---

## 2. Target model

### 2.1 The rule

A granted task declares its scope by where it sits, and a scoped grant never leaks outside its scope:

- `task.cycleId = NULL` → **community scope** ("evergreen role").
- `task.cycleId = C` → **cycle scope**: the authority covers cycle C's data **only** — never another cycle, and never the community's unclaimed cycle-less data (that stays the community-scoped task's job).

(**Decided — D1:** community scope is *strict*. For cycle-shaped modules a cycle-less task covers only cycle-less data and never reaches into a cycle's; there is no fallback/precedence rule. See §6.)

`permission_grant.cycleId` is retired. A grant row becomes a pure "this task grants module M" fact; scope comes from the task. This kills both the disagreeing-mechanisms incoherence and the "one task, several cycle grant rows" special case.

### 2.2 Module tiers

The rule only bites modules whose authority is **cycle-shaped**. Three tiers:

| Tier | Modules | Placement rule |
|------|---------|----------------|
| **Community-shaped** — authority is inherently whole-community | `admin`, `conflict_team`, `support`, `announcements` (community sends) | Task must be cycle-less. A cycle-placed instance is a contradiction the interface prevents/warns rather than a silent scope loss. |
| **Cycle-shaped** — authority targets per-cycle data | `event_scheduling_owner`, `spatial_planning` (already), `branch_coordination` (new), `announcements` (new cycle variant), `backstop` (new), `shift_management` (new — cycle roster; community variant = standing series), `feedback_review`, `recruitment` | Placement is the declaration: in cycle C → that cycle; cycle-less → the community's cycle-less scope. `feedback_review` was `deferred` until §4.3's feedback half gave `formResponse` a cycle and shipped its scoping; `recruitment` completes the same move in §4.3's recruitment half (work-plan 8b–8d). |
| **Standing structures** — no cycle by nature | evergreen tasks, cycle-less events/plots, standing shift series | Served by community-scoped tasks only. Shifts straddle this line — standing *series* stay here, but a series can also be placed in a cycle (§2.6) to form that cycle's roster. |

**User decisions locked for this tiering:** conflict stays community-level (conflicts are relationship-shaped, not cycle-shaped); community-level roles live as cycle-less tasks — the original "carry admin forward until the next cycle's admin task" idea is dropped in favor of "community-level things just exist as tasks that are not cycle scoped."

**Announcements gains a cycle variant** (§4.5): the same module, but a task placed in cycle C gates sends to cycle C's roster, coexisting with the community-scoped task for community-wide sends.

**Shift management gains the same dual form** (§2.6): a task placed in cycle C manages that cycle's shift roster; a cycle-less task manages the community's standing series — the grant path becomes the *only* authority, replacing today's creator/`sourceTaskId` routes (D10).

### 2.3 Cardinality per scope

The current split — three "multi-cardinality" modules vs six "single-pointer" — becomes **single-cardinality per scope**: at most one granting task per (module, scope). A community gets one community-scoped instance *and* one instance per cycle, instead of one global pointer (today's six) or "one task owning several cycles via stacked grant rows" (Phase 68's workaround). Multi-cardinality modules (`admin`, `branch_coordination`, `support`) keep allowing several tasks within one scope, exactly as they do within one branch today. The new `backstop` module is single-cardinality: at most one backstop task per scope (one per cycle, plus at most one community/evergreen backstop). `shift_management` is single-cardinality per scope too — one manager per cycle roster, one for the community's standing series (Q10). (**Decided — D2:** one scope per task; the Phase 68 "one task, two grant rows, two cycles" stacking case becomes two tasks — cycle clone supplies the second.)

### 2.4 Coordination resolution (the branch → cycle question)

Coordination keeps today's branch-column behavior **and** gains a cycle-row mode, resolved by one precedence rule:

- A coordination task placed **cycle-less** in branch B → covers **column B**: every task in branch B, all cycles — **today's behavior, unchanged**.
- A coordination task placed in **cycle C** → covers **row C**: every task in cycle C, all branches. This is the "cycle coordinator" for a small cycle — one person wrangling the whole cycle.
- Coverage is the **union** of the holder's coordination tasks' row/columns. A holder with a cycle-less task in branch B *and* a cycle-C task covers both.

This is "cycle coordination **instead of** branch coordination" in the small-cycle case: the community simply places its coordination task in the cycle, and the strict "never leaks outside its scope" rule keeps it from also (or instead) grabbing a branch column. Note the deliberate consequence, spelled out in the earlier discussion: a cycle-scoped coordinator does **not** cover the cycle's evergreen tasks (those belong to a community-scoped coordination task).

### 2.5 Backstop: the responsible party (new module)

A **backstop** is not a coordination variant — coordination's job is to *find* someone; the backstop's is to be the person *accountable* that a critical task in the scope doesn't go unanswered, and to be the named party behind it when coordination can't fill it. It lands here because it is the plan's answer to the spec's round-0 "fall-back holder" text (`docs/spec.md:262`), which is entangled with coordination there and implemented nowhere in code. Resolved as a new `backstop` grant module — **cycle-shaped with a community variant, like announcements**: a task placed in cycle C → cycle C's backstop; a cycle-less backstop task → the community/evergreen backstop, covering cycle-less criticals under D1. By the same "access follows the task" pattern, the position survives handoff because it *is* a task.

**Locked (D5):**

- **Standing role + fallback layering.** The backstop is a standing oversight position — a critical backstop task (single-slot, `backstop`-granted) whose first holder is auto-claimed to the cycle's `startedBy` (D6, transferable) — with the spec's fallback duty layered on: if a critical task stalls or sits unfilled, the backstop is the person responsible for getting it moving, including by claiming it themselves through the ordinary claim path (the role never needs its own special claiming power).
- **Unclaimed criticals stay unclaimed and open (no auto-hold).** When a critical task's browse window closes with no takers, the task remains *unclaimed* and keeps hard-flagging per the existing attention rule — visibly open for anyone, including newcomers, to claim. It is listed in the backstop's **duty view** (every critical task in scope: unclaimed / browse-open / hard / escalated / current holders), and the board marks it **"Backstop: {name}"**. That doubling does recruitment work for free: an unfilled critical with a named backstop is exactly the "important task that could be in better hands" signal a new member should see, while the open state keeps it claimable.
- **Escalate-only.** The backstop's one action: put any stalled task in their scope onto the shared escalated queue (view *and* escalate for their own scope). No waive, no nominate, no messaging — coordination's powers stay coordination's.
- **Status-level oversight view.** The backstop sees critical-task statuses, attention flags, the escalated queue, and whether the scope's coordination tasks are filled or flagged ("did coordination manage to find someone"). The raw diagnostics (signals, pings, declined join requests, engagement patterns) stay in coordination's lane.

**Interactions.** Orthogonal to the §2.4 coordination precedence — the escalated queue gains a second viewer class (the scope's backstop) alongside community-wide coordination. Every cycle that runs with a backstop should create its backstop task at kickoff (§4.7); the community variant is a plain cycle-less task. Relies on §4.4 (clone copies grants) so a cloned cycle arrives with its own backstop.

### 2.6 Shift rosters: standing series vs cycle rosters (new `shift_management`)

The current shift model (`src/db/schema/shift.ts`) is entirely community-standing: a `shift_series` carries `communityId`, optional `branchId`, optional `sourceTaskId`; authority is per-series — the series' creator, or whoever holds `sourceTaskId` (`isShiftCoordinator`, `shifts/series.ts:142`). Nothing in it is cycle-aware. This plan gives shifts a cycle form on the same "placement is the declaration" rule tasks use:

- **`shift_series.cycleId` (new, nullable).** A series placed in cycle C is part of **that cycle's roster** — roster = every series placed in the cycle; no separate roster table (Q8). Occurrences and signups inherit the scope through their series, so no cycle columns are needed on `shift_occurrence` or `shift_signup` — they count as cycle-keyed by placement, exactly the way tasks are.
- **`shift_management`, a new grant module** (cycle-shaped with a community variant, like announcements). A task placed in cycle C granted `shift_management` manages **cycle C's roster** — create in-cycle series, generate occurrences, list signups, mark no-show, archive/unarchive. A cycle-less `shift_management` task manages the community's **standing series**. The grant path is the *only* authority: the per-series creator/`sourceTaskId` routes are removed (D10).
- **Roster sign-ups open as one act, one-way (D11).** Until the shift manager of cycle C opens them, the roster *collects*: `cycle.shiftSignupsOpenedAt` is null, sign-ups are closed, and the roster is visible-but-not-claimable ("coming"). Opening is a single irreversible act by the cycle's `shift_management` holder (Q14), releasing every series in the roster at the same time.
- **Who can compose the roster.** During the collecting window, *any member* can place a series in cycle C — direct, part of the batch the open act releases (Q12). After the roster opens, additions stay possible but land as **proposals**: the shift manager must confirm them before they become visible and claimable (Q13). Re-placing an existing series into a cycle is a manager action either way; standing series are manager-added (D10). A community with no shift-management task at all shows the honest gap any single-pointer module shows — and now its cycle rosters simply stay closed.
- **Sign-ups.** Once a series is confirmed and its roster is open, any member signs up first-come to capacity exactly as today; withdraw before start unchanged. Standing series keep today's always-open sign-ups.
- **Clone carries the roster, with relative timing.** Cycle clone (clone-previous) copies the cycle's shift series and re-derives occurrence timestamps against the target cycle's dates using the same relative-boundary machinery phases/milestones already use (`deriveClonedBoundaryRecipe`, `cycles/crud.ts`) — offsets from the source cycle's `startDate` applied to the target's, not absolute datetimes copied over (§4.8).

Interactions: another cycle-shaped module whose scope is the placement of its task — orthogonal to coordination (§2.4) and backstop (§2.5). Depends on the unified resolver (§4.2) and replicates per scope through cycle clone (§4.4), so a cloned cycle brings its own shift-management task with its own roster.

---

## 3. Does placement-as-scope cost us on compute?

Short answer: no — it is strictly cheaper than today, and the two things that do cost are handled by machinery that already exists.

- **Fewer special cases.** Today's resolver surface is: seven modules with grants always `NULL`-scoped, two modules with `grant.cycleId` scoping plus a `listGrantedCycleScopesForTask` array API to diff per-cycle checkboxes, and the settings UI branching on `CYCLE_SCOPED_MODULES`. Under the new model every resolver is the same join with one filter (`task.cycleId`), and `listGrantingTaskIds`'s third argument disappears.
- **"Which cycle am I in" is already plumbed.** Item-level actions (waive a task, review a proposal, edit a plot) derive the cycle from the item itself — the identical pattern Phase 68 already uses for the two cycle-shaped modules. Page-level gates (coordination queue, dashboard, board) already resolve the view scope via the `[cycleScope]` route segment / `resolveViewScopeCycleForMember` from Phase 67. No new cycle-resolution machinery.
- **The one real loss:** a single task can only carry authority for **one** scope. Phase 68 could stack "task owns cycle 1 *and* cycle 2" via two grant rows; the new model says one scope per task. The answer is one task per scope — and because **cycle cloning copies tasks**, per-scope authorities replicate by construction (§4.4). That turns a limitation into the model's main structural advantage: a cloned cycle arrives with its own coordination, scheduling-owner, and spatial-planning tasks already sitting in it.
- **The one genuine policy question, not a query one, is now decided (D1):** a community-scoped (cycle-less) task in a cycle-shaped module covers only cycle-less data — strict, matching shipping Phase 68 behavior and keeping "permissions remain in the cycle" airtight.

---

## 4. Backend work

### 🔴 4.1 Kill the dual mechanism (the core change)

**Fix:** stop reading/writing `permission_grant.cycleId`; make every resolver filter on the granting task's `task.cycleId`. **Decided (D8): no deprecation window** — only a test instance exists, so the conflicts below are backfilled and the column dropped in the *same* migration rather than held for a release.

**Backfill conflicts to surface** (rare, but real from Phase 68): a grant row names cycle B while its task sits in cycle A → migrate the task to B only if its `cycleId` is `NULL`; if both are set and disagree, leave the task as-is and log the row for a human (the two-cycle-stacking case, §6 D2, is the only source of this).

**Files:** `src/lib/permissions.ts` (`listGrantingTaskIds`, `setPermissionGrant`/`addPermissionGrant`/`removePermissionGrant`, `CYCLE_SCOPED_MODULES`, `listGrantedCycleScopesForTask` → deleted), `src/db/schema/permission-grant.ts`, all nine resolvers (§4.2), every call site that passes a third arg (`event-scheduling/conflicts.ts:24`, `spatial-planning/access.ts:30`, `spatial-planning/page.tsx:101`). **Effort:** Large — but most of it is deleting.

### 🔴 4.2 One resolver shape for all nine modules

**Fix:** standardize each resolver on "holder of a granted task whose `task.cycleId` matches the target scope (or `IS NULL` for community scope)." Concretely:

- `event_scheduling_owner` / `spatial_planning`: replace the `permissionGrant.cycleId` filter with `task.cycleId = targetCycleId` (or `IS NULL`). Behavior to tests: bit-for-bit unchanged for existing data post-migration.
- `branch_coordination`: add the precedence rule from §2.4 — support filtering by the target task's cycle (new `isCoordinationHolder(actor, { branch, cycle })` shape or a second function), keeping the branch-only call sites working on column semantics.
- `feedback_review`: **scoped — done in §4.3's feedback half** (`908f36c`): the reviewer resolves against the target *response's* `formResponse.cycleId` via `listHeldFeedbackReviewScopes`, the same per-item resolution the two Phase 68 modules already use. `recruitment` completes the identical resolution in §4.3's recruitment half — authority lands first (work-plan 8b), ahead of the per-cycle intake that furnishes the cycle-tagged applications (8c).
- `admin`, `conflict_team`, `support`: no resolution change — but they become cycle-less-only by construction, so their resolvers should read "any granted cycle-less task," which is what they already get once grants are placed cycle-less.

**Files:** `src/lib/coordination.ts`, `src/lib/event-scheduling/conflicts.ts`, `src/lib/spatial-planning/access.ts`, `src/lib/forms.ts`, `src/lib/settings/admins.ts`, `src/lib/conflict.ts`, `src/lib/recruitment/access.ts`, `src/lib/messages.ts`, `src/lib/view-as.ts`, plus every call site currently passing `branchId` (`signals.ts`, `coordinator-ping.ts`, `join-requests.ts`, `waive.ts`, `messages.ts:152`, `board/page.tsx`, `tasks/[id]/page.tsx`, dashboard, nav). **Effort:** Large (thread the target scope through ~20 call sites, most mechanical).

### 🟠 4.3 Cycle-key the data the cycle-shaped authorities govern

**Fix:** the data layer must know which cycle an item belongs to before authority can "remain in the cycle." Executed in two halves — the **feedback half** (shipped) and the **recruitment half** (this pass, specified below).

**Feedback half — done (`908f36c`).** `form_response.cycle_id` exists (spec already lists `response.cycle_id`: `docs/spec.md:867`); `submitFormResponse` accepts an in-community `cycleId`; `/feedback` carries a cycle picker and tags each response; `feedback_review` scoped `deferred → cycle` via `listHeldFeedbackReviewScopes` — a review task placed in cycle C reads only C's responses, a cycle-less task is the community/evergreen reviewer covering everything including untagged.

`conflictReport` deliberately stays **unkeyed** — conflict remains community-level (§2.2).

**Recruitment half — the cycle-shaped intake and authority** (the plan's "genuinely unresolved" recruitment item, `docs/development-plan.full-archive.md` "Beyond"). Recruitment becomes event-driven intake; applications are cycle-keyed for free by the feedback half's `formResponse.cycleId`:

- **Authority (tier `deferred → cycle`).** `recruitment` resolves exactly like `feedback_review`: `listHeldRecruitmentScopes(actor)` = the `task.cycleId`s of the recruitment-granted tasks the actor holds (the `null` community scope included). A recruitment task placed in cycle C evaluates **only** cycle C's applications (`formResponse.cycleId = C`); a cycle-less task is the community/evergreen reviewer covering every application, its own-cycle and untagged. Application listing, evaluation filing, objections, and decisions all resolve against the candidate response's cycle this way, so a cycle-placed evaluator can only act on their own cycle's applicants. Inquiries stay any-holder — an unkeyed community-wide inbox, not a cycle thing.
- **Per-cycle joining configuration** (new `cycle` columns): `recruitmentApplicationFormId` (uuid pointer, the same non-FK pattern as the community's; null → falls back to the community's form), `applicationsOpen` (default true), `invitesOpen` (default true), `joiningInviteMode` `direct | referral` (default `direct`), `joiningWindowClosesAt` (nullable). A cycle's **joining period** runs from the close of its returning-priority window (`returningWindowClosesAt` — existing members declare first) or cycle start if none, until `joiningWindowClosesAt` (null = until the cycle closes). **Both doors are shut outside that period** and **shut once capacity is reached** ("recruitment opens against whatever capacity remains" — the *displayed* number stays un-clamped per spec's "not a special case"; the *door gate* is the policy).
- **Per-event application.** `/apply?cycle=C` renders cycle C's form (the cycle's, falling back to the community's), requires C's joining period + `applicationsOpen` + capacity room, and tags the submission `cycleId = C`. The general `/apply` is unchanged — the community's standing door.
- **Community-wide door toggles** (new `community` columns `recruitmentApplicationsOpen` / `recruitmentInvitesOpen`, default true): close the *general* cycle-less doors so a community can run fully closed except for the cycles/periods it opens.
- **Cycle-scoped invites** (`community_invite.cycleId`, nullable; null keeps today's general invite). An invite's meaning follows its cycle's `joiningInviteMode`:
  - **`direct`** — redemption skips the application and interview process entirely (today's behavior, now cycle-bound): `/invite/[token]` creates the Member immediately and seeds Participation in the cycle (`coming`; the member adjusts it). An *outstanding* direct invite **holds a capacity slot** until redeemed, revoked, or expired — the "block a spot for a few days so sending an invite makes sense" rule; the hold's length is the invite's own `expiresAt`, and direct invites into capacity-capped cycles must carry a non-past expiry (no immortal holds).
  - **`referral`** — the invite never redeems directly. It routes through the evaluated application via the existing `recruitmentApplicationInvite` link (`/apply?invite=<token>` — the inviter's good-fit/know-personally vouching feeds the decision rules without spending the invite); it holds **no** capacity slot; outstanding referral counts are visible to the recruitment holders (applications pipeline).
  - Creating a cycle invite gates on the mode's door (`direct` → `invitesOpen`, `referral` → `applicationsOpen`) plus the joining period and capacity room.
- **Conversion seeds participation (D14).** Accepting an application for cycle C, or redeeming a direct invite into C, seeds `participation(C, member, "coming")` idempotently — the event context is real, and the new member counts against the cycle's capacity from day one.
- **Surfaces.** The participation page's cycle-config form (which already owns capacity / `returningWindowClosesAt`) gains the joining fields + per-cycle form picker (`updateCycleSettings` extended); Settings gains the two community door toggles beside the existing recruitment config; the Invites page's create form gains an optional cycle picker and mode-aware copy; `/invite/[token]` renders the referral path for referral-mode invites; the applications pipeline shows held/outstanding counts.

**Files:** `src/db/schema/cycle.ts`, `src/db/schema/community.ts`, `src/db/schema/community-invite.ts`, `src/lib/recruitment/{access,applications,evaluations,decisions,invites,pipeline}.ts`, `src/lib/participation.ts`, `src/lib/forms.ts`, `src/lib/permissions.ts` (tier + hints), `src/app/apply/*`, `src/app/invite/[token]/*`, `src/app/(app)/invites/*`, `src/app/(app)/[cycleScope]/participation/*`, `src/app/(app)/applications/page.tsx`, `src/app/(app)/settings/*`. **Effort:** Large (split as work-plan 8b–8d).

### 🔴 4.4 Cycle clone must copy grants (prerequisite, already tracked)

**Fix:** close the grant-copy gap where it still exists and extend the clone to carry shift rosters. `clone_previous` already copies `PermissionGrant` rows (`cycles/crud.ts:344`); the remaining hole is **pack import** (`src/lib/task-packs/import.ts` — no grant handling at all), which must copy grants for its imported tasks. Plus the new requirement (§2.6): cloning a cycle carries the previous cycle's **shift series**, with occurrence timing re-derived relative to the target's dates (§4.8). Under the new model this is what makes per-scope authority — and a cycle's roster — replicate for free.

**Files:** `src/lib/cycles/crud.ts` (clone), `src/lib/task-packs/import.ts` (`commitPackImport`). **Effort:** Medium — shared helper both paths call.

### 🟠 4.5 Announcements: cycle variant + new "cycle" send scope

**Fix:** the `announcements` module already gates only the `community` send scope (`messages.ts:101`). Add a **cycle** scope — recipients drawn from `Participation` in the target cycle, as **selectable segments the sender picks: `coming`, `maybe`, or both** (D3, since the two groups may need different messages) — gated by the holder of an `announcements`-granted task *placed in that cycle*; a cycle-less `announcements` task keeps gating the `community` scope. Existing `arrival_window` scope is untouched (it's cycle-initiation-gated, a different authority).

**Files:** `src/lib/messages.ts` (`OutboundMessageScope`, `resolveRecipientMemberIds`, `resolveScopeForSend`), `src/db/schema/messages.ts`, `src/lib/permissions.ts` hints. **Effort:** Medium.

### 🟡 4.6 Tidy the permission lib

**Fix:** delete `CYCLE_SCOPED_MODULES` (replaced by the tier table §2.2 + enforcement in the resolvers), `listGrantedCycleScopesForTask`, the `cycleId` parameter of `listGrantingTaskIds`/`setPermissionGrant`/`removePermissionGrant`, and the `grantCycleId` plumbing in proposal activation and task-grant actions. **Files:** `src/lib/permissions.ts`, `src/lib/proposals/crud.ts`, `src/app/(app)/tasks/[id]/actions.ts`, `src/app/(app)/proposals/*`. **Effort:** Small once 4.1–4.3 land.

### 🟠 4.7 Backstop: the responsible-party module (new)

**Fix:** add `backstop` as a grant module and the machinery around it (design in §2.5).

- **Resolver** (`src/lib/backstop.ts`, new): holder of a granted `backstop` task whose `task.cycleId = target scope` (or `IS NULL` for the community/evergreen backstop); single instance per scope (§2.3 — enforce at grant time like today's single-pointer modules).
- **Escalated queue:** `listEscalatedTasks` / `escalateTask` (`src/lib/tasks/escalation.ts`) admit the scope's backstop for their own cycle alongside the community-wide coordination gate (view + escalate, D5).
- **Duty view:** "critical, no owner, backstop is {name}" — all critical tasks in the scope with status/attention/holders, available to the scope's backstop. Nothing new is computed; it is the existing attention state rendered for one role.
- **Notification fan-out:** today a critical task hard-flags and nobody is told. Extend the job that recomputes attention to notify the scope's backstop when a critical task in scope hard-flags (D7 — the only notification; browse-close is visible on the duty view and board).
- **Cycle creation** (`src/lib/cycles/crud.ts`): create the backstop task at kickoff (critical, single-slot, `backstop` grant), auto-claimed to `startedBy`; transferable/unclaimable, an unclaimed backstop task is a visible critical gap (D6). Cycle clone copies it like any task via §4.4.

**Files:** `src/lib/backstop.ts` (new), `src/lib/tasks/escalation.ts`, `src/lib/cycles/crud.ts`, attention job, `src/lib/permissions.ts` (hints + tier), §5.5 UIs. **Effort:** Medium.

### 🟠 4.8 Shift rosters: placement column + `shift_management` module

**Fix:** give shifts a cycle form (design §2.6).

- `shift_series.cycleId` — nullable FK to cycle, mirroring `task.cycleId`; placement is the declaration, so `shift_occurrence`/`shift_signup` stay unkeyed (they resolve scope through their series).
- `shift_management` module: hints/tier in `src/lib/permissions.ts`, resolver in the shifts lib — holder of a granted task whose `task.cycleId = series.cycleId` (or `IS NULL` for standing series) manages the series. This replaces the per-series `sourceTaskId`/`createdBy` authority everywhere, cycle and standing (D10): `isShiftCoordinator`/`requireShiftCoordinator` drop their creator/sourceTaskId routes. Existing series with no grant-backed manager become visible unmanaged gaps — the same honest state every single-pointer module has, plus a dashboard needs-action entry.
- **Roster gate & open act (D11):** `cycle.shiftSignupsOpenedAt` (nullable, set once, one-way) + `shift_series.confirmedAt` (null = proposal, hidden until confirmed). `openCycleShiftSignups(actor, cycleId)` — cycle-C `shift_management` holder only, rejects if already set. Signup checks and the browse surface read both: unconfirmed proposal → hidden; roster unopened → visible-but-closed; open + confirmed → claimable (capacity/withdraw as today).
- **Composition paths:** during the window, any member may place a series in cycle C (`confirmedAt = now` at creation — it opens in the batch); after the open act, placement creates a **proposal** (`confirmedAt = null`) requiring `confirmShiftProposal` by the cycle's manager before it appears on the browse surface or accepts sign-ups. Standing series stay manager-added (D10). Re-placing a series into a cycle is a manager action.
- **Clone carries the roster:** clone-previous copies the series and re-derives occurrence timestamps via the relative-boundary machinery (`deriveClonedBoundaryRecipe`) — source-cycle `startDate` offsets applied to the target's dates, not copied absolute datetimes; occurrences stay explicit materialized rows (no live recurrence engine). The new cycle's roster starts back in the collecting window (`shiftSignupsOpenedAt = null`); proposed series carry as proposals. Where the target's dates aren't known at clone time, occurrence materialization defers until they land, mirroring how phase boundaries already behave.
- `listPendingShiftProposals` (manager confirmation surface) and `listShiftCoordinatorNeedsAction` (dashboard) resolve the manager's series set by the same scope rule.

**Files:** `src/db/schema/shift.ts`, `src/lib/shifts/series.ts`, `src/lib/shifts/occurrences.ts`, `src/lib/shifts/signups.ts`, `src/lib/permissions.ts`, settings + task-detail grant UIs (§5.6). **Effort:** Medium.

---

## 5. Interface work

### 🔴 5.1 Settings → Access & permissions: one scope notion, from the task

**Fix:** `GrantField` stops taking a cycle picker for two modules and shows **every** granted row's derived scope instead: `task — branch — {Cycle name | Community-wide | Evergreen}`. The task's own placement *is* the scope; there is nothing else to pick. Guidance copy per tier from §2.2 — e.g. community-shaped modules show "this is a community-wide role — keep its cycle unset"; a cycle-placed admin/conflict/support task renders a warning, not a mistake, server-backed. Single-cardinality copy becomes "one task per scope" uniformly.

**Files:** `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/actions.ts`, `src/lib/permissions.ts` (`PERMISSION_MODULE_HINTS` rewritten to state each module's scope tier). **Effort:** Medium.

### 🟠 5.2 Task detail: the cycle field becomes the scope control

**Fix:** the "Permissions granted by this task" form drops the separate "Cycle" dropdown and the array-diffing checkboxes. For a cycle-shaped module, the checkbox is checked for **this task's own placement** — the form is just checkboxes plus a scope line ("sitting in Cycle 3, this grants Spatial planning to Cycle 3 only"). A task without a cycle shows "community-wide / evergreen." If cycle-shaped grants are checked on an un-placed task, prompt to place it (or default to community scope per D1).

**Files:** `src/app/(app)/tasks/[id]/page.tsx` (+ its grants action), `src/lib/permissions.ts` (`listModuleKeysGrantedByTask` replaces the scopes API). **Effort:** Medium.

### 🟠 5.3 Coordination surfaces visualize the holder's scope

**Fix:** `/coordination` and `/escalation` gate on the view-scope cycle (via the `[cycleScope]` segment) when the community runs cycles, staying community-wide for cycle-less ones. Board badges resolve from both dimensions (§2.4): a task card flag says "coordinated by {name}" when the holder covers its branch column *or* its cycle row. `listCoordinationBranchIds` becomes `listCoordinationScopeIds`.

**Files:** `src/app/(app)/coordination/page.tsx`, `src/app/(app)/escalation/page.tsx`, `src/app/(app)/board/page.tsx`, `src/lib/coordination.ts`, `src/lib/dashboard.ts`, `src/lib/engagement.ts`, `src/lib/messages.ts`. **Effort:** Medium.

### 🟡 5.4 One coherent mental model for the whole UI

**Fix:** wherever grants are edited or described, state the single rule once ("a task grants what it sits in") instead of per-module exceptions: module hints, the settings tab's intro, the task detail disclosure, proposal activation. The board's existing "not cycle-scoped" indicator on cycle-less tasks doubles as the "community-wide role" signal.

### 🟠 5.5 Backstop surfaces

**Fix:** make the responsible party visible without closing the task to claimants (D5's open-and-responsible duality).

- Settings and task detail gain the `backstop` module row/checkbox via the same §5.1/§5.2 machinery as every other module.
- Unclaimed critical tasks in a cycle with a backstop render a **"Backstop: {name}"** marker alongside their normal open/unclaimed state — on the board and task card, which stay claimable by anyone.
- The backstop's **duty view** (§4.7) — scope criticals + status, visible only to the scope's backstop — placed as a segment of the board's "needs an owner" surface (or the coordination-adjacent view), not a new page.
- The escalation page admits the scope's backstop (their cycle segment only, per §5.3's view-scope gating).

**Files:** `src/app/(app)/board/page.tsx`, task card, escalation page, settings + task-detail grant forms. **Effort:** Medium.

### 🟡 5.6 Shift roster surfaces

**Fix:** make a cycle's roster visible as a cycle thing.

- `/shifts` groups upcoming occurrences by scope — "cycle C roster" vs "standing series" — or keeps today's flat list where a community doesn't run cycles.
- Settings and task detail gain the `shift_management` module row/checkbox via the same §5.1/§5.2 machinery; a cycle-placed task shows the derived scope line ("sitting in Cycle 3 → manages Cycle 3's shift roster").
- The cycle view (or shift tab) shows the roster: who manages it, which slots are filled vs open, drawn from the grant + existing signup data — plus the window state: "Collecting — sign-ups closed" vs "Sign-ups open", with the shift manager's one-way "Open sign-ups for this roster" action (irreversible, confirm dialog) and "Confirm proposal" for any pending additions. The browse surface shows a collecting roster as "not open yet" and hides unconfirmed proposals.

**Files:** `src/app/(app)/shifts/page.tsx`, cycle page, settings + task-detail grant forms. **Effort:** Small–Medium.

---

## 6. Decisions (locked) & what's left open

**Decided — locking the model before build:**

- **D1 — Community scope is strict.** A cycle-less task covers only cycle-less data for cycle-shaped modules; it never reaches into a cycle's data. No fallback/precedence between scopes.
- **D2 — One scope per task.** A task carries authority for exactly one scope (one cycle, or community). The Phase 68 "one task, two grant rows, two cycles" stacking case becomes two tasks — cycle clone supplies the second; the §4.1 backfill surfaces existing rows for a human.
- **D3 — Cycle-announcement recipients are selectable segments.** The sender picks `coming` and/or `maybe` (`Participation` statuses), since the two groups may need different messages.
- **D4 — Land the ready five now.** `event_scheduling_owner`, `spatial_planning`, `branch_coordination`, `announcements` (cycle variant) and the three community-shaped modules (`admin`, `conflict_team`, `support`). `feedback_review` scoped in §4.3's feedback half (done, `908f36c`); `recruitment` scopes in the recruitment half (work-plan 8b–8d), per D12–D14.
- **D5 — Backstop is a standing responsibility role, not a coordination variant** (§2.5). Standing oversight position + fallback layering; unclaimed criticals stay unclaimed, hard-flagged, and claimable by anyone, listed in the backstop's duty view with a "Backstop: {name}" marker (no auto-hold); escalate-only as the backstop's sole action (view + escalate for their scope); status-level oversight view only — coordination diagnostics stay coordination's.
- **D6 — Backstop holder is auto-claimed but transferable.** The cycle's `startedBy` is auto-claimed as the backstop task's first holder at cycle creation; unclaiming or transferring it simply turns the backstop task into a visible critical gap — the honest-gap treatment, no special machinery.
- **D7 — Backstop notified at hard-flag only.** The scope's backstop is notified when a critical task in scope hard-flags (unclaimed past deadline). Browse-close is already visible via the duty view and board marker, so it needs no notification.
- **D8 — Single migration for `permission_grant.cycleId`.** Only a test instance exists — no deprecation window. Backfill the §4.1 conflicts and drop the column in one migration.
- **D9 — Shift rosters get a cycle form** (§2.6). `shift_series.cycleId` placement; roster = the cycle's placed series; `shift_management` module (cycle-shaped with a community variant); signups stay open to any member.
- **D10 — Shift management is grant-everywhere and single per scope.** The creator/`sourceTaskId` per-series authority is removed; `shift_management` is single-cardinality per scope (one per cycle roster, one for standing series); managing a roster — opening sign-ups, confirming proposals, re-placing, standing-series adds — belongs to the holder of a `shift_management`-granted task in the matching scope; unmanaged rosters surface as visible gaps (their cycle rosters stay closed). Cycle clone carries the roster, re-deriving occurrence timing relative to the target cycle's dates rather than copying absolute datetimes (Q8 addendum — placement stays the roster, timing travels as a relative recipe). Module key: `shift_management` (Q11).
- **D11 — Roster sign-ups open with one manager act; the collecting window is open-to-anyone; post-open additions are proposals.** `cycle.shiftSignupsOpenedAt` (null = collecting, set once by a one-way act of the cycle's `shift_management` holder); during the window *any member* can place series in the roster (they open together); after the open act, additions land as **proposals** (`shift_series.confirmedAt` null) that the cycle's manager must confirm before they become visible/claimable. Signups run when a series is confirmed and its roster is open; standing series stay always-open.
- **D12 — Invites are cycle-scoped with a per-cycle mode.** `community_invite.cycleId` (null = today's general invite, unchanged). A cycle's `joiningInviteMode`, default `direct`: redeeming a direct invite skips the application and interview process (Member created immediately + Participation seeded, D14), and an **outstanding direct invite holds a capacity slot** until redeemed, revoked, or expired — the "block a spot for a few days so the invite can land" rule, with the hold's length set by the invite's own `expiresAt` (direct invites into capacity-capped cycles must carry a non-past expiry). `referral`: the invite never redeems directly — it routes through the evaluated application via the existing `recruitmentApplicationInvite` link (`/apply?invite=<token>`), holds nothing, and outstanding referral counts are visible to the recruitment holders (D12 locked with the user during the §4.3 recruitment refinement).
- **D13 — Community-wide door toggles.** `community.recruitmentApplicationsOpen` / `recruitmentInvitesOpen` (default true) close the *general* cycle-less doors, so a community can run fully closed except for the cycles/periods it opens (per-cycle doors are set on the cycle, §4.3).
- **D14 — Joining seeds participation.** Accepting an application for cycle C, or redeeming a direct invite into C, seeds `participation(C, member, "coming")` idempotently — the event context is real from day one and the new member counts against the cycle's capacity.

**Open:** the §4.3 recruitment refinement locked D12–D14 at the user's direction; everything from the earlier rounds (Q5, Q8–Q11) is settled as listed. What remains are implementation details tracked inside the work items — e.g. the exact held-slot count queries (8d), how the applications pipeline renders outstanding invite counts, and how `/invite/[token]` presents the referral path for referral-mode invites.

---

## Work plan (suggested order)

**Execution status:** steps 1–8 are committed locally on `main` (the tasks session's `ea7ed0e` landed §5.2's surface within step 6); step 7 was verified as already covered by step 1's single migration. The feedback half of step 8 is committed (`908f36c`); the recruitment half is split into 8b–8d, each a separate commit approved step by step — the design is locked in §4.3 and D12–D14.

1. **Backend model** — §4.1 + §4.2, with `task.cycleId` as the only scope read; existing Phase 68 tests must pass unchanged post-migration. ✅ `36b7ee0`
2. **Cycle clone grants** — §4.4 (unblocks the "clone carries authority" story; needed before any UI depends on it). ✅ `1da3f1d`
3. **Backstop** — §4.7 + §5.5 (new module, cycle-creation default, unclaimed-critical marker + duty view). Rides directly on the unified resolver shape from step 1. ✅ `15dc763`
4. **Shift rosters** — §4.8 + §5.6 (series placement column, `shift_management` module, roster open-act + proposal gate, surfaces + clone carries the roster). Same resolver shape. ✅ `51ceaa4`
5. **Announcements cycle variant** — §4.5 (cycle send scope with selectable `coming`/`maybe` segments, D3). ✅ `34703f3`
6. **Interface** — §5.1 then §5.2 (the two confusing surfaces), then §5.3–5.4. ✅ `6ce0ff0` (§5.1); §5.2 landed via the tasks session's `ea7ed0e`; ✅ `f831219` (§5.3 — coordination surfaces visualize both dimensions + `[cycleScope]` gates); ✅ `4341fb7` (§5.4 — the coherent one-rule copy pass).
7. **Retire the old scope pipe** — §4.6, then drop the column in step 1's single migration (D8). ✅ (verified already covered by step 1's migration — no `CYCLE_SCOPED_MODULES` / `listGrantedCycleScopesForTask` / `grantCycleId` remains).
8. **Data pass + scope the two deferred modules** — §4.3.
   - **8a. Feedback half.** `formResponse.cycleId` + cycle-picker intake + response cycle tags; `feedback_review` scoping (`deferred → cycle`, `listHeldFeedbackReviewScopes`). ✅ `908f36c`
   - **8b. Recruitment authority half.** Tier `recruitment` `deferred → cycle`; `listHeldRecruitmentScopes`; applications/evaluations/decisions resolve against the candidate response's cycle; inquiries stay any-holder. Permission + resolver tests. ✅ `e0738db`
   - **8c. Joining config + per-cycle intake.** `cycle` joining columns (application-form pointer, `applicationsOpen`, `invitesOpen`, `joiningInviteMode`, `joiningWindowClosesAt`), community-wide door toggles (D13), `updateCycleSettings` + participation-page config, Settings toggles, `/apply` cycle context (form resolution, door/period/capacity gates, `cycleId` tagging). ✅ `0fe0e6c`
   - **8d. Cycle-scoped invites + seeding + visibility.** `community_invite.cycleId`; direct vs referral creation/redemption semantics (D12); direct-invite capacity holds with expiry enforcement; participation seeding on acceptance and redemption (D14); pipeline + participation-page held/outstanding counts. ✅ `969a2d8` (+ `0d13350` for the held-capacity display).

Cross-referenced from: `CHANGELOG.md` (Phases 63, 67, 68), `docs/spec-audit-remediation-plan.md` §3, `docs/development-plan.full-archive.md` "Beyond" (recruitment), `docs/spec.md:867` (`response.cycle_id`).