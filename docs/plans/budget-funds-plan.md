# Budget: events own their budgets, proposals replace rounds, and a community fund keeps the money between events

**Status (2026-10-12):** **Phase 1 is built** (events own their budgets; see the dated note under
*Phase 1* for where it differs from the text below, and `CHANGELOG.md` for how it was verified).
Phases 2 and 3 are not started. This was a proposal agreed with the product owner and written up for
them to edit before any code. Three phases, each shippable on its own: **Phase 1** makes an
event's budget belong to the event (fixing the mismatch that prompted this); **Phase 2** replaces
rounds, ranked voting and confirmation with always-open proposals that members back, for events and
for the fund alike; **Phase 3** adds actual money: a ledger, expenses, contributions, allocations and
settlement. Every question has been answered (2026-10-11 and 2026-10-12) and is folded into the text.

**Supersedes** parts of [`../spec.md`](../spec.md):

- the Budget section's *Starting one alongside a Cycle* paragraph, and the matching sentences under
  *Concurrent cycles & view scope*, which say a new Cycle starts with no Budget process and offers an
  opt-in checkbox (Phase 1);
- the Budget section's *Proposals*, *Ranked-choice voting* and *Confirmation* bullets, and the line
  in the voting section that says Budget "keeps its own voting mechanism" because ranked choice
  against itemized costs "is a genuinely different computation" (Phase 2). Ranked voting is retired,
  not tweaked; see D15 for why it can go;
- the Budget section's *Contributions* bullet, which today is one sentence (Phase 3).

Everything else in the Budget section (fixed costs, itemized line items, branch tagging, the owner
grant) stands.

## The working principle

> Most of the rest of the platform focuses on the cycle (event), and this budget period should be
> replaced by the cycle if cycles are being used. In any case, closing a cycle expects the budget
> manager to confirm that cycle's budget is closed, so if that period is not the same as the cycle
> that doesn't make much sense.
>
> Even communities with events may need to keep track of their money between events, and there
> should be some amount that can be added to (a fundraising event, say) or taken from by the events'
> budgets themselves.
>
> Rounds were a concept defined for events and incorrectly implemented the first time.

Said as a rule: **an event has exactly one budget and it is that event's; money that belongs to no
event lives in the community fund; both decide what to spend the same way, through proposals the
community backs; the two exchange money through recorded transfers, and closing an event settles its
budget.**

## What is wrong today

Read from the code, not remembered:

- A `budget_cycle` is a free-standing "period" with its own title and proposal deadline. Its
  `cycle_id` is optional. Nothing makes a period and an event the same thing.
- It comes into being through an Admin's "Start a budget period" or an opt-in checkbox on the
  create-event form (`startBudgetCycleForNewCycle`), offered only when there is already a confirmed
  previous period to copy from.
- `createBudgetCycle` refuses to create *any* period while the community has one that isn't
  confirmed, whatever events exist. Two concurrent events cannot both have a budget.
- `closeCycle` warns only if a period is linked to that event and its owner hasn't marked it done
  (`getBudgetCycleForCycle` / `ownerMarkedDoneAt`). An event whose budget was started as a separate
  period has no linked row, so closing it checks nothing.
- Several surfaces still assume one community-wide period and read `getCurrentBudgetCycle`: the
  calendar's deadline entry, the nav's owner check, the dashboard's needs-action list
  (`listBudgetNeedsAction`), and the create-event form.
- The decision machinery is heavy for what it does. A period runs proposals → ranked voting (Borda
  scoring, a full ballot per member) → owner confirmation with a mandatory rationale for departing
  from the ranking. It is about 450 lines of `voting.ts`, a 217-line voting component and four API
  routes, and the ranking has **no money to rank against**: nothing says how large the pot is, so
  the ranking only suggests where the owner should draw a line the owner then draws by hand.
- Money is never recorded. The module holds plans and a per-voter *pledge*
  (`contribution_signal`), and nothing about what was spent or received. The schema comment says so
  deliberately: "this module never moves real money itself".

## Decisions

Numbered so later documents can cite them.

**D1. An event's budget is created with the event, automatically, when Budget is on.** Titled after
the event, fixed costs carried forward from the previous *event* budget. No "Start a budget period"
for an event and no checkbox. Events that already exist get theirs lazily, the first time anyone
opens their Budget page, as `getOrCreateCommunity` already does for the community row.
*Why:* an opt-in step is what let a budget and its event drift apart. A budget that always exists
for an open event is what makes "closing the event checks the budget" true.

**D2. The proposal deadline is optional.** Blank means proposals stay open until the event's budget
is settled. A date, when set, stops *new* proposals after it; the holder can move it. *Why:*
automatic creation has no honest date to invent; the existing carry-forward guessed "two weeks out".

**D3. One budget per event, one fund per community.** A **scope** is an event or "the community"
(`cycle_id` null). Concurrent events each have their own. (Until Phase 2 retires rounds, "one
unfinished round per scope" is the transitional form of this rule.)

**D4. Rounds retire, in both scopes.** A round was a way to decide an event's spending in one
sitting, and was a mis-fit even there: an event keeps having needs while it runs, and a fund has no
beginning or end at all. Proposals are always open, in an event's budget and in the fund's, and
members back them (D12). The event's plan is whatever has been approved (D15). Phase 2 builds this
for both scopes with one mechanism and one table. Existing standing rounds become read-only history
under "Earlier rounds".

**D5. Phase 3 records actuals in a ledger, scoped by event or fund.** Plans stay plans until
someone enters what really happened. The ledger is a single table of entries; a scope's balance is
the sum of its confirmed entries. No double-entry accounting, no currencies or cents (whole units,
as everywhere in the module), no payment integration. The app records what people say happened.

**D6. Authority follows the grant, per scope.** The unscoped `budget` grant's holder runs the fund.
The event-scoped holder runs that event's budget and may ask the fund for money (D9). This is the
existing `holdsBudgetGrant` rule, unchanged.

**D7. Settlement replaces "mark done".** Closing an event is when its books close: the budget owner
confirms the outcome and the net result is posted to the fund (D10). `closeCycle` keeps its posture
of *warning, never blocking*, and now warns until the budget is settled.

**D8. Individual amounts are private; totals are not.** What one member paid in or pledged, and the
detail of one member's expense claim, is visible to the scope's budget owner and to that member, and
to nobody else, *including Admins* (D13). Totals are open to every member: the fund's balance, an
event's total paid in against its ask, the total pledged, and an event's balance. The entry list on
the fund is the holder's. Privacy is enforced in the query layer, not the page, as
`getProposalInterest` does for names.

**D9. An event gets money from the fund only through a proposal the community has backed.** An
event's owner can read the fund's balance and *request an allocation*, and the request is a full
budget proposal, not a number: a snapshot of the event's plan, the contribution per member the owner
intends to ask, how many contributors that assumes, the other income expected, and the **shortfall**
being asked of the fund. It is listed on the fund's proposals as a proposal of kind
`event_allocation`, labelled with its event, and the fund's holder can approve it only up to what the
backers cover (D12). An event that needs nothing from the fund makes no request and touches nothing.
Nothing else is open to the event's owner: no entries on the fund, no reading its ledger, and
nothing at all once the event is closed.
*Why:* a community that lets anyone start an event (who may is a configurable tier,
`cycleInitiationTierId`) would otherwise have a way round the fund's backing requirement: start an
event, ask the holder for its shortfall, never gather support.

**D10. Transfers are paired entries.** An allocation or a settlement writes two entries sharing a
`transfer_id`, one in each scope, opposite signs. Every scope's balance then stays a plain sum.

**D11. A member's contribution belongs to a scope, and usually that scope is an event.** A
contribution entry carries the scope it was paid *for*. Paid for an event, it sits in that event's
budget, counts toward that event's ask, and stays there: it is not "the fund's money" at any point.
The only thing that ever moves between an event and the fund is the event's *net* at settlement
(D7), so contributions reach the fund only as part of a surplus. Paid for the community itself
(general support between events), it is a contribution on the fund. Same kind of entry, same
privacy (D8); only the scope differs. A member can contribute to an event they are not attending;
the ask is computed from attendees, not enforced on them.
*Why:* an event's ask is worked out from its own plan, so what was paid against it has to be measured
against that plan, not pooled with everything else.

**D12. Proposals are backed, not ranked, and each backer stands behind an amount of money.** Any
member can propose spending at any time, in an event's budget or in the fund. Other members can say
"I support this", one per member, withdrawable, the same shape as interest in a programme proposal.
The community sets one number in Settings: **the amount each backer stands behind**, say €30. The
proposer is the first backer and every supporter is another. A proposal is *backed up to* its number
of backers times that amount, and the holder of the scope it belongs to can approve it only up to
that. A €5 proposal is backed by its proposer alone and goes straight to the holder; a €90 proposal
needs three people behind it (the proposer and two supporters) before it can be approved in full,
and with only two it can be approved for up to €60. Unset or zero means no backing is required and
the holder decides alone.
*Why a money figure and not a head-count:* a flat number of supporters is too much to ask for a
small purchase and too little for a large one, and it says nothing about how much the community is
willing to put at stake.
Backing never approves: the holder can still decline, with a note, and decides what to approve
within what is backed. There is no ranking and no fixed funded set. Counts are visible to everyone;
names only to the proposer and the holder.
**One setting, both scopes.** The same amount applies to event proposals and fund proposals, and for
an ordinary proposal only explicit supporters count (attendance does not back every line of an event,
which would approve everything). Separate amounts per kind are deferred.
**What counts as backing an event's allocation request.** Beyond the requester and explicit
supporters, the members who have declared Participation `coming` to that event, each counted once
however they arrive at it. Going to an event whose plan you can read is a form of backing it. The
amount that has to be backed is the **shortfall asked of the fund**, so a large event asking for a
modest sum is backed by its own attendance and reaches the holder with nobody having to be asked,
and one asking for a lot lists itself among the fund's proposals and gathers the rest there. One
rule, not two paths. The count is taken when the holder approves; someone leaving the event
afterwards does not revoke it.

**D13. Authority is the grant and nothing else.** An Admin manages the platform; being one confers
no budget powers and no sight of private amounts. The only way to see or confirm money for a scope
is to hold that scope's `budget` grant. A scope with no holder cannot confirm money at all: entries
wait, and the community is shown that money is waiting with nobody to confirm it. An Admin sees that
notice, because filling the task is platform work, and gains no access to amounts.

**D14. An event cannot overspend onto the fund unnoticed.** A deficit at settlement is money the
fund would be covering that nobody approved: the same loophole as D9 from the other side. So
settling a deficit beyond what the fund allocated opens a proposal of kind `event_deficit` for the
shortfall, which follows the same backing rule (D12). Until the holder approves it, the event's
budget is settled *except for that amount*, which stays visible as an uncovered overspend, and
`closeCycle` keeps warning. A declined deficit is not forgiven or hidden: it stays on the event's
books as unrecovered, with no further consequence.

**D15. An event's plan is its fixed costs plus its approved proposals.** Ranking and confirmation go
because there is no pot to rank against: what the event will cost is simply what has been approved,
and the contribution ask follows from that total (Phase 3). The brakes that ranking pretended to
provide are the backing rule for fund money, the running total against the ask, and members'
freedom to pledge or pay less. A decision's reasoning is kept as the holder's note on approving or
declining, which replaces the confirmation rationale. **Fixed costs stay owner-entered**: they are the
floor (insurance, infrastructure, contingency), they need no backing, and they cannot take fund
money without a backed allocation, so they cannot be used to get round D12.

**D16. A member's pledge survives, on its own.** "How much would you contribute?" was a field on the
ranking ballot, and the ballot goes. The pledge becomes a small standalone record per member per
event, replaceable, private to the member and the owner, with its **total** visible to everyone
(D8). It informs the plan as a whole and is not part of any one proposal. It is deliberately *not* a
profile question for now: see the roadmap note on aggregates from profile data.

**D17. A line item can be tagged to a task, so the person holding it informs the figure.** The
motivating case is food: the kitchen holder knows what feeding forty people costs better than the
budget holder does. The budget holder tags a line, in fixed costs or in a proposal, to a **task**.
The tag is to a task and not to a permission module on purpose: modules cover only the areas that
already have a grant (Kitchen, Shifts, Spatial planning), while sound, decor, transport and the rest
have tasks and no module, so a module tag would make the feature work for some lines and not others.
The Kitchen case stays one click, because the task picker lists first the tasks that grant a Kitchen
permission in this event, labelled as such.
What a tag does, and only this:

- the line shows the task and its current (non-shadow) holders, or "no holder yet" when there are
  none, in which case nothing is asked of anyone;
- each holder gets a needs-action row for lines tagged to their task;
- while the line is not yet approved (a proposal), or while the event is open (a fixed cost), a
  holder can edit that line's amount and label;
- the budget holder still approves everything, and a tag gives its holder no other budget authority
  (budget authority remains settings-only, never granted from a task).

A tag may point at a task in this event or a standing one, never another event's, so authority over a
line cannot leak across scopes. If the task is later released, reassigned or archived the line keeps
its tag and simply follows whoever holds the task now. *Not built:* tagging to a permission module
as well. If a community finds re-tagging after a task changes hands tedious, a "whoever holds this
module in this event" variant can be added beside the task tag without changing anything here.

## Data model

### Phase 1

- `budget_cycle.proposal_deadline` becomes nullable.
- A partial unique index on `budget_cycle (cycle_id) WHERE cycle_id IS NOT NULL`, so an event cannot
  end up with two budgets. Before it is created the migration must find any existing duplicates and
  keep the newest (the read path already resolves "newest wins"); that query is part of the
  migration. Standing-scope rounds stay many until Phase 2.
- `created_by` stays `NOT NULL`. A budget created by the event's creation uses that member; a lazily
  created one uses `cycle.started_by`, else the viewer. It records who triggered it, which is all it
  ever did.

### Phase 2

- **`budget_proposal`** gains: `community_id` (backfilled), `cycle_id` (the scope, null for the fund;
  backfilled from the parent `budget_cycle`), and `budget_cycle_id` becomes nullable (a fund proposal
  has no round). New columns: `status` (`open`, `approved`, `declined`, `withdrawn`, `closed`),
  `decided_by`, `decided_at`, `decision_note`, `approved_amount` (at most the amount asked **and** at
  most what the backers cover). The line-item JSON shape (`lineItemInput`) gains an optional `taskId`
  (D17), validated as a task of this community, in this event or standing; fixed costs on
  `budget_cycle` use the same shape, so one change covers both.
- **`budget_proposal_support`**: `proposal_id`, `member_id`, unique on the pair, `created_at`. No
  level: support is one thing.
- **`budget_pledge`**: `budget_cycle_id`, `member_id`, `amount`, unique on the pair, timestamps.
  Backfilled from existing `budget_vote.contribution_signal` values.
- **`community.fund_support_per_backer`**: a nullable integer in whole currency units (null or 0 means
  no backing is required), configured in Settings next to the other community thresholds
  (`engagementSoftFlagThreshold` is the precedent for an integer column and a settings control). The
  control shows what the number means as it is typed: "A 90 proposal needs 3 people behind it".
  **Unset by default**, so the holder alone decides until a community opts in; the right figure
  depends on its currency and scale, which the app does not know.
- **Retired, not deleted.** `budget_cycle.status` stops meaning anything beyond "open until settled",
  and `confirmed_proposal_ids` / `confirmation_rationale` are no longer written. `budget_vote` is
  no longer written and stays readable as history. All are dropped in a later cleanup, once nothing
  reads them; dropping them here would destroy the record of past decisions.
- **Existing data, converted once, in the migration.** In a confirmed round, funded proposals become
  `approved` (approved for their live total) and the rest `declined`, with a note saying they were
  not funded; the old rationale is kept on the round for reference. A round in voting, or still
  accepting proposals, has its proposals made `open`. Proposals in standing rounds get `cycle_id`
  null and join the fund's list. The migration is checked against a copy of a realistic database
  before anything ships.

### Phase 3

`budget_entry` (a migration after Phase 2's):

| column | notes |
|---|---|
| `id`, `community_id` | |
| `cycle_id` | nullable. The scope: an event, or null for the fund. |
| `kind` | `opening_balance`, `expense`, `income`, `contribution`, `allocation`, `settlement`, `adjustment`. `contribution` is money a *member* paid, for the scope in `cycle_id` (D11); `income` is money that came from anywhere else (a ticket sale, a fundraiser, a donor who isn't a member). |
| `amount` | integer, signed. Positive is money into this scope. |
| `status` | `pending`, `confirmed`, `rejected`. Owner-recorded entries are born `confirmed`. |
| `member_id` | nullable. The member a contribution or expense concerns. Required on a `contribution`. |
| `submitted_by`, `confirmed_by`, `confirmed_at` | who entered it, who accepted it |
| `description`, `occurred_on` | |
| `receipt_note` | free text: a reference, a seller, an invoice number. **No upload now.** The column is where an attachment id goes later. |
| `proposal_id` | nullable. Ties an expense to the approved proposal it spends against, so the page can show planned against actual. |
| `reimbursed_at` | nullable. Set by the owner on an expense a member paid out of pocket, so the list can say who is still owed. |
| `transfer_id` | nullable, shared by the two halves of a transfer (D10) |
| `reverses_entry_id` | nullable. Entries are never edited or deleted; a correction is an `adjustment` pointing at the entry it undoes. |

On `budget_proposal`, for 3c: `kind` (`spending`, `event_allocation`, `event_deficit`) with
`plan_snapshot`, `requested_contribution_per_member` and `expected_contributors` on the two event
kinds. Nothing on a `spending` proposal changes.

On `budget_cycle` (the event's budget):

- `contribution_per_member` integer, nullable. The ask the owner settles on (see *Contributions*).
- `settled_at`, replacing `owner_marked_done_at`. The migration renames the column and its meaning
  carries over: a row already marked done is settled, and with no ledger behind it there is nothing
  to post.

## Phase 1: events own their budgets

**Goal.** Every open event has exactly one budget, made with it; closing the event checks that
budget; concurrent events no longer block each other; the standing budget stops being the odd one.
Rounds still exist here; Phase 2 retires them.

**Build.**

1. Migration: deadline nullable, the unique index, the duplicate check.
2. `ensureEventBudget(actor, event)` in `src/lib/budget/cycles.ts`, replacing
   `startBudgetCycleForNewCycle`. Idempotent, serialised with `pg_advisory_xact_lock` on the cycle id
   so two first visits don't both insert. Called from `createCycle` (inside its transaction, when the
   module is on) and from the Budget page for an open event with none. A closed event with no
   budget is not backfilled; its page says no budget was kept.
3. `createBudgetCycle` checks "one unfinished round **for this scope**". `POST /api/budget-cycles`
   keeps its Admin gate and gains the same check; for an event scope it returns a conflict if one
   exists.
4. Move every reader off `getCurrentBudgetCycle`:
   - **Calendar** (`src/lib/calendar/view.ts`): one deadline entry per unfinished round that has a
     deadline, each linking to its own `/{cycleId}/budget`. Rounds without a deadline add nothing.
   - **Nav** (`isAnyBudgetOwner`): true if the member holds the grant for *any* unfinished round's
     scope, not the community's newest.
   - **Dashboard** (`listBudgetNeedsAction`): iterate every unfinished round. `close_to_voting` fires
     on a passed deadline *only when there is one*. (Phase 2 replaces this list entirely.)
   - **Create-event form** and `participation/actions.ts`: the checkbox, `startBudget`, and the
     `budgetNotStarted` banner go. It simply happens.
5. **Budget page.** An event's page has no "Start a budget period"; it shows the budget, titled for
   the event. The deadline field reads "Proposals close (optional)". The standing scope is reached at
   `/budget/fund`, a sibling of the bare `/budget` redirect (the `[cycleScope]` segment resolves only
   `active` or a cycle id, so the fund has no URL of its own today). Its action is "Open a spending
   round" where the period form used to be, a transitional label that Phase 2 removes. The
   `?compose=period` form that went in with the header-action change is reworked here, not left
   half-true.
6. `closeCycle` is unchanged in shape; it already asks `getBudgetCycleForCycle`. Its message names
   the event's budget, which now always exists for an open event.

**Built 2026-10-12, with two departures from the text above, both for a reason found while building:**

- *The unique index is on unfinished rows only* (`WHERE cycle_id IS NOT NULL AND status <> 'confirmed'`),
  and there is no "keep the newest" dedupe step in the migration. Earlier rounds for one event are
  legitimate history, so a plain unique index would have failed on real data and deleting the older
  rows would have destroyed proposals and votes. Concurrency is handled by that index with
  `ON CONFLICT DO NOTHING`, not by an advisory lock, and `createBudgetCycle` additionally refuses a
  second budget for an event however the first ended.
- *`ensureNewEventBudget`* (best-effort, swallowing failures) is what `createCycle` and the task-pack
  import call, with `ensureEventBudget` itself called by the Budget page. A failure to make the
  budget never fails the event, and the page makes it on first visit.

Also found: closing an event whose budget was never used still asks the owner to mark it done, which
today requires taking it through voting and confirmation. Phases 2 and 3 remove that path (settlement
replaces "mark done"); until then the warning is overridable, as every close-time check is.

**Done when.** Two concurrent events each have a budget; creating an event creates one; opening an
older event's Budget page creates its budget exactly once under concurrent first visits; closing an
event whose budget isn't marked done warns, and a standing round never does; the calendar shows one
deadline per round with a deadline and none for the rest; `tsc`, lint, build and the budget,
lifecycle, calendar, dashboard and open-permissions suites pass.

**Tests to change or add.** `budget.test.ts` (the one-active-period rule becomes per scope; the
auto-start tests become `ensureEventBudget` tests), `cycles-lifecycle.test.ts`, `calendar.test.ts`,
`dashboard.test.ts`, `open-permissions.test.ts`. New: lazy creation under concurrency, null-deadline
behaviours (submission allowed, needs-action row absent, calendar entry absent), the migration's
duplicate resolution.

## Phase 2: proposals replace rounds

**Goal.** One way to decide spending, for events and the fund: always-open proposals that members
back and the scope's holder approves (D4, D12, D15). Ranking, ballots and confirmation are removed.

**Behaviour.**

- Any member proposes at any time, with the compose pattern the rest of the module uses ("Propose
  spending" in the page header, on an event's budget and on the fund). The proposer can edit or
  withdraw while it is `open`.
- Members support or withdraw support. The proposer cannot support their own: they are already the
  first backer. Backers are counted, not weighed.
- A proposal says "N people behind this, backed up to X of Y asked". The holder can **approve** for
  any amount up to what is backed, and **decline** at any time; a decline needs a note. Approving
  more than a fund's available amount is not blocked: it warns and goes through, like every other
  check in this module.
- Counts are visible to everyone; names only to the proposer and the holder, enforced in the read
  function, as `getProposalInterest` does.
- **An event's plan** is its fixed costs plus its approved proposals, shown with the running total and
  the per-member figure it implies (`total ÷ expected contributors`, with the existing attendee
  count; the member count if there is no event). A proposal that arrives mid-event is just another
  proposal.
- **The deadline** (D2) stops new proposals after it when set. The holder can change it.
- **Line-item tagging** (D17) lands here: the tag, the holder's needs-action row and the holder's
  edit right on the tagged line, with the picker listing Kitchen-granting tasks first.
- **The pledge** (D16) is asked for on the event's page at any time, with the total shown.
- **The fund page** lists open proposals, the approved ones, and "Earlier rounds" (read-only
  history). Until the ledger exists in Phase 3 it shows approved totals; *balance*, *committed* and
  *available* arrive with it.
- **Needs-action** for the holder: proposals awaiting a decision, noting which are fully backed.
  Nothing for ordinary members: "cast your vote" has gone.

**Removed.** `submitBudgetVote` and its action and API route, `computeAggregateRanking`,
`requireValidRanking`, `getBudgetVotingView` and its route, `closeProposalsToVoting`,
`confirmBudgetCycle`, `requiresConfirmationRationale` and their routes, `BudgetVotingSection`, the
`voting` and `confirmed` states, and the dashboard rows `close_to_voting`, `cast_vote` and
`confirm_funded_set`. What remains of `voting.ts` is the owner-authority check and needs-action.

**Done when.** A member proposes in an event and in the fund; another supports; a proposal asking for
more than its backers cover cannot be approved for the excess, on the page *and* on a direct call;
adding a supporter raises what can be approved by the per-backer amount; a proposal within the
proposer's own backing goes straight to the holder; with the setting unset the holder alone decides;
a decline requires and records its note; the proposer cannot support their own; names are hidden from
everyone but the proposer and the holder; the setting is editable in Settings and takes effect for
open proposals; an event's plan total is fixed costs plus approved amounts; the pledge total is
public and each pledge private; the migration converts a confirmed round, a voting round and a
standing round as described, and a copy of real data survives it; every write refuses while
viewing-as; `tsc`, lint, build and the suites pass.

**Tests.** Remove the Voting and Confirmation blocks and the ranking half of the contribution-balance
test from `budget.test.ts` (about 165 of its 958 lines, plus). New `budget-proposals.test.ts`
covering each point above, the pledge, and the migration's three cases.

## Phase 3: the ledger, contributions, allocations and settlement

Three steps; each leaves the app consistent.

### 3a. The ledger, the fund, and expenses

- Migration for `budget_entry`; `src/lib/budget/ledger.ts` with `recordEntry`, `confirmEntry`,
  `rejectEntry`, `reverseEntry`, `getScopeBalance`, and the read functions that apply D8 themselves
  and return only what the actor may see.
- **The fund.** `/budget/fund` shows the balance to everyone. The holder also sees the ledger,
  records an opening balance, income and expenses, and confirms or rejects what is pending. The
  first entry on a fund is its opening balance, entered once. The page now shows three numbers:
  *balance*, *committed* (approved proposals less what has been spent against them) and *available*
  (balance less committed). The holder marks a proposal `closed` once spent or abandoned, which
  releases what is left.
- **Expenses on an event.** Any member can add an expense to an open event's budget: amount,
  description, date, receipt note, optionally which approved proposal it belongs to. It is `pending`
  until the event's owner confirms or rejects it; the owner can also record one directly. The page
  shows planned against actual per proposal and overall. A member sees their own expenses and what
  became of them; the owner marks a member's out-of-pocket expense reimbursed.
- The header action on an event's Budget page stays "Propose spending", with "Add an expense" beside
  it for members.

### 3b. Contributions

The plan sets the ask; recorded payments track it.

- **Suggested ask.** `(plan total − planned income − what is being sought from the fund) ÷ expected
  contributors`, which with nothing sought from the fund is simply the plan over the contributors.
  Expected contributors are the event's `coming` count (`getBudgetCycleAttendeeCount`), else the
  member count. Shown beside the pledge total (D16) so the owner can see whether sliding-scale
  pledges cover it. The owner decides how the plan is split between members and the fund; what is
  left for the fund is the **shortfall** an allocation request carries (D9, 3c).
- The owner **sets** `contribution_per_member`; it need not equal the suggestion. It is an average
  ask, not a bill: members pay what they can, which is the point of the sliding scale.
- **Recording what was paid, against an event.** The contribution is for *this* event: an entry in the
  event's own budget (D11). The owner records "Alex paid 40" (confirmed at once), or a member records
  "I paid 40, reference …" from that event's Budget page and it is `pending` until the owner
  confirms. Rejecting keeps the row, marked rejected, so there is a trail.
- **Which scope.** From an event's page a payment is for that event; from the fund's page it is a
  general contribution to the community. A member pays from the page for the thing they are paying
  for, never from a scope dropdown.
- **Where it ends up.** Event contributions stay in the event's balance through the event, and the net
  reaches the fund only at settlement. Never moved earlier, even if the fund would like it.
- **Who sees it (D8).** Each *amount* is visible to the scope's owner and to the member it concerns,
  and nobody else. Every member sees the event's totals (paid in against the ask, balance). A
  member's event page also shows their own payments for that event and whether anything is waiting
  on the owner. The owner sees paid-in per member as well as in total. The fund's holder sees
  general contributions to the fund and does **not** see an event's individual amounts: those are
  the event owner's until settlement, and after it only the net moves.
- **"My contributions".** A member can see everything they have paid, across events and the fund,
  grouped by what it was for. Their own data and no one else's; the one place the scopes meet for a
  member.
- **The ask is per event.** The fund has no ask in this plan; a fund-level suggested contribution (a
  yearly figure, say) is a later addition.

### 3c. Allocation, settlement and closing

Ships last: allocations move money and deficits are settled through proposals, so it needs both the
ledger (3a) and the proposals (Phase 2).

- **Allocation.** The event owner's request is a proposal of kind `event_allocation` (D9). It needs
  the event to have approved items and a `contribution_per_member` set, and is made from the event's
  Budget page ("Request funding from the fund"). It appears on the fund's proposals labelled with the
  event and showing "N coming + M supporting". The plan is snapshotted; a later rise in the plan's
  total needs a new request, because approval covers what was shown. **Approval moves the money at
  once** as paired entries (D10), the fund down and the event up: a transfer, where an ordinary
  approval is only an earmark, because the event is going to spend it itself. Declined or approved
  for less, the owner is told to recompute the ask.
- **Income inside an event.** The owner can record non-contribution income (tickets, a fundraiser
  sale) against the event, an ordinary `income` entry. A fundraising event needs no special type,
  only a settlement that happens to be positive.
- **Settlement.** `settleEventBudget(actor, budgetCycleId)`: refuses while any entry is `pending`
  (resolve them first), then writes the paired `settlement` entries that bring the event's balance
  to zero and move that amount to or from the fund, and sets `settled_at`. A surplus returns to the
  fund. A deficit is **not** absorbed: it becomes an `event_deficit` proposal the community backs
  (D14), and the event is settled except for that amount. Approving one posts the covering transfer
  and finishes the settlement.
- **Who settles.** The event's owner. Once the event is closed and still unsettled, the fund's
  holder can settle it, since an event whose owner is gone must not strand its balance.
- **After close.** An event's budget accepts no new entries once the event is closed and settled. A
  late receipt becomes an entry on the fund recorded by the fund's holder, naming the event in its
  description.
- `closeCycle`'s warning changes from "hasn't marked it done" to "hasn't settled its budget", naming
  the unresolved balance.
- Dashboard needs-action gains: expenses and payments awaiting the owner's confirmation; a closed
  event whose budget is unsettled.

**Done when** (Phase 3 as a whole): a member's expense is confirmed by the event owner and shows in
planned-against-actual; contributions are recorded both ways **for an event**, count against that
event's ask and not the fund's, and each individual amount is invisible to anyone but that event's
owner and the contributor, **including to an Admin who isn't a holder and to the fund's holder**,
with a test that proves it; a contribution for the fund does the reverse; "My contributions" lists
both and only a member's own; an approved allocation moves money and both balances are right, and an
event whose attendance covers its request needs no explicit support while one whose attendance does
not is short by exactly the right amount, through the same code path; the requester is counted once,
and so is someone both coming and supporting; leaving the event after approval does not revoke it;
settling a surplus zeroes the event and moves the net to the fund, and a deficit opens a covering
proposal and leaves the event settled except for that amount; closing an unsettled event warns; the
fund's balance is visible to everyone and its ledger to nobody but its holder; reversing an entry
reverses its balance effect and leaves the original visible; with no holder, entries wait and the
notice appears; every write refuses while viewing-as.

**Tests.** A new `budget-ledger.test.ts`: an event contribution changes only that event's balance
and reaches the fund only via settlement; a `contribution` entry without a member is refused;
balances as sums, pending excluded until confirmed; paired transfers net to zero across scopes;
settlement refused with pending entries; a deficit opening an `event_deficit` proposal instead of
being absorbed; privacy per role (holder, member, other member, Admin, event owner reading the fund);
the open-module and no-holder cases; event totals visible to every member while individual amounts
are not; the lifecycle of a reversal. Update `cycles-lifecycle.test.ts` for the new close warning.

## Permissions and privacy

| | Fund (unscoped) | An open event's budget |
|---|---|---|
| Fund holder (unscoped grant) | everything on the fund: approves proposals, sees the ledger and general contributions | the totals; settles a *closed* unsettled event. Cannot see its individual amounts |
| Event holder (event-scoped grant) | the balance; requests an allocation as a proposal while the event is open | everything: approves its proposals, confirms entries |
| Any member | the balance; propose and back spending; add a general contribution | the plan and totals; propose and back spending; add an expense or a contribution *for this event*; their own entries and pledge only |
| Admin, not a holder (D13) | same as any member | same as any member |

Two things follow from the owner's rule that actual amounts are not community-visible, and the code
must not get them wrong by convenience:

- The `budget` module can be **open to everyone** (`isModuleOpenToEveryone`), which makes
  `isBudgetOwner` true for every member. That is right for running a *plan* and fatal for money.
  Every ledger read and write therefore uses `holdsBudgetGrant` (a real holder), never
  `isBudgetOwner`. With no holder, entries wait (D13).
- Privacy lives in the read functions, which take the actor and return only what they may see. A page
  cannot show an amount by forgetting a check, because it is never handed one.

## Spec, docs and release notes

- **Phase 1:** rewrite the Budget section's *Starting one alongside a Cycle* paragraph and the two
  sentences under *Concurrent cycles & view scope* that say a new Cycle starts with no Budget
  process; CHANGELOG entry; a member-facing note in `src/lib/docs/content/releases.ts`.
- **Phase 2:** rewrite the Budget section's proposals, voting and confirmation bullets around backed
  proposals; reverse the voting section's "Budget keeps its own voting mechanism" line and say why;
  describe the per-backer amount and, in the Settings documentation, where to set it; the entity
  table gains `BudgetProposalSupport` and `BudgetPledge`. CHANGELOG and release notes.
- **Phase 3:** a Budget section for the fund, actuals, contributions and settlement; the
  *Contributions* bullet stops being a sentence; the entity table gains `BudgetEntry`. CHANGELOG and
  release notes, each worded for a treasurer, not a developer.
- **`docs/roadmap.md`:** its "community savings" item is what Phase 3 builds, so it points here once
  work starts, and is removed when it ships. It also gains a note on aggregates from profile data
  (written alongside this plan; see D16).

## Not in this plan

- **Receipt uploads.** `receipt_note` is the placeholder; an attachment column is a later, additive
  change.
- **Multiple currencies, cents, tax, payment processors, bank import.**
- **Reimbursement workflows** beyond a single "reimbursed" marker.
- **Renaming `budget_cycle`.** Once rounds are gone the table is really an event's budget, and the
  name will mislead. Renaming a table this widely used is its own change.
- **Different per-backer amounts for different kinds of request.** One number now.
- **Dropping the retired columns and `budget_vote`.** A later cleanup, once nothing reads them.
- **Pledges as an event-scoped profile question, and aggregates from sensitive profile answers.**
  Thought through and set aside for now; the reasoning is in `docs/roadmap.md`.
- **Cross-community anything.**

## Decisions made on 2026-10-11

- **Q1.** Event totals (paid in, balance) are visible to every member; individual amounts are not (D8).
- **Q2.** Admins get nothing extra (D13).
- **Q3.** Only a real holder ever confirms money; with none, entries wait and the community is told
  money is waiting. Admins see the notice and gain no access (D13).
- **Q4.** Expenses carry `reimbursed_at`, set by the owner, so the list can say who is still owed.
- **Q5.** An allocation is a full budget proposal with its ask per member, backed by the community and
  not decided by the holder alone (D9). Its backers are its requester, explicit supporters and
  coming participants, counted once each, always listed on the fund's proposals (D12). Worth
  remembering when choosing the per-backer amount: attendees count as backing whether or not they
  have read the request, so a small amount makes a large request close to automatic.
- **Q6.** Rounds are the wrong mechanism; proposals are always open, members back them, and the
  community sets how much money each backer stands behind (D4, D12).
- **Q7.** Visibility only for an unpaid deficit (D14).
- **Q8.** `fund_support_per_backer` is unset by default.
- **Q10.** Retire ranked voting and confirmation; event proposals use the same backing rule and
  setting, with only explicit supporters counting (D12, D15).
- **Q11.** Fixed costs stay owner-entered (D15).
- **Q9.** A line can be tagged to a task so its holder informs the figure (D17). Tagging to a
  permission module was considered and set aside because it would only work for the areas that
  already have a grant; the picker puts Kitchen-granting tasks first so the food case stays one
  click. The recommended minimal behaviour was accepted: the line shows the holder, the holder
  gets a needs-action row and can edit that line, and the budget holder still approves everything.
- **Q12.** The contribution pledge survives as a standalone per-event record and stays out of profile
  questions for now (D16).

## Open decisions

None.

## Sequencing

Phase 1 first, on its own PR: it changes no money behaviour and is what makes `closeCycle` honest.
Phase 2 next: it replaces the decision machinery and stands without any ledger. Then 3a, 3b, and 3c
last, each a PR that leaves the module working. 3c needs 3a (allocations and settlement move money)
and Phase 2 (allocation and deficit requests are proposals); 3b needs 3a. Phase 2 can be built
without Phase 3 and ships a coherent module on its own: events and the fund both decide spending
by backed proposals, with the planning numbers and no actual money yet.
