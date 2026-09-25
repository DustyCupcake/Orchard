# Board declaration — historical handoff (Unclaimed queue landing)

> **Superseded by the current working-tree follow-up below.** The original
> session notes are retained for archaeology; their TypeScript faults and
> 17-test counts are not the current state of the board revamp.

## Current follow-up (2026-09-25)

The board overhaul is now implemented in the working tree, including:

- `view=kanban` and all other non-default board tabs are explicit in URLs.
- Selection is shared by rendered task cards across Unclaimed, Kanban, By phase,
  and Branch coverage; Claim, Task Pack export, and bulk move are available from
  the board overflow.
- Uncapped (`capacity: null`) tasks correctly satisfy **Has open slots**.
- Branch coverage limits detailed task lists/counts/ordering to the relevant
  coordination scope while retaining public health status.
- The Library header-only nav group survives visibility filtering; `/community`
  is the Community hub and `/members` is directory-only.
- Pack-import screen two supports selecting multiple declined tasks and applying
  one branch to them, with per-task overrides still available.

Verification for the current changes: `npx tsc --noEmit`,
`npm run lint -- --no-warn-ignored`, the 27 targeted board/navigation/import
Vitest tests, and `npm run build` pass.
The local DB-backed suite remains environment-blocked by the placeholder Postgres
password, so this is not a claim that every integration test ran.

## Original session state (historical)

Session state at handoff. The **render layer garbles identifiers on read** (German
words, `godzin`, board_views/board-views spellings drift across reads). **Trust
`git status` + `od`/`shell` byte dumps + `tsc`/`vitest` exit codes — never raw
render text.** All edits below are pure server logic; zero new client JS beyond the
one locked client slice.

## Done — committed at the time of the original handoff (`tsc: 0`, `vitest: 17 pass`)

1. **Pure queue sorter** — `src/lib/tasks/board-views.ts`:
   `sortUnclaimedQueue<T extends QueueTask>(tasks, phaseEndDateById?)` — worst-first:
   attention level → critical → phase-end → deadline → title. Plus `board-views.test.ts`.
   File = 179 lines. Commit `90964f3 board views: unclaimed attention queue default landing (pure sorter)`.
2. **Board page rework — default attention-queue landing** — `src/app/(app)/board/page.tsx`:
   - `VIEWS`/`VIEW_LABEL`/`BOARD_VIEW` gain `"unclaimed"` as **first view + default landing**
     (active-view fallback resolves to `"unclaimed"` when no valid `view` param).
   - New `unclaimed` render block (worst-first queue via `sortUnclaimedQueue`, folding
     phase-end dates from loaded phases; reuses `TaskCard`).
   - Header declutter: one primary **"Propose a task"** button + `ActionMenu` overflow
     (coordinator hub links + export) instead of the old 3× `Link` `BUTTON_SECONDARY` row.
   - Commit `89baee2 board: land unclaimed attention queue as default view tab`,
     plus `e0738db` (earlier pure-sorter commit). `board-views.test.ts` → 17 tests green.
3. **Bulk claim — the locked client slice** — `src/components/tasks/BulkClaimSelect.tsx`
   (54 lines, exists): per-task checkbox select mode reusing the page's bulk claim server
   action. **`string|null` fault at line 44** (see below).

## Original remaining-work list (historical; superseded)

`tsc --noEmit` currently fails on **exactly three** byte-anchored faults — all
deterministic, no derivations needed:

1. **`src/app/(app)/board/page.tsx` line 30** — `Cannot find module './BulkClaimSelect'`.
   Page imports `import BulkClaimSelect from "./BulkClaimSelect";` (board-relative) but the
   component lives in `src/components/tasks/`. → Change to
   `import BulkClaimSelect from "@/components/tasks/BulkClaimSelect";`.
2. **`src/app/(app)/board/page.tsx` line 368 (region ~363-370)** — `<BulkClaimSelect ...>`
   call passes `action={bulkClaimAction}` (and claim/branch fields) to a component whose
   prop contract is only `{ claimable, branchNameById }` (no `action` prop). Three options,
   pick per intent; keep option 1 (component already imports its own bulk action):
   - **Option 1 (recommended):** remove `action={bulkClaimAction}` from the page call site —
     component already `import { bulkClaimAction } from "@/app/(app)/board/actions"` internally.
   - Option 2: add `action` to the component's prop type and pass it through.
3. **`src/components/tasks/BulkClaimSelect.tsx` line 44** — `Argument of type 'string | null'
   is not assignable to parameter of type 'string'` — `branchNameById.get(t.branchId)` where
   `branchId: string | null` but `Map<string,string>.get` needs `string`. → Fold first:
   `(t.branchId ? branchNameById.get(t.branchId) ?? "—" : "—")`.

**Then:** `npx tsc --noEmit` (exit 0) + `npx vitest run` (17 pass) + commit.

## Ground-truth anchors (od-verified, byte-clean this session)

- Sorter: `src/lib/tasks/board-views.ts` — `export function sortUnclaimedQueue`, interface
  `QueueTask { id; title; status; attentionLevel; critical; deadlineDate; phaseId }`.
- Barrel re-exports it: `src/lib/tasks/index.ts` → `export * from "./board-views"` (line 16).
- Page render seam: `{activeView === "unclaimed" && (...)}` block wraps `TaskCard` per task
  using `sortUnclaimedQueue(filteredTasks.filter(unclaimed), phaseEndDateById)`.
- Header: single `BUTTON_PRIMARY` proposer + `ActionMenu` overflow for the rest.

Standard gates to re-run after each edit: `npx tsc --noEmit` and
`npx vitest run tests/board-views.test.ts` — check **exit codes**, not panel render text.
