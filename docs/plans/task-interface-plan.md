# Task interface: a separate edit screen, visible slots, propose-anytime nomination

**Status:** all three phases are built — the plan is fully implemented. Phase 1 (the edit
screen, D1–D2 and the edit-screen half of D7, 2026-10-31): `/tasks/[id]/edit` holds the details
form, requirements, dependencies, milestone add/edit/remove and permission grants; the read page
keeps state actions and content only, and reaches the screen via the ⋯ menu's "Edit task…".
Phase 2 (Who's on it, D3–D4 and D6, 2026-11-13): the task page leads with explicit filled/empty
slot rows plus the join-request, nominate and waive actions in one section; the capacity chip
renders slot dots up to capacity 5 on cards and the detail header; subtasks show their done-count
rollup. Phase 3 (propose-anytime nomination, D5 and the rest of D7, 2026-11-15): nomination is
offered on any non-endorsed, non-done task; at capacity the nomination raises the count by one in
the same transaction as the claim; `performClaimInTx` accepts a waiting task and leaves it parked,
and a parked task can be asked about or claimed too (D8); board cards link to the nominate form
from the ⋯ menu (`?nominate=1#nominate`: the query renders the disclosure open, the fragment
scrolls to the form). Direction agreed with the
product owner 2026-10-30 (three decisions confirmed in conversation, marked D2/D5/D6 below).
Written after comparing Orchard's task card and task detail page against the Humans
tasks/teams/navigation prototype (`DustyCupcake/Humans`, branch `spec/tasks-teams-navigation`,
`docs/superpowers/specs/2026-10-19-tasks-teams-navigation-prototypes/tasks/task.html` and the
accompanying tasks-module spec) and picking the improvements that survive contact with Orchard's
own spec and UI grammar.

> "All the edit options for the task detail, which are for some reason scattered across sections
> that collapse and expand, should all be on a separate edit screen accessible from the action
> overflow menu. The slots should also be better visible and the coordinator should see a way to
> propose that someone take a slot even if there is already someone on the task."
>
> — product owner, 2026-10-30

---

## 1. What exists today

**The task detail page** (`src/app/(app)/tasks/[id]/page.tsx`, ~2,150 lines) carries its edit
surface in nine different places with different discovery mechanics:

| What's editable | Where it lives | Mechanism |
|---|---|---|
| Title, description, branch, cycle, phase, effort, capacity, critical, tags | "Edit task" panel under the header | `<details>` |
| Requirements (add/edit/remove) | inside that same panel | nested `<details>` per row |
| Dependencies | inside that same panel | nested `<details>` |
| Milestones (add/edit/remove) | Milestones section | per-milestone inline forms + `<details>` |
| Permission grants (admin-only) | own panel mid-page | `<details>` |
| Wiki, comments, resources | main column | always-visible inline forms |
| Nominate someone, waive-and-claim | far down the page | two `<details>` panels |
| Split subtask, park, re-snooze, waiting/attention nudges | various | disclosures and contextual panels |

**Slots** render as a plain "Held by: names" text line in the rail Status card plus the numeric
capacity chip (`1/3`). Empty slots render as *nothing* — an understaffed task looks identical to a
fully staffed one unless the reader does the arithmetic. **Nomination** is gated by
`canNominate = authorizedToNominate && !isCommunityEndorsed && (unclaimed || (claimed && hasRoom))`:
on a *waiting* task, or a task at capacity (the common case — capacity 1, one holder), a
coordinator sees no affordance at all, and server-side `performClaimInTx` throws "Task is at
capacity". The board card has no nominate affordance either way.

## 2. What the Humans prototype does, and the verdict for Orchard

| Humans improvement | Verdict |
|---|---|
| "Who's on it" card: slots as explicit objects — filled rows (avatar, name, since), **empty "needed" slots rendered**, shadow slot visually distinct | **Adopt** (D3). Orchard already has every input: assignments, `isShadow`, capacity. Empty slots are `capacity − held`, just never rendered. |
| "Nominate someone" as a persistent coordinator action, independent of occupancy | **Adopt, adapted** (D5). Orchard's nomination is richer than Humans' (instant claim + courtesy response window); the change is visibility and the at-capacity rule, not the mechanism. |
| No edit UI on the read page at all; config shown read-only (their coordinator "Staffing" aside card) | **Adopt** (D1). The read page becomes view + state actions only. |
| "Understaffed · needs 2, has 1" pill from a separate *Needed* staffing floor | **Defer.** Humans splits Needed/Capacity; Orchard's spec has only capacity ("owner can raise it later… a way to ask for help") and covers understaffing through attention levels. A `needed` column is its own spec/schema conversation. |
| Subtask rollup ("1 of 4 done") in the section header | **Adopt** (D6). Trivial, real signal. |
| Notes/Comments/Activity behind tabs | **Skip.** Conflicts with an explicit Orchard decision: notes render inline, "never buried behind a toggle, a mode switch, or a different part of the app." |
| Status step strip (To do → In progress → Waiting → Done) | **Optional, not in this plan.** StatusIcon plus the board's columns already carry lifecycle status. |
| "Fits you?" personal fit card | **Mostly exists.** `getUnmetRequirements` is already viewer-specific; reframing the rail card is polish for another pass. |
| Following, activity feed, sticky mobile action bar, manual "ask for help" | **Separate features.** Orchard already covers help-seeking through signals, pings and escalation. |

## 3. Decisions

- **D1 — One edit screen at `/tasks/[id]/edit`.** All *config* moves there: the details form
  (title, description, branch, cycle, phase, effort, capacity, critical, tags), requirements
  management, dependency management, milestone add/edit/remove, and the admin-only permission
  grants. The read page keeps *state actions* (claim/finish/park/resume/release, milestone
  mark-done and confirm/reject-pending) and *content* (wiki edit, comments, resources, split
  subtask) — those are the work, not the task's settings. The existing posture that any member can
  edit a task's details is unchanged; only the location moves. Saving returns to the read page.
- **D2 — The ⋯ overflow menu gains "Edit task…"** (decided). A navigation item, per the UI
  grammar's "one primary, everything else in a menu"; the menu can hold links (it already holds
  "Make this a recurring shift…"). The big "Edit task" `<details>` panel, the per-milestone edit
  forms, and the permissions `<details>` are removed from the read page.
- **D3 — A "Who's on it" section makes slots explicit.** Main column, above Requirements. Filled
  slots: name, outgoing marker, gate-waived note. **Empty slots render as visible empty rows**
  (`capacity − realAssignments`, danger-styled when the task is critical or unclaimed; a
  `null` capacity renders holders plus a "room for more" line instead of countable empties).
  Shadow slots are a distinct "learning alongside" row, matching the spec's "doesn't count toward
  capacity, isn't who 'Held by' means". The section is also the home for the *slot-management*
  actions — nominate (D5), waive-and-claim, and the join-request accept/decline that already
  exists — so everything about who holds a slot lives in one place.
- **D4 — Board cards show slot dots.** `●●○` for capacity ≤ 5, the existing numeric chip beyond
  that, so understaffing is scannable on the board without opening the task. (decided)
- **D5 — Nominate anytime, raising capacity when full** (decided). `canNominate` drops the
  `hasRoom` and status restrictions: any coordinator or current holder can nominate on any
  non-endorsed, non-done task, including waiting ones. The form moves out of its buried
  `<details>` into the "Who's on it" section as a visible affordance. When the task is at
  capacity, the form says so — "this task is full; nominating adds a slot (N → N+1)" — and the
  nomination raises `capacity` by one inside the same transaction as the claim, per the spec's
  "owner can raise it later… a way to ask for help without releasing or splitting the task."
  `community_endorsed` stays excluded (candidacy is the only door there).
- **D8 — Joining a parked task never changes the parking** (decided with the product owner).
  A task in `waiting` takes a new holder through every door — nomination, an accepted join
  request, a waiver, an endorsement confirm, a plain claim — and `performClaimInTx` then adds the
  assignment and touches nothing else: status, check-in date, "waiting on…" note and attention
  level stay as the parking holder set them. The newcomer reads the task for the first time
  anyway and presses Resume themselves if having them there is what unblocked it; waking it for
  them would discard a date and note someone chose, and a nomination that is then declined
  would leave it woken for nothing. No wake/keep choice is offered anywhere. The other half: a
  member can *ask* to join a parked task (`claimOrRequestToJoin` allows `waiting`; the page and
  card show Claim / Request to join on one with room) — someone who knows they'd unblock it can
  say so. An `open` task claims straight away, a `request` / `coordination_approved` one files
  a request, and accepting it keeps the task parked. The request carries no message for now;
  the "waiting on…" note is already readable and the rest happens in conversation. The check-in
  is the task's, so the newcomer inherits it (it shows in their upcoming check-ins, and an ignored
  nudge is logged against every real holder).
- **D6 — Subtask rollup in the section header** (decided): "Subtasks · 2 of 5 done".
- **D7 — The Task UI grammar follows the code.** The action-hierarchy table in
  `docs/design_handoff_conventions/README.md` gains the edit-screen entry and the nominate
  affordance in the same commit as the code.

## 4. Scope

1. New route `src/app/(app)/tasks/[id]/edit/page.tsx` rendering the config form stack; it reuses
   the existing server actions in `src/app/(app)/tasks/[id]/actions.ts` (`updateTaskAction`,
   requirement and dependency actions, milestone add/update/delete,
   `updateTaskPermissionGrantsAction`).
2. `src/app/(app)/tasks/[id]/page.tsx`: remove the edit panels (D1/D2), add the "Who's on it"
   section (D3), relocate the nominate and waive-and-claim forms into it, widen `canNominate`
   (D5), subtask rollup (D6), update the "add and remove live in the Edit task panel" copy on the
   read-only Requirements/Dependencies sections to point at the edit screen.
3. `src/app/(app)/board/TaskCard.tsx`: slot dots (D4); ⋯ menu gains an "Ask someone…" link to the
   task page's nominate form for coordinators/holders.
4. `src/lib/tasks/nominations.ts`: the at-capacity capacity-raise inside the nomination
   transaction (D5); `performClaimInTx`'s capacity check otherwise untouched — the raise is the
   nomination's own deliberate act, not a general weakening of the gate.
5. `docs/design_handoff_conventions/README.md`: grammar table updated (D7).

## 5. Depends on

Nothing. No schema change: the capacity raise writes an existing column, and every other input
(assignments, shadows, capacity) is already fetched on both pages.

## 6. Done when

- The task detail page contains no `<details>` edit panels; every config change happens at
  `/tasks/[id]/edit` and round-trips back to the read page.
- An understaffed task shows its empty slots without the reader doing arithmetic, on the detail
  page and (as dots) on the board.
- A coordinator viewing a full, waiting, or already-held task can propose someone in one visible
  step; at capacity the slot bump is stated before they confirm.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` pass; `tests/tasks-nominations.test.ts`
  covers the capacity-raise and the waiting-task case; `tests/tasks-crud.test.ts` still passes
  against the edit screen's actions; manual verification against the Docker Compose stack.
- CHANGELOG entry and the grammar-table update land in the same commit as the code.
