# Open Permissions Plan — "everyone has this" per module

**Status:** design only. No migration, no resolver, no settings change has been made. The
recruitment-specific proposal in `docs/recruitment-access-plan.md` §4 is **superseded** by
this document — it proposed a recruitment-only, Tier-based evaluator rule; this is the
general, per-module mechanism that replaces it. See that doc's §5 (the `/recruitment` hub) for
what has actually landed.

**Scope:** all 14 `PermissionModuleKey` values in `src/lib/permissions.ts:6-21` — the
"Access & permissions" tab in Community Settings.

**Working principle, agreed with the user:**

> **Task-gating decides who holds the role. A Community setting decides whether holding it is
> required at all.** A module marked open is a deliberate, community-wide grant — not a
> fallback, not a bug, not a bootstrap state.

The open flag and the task grant are orthogonal facts. A community can run Recruitment
open to everyone *and* still name someone responsible.

---

## 1. Current state

Every one of the 14 modules resolves through the same shape — "does this actor, non-shadow,
currently hold a task carrying a `permission_grant` row for this module" — scoped by the
granting task's own `task.cycleId` or `task.branchId`
(`docs/cycle-scope-remediation-plan.md` §2.1). There is **no** community-wide grant concept
anywhere: `permission_grant.taskId` is `NOT NULL` (`permission-grant.ts:64-66`) and every
resolver joins it to `taskAssignment`, so authority always resolves to a specific person
holding a specific task.

Three prior facts constrain the design:

- **Phase 63** removed nine `Community` columns and a `Task.tags` match, because they were a
  second authority path that could be set inconsistently — a task tagged "support" for
  logistics reasons could grant live View-as access (`permission-grant.ts:5-16`). A new
  authority path must not reintroduce that failure mode.
- **`admin` already has a community-wide mode**, but an implicit and non-durable one:
  `requireAdmins` returns early for *every* member while `community.adminsEverClaimed` is
  false (`settings/admins.ts:22-24`), purely to stop a fresh install locking itself out. An
  explicit open flag makes that a chosen state rather than a startup artefact.
- **Cardinality is per-module** (`MULTI_CARDINALITY_MODULES`, `permissions.ts:196-210`:
  admin, branch_coordination, community_coordination, support, kitchen), and **scope tier**
  is per-module (`PERMISSION_MODULE_SCOPE_TIER`, `permissions.ts:111-126`: 4 `community`,
  9 `cycle`, 1 `cycle_variant`).

### 1.1 The five resolver shapes

Every resolver must be edited. They are not one shape but five, and grouping them by what
they *return* is what makes this tractable:

| # | Shape | Modules | Return |
|---|-------|---------|--------|
| 1 | Community-wide boolean | `admin`, `conflict_team`, `support`, `recruitment` (`isRecruitmentTaskHolder`) | `boolean` |
| 2 | Held-scope set | `recruitment` (`listHeldRecruitmentScopes`), `feedback_review` (`listHeldFeedbackReviewScopes`, private), `kitchen` (`ownedKitchenScopeIds`, private) | `Set<string \| null>`, `null` = community/evergreen = superset |
| 3 | Tri-state cycle arg | `event_scheduling_owner`, `spatial_planning`, `kitchen` | `boolean`; `undefined`=any, `null`=cycle-less, `string`=that cycle |
| 4 | `CoordinationCoverage` | `branch_coordination`, `community_coordination` (`resolveCoordinationCoverage`) | `{communityWide, branchIds, cycleIds}` |
| 5 | `.limit(1)` over possibly-many holders | `backstop`, `shift_management`, `budget` | `Member \| null` / `boolean` |

`announcements` is a sixth case, not a shape: two **disjoint** authorities that never cross
(`messages.ts:54-58`) — cycle-less grant for community-wide sends, per-cycle grant for
event sends.

### 1.2 Task-gated does not mean one person

An earlier draft of this plan repeatedly said "one person" for a task-gated module. That is
wrong as a general statement, and the correction matters for §3.2.

**A task can have several real holders.** `task.capacity` (`task.ts:58`) defaults to `1`, but
a claim is refused only when `held >= capacity` (`lifecycle.ts:100-105`), so `capacity: 5`
means five non-shadow holders. Shadows are excluded from the count
(`lifecycle.ts:46-47, 15`), so they don't add to it. Separately, `crud.ts:198-199`:

```ts
const capacity =
  input.capacity !== undefined ? input.capacity : openness === "community_endorsed" ? null : 1;
```

A `community_endorsed` task gets `capacity: null`, and `null` skips the capacity check
entirely — **unlimited holders.**

So the number of people a module resolves to is `task.capacity`, or unbounded, and one case is
automatic rather than configured:

- **`admin` is unbounded in practice.** `requireAdmins` requires the granting task to be
  `community_endorsed` (`admins.ts:41`), and `community_endorsed` implies `capacity: null`.
  An admin task can therefore be held by any number of people with no configuration at all,
  and `requireAdmins` is satisfied by any one of them. This is also why the
  `adminsEverClaimed` bootstrap (`admins.ts:22-24`) is tolerable — Admins was never really
  single-holder to begin with.
- **Every other module** defaults to one holder, but a community can set a permission-granting
  task's `capacity` to any N and get N holders.

The consequence: "task-gated" and "one person" are different claims, and the codebase only
guarantees the first. The `.limit(1)` in shape 5 is best read as *first holder wins* — an
arbitrary tie-break among several — not as a guarantee that there is only one. That is why
`getRecruitmentTaskHolderMember` orders by `claimedAt` before its `.limit(1)`
(`recruitment/decisions.ts:82-83`): it is picking the *earliest* holder, which only makes
sense if there can be several.

---

## 2. Target model

### 2.1 Storage

A new table. **Not** a nullable `taskId`, and **not** a sentinel module key.

```
open_permission_grant
  community_id   uuid → community      NOT NULL
  module_key     permission_grant_module_enum  NOT NULL
  opened_at      timestamptz          NOT NULL default now()
  opened_by      uuid → member        NOT NULL
  PRIMARY KEY (community_id, module_key)
```

The enum already carries all 14 values (`permission-grant.ts:36-51`), so no enum change is
needed. One row per module; a unique constraint makes double-open impossible. `opened_by`
because the answer to "should this record who opened it" was yes — see §9.1.

**Why not a nullable `permission_grant.taskId`:** every resolver does
`listGrantingTaskIds(...)` → `inArray(task.id, grantingTaskIds)` → `taskAssignment` join. A
`NULL` taskId would match no assignment and therefore grant **nothing** — indistinguishable
from "correctly closed." A sentinel string would match no task either, and would additionally
break `inArray`'s uuid typing. A separate table cannot poison the existing reads at all,
which is the property that matters most given that a mistake here fails *open*.

**Why it isn't just another `Community` column:** 14 booleans on `community` would be the
Phase 63 failure mode — a second authority path settable from a different tab than the one
that describes the role, free to disagree with the grant table. One narrow table is also
closer to the existing `permission_grant` shape ("this capability exists for this community")
than to a settings blob.

### 2.2 Read primitive

In `src/lib/permissions.ts`, next to `listGrantingTaskIds`:

```ts
listOpenModuleKeys(communityId): Promise<Set<PermissionModuleKey>>
isModuleOpenToEveryone(communityId, moduleKey): Promise<boolean>
```

`isModuleOpenToEveryone` is the one enforcement call. It is a single indexed lookup on a
composite PK, and it is safe to call at the top of every resolver.

**Holder counts** — a second primitive, needed by both D12 and the settings indicator (§10
q3), and deliberately not a `countModuleHolders(communityId, moduleKey, scope?)` signature:

```ts
countHoldersOfTasks(taskIds: string[]): Promise<number>
```

A pure helper over a list of task ids, joining `taskAssignment` where `isShadow: false` and
counting distinct members. **Scope-awareness comes from which id-list you pass it**, not from
a parameter: `listGrantingTaskIds` for the community-wide case,
`listGrantingTaskIdsForScope(communityId, moduleKey, cycleId)` for a scoped one. This avoids
inventing a scope argument that would have to mean branch for coordination, cycle for most
modules, and nothing for the `community` tier — and it reuses the scope split the codebase
already has instead of adding a second one.

`describeRecruitmentAuthority` (`recruitment/access.ts:90-131`) already computes this for one
module, and should be refactored onto the shared helper rather than left as a parallel
implementation.

### 2.3 Scope semantics

**An open module is the community/evergreen scope, which is already a superset.** For the
nine `cycle`-tier modules, the cycle-less scope covers every event's data — that is what the
existing D1 strictness rule already means by it. So "everyone has Recruitment" ⇒ every member
sees every event's applications. There is no narrower coherent reading of the word
"everyone," and inventing one (e.g. per-event opt-in) would be a different feature.

`announcements` needs both halves opened, or neither: its community-wide and per-event
authorities are disjoint by design, so opening only one gives a surprising half-open state.
The UI treats it as one checkbox driving both.

### 2.4 What open does *not* change

The task grant is untouched and remains independently meaningful:

- **Navigation** — decided: **no auto-pin when a module is open** (`nav.ts:231-240`). The pin
  means "you have outstanding work here"; if the module is open, outstanding items should
  surface through the normal task feeds instead. Otherwise every member's sidebar changes
  identically and the signal is lost for whoever is actually doing the work.
- **Module on/off** (`community.modulesEnabled`) is a separate, orthogonal gate and still
  applies. Open never bypasses it.
- **Membership** is still required. Open does not grant anything to a non-member.
- **Open flags do not travel** — decided. A cycle clone (`copyPermissionGrants`,
  `cycles/crud.ts:859-860`) and Task Pack export/import (`task-packs/export.ts:123-125`)
  carry *grants* only. An open flag is a Community's local decision about its own members,
  not a property of a task or an event, so a cloned cycle or an imported pack arrives with
  the module **closed** and a task grant at most. Both paths are task-keyed, so there is
  nowhere natural for a community-level fact to ride even if someone later wants it to.
- **`feedback_review` nav visibility** is not grant-based today
  (`nav.ts:186`, keyed on `postCycleFeedbackFormId`) and stays that way.

---

## 3. Per-module classification

The classification that matters is not "can it be open" — all 14 can — but **what else reads
the grant**, because those secondary consumers are what break.

| Module | Tier | Enforcement edit | Secondary consumers | Open impact |
|---|---|---|---|---|
| `admin` | community | `requireAdmins` (`admins.ts:20`) — check open before the `adminsEverClaimed` bootstrap and the grant lookup | 33 settings actions, 10 API routes, `isAdmin` for UI | None. Note open **overrides** the bootstrap gate by design (explicit beats implicit) |
| `branch_coordination` | cycle | `resolveCoordinationCoverage` (`coordination.ts:95`) → set `communityWide: true` | `listCoordinationHoldersForScopes` display; nav `isCoordinator` | Display must say "everyone" |
| `community_coordination` | community | same function (already short-circuits `communityWide`) | same | None |
| `conflict_team` | community | `isConflictTeamMemberId` (`conflict.ts:18`) | `listConflictTeamMemberIds` roster; `recuseSelf`/`recusePeer`; `acknowledgeConflictReport`; `fileConflictReport` | No caveat — but see **§4.1**, which is a *gate to fix*, not a limit on recusal |
| `feedback_review` | cycle | `listHeldFeedbackReviewScopes` (`forms.ts:493`, private) → return `new Set([null])` | none | None |
| `event_scheduling_owner` | cycle | `isEventSchedulingOwner` (`conflicts.ts:27`) | `listEventSchedulingNeedsAction`; nav pin | None |
| `recruitment` | cycle | `isRecruitmentTaskHolder` (`access.ts:22`) + `listHeldRecruitmentScopes` (`access.ts:139`) → `{null}` | `getRecruitmentTaskHolderMember` (`decisions.ts:75`, **one call site**: `decisions.ts:474`) | **See §4.2** |
| `spatial_planning` | cycle | `isSpatialPlanningHolder` (`access.ts:29`) | `isPlacementEditor` is a *different* authority — untouched | None |
| `announcements` | cycle_variant | **both** `isAnnouncementTaskHolder` and `isAnnouncementHolderForCycle` (`messages.ts:59,65`) | `listMyAnnouncementCycles` | None; both must open together |
| `support` | community | `isSupportHolder` (`view-as.ts:20`) | `getActiveViewAs` re-verifies every call | None mechanically. **Worth a settings warning**: open means every member can View-as every other member |
| `backstop` | cycle | — (**not openable**, D11) | `notifyBackstopOfHardFlag` (`backstop.ts:135`) **emails a named person**; task detail names them (`tasks/[id]/page.tsx:405`) | No checkbox. The sole exclusion — see D11 |
| `shift_management` | cycle | `isShiftManagerForScope` (`management.ts:50`) | `resolveShiftManager` used for display only (`roster.ts:57`, `shifts/page.tsx:167`); all 4 `requireShiftManagerForScope` call sites **discard** the returned `Member` | Display only |
| `budget` | cycle | `isBudgetOwner` (`voting.ts:27`) | `listBudgetNeedsAction` (every budget appears in every member's queue); nav pin (dropped when open) | Noisy, not incorrect |
| `kitchen` | cycle | `isKitchenOwner` (`access.ts:18`) + `ownedKitchenScopeIds` (`needs-action.ts:17`, private) | none | None |

Two corrections to an earlier reading of this table, both verified against call sites rather
than signatures:

- **`shift_management` is pure capability**, despite `resolveShiftManager` returning
  `Member | null` with `.limit(1)`. All four `requireShiftManagerForScope` call sites
  (`shifts/series.ts:92,230,253,306`) discard the return value — which is precisely what makes
  the multi-holder case harmless there: the check is "is the actor *one of* the managers," so
  an arbitrary pick among several is harmless. Compare `backstop`, where the picked member is
  emailed.
- **`budget` is pure capability.** `isBudgetOwner` is a plain boolean; the `Member`-returning
  shape belongs to backstop only.

So the only module that cannot be opened at all is **`backstop`** (D11), and the reason is
narrow: `notifyBackstopOfHardFlag` emails **one** person, and that person is chosen by an
arbitrary `.limit(1)` among however many hold the task (§1.2). Widening it to everyone would
mean emailing everyone on every hard-flagged task — a fan-out, not a shared queue. The task
detail page names the same single holder (`tasks/[id]/page.tsx:405`).

### 3.1 Complete enforcement-site audit

A sweep of every site that reads a grant, to find the ones that use *"a grant exists"* as a
proxy for *"the module is configured."* `listGrantingTaskIds` has 22 call sites
(`permissions.ts:227` is the definition); `permissionGrant` is also joined directly in 8
places that bypass it. The sites fall into four classes, and **only the first two need
enforcement edits** — the other two are the ones that quietly break.

**Class 1 — capability resolvers.** The edit is one open check at the top; **11 sites**
(13 modules minus the two coordination keys, which share one resolver, minus `backstop`,
which is not openable).

| Module | Site |
|---|---|
| `admin` | `settings/admins.ts:20` `requireAdmins` |
| `conflict_team` | `conflict.ts:18` `isConflictTeamMemberId` |
| `support` | `view-as.ts:20` `isSupportHolder` |
| `recruitment` | `recruitment/access.ts:22` `isRecruitmentTaskHolder` |
| `event_scheduling_owner` | `event-scheduling/conflicts.ts:27` `isEventSchedulingOwner` |
| `spatial_planning` | `spatial-planning/access.ts:29` `isSpatialPlanningHolder` |
| `kitchen` | `kitchen/access.ts:18` `isKitchenOwner` |
| `budget` | `budget/voting.ts:27` `isBudgetOwner` (joins `permissionGrant` directly) |
| `shift_management` | `shifts/management.ts:50` `isShiftManagerForScope` (via `resolveShiftManager`, direct join) |
| `branch_coordination`, `community_coordination` | `coordination.ts:95` `resolveCoordinationCoverage` (direct join) → set `communityWide` |
| `announcements` | `messages.ts:32` `holdsAnyGrantingTask`, behind both `isAnnouncementTaskHolder` (`:59`) and `isAnnouncementHolderForCycle` (`:65`) |
| ~~`backstop`~~ | **excluded — not openable (D11)**, so `isBackstopForScope` (`backstop.ts:46`) needs no open check at all |

**Class 2 — scope-set resolvers.** The edit is returning the community/evergreen scope, i.e.
`new Set([null])`, which the existing D1 strictness rule already treats as covering every
scope; 3 sites.

| Module | Site |
|---|---|
| `recruitment` | `recruitment/access.ts:139` `listHeldRecruitmentScopes` |
| `feedback_review` | `forms.ts:493` `listHeldFeedbackReviewScopes` (private) |
| `kitchen` | `kitchen/needs-action.ts:17` `ownedKitchenScopeIds` (private) |

**Class 3 — "is the module set up?" proxies.** These are the bug class. Each reads grant
*existence* as a proxy for the module being configured, so an open module with no task
degrades silently or refuses outright. **These are the sites the sweep was for.**

| Site | Current behaviour with no grant | Consequence when open |
|---|---|---|
| `conflict.ts:78-82` `fileConflictReport` | throws `"Conflict management isn't set up for this Community yet"` | **nobody can file a report** — see §4.1 |
| `conflict-reports/page.tsx:43-44` | `moduleOn = grantIds.length > 0` | page renders "not set up" for an open module |
| `nav.ts:176,185` | `visibleModules.conflictReports = grantIds.length > 0` | **nav item disappears** for an open module |
| `nav.ts:66-81` `holdsGrantedTask` | returns `false` → drives pins at `nav.ts:231-240` | needs to keep returning `false` when open (D5), not `true` |
| `recruitment/decisions.ts:110-113` `createIntroCallPoll` | returns `null` | **no intro call is ever scheduled**; needs the granting task's `branchId` |
| `recruitment/decisions.ts:269-272` `maybeCreateAccompanimentTask` | returns `null` | **no accompaniment task is ever created**; same `branchId` need |
| `recruitment/decisions.ts:75-87` `getRecruitmentTaskHolderMember` | returns `null` | scheduled job cannot author the accompaniment task — see §4.2 |
| `recruitment/access.ts:90-92` `describeRecruitmentAuthority` | returns empty `grants`/`holders` | **the hub I just landed would say "No task grants Recruitment, so nobody can evaluate"** for an open module — self-contradictory |
| `permissions.ts:284-285` `listGrantingTaskIdsForScope` | returns `[]` | used by `announcements` and the spatial-planning page; both Class-1-adjacent |
| `spatial-planning/page.tsx:157-162` | renders `"No Spatial-planning task designated yet — … nobody can draw or edit"` | **false warning** contradicting the open flag |
| `budget/voting.ts:379+` `listBudgetNeedsAction` | no budget items | every budget lands in every member's queue when open — noisy, not incorrect |
| `conflict.ts:51-52` `listConflictTeamMemberIds` | returns `[]` | the **recusal target picker** goes empty, so `recusePeer` has no one to pick even though `isConflictTeamMemberId` now accepts everyone — the UI would silently lose the feature |

**Class 4 — task-scoped, correctly so.** These are about *a specific task's* grants, not
about who holds a module, and an open flag must not touch them: `tasks/crud.ts:121-127`,
`tasks/endorsements.ts:145-150`, `permissions.ts:258-270` (`listGrantsWithTaskInfo`, which is
also what the settings tab renders), `task-packs/export.ts:123-125`, `cycles/crud.ts:825-826`
and `:859-860` (`copyPermissionGrants`).

`cycles/crud.ts` and `task-packs/export.ts` are also where open question 3 bites: those paths
carry grants between communities/events, and an open flag is a community-level fact with
nowhere to ride.

**Class 5 — copy that becomes false.** `settings/page.tsx:178` ("No task grants this yet") is
fine as written *if* the open checkbox is rendered above it and worded so the two don't
contradict. `recruitment/page.tsx:257` and `spatial-planning/page.tsx:159` are the two that
assert nobody can act, and both need the open branch.

### 3.2 Open-and-unheld is different from multi-holder

Surfaced while working out what an open `budget` would do, and it turned out not to be a
budget question.

`listBudgetNeedsAction` (`budget/voting.ts:379-404`) returns a **per-actor** list and already
contains the exact distinction that matters:

- **Owner-management items** — `close_to_voting` and `confirm_funded_set`, gated on
  `isBudgetOwner` (`:384`). Someone must close the period and confirm the funded set.
- **A participatory item** — `cast_vote` (`:393-401`), explicitly *not* ownership-gated. The
  comment above the function says it "is read for every member's Dashboard, not just the
  owner's, since cast_vote applies to anyone."

So the collaborative half of a budget is **already** collaborative, and opening the module
changes nothing about it. What an open module adds is the two management items appearing in
*every* member's feed, phrased as personal obligations ("Budget needs your attention") that
nobody opted into.

Every module with a needs-action list is per-actor the same way, and the dashboard calls each
once per member (`dashboard.ts:181-197`) and sums them into the nav badge
(`nav.ts:311-329`):

| List | Gated on |
|---|---|
| `listRecruitmentActionItems` | recruitment holder |
| `listEventSchedulingNeedsAction` | scheduling owner |
| `listKitchenNeedsAction` | kitchen owner |
| `listShiftCoordinatorNeedsAction` | shift manager |
| `listConflictNeedsAction` | conflict team |
| `listBudgetNeedsAction` | budget owner (management items only) |

**The distinguishing property is consent, not headcount.** `task.capacity > 1` (§1.2) is a
deliberate redundancy choice — splitting load so that at least one holder is likely to be
available at any given time — and five people each seeing a needs-action item is that working
as intended, not duplication to be suppressed. An open, unheld module is the opposite: every
member is in the module by *default*, nobody took it on, and there is no on-the-hook person.
That is the case worth rendering differently.

**Proposed (D12):** a needs-action item is `personal` when the actor actually **holds** the
module via a task assignment, and `shared` when the actor is only in the module because it is
open. Two useful consequences: a module that is open *and* held by five gives those five
personal items and the remaining members a shared one; and `capacity > 1` is left completely
untouched, because it is a feature.

This corrects two earlier drafts of this plan, both wrong for the same reason — they reached
for a numerical rule. The first said "open and unheld"; the second said "resolves to more than
one person," on the theory that `capacity: 5` produced duplicate items. It does produce five
items, and that is the point of `capacity: 5`.

#### Where a `shared` item would render

The dashboard feed is the **only** needs-action surface in the app, so the decision is a
decision about the feed:

- **Dashboard feed** — 16 titled `FeedSection`s, each a list of `FeedRow`s
  (`dashboard/page.tsx:509-725`). The module sections are "Recruitment candidates stuck
  waiting on you" (`:596`), "Budget needs your attention" (`:656`), "Programme proposals
  awaiting review" (`:669`), "Shift occurrences needing completion marks" (`:686`), "Conflict
  reports needing acknowledgment" (`:712`), "Kitchen needs your attention" (`:725`).
- **Nav badge** — `taskBadgeCount` (`nav.ts:311-329`) is a flat sum of 18 list lengths,
  rendered on the Dashboard nav item (`AppShell.tsx:327`).
- **Email** — only two paths exist, both gated on `member.emailNotificationsEnabled`:
  `notifyBackstopOfHardFlag` (`backstop.ts:129-136`) and announcements
  (`messages.ts:317-320`). Email is not a needs-action surface in this app; everything else is
  in-app and recomputed per page load.
- **Nothing else** — no notification centre, no digests, no per-module inbox. `/questions` is
  explicitly "a supporting page, not a destination in its own right"
  (`dashboard/page.tsx:220-223`).

**Decided: the split is per section, not per item.** `FeedSection` (`dashboard/page.tsx:80`)
gains a `shared` flag; the page renders every personal section first and the shared ones
below, and a shared section is marked so it reads differently from a personal one. This works
because D12's condition is a property of the *actor and module*, not of the item: you either
hold the module or you don't, so for five of the six lists the whole section is personal or
the whole section is shared, and no item needs classifying individually.

Titles lose their second-person framing when shared — "Budget needs your attention" is a
personal claim and cannot survive being true of everyone. Shared sections keep the module
identity and get an explicit marker, e.g. "Budget — waiting to be closed" with a
`Tag tone="neutral">open to everyone</Tag>`.

**The one exception is `budget`,** and it is a real wrinkle rather than a detail.
`listBudgetNeedsAction` already mixes per-person and per-owner items: `cast_vote` is emitted
for anyone who has not voted, independent of ownership (`:393-401`), while the two management
items are owner-gated (`:384`). With `budget` open and the actor not a holder, the list
therefore contains one genuinely personal item (`cast_vote` — *you* have not voted) and two
shared ones. The budget section has to be able to split, or `cast_vote` gets buried under the
shared items it does not belong with. The other five lists are unaffected.

**The badge counts personal items only** (decided). `taskBadgeCount` is described in its own
comment as "your held-task obligations" (`nav.ts:306-310`), and a shared item is not one. This
means the sum at `nav.ts:311-329` stops being simply "the lengths of the 18 lists" and filters
instead — a small change to a number the Dashboard and the nav deliberately keep in agreement
(`dashboard/page.tsx:224-225`), so both must filter identically from the same tagged items.

Whatever renders, a `shared` item must stay **visible**. The failure to avoid is D12 quietly
turning "everyone can close the budget" into "nobody is told the budget needs closing."

---

## 4. Gates that need fixing before a module can be open

Neither of these is a reason to limit the permission. Both are places where existing code
gates on *"a task is granted"* as a proxy for *"the module is staffed"*, and an open module
makes the no-task case reachable deliberately — so the proxy has to be replaced with a
different answer rather than left to fail.

### 4.1 `conflict_team` — recusal is not a power, but filing is gated on a task

**Recusal: no limit, for a concrete reason.** An earlier draft of this plan proposed keeping
`recusePeer` task-gated even when the team is open, on the grounds that excluding another
person is a power over them. That was wrong, and the module's own code shows why:

- `acknowledgeConflictReport` (`conflict.ts:249`) takes a `requireConflictTeamMember` and
  makes the actor the point of contact.
- `resolveConflictReport` (`conflict.ts:267`) has **no team check at all** — only
  `report.acknowledgedBy === actor.id`. Whoever acknowledges records the resolution, with a
  written note, terminally.

So open membership already lets any member claim a conflict report and decide its outcome.
That is strictly more authority than removing someone from handling one report, so gating
recusal harder than acknowledging would protect nothing — and could not be done coherently,
since acknowledge/resolve must stay open for the module to work. Recusal is also the weaker
act on its own terms: it is a claim about *involvement* rather than a sanction, it is recorded
with `addedBy`, it is visible to everyone who can see the report
(`listConflictReportExclusions`, `conflict.ts:200-207`), it is idempotent
(`addExclusionIfMissing`, `conflict.ts:209-221`), and it is not destructive — the report is
still handled, by more people rather than fewer. The spec already asks for it to be broad:
"recusal from three directions, not just the reporter" (`conflict.ts:223-228`).

**The real problem is the filing path.** `fileConflictReport` (`conflict.ts:78-82`) opens
with:

```ts
const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "conflict_team");
if (grantingTaskIds.length === 0) {
  throw new AppError("Conflict management isn't set up for this Community yet");
}
```

That is a *staffing* check standing in for a *configured* check. With `conflict_team` open
and no task granted — a perfectly sensible configuration, since the whole point is not to
need a task — **nobody can file a report at all.** The module becomes a place where conflicts
can be handled but not raised, which is worse than either state on its own.

**Fix:** `fileConflictReport` should require the module to be *configured or open*, not
granted. `moduleOn || isModuleOpenToEveryone(...)` is the correct guard; the message should
change to match, and `nav.ts:185` (which currently derives `visibleModules.conflictReports`
from grant existence alone) needs the same treatment or the nav item disappears for an
open community.

This is the same class of bug as §4.2 and the reason the classification in §3 is about
*secondary consumers* rather than about which permissions feel safe to open.

### 4.2 `recruitment` — the scheduled job needs an author

`getRecruitmentTaskHolderMember` has exactly one call site: the scheduled
`resolveWiderDiscussionWindows` job (`decisions.ts:474`), which passes the result as `actor`
to `maybeCreateAccompanimentTask`. Its own comment states the requirement — "Accompaniment's
own task creation genuinely does need a real actor to create a Task as."

This is not an authority question (any member may author their own Task) but it does need a
deterministic member id when the job runs with no actor. **Proposed fallback order:** the
converted member's referrer (`referredByMemberId`, already read at `decisions.ts:277`) →
else the earliest-claimed evaluator on the decision → else skip accompaniment and log it.
Never a random member, since the accompaniment task is visible.

Note `createIntroCallPoll` and `maybeCreateAccompanimentTask` both need the granting **task**
for its `branchId` (`decisions.ts:112,271`) and return `null` when none is granted. With a
module open and no task granted, both would silently no-op. That is a pre-existing
degradation for the no-grant case, but open makes it reachable deliberately, so both need a
branch fallback (or an explicit "needs a Recruitment task to file under" warning).

---

## 5. The one site that would *widen* rather than break — deferred

Everything in §3.1 fails closed or degrades quietly. One site fails **open**, and it is the
reason this sweep was worth doing on its own. **It is not being changed in this plan (D9) —
this section exists so the other session starts from the finding rather than rediscovering
it.**

`listUnlockedFields` (`sensitive-data.ts:176-237`) resolves the "Sensitive data access"
feature. A Community can unlock a sensitive field — dietary restrictions, or whatever the
`SensitiveFieldKey` set holds — by **Tier**, by **task**, or by **permission module**
(`sensitive_field_access_rule.unlockedByGrantModuleKey`). The module route resolves at
lines 229-234:

```ts
if (rule.unlockedByGrantModuleKey) {
  const grantingTaskIds = grantTaskIdsByModule.get(rule.unlockedByGrantModuleKey) ?? [];
  if (grantingTaskIds.some((id) => heldTaskIds.has(id))) {
    unlocked.add(rule.fieldKey);
  }
}
```

Purely task-hold-based. So: **a Community that unlocks the allergies field to the `kitchen`
role, and then opens `kitchen` to everyone, has just made every member's medical/dietary
data readable by every member** — with no warning, on a checkbox whose label says "Everyone
has Kitchen." The person who ticked it is thinking about who can build a menu.

The existing code is careful about the *wrong* thing here, which is what makes the gap easy
to miss — it goes out of its way to keep modules from cross-satisfying each other ("a hold of
a `budget` task must not satisfy a rule that names `kitchen`", `sensitive-data.ts:195-198`).
It has no concept of a module being *open* rather than *held*.

**Status: DEFERRED (D9) — this section is a written-down warning, not a spec to implement.**
The underlying question — whether an open module should unlock a sensitive field, and how
that relates to profile questions, consent purposes, and the sensitive-vs-planning-field
distinction — is being worked through separately. This plan does not modify
`sensitive-data.ts`.

The consequence of leaving it alone is the safe one: `listUnlockedFields` resolves
`unlockedByGrantModuleKey` purely by task-hold, so an open module does **not** unlock a
sensitive field without anyone deciding that it should. That is D9's proposed outcome reached
by inaction rather than by a decision, which is worth being explicit about rather than
relying on.

The alternative — open implies unlocked — is defensible for `kitchen` ("anyone can cook, so
anyone should see the allergies") and indefensible for `admin`. A single uniform rule cannot
be right for both, which is the argument for keeping the two settings independent.

Two things this plan owes whichever way that session lands: the settings UI must not *imply*
that opening a module widens a field's visibility, and the coupling should be surfaced
whenever a module is opened that has a rule pointing at it — not because the behaviour is
changing, but because the person clicking should know it exists.

---

## 5a. Settings UI

In `GrantField` (`settings/page.tsx:167-234`), one checkbox per module, above the grant list —
so it reads as the *primary* fact when set and a relaxation of the task list when not:

```
┌ Recruitment ─────────────────────────────────────────────┐
│ Event-shaped — placed in an event, it evaluates…          │
│                                                          │
│ ☐ Everyone has this permission                           │
│                                                          │
│ Task grants this:                                        │
│   Recruitment 2026 — Coordination — Evergreen            │
│   Held by Sam and Robin (2)          → task view         │
│   [Remove]                                                │
│                                                          │
│   Kitchen lead — Kitchen — Community-wide                │
│   Held by 6 people                  → task view         │
│   [Remove]                                                │
└──────────────────────────────────────────────────────────┘
```

The holder count answers a question the tab currently cannot: `capacity` is the real control
on how many people hold a role (§1.2), nothing in the permission layer reads it, and today
nothing in the interface shows it. A community can put a single-cardinality module like
`recruitment` in the hands of five people by setting the granting task's `capacity`, and the
Access & permissions tab gives no hint that it has happened.

**Names at three or fewer, count above that** (decided). Three names fit on a line and make
redundancy legible — "Sam and Robin are sharing this" reads as deliberate, where a bare "2" can
read as a misconfiguration. Past that the names stop helping and the count is the useful part.

**The count always links to the task** (decided), because the count alone cannot answer "who,
actually". The task's reference rail already renders `Held by: …` from `realAssignments`
(`tasks/[id]/page.tsx:1851-1854`) and is **not** gated behind holding the task, so the link
resolves for any admin viewing the grant. This matters most in exactly the case the count
hides — the six-names row — and costs nothing in the two-names row.

The data is the `countHoldersOfTasks` helper from §2.2, fed the `taskId`s `GrantField` already
has in `grants[]` — one call per grant row, no new query plumbing. It needs a variant that
returns members as well as a count, or a second call, to render the ≤3 names.

Copy rules:
- Checked: state the capability in the module's own words, and say plainly that the task
  below is no longer required. Never say "unlocked" or "bypassed" — this is a chosen state.
- Unchecked, with a grant present: leave the existing form exactly as it is.
- Unchecked, with no grant: existing "No task grants this yet."
- Both open and unheld → a `Banner tone="warning"`: nobody is named, so notifications and
  needs-action routing have no target (this is the `backstop` case made visible).
- `support` open → an extra warning line: every member can then view the platform as any
  other member, read-only. Deliberate, but worth stating at the point of decision.
- `admin` open → a warning that every member can change every Community setting.

Mechanics: `PERMISSION_MODULE_SECTIONS.map` → `section.moduleKeys` → `<GrantField>`
(`settings/page.tsx:598-608`) already renders all 14, so the checkbox needs no loop change —
only `GrantField`'s props. Data comes from one `listOpenModuleKeys(communityRow.id)` call
alongside the existing `listGrantsWithTaskInfo` (`settings/page.tsx:384`).

Server action: `setModuleOpenAction` in `settings/actions.ts`, mirroring
`setPermissionGrantAction` (`:263`) — `requireMember()` → `requireAdmins(actor)` → zod
(`moduleKey: z.enum(PERMISSION_MODULE_KEYS)`) → upsert/delete → `revalidatePath("/settings")`.
`removePermissionGrantAction` (`:307`) has no `requireTaskInActorCommunity` because the lib
function does its own checks; the open action needs no such check since it names no task.

---

## 6. Implementation plan

Ordered so that each step is independently verifiable and no step leaves the app in a state
where a checkbox exists but does nothing. **Step 0 is a hard prerequisite** — nothing here is
testable without it.

**Step 0 — Make the test suite runnable.** It integration-tests against a real Postgres, each
file truncates the DB, and no test `DATABASE_URL` is configured (`db/index.ts:10` falls back
to a placeholder, so every file currently fails). Add a dedicated test database or a per-run
schema, and wire it into `vitest.config.ts`. Until this lands, every step below is verified by
reading rather than by running. **Do not point the suite at the development database.**

**Step 1 — Storage.** New table `open_permission_grant (community_id, module_key, opened_at,
opened_by)`, PK on `(community_id, module_key)`, reusing the existing
`permissionGrantModuleEnum`. One migration. No resolvers read it yet, so this is inert. **DONE** — `open_permission_grant`,
migration 0075, 8 storage tests.

**Step 2 — Read primitive.** `isModuleOpenToEveryone` + `listOpenModuleKeys` in
`permissions.ts`, with the §2.2 safety note about why this is separate from
`listGrantingTaskIds`. Plus `listHoldersOfTasks` / `countHoldersOfTasks` for D12 and D14.
Still inert. **DONE.**

**Step 3 — Class 2 first (scope sets, 3 sites).** The smallest correct enforcement change and
the easiest to test, because the expected value is unambiguous: `new Set([null])` from
`listHeldRecruitmentScopes`, `listHeldFeedbackReviewScopes`, `ownedKitchenScopeIds`. **DONE**
— all three edited. **But the step ordering overstated what this delivers:** only
`feedback_review` is actually usable afterwards, because it is the only one of the three with
no Class 1 gate in front of it. `listPostCycleFeedbackResponses`' sole gate is the scope set
(`forms.ts:549-552`); `listKitchenNeedsAction` opens with `if (!(await isKitchenOwner(actor)))
return []` (`kitchen/needs-action.ts:51`) and every recruitment consumer calls
`requireRecruitmentTaskHolder` first. So **`recruitment` and `kitchen` are still closed after
Step 3** — pinned by two deliberately-named `INTERIM:` tests that assert the refusal still
happens, so Step 4 cannot land half-applied. Step 4 is the first step that unlocks anything
beyond feedback review.

**Step 4 — Class 1 (capability resolvers, 11 sites, 13 modules).** Mechanical: one open check
per resolver. `admin` first (it also has to sit *before* the `adminsEverClaimed` bootstrap,
D2), then `support` and `conflict_team` (the `community` tier, no scope questions), then the
tri-state ones (`event_scheduling_owner`, `spatial_planning`, `kitchen`), then
`coordination.ts`'s `communityWide` flag (covering both coordination keys), then
`shift_management` and `budget`. `announcements` must move both halves together (D8) or not
at all. **`backstop` is skipped entirely** (D11) — it is not openable, so `isBackstopForScope`
keeps its current `.limit(1)` behaviour with no edit. **DONE** — all 13 modules reachable;
`backstop` deliberately has no path. The two `INTERIM:` tests from Step 3 flipped as expected,
which is what confirmed the boundary was real rather than assumed.

**Step 5 — Class 3 (the proxies).** This is the step the sweep exists for, and it is where an
open module would misbehave. **DONE.**
- `fileConflictReport` (`conflict.ts:93-101`) — configured-or-open guard + new copy (§4.1).
- `conflict-reports/page.tsx:42-49` and `nav.ts:176-188` — same predicate. The nav item used to
  vanish for a Community that had opened the team, leaving it able to file and handle reports
  with nowhere to go.
- `listConflictTeamMemberIds` (`conflict.ts:65-75`) — an open team returns *every* member, not
  `[]`. It was going empty while `recusePeer`'s own target check accepted everyone, so the
  recusal UI lost its picker entirely.
- `recruitment/decisions.ts:104-126` and `:285-292` — the branchId dependency. **Deliberately
  not given an arbitrary fallback:** a member has no branch column and a cycle has none either,
  so there is nowhere to file a Poll or a Task. Reported via
  `RecruitmentAuthority.needsTaskToFileUnder` and surfaced on the hub, because a real poll
  appearing under an unrelated branch is worse than a visible gap.
- `recruitment/decisions.ts:75-121` — the author's fallback chain (§4.2): the converted
  member's referrer, then the earliest evaluator, for the scheduled job's
  `maybeCreateAccompanimentTask`.
- `describeRecruitmentAuthority` (`recruitment/access.ts:93-140`) — `open` as a fourth
  authority state, plus `unstaffed` and `needsTaskToFileUnder`. Without this the hub reported
  "nobody can evaluate applications" about a Community where every member can.
- `spatial-planning/page.tsx:101-110,161` — the false "nobody can draw or edit" warning.
- `listGrantingTaskIdsForScope` (`permissions.ts`) — unchanged, per **D15**; the open check is
  its callers' responsibility, which is why the spatial-planning page had to make it.

**Step 6 — Nav and needs-action (D5 + D12).** `nav.ts:231-240` pins: `holdsGrantedTask`
(`nav.ts:66-81`) must keep returning `false` for an open module rather than flipping to
`true`, and the nine holder probes at `nav.ts:206-214` should short-circuit so an open module
doesn't pay nine queries per page load to compute pins nobody gets. Then the `shared`
distinction from §3.2 across all six needs-action lists, the badge sum at
`nav.ts:317-328`, and the dashboard's rendering. **D12's mechanics are still open (§10 q1) and
this step is where that gets decided** — it is the one step here that is design, not
mechanical, and it can slip without blocking anything before it. **DONE.**

Landed as `src/lib/needs-action.ts`: a `NeedsAction<T>` type and one helper,
`isSharedByOpenness(communityId, moduleKey, actorId, grantingTaskIds)`. All six lists now
return `{personal, shared}`; the six Dashboard sections were hoisted into one
`ModuleNeedsActionSections` component rendered twice — the personal pass in place, the shared
pass after every task-side section, with an "open to everyone" tag per section — and
`taskBadgeCount` sums `.personal` only.

Two things this turned up that the design hadn't anticipated:

- **`isCoordinator` is not a pin-only signal.** It also drives the `coordinatorOnly` nav
  items' *visibility*, so suppressing it for an open module would have **hidden** the
  Coordination destination from everyone rather than merely unpinning it. It stays an accurate
  capability answer; only its pin is suppressed.
- **Budget is the only genuinely mixed list**, which is why `isBudgetOwner` was split into
  `isBudgetOwner` (open *or* held) and `holdsBudgetGrant` (held only). `cast_vote` is personal
  to whoever hasn't voted; the two management rows are shared unless the actor really holds the
  grant — and *opening the module is not the same as holding it*, which is precisely the
  distinction the split exists to preserve.

**Step 7 — Settings UI.** The checkbox in `GrantField` (`settings/page.tsx:167-234`),
`setModuleOpenAction` in `settings/actions.ts` mirroring `setPermissionGrantAction` (`:263`),
plus the copy rules in §5a. Include the D13 warn-and-confirm for `admin`/`support`, the
open-but-unheld "nobody is named" banner, and **no** claim that opening a module widens a
sensitive field's visibility (D9). `backstop` renders no checkbox at all (D11) — the field
should say why, so it doesn't look like an oversight.

**Step 8 — Class 4, deliberately untouched.** Task-scoped readers stay as they are. Cycle
clone and Task Pack export already carry grants only and need no edit, since open flags do
not travel (§2.4) — record that as decided rather than as an oversight.

**Step 9 — Tests.** One open/closed pair per module, plus the specific cases already listed.
The closed half is the regression net for the other thirteen, so it matters more than the
open half: 13 modules' worth of existing behaviour must survive this change untouched.

**Deliberately last:** nothing in Steps 1–2 changes behaviour, so they can ship together and
early; nothing in Step 5 can ship before Step 4, because "open but misconfigured" is worse
than either state alone.

---

## 7. Tests

One test per module, all the same shape, because that is what makes a 14-file mechanical
change safe to review:

```
it("open: a member who holds nothing can <capability> when the module is open")
it("open: a closed module still refuses a non-holder")   // the no-regression half
```

Plus specific cases:
- `conflict_team` — open grants `recuseSelf`, `recusePeer` **and** `acknowledgeConflictReport`
  with no extra condition (§4.1); and, the part that actually needs a fix, `fileConflictReport`
  succeeds with **no task granted** at all instead of throwing "Conflict management isn't set
  up for this Community yet", with `nav.ts:185` still showing the nav item.
- `recruitment` — `listHeldRecruitmentScopes` returns `{null}` when open, so
  `requireRecruitmentScopeForCycle` passes for every cycle id including `null`.
- `announcements` — both authorities open together; `isAnnouncementHolderForCycle` and
  `isAnnouncementTaskHolder` both true when open.
- `backstop` — **not openable** (D11), so no open/closed pair; the existing holder-gate tests
  stand unchanged as the regression net.
- `admin` — open overrides the `adminsEverClaimed` bootstrap, and an open+closed pair behaves
  as closed.
- Idempotence — opening twice is one row; the PK prevents duplicates.
- A module left closed by every existing test is the regression net for the other 13.

The current suite is **not runnable**: it integration-tests against a real Postgres, each
file truncates the DB, and no test `DATABASE_URL` is configured (`src/db/index.ts:10` falls
back to a placeholder). Pointing it at the development database would destroy local data. It
needs a dedicated test database or a per-run schema before any of this is verifiable.

---

## 8. Locked decisions

- **D1 — Separate table, not a nullable `taskId` or a `community` column.** A `NULL` taskId
  grants nothing while looking correct, which is the worst possible failure direction.
- **D2 — Open is an explicit, chosen state.** It overrides `admin`'s bootstrap gate on
  purpose; the bootstrap exists to prevent lockout, and an explicit choice is better evidence
  than a startup artefact.
- **D3 — Open means the community/evergreen scope**, i.e. a superset for `cycle`-tier
  modules. No narrower reading of "everyone."
- **D4 — The task grant is orthogonal and stays.** Open does not delete it, and it keeps its
  meaning: who is named, who gets notified, whose queue it is. Note that "the holder" is
  whatever `task.capacity` allows, which for an `admin` task is unbounded (§1.2) — so this
  decision is about *keeping a name attached*, not about there being exactly one.
- **D5 — No nav auto-pin when open.** Outstanding work surfaces through normal feeds.
- **D6 — All defaults off.** No existing community gains authority by upgrading.
- **D7 — Recusal is not separately gated.** `recuseSelf` and `recusePeer` both open with
  `conflict_team`, with no extra condition. Open membership already confers the larger power
  (`acknowledgeConflictReport` → `resolveConflictReport`), so a narrower recusal gate would
  protect nothing (§4.1).
- **D8 — `announcements` opens both halves or neither.**
- **D9 — DEFERRED, do not touch `sensitive-data.ts`.** The coupling between an open module
  and an `unlockedByGrantModuleKey` rule (§5) is real and is being considered alongside
  profile questions, consent purposes, and the sensitive/planning-field distinction in
  another session. **This plan does not modify `listUnlockedFields` at all.** The useful
  consequence of doing nothing: `sensitive-data.ts:229-234` is already purely task-hold-based,
  so leaving it untouched means an open module *does not* unlock a sensitive field — the safe
  behaviour, arrived at without deciding the question. The one thing this plan owes that
  session is to **not imply otherwise in the UI**: the settings copy must not claim that
  opening a module widens a field's visibility, and §5 stays as the written-down warning.
- **D10 — Task-scoped grant readers are untouched.** `listModuleKeysGrantedByTask`,
  `listGrantsWithTaskInfo`, endorsements, and Task Pack export describe *a task's* grants;
  an open flag is a community-level fact and must not leak into them.
- **D11 — `backstop` is the one module with no checkbox.** Its authority is a *named person*
  to notify (`notifyBackstopOfHardFlag`, `backstop.ts:135`) and the task detail page names
  them, so a backstop with no name has nothing to do. `isBackstopForScope` gets no open check
  and `resolveBackstopHolder` keeps its `.limit(1)`. Every other module is openable.
- **D12 — A needs-action item is `personal` when the actor holds the module, `shared` when they
  are only in it because it is open.** The distinction is consent, not headcount (§3.2):
  `capacity > 1` is a deliberate redundancy choice and is left completely alone, while
  open-and-unheld membership is by default rather than by choice. Open *and* held by five
  gives five personal items and one shared view for the rest. Rendering is **per section** —
  personal sections above shared ones, shared ones marked, titles dropped of second-person
  framing — and the **badge counts personal items only**. `budget` is the one list that must
  split, because `cast_vote` is per-person while its management items are not.
- **D13 — `support` and `admin` are openable, but warn-and-confirm.** Allowed, since a small
  community may genuinely want that, but the settings UI states the blast radius in the
  module's own words before the box can be ticked, and the confirmation is a second, explicit
  step rather than the same click.
- **D14 — Settings shows who holds a granting task.** Each grant row in `GrantField` displays
  a holder count, **names when there are three or fewer**, and the count always **links to the
  task view**, which already shows `Held by` ungated (`tasks/[id]/page.tsx:1851-1854`).
  `capacity` is the real control on how many people hold a role and nothing in the permission
  layer or the interface currently surfaces it (§1.2, §5a).
- **D15 — Open short-circuits scope rather than being filtered by it.** Under D3 an open
  module *is* the community/evergreen scope, which is already a superset, so
  `isAnnouncementHolderForCycle` is true for an open `announcements` module without
  `listGrantingTaskIdsForScope` growing an `open` parameter. The open check runs first; the
  scope filter is only reached when the module is closed. This is why the question was worth
  asking: it is the one place where "open" and "scope" could interact, and the name
  `…ForScope` invites adding a parameter that would be redundant.

## 9. Resolved questions, and what they changed

1. ~~Should `support`/`admin` be openable?~~ → **D13**: yes, with warn-and-confirm.
2. ~~`backstop` with no named holder?~~ → **D11**: it isn't openable at all. This removed
   `backstop` from Class 1 and made it the sole exclusion.
3. ~~Do open flags travel with Task Packs / cycle clone?~~ → **No** (§2.4). Cycle clone and
   Task Pack carry grants only; an imported pack or a cloned cycle arrives closed.
4. ~~Should the flag record who opened it?~~ → **Yes — but see §9.1**: this turned into a
   larger question about auditing *all* settings changes, which is a separate piece of work.
5. ~~Which sensitive fields should an open module unlock?~~ → **Deferred** (**D9**), with the
   safe behaviour obtained by not touching the code.
6. ~~What happens to `budget`'s needs-action when open?~~ → **Not a budget question**
   (**D12**); it generalised to all six needs-action lists.

### 9.1 The audit-trail question that came out of #4

Asking "should the open flag record *who* opened it" surfaced that **there is no audit
mechanism for settings changes at all.** No audit, history, or revision table exists anywhere
in `src/db/schema` — the schema comments are explicit that several entities have "no revision
history; spec doesn't ask for one here" (`profile-question.ts:224`, `call.ts:29`). What
exists is incidental: `proposedBy` on a milestone as "a pure audit" field
(`task-milestone.ts:51`), and `objection.raisedBy` "stored, never deleted, a real audit trail"
(`recruitment.ts:84`). Those are columns that fell out of the feature, not a log.

A general audit trail is a real feature and clearly out of scope here — Settings has ten tabs
and ~80 `requireAdmins` actions, and a faithful log means capturing old/new values for all of
them. **Deferred to its own piece of work** (decided). What stays in this plan is the cheap
half: `opened_by` on `open_permission_grant` alongside `opened_at`, so "who decided the whole
community could View-as anyone" survives. `opened_by` recording *closing* is part of the
deferred work — the row deletes on close, so the flag table alone cannot answer "who turned
this on and off, and when" without a tombstone, and that is a log-shaped problem.

Carried over to the deferred audit work, since it is the reason that work is worth doing: a log
would show *that* the `kitchen` module was opened and `opened_by` shows *who*, but neither
shows that an allergies field was attached to that module in the same breath — which is the
case §5 is actually worried about.

### 9.2 Follow-up: an open Recruitment Community with several branches

Raised after Step 5. **The premise needs narrowing first:** this is not conditional on
branches being enabled. `task.branchId` is `NOT NULL` and `createPoll` requires a `branchId`
(`scheduling-polls/crud.ts:12`), so every Community always has branches and always has
exactly the poll/Task shape that needs one. What is conditional is narrower:

- An open Recruitment Community **with** a granting task: the branch comes from that task, so
  intro calls and accompaniment tasks are created normally. Working as intended.
- An open Recruitment Community with **no** granting task: no branch to borrow. Evaluating and
  deciding work; the two follow-on side effects do not.

**Proposed fix, deliberately deferred:** fall back to the Community's **sole** branch when it
has exactly one, which covers the common small-Community case and makes open Recruitment work
end-to-end there. With two or more branches the gap stays visible rather than guessed —
picking one arbitrarily would file a real Poll and a real Task under an unrelated branch, which
is worse than a visible omission. If a Community wants this to work with several branches, the
real answer is probably to let the open flag name a branch, rather than to infer one.

Tracked as: `RecruitmentAuthority.needsTaskToFileUnder` is the detection, the hub banner in
§5a is the report, and the sole-branch fallback is the fix.

---

## 10. Still open

All design questions are now answered. The settings audit trail (the old q4 and q5) is
**deferred to its own work** (§9.1). What remains is implementation detail, recorded so it is
not rediscovered mid-build:

1. **The shape of the needs-action return type.** §3.2 decides *what* is personal versus
   shared, but the six lists currently return flat arrays. Both `dashboard.ts:181-197` and
   `nav.ts:311-329` consume them and must agree. The options are tagging each item
   (`personal: boolean`) or returning `{personal, shared}` pairs; the budget split makes the
   second cleaner, since it is the one list that genuinely contains both.
2. **How `listBudgetNeedsAction` splits.** The `cast_vote` / management-item boundary is a
   property of *which branch pushed the item* (`budget/voting.ts:384` versus `:393-401`), so
   it is knowable at push time rather than inferred later. Worth tagging at the source.
3. **`describeRecruitmentAuthority` — guidance withdrawn.** This plan originally said it
   "should be refactored onto the shared helper rather than left as a parallel
   implementation." Having built the helper, that turns out to be wrong: the helper dedupes
   to distinct members (`listHoldersOfTasks`), while this function needs **per-holder task
   attribution** — taskId, title, cycleId — so the hub can say who holds Recruitment *via
   which task*. Forcing it onto the helper would either add a second query or drop data the
   type deliberately carries. The two do compute the same number by different routes, so the
   plan's actual intent (no drift) is met by an anti-drift test pinning
   `evaluatorCount` to `countHoldersOfTasks` — see `tests/open-permissions.test.ts`,
   "agrees with describeRecruitmentAuthority's evaluatorCount".
4. **Whether a shared section should show who is already on it.** If a module is open *and*
   held, D12 gives holders personal items and everyone else a shared one — the shared section
   could name those holders, which is the one place it would genuinely help. Not required, and
   it means a member list the shared section has to fetch.

Settled and needing no further input: `listGrantingTaskIdsForScope` stays task-only (**D15**);
`countHoldersOfTasks` takes a task-id list rather than a scope parameter (§2.2); cycle clone
and Task Pack export carry grants only and need no edit (§2.4); `sensitive-data.ts` is not
touched (**D9**).

Ready to build from Step 0 (the test database), which is the only thing gating any of this.
