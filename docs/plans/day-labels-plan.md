# One way to say which day it is

**Status:** steps 1 to 9 of §6 are built (2026-11-22); steps 1 to 4 are committed (`f1daaae`). Step 1:
the resolver and the label styles (`src/lib/dates/day-labels.ts`), with `formatShiftRange` rebuilt on
them. Step 2: `createDayLabeler` (pure, `src/lib/dates/day-labeler.ts`) and the request-scoped
`getDayLabeler` (`src/lib/day-labeler.ts`). Step 3: shifts. Step 4: the calendar and the task page.
Step 5: the kitchen. Step 6: the programme. Step 7: the feeds. Step 8: the audit, recorded in §9: the
board's phase cards and a task's check-in date (board card, task page, coordination page, dashboard) are
moved over, the old `formatDateLabel` and `PeriodDateContext` are deleted so there is one way to say a
day, and every other date formatting site is listed there with why it stays a plain date. Driven in a
browser against a scratch database (Period and Exact) for steps 3 to 8, except the check-ins-due row.
Step 9 (spec and member-facing docs) is done: the spec's Date display section, the settings copy and the release note.

**Deviation from §6 step 2, 2026-11-22:** it said "lazy per-event loads". It loads every event of the
community and their phases up front, in two queries, the way `getEventClocks` already does, so the labeler
can be synchronous and a page can label a row without knowing in advance which events its rows come from.
Events are few and phases fewer; the cost is two small queries per request, memoised.

Marked **(decided)** where the product owner said it in conversation (2026-11-22); **(proposed)** is
my reading and needs a yes or a correction. Section 8 collects the open questions.

---

## 1. The principle

> "We already have a period notion for tasks and it would be good if we use that same thing across
> everything that might need it so we use a consistent way to indicate days … some sort of interface
> that is called every time a day is needed … so that there's only one place to manage it."

> "For the most part the phase, if set, is going to be best and as long as that is 7 days or less
> that makes it easy. … Scoped views don't necessarily need the specificity, including for kitchen."

> "Where the date is not event-associated … then the full date should be shown. If the view is
> showing dates from multiple events then specifying event and phase may be necessary."

So: a date is written as a day of the week **where it belongs to a short phase or event**, using the
member's own setting, and in **one** place. Everything else is a full date. Nothing about *what the
date is* changes; this is presentation only, as `src/db/schema/date-display.ts` already says.

This is not a reversal of anything; it generalises `formatDateLabel` and the task page's
phase-then-event rule.

## 2. How it works now

**The primitive** is `src/lib/dates/display.ts`:

- `formatDateLabel(date, mode, period)` returns `"Name · Thu"` when the mode is `period` and the date
  is inside a `PeriodDateContext` whose span is seven days or fewer (`isShortPeriod`); otherwise the
  full date. `period` may carry a `cycleName` prefix and a `boundaryKind`.
- `effectiveDateDisplayMode(member, community)` is the member's override, else
  `Community.defaultDateDisplayMode`. Settings → General → "How dates read by default"; profile →
  "inherit / exact / period".

**Who builds the period** is every caller, by hand. `{ name, startDate, endDate, cycleName }` is
assembled separately in `calendar/page.tsx` (twice), `lib/calendar/view.ts`, `tasks/[id]/page.tsx`,
`schedule/page.tsx`, `shifts/page.tsx` and `[cycleScope]/participation/page.tsx`. They disagree:

| Where | Looks at | Notes |
|---|---|---|
| Task page (milestones) | the milestone's parent **phase**, else the event | the only phase-first caller |
| Calendar, calendar view | phase boundaries get their phase; entries get the event | |
| Schedule (programme) | the event only | |
| Shifts, event roster | the event only | new; prefix repeats the heading above it |
| Board phase cards | the phase, with a `boundaryKind` | |

**Who ignores the setting entirely:**

- Kitchen: `dayHeading` (`kitchen/parts.tsx`), used by the menu and shopping tabs, always prints
  "Friday, March 5".
- The programme grids: `gridDayHeading` / `gridDayLabel` (`lib/event-scheduling/availability.ts`),
  used by three availability grids, always weekday plus date.
- The dashboard's shift rows, the contribution history, check-ins due and a few others print a plain
  date.

**What already carries scope.** The data needed is on the rows: shift series, calendar events and
kitchen menu plans have `cycleId`; tasks have `cycleId` and `phaseId`; meals have an optional
`phaseId`. The dashboard already uses a row's `cycleId` to choose its venue clock
(`getEventClocks`, `lib/dashboard.ts`), so passing a period the same way is the same plumbing.
Phase `startDate`/`endDate` are always plain date columns even for a relative recipe (they are the
cached resolved value; `src/db/schema/phase.ts`), so nothing here needs to resolve a recipe.

## 3. Decisions

- **D1. Scope comes from the item, never from the date. (decided)** A row says which event and,
  where it has one, which phase. The resolver does not look at a bare date and guess. That removes
  the "overlapping events" ambiguity: an item belongs to exactly the scope it already names.
- **D2. Phase first, then event, then the full date. (decided)** For an item's scope:
  1. its phase, if the phase has both dates, spans seven days or fewer and contains the day;
  2. else its event, on the same three conditions;
  3. else the full date.

  **An explicit phase is authoritative. (decided)** Where an item names a phase (a task, a milestone,
  a meal), that phase is the only phase ever considered for it. If it does not qualify, the item
  falls to its event and then the full date; it is **never** handed to some other, narrower phase
  that happens to contain the day. A task belonging to a Recruitment phase that runs alongside a
  Build phase is dated in terms of Recruitment or not by phase at all, never "Build · Wed".

  Only an item that names an event but **no** phase (a shift, a calendar entry) has its phase found
  by containment: of the event's dated phases that contain the day, the narrowest wins and a tie
  goes to the lower `order`. That is a best guess for items that carry no phase of their own, which
  is why it is only for them. (Q1)
- **D3. No scope means the full date. (decided)** A task milestone that is not event-scoped, a
  community meeting, a standing shift series: all of these read as they do today.
- **D4. The label names only what the view does not already say. (decided)** The labeler is told what
  the surrounding view already established (`alreadyShown`):
  - a list that mixes events: `Peach Please · Set-up · Wed`;
  - a view of one event: `Set-up · Wed`;
  - a view of one phase, or a kitchen menu already scoped to it: `Wed`.

  Where a phase is not set, the event stands in for it in the same way.
- **D5. One module, two layers. (proposed)** `src/lib/dates/` gets a pure resolver (D1 to D3) and the
  existing `formatDateLabel` stays the presentation primitive. A request-scoped labeler wraps them,
  following `getViewerClock` in `lib/view-clock.ts` (a `cache()`d async that reads the viewer once).
  Callers get `day(date, scope, opts)`; they stop assembling `PeriodDateContext`.
- **D6. A few styles, one resolver. (proposed)** The inline label, a heading (kitchen, grids) and a
  range with times (shifts). Each is a thin shape over the same resolution, so the rule cannot drift
  between them.
- **D7. The input is a plain day. (proposed)** A shift or a slot is an instant; it is first turned
  into the venue's calendar day (`localDateInZone`) and only then labelled. `formatShiftRange`
  already does this and keeps doing it, so a 00:30 shift is named for the right day.
- **D8. Exact mode is untouched, everywhere. (decided in spirit)** A member reading dates as exact
  sees byte-for-byte what they see now. Every migration step has a test pinning this.
- **D9. A "Set-up" shift needs no new rota to be labelled. (decided)** The event's own dates are the
  event proper and set-up is entered as a phase (Q2). If the event has a dated Set-up phase of a week
  or less, D2 gives a shift on that phase's days `Set-up · Wed` already; without one it reads as a
  full date, and that is accepted. A separate shift rota is then only a question of grouping and
  permissions, which this plan does not touch (§7).

## 4. What period mode does to a heading that already shows the weekday

Kitchen reads "Friday, March 5"; the programme grids read "Fri" over "Nov 28". The weekday is already
the point there, so in period mode inside a short scope:

- kitchen: `Friday` (D4 drops the event and phase, the view already is one);
- programme grids: the weekday line stays, the date line is dropped;
- both only inside a short scope. Outside one, or in exact mode, nothing changes (D8).

(decided: kitchen agreed first; the grids confirmed in Q3 as the same rule.)

## 5. Edge cases

- **A phase with one boundary set**, or none: not a period (`isShortPeriod` needs both). Falls to the
  event.
- **A phase named by the item but it does not qualify** (the day falls outside it, as for a relative
  milestone at "start − 3", or the phase is longer than a week): D2 moves on to the event, then the
  full date. It is not forced into the phase, and it is not swapped for another phase that happens
  to qualify.
- **Phases that overlap**: an item with its own phase uses that one regardless of overlap. For an
  item with no phase, narrowest wins, then lower `order`.
- **Shifts and calendar entries have no phase of their own today**, so for them the containment
  guess is all there is. If either later gains a `phaseId`, D2 makes it authoritative with no change
  to the resolver.
- **An event longer than a week with no short phase**: the full date, as now.
- **A closed or past event**: its dates still define the period; reading last year's roster as
  "Fri" is correct inside it, and a list that mixes years falls to D4 and names the event.
- **Days outside every period** in a mixed list sit beside labelled ones as full dates. That is
  intentional; the plain date is the honest fallback.
- **Cost.** An event and its phases are a handful of rows; the labeler reads them once per request
  and per `cycleId` it is asked about, memoised.

## 6. Build order

Each step ships on its own, keeps D8, and ends with its own tests. Steps 1 and 2 are the foundation;
the rest are independent of each other and can land in any order.

1. **The resolver and labeler.** `resolveDayPeriod(day, scope, { cycle, phases })` (pure) and the
   three styles over it, with `alreadyShown`. Rebuild `formatShiftRange` on top. Tests pin: phase
   beats event, an explicit phase is never swapped for a narrower overlapping one (it falls to the
   event, then the full date), the containment guess for phase-less items, event fallback, longer-than-a-week, outside the phase, overlapping phases, no scope,
   `alreadyShown` at each level, exact mode identical to today, the venue-clock day for an instant.
2. **The request-scoped labeler** (`getDayLabeler`, cached per request): the viewer's mode plus every
   event's dates and phases, loaded up front (see the deviation note in the status).
3. **Shifts.** Shifts page, "Series you manage" and the event roster: drop the hand-built period map
   from `shifts/page.tsx`; the cards under an event heading stop repeating its name; "My past
   shifts", which mixes events, names it.
4. **Calendar and the task page.** Replace the hand-built periods in `calendar/page.tsx`,
   `lib/calendar/view.ts` and `tasks/[id]/page.tsx` (milestones keep their explicit phase).
5. **Kitchen.** `dayHeading` in `MenuTab` and `ShoppingTab`, using the menu plan's `cycleId` and the
   meal's optional `phaseId`.
6. **Programme.** `formatEventTime` / `EventReviewSection` and the three availability grids.
7. **Feeds.** Keep `cycleId` (and `phaseId` where there is one) on the dashboard's shift rows, the
   contribution history and check-ins-due rows instead of flattening them to a zone and a date, then
   label them. This is the mechanical step; it widens a few feed types.
8. **Audit the rest** (`PlotEditor`, scheduling polls, invites, admission pages): for each, is there a
   scope on the row? If so migrate it; if not, leave it a full date and say so here.
9. **Docs.** A short behaviour paragraph for the two settings rows in `docs/spec.md`; `CHANGELOG.md`;
   the member-facing note in `src/lib/docs/content/releases.ts` (that one says "dates read as periods"
   now reaches shifts, kitchen and the programme).

## 7. Out of scope

- A separate named shift rota for set-up (or any other lead-in): see D9. Worth doing only if the
  grouping or the permissions need it.
- Changing what any date *is*, how relative dates resolve, or the seven-day limit.
- Locales other than `en-US` (the formatters are fixed to it today).
- Anything the member cannot see: emails and notifications keep their own wording until someone asks.

## 8. Questions, all answered (2026-11-22)

- **Q1. Overlapping phases. (decided)** Phases are not expected to overlap, and nothing stops them.
  Where they do, an item's own phase always wins (a Recruitment task stays in Recruitment's terms
  even when a narrower Build phase overlaps it). Narrowest-wins, tie to the lower `order`, applies
  only to items that carry no phase (D2). No check is added to prevent overlap: it only matters if
  phases get used for things that are not relevant in every context, and guarding against that is
  not worth the effort.
- **Q2. Set-up and the event's dates. (decided)** The event's own dates are expected to be the event
  proper, with set-up entered as a phase. How a community uses this is its own choice. If nobody
  creates a set-up phase, a set-up shift reads as a full date under D2, and that is fine.
- **Q3. Programme grid headings. (decided)** In period mode inside a short scope the heading is the
  day only: the weekday line stays and the date line is dropped. Same as kitchen (§4).
- **Q4. Naming the event inside a phase. (dropped)** Already settled by D4: the event is named when
  the view is not scoped to one event, and not otherwise. There was nothing left to ask.

## 9. The audit (step 8)

Every place that formats a date outside `src/lib/dates/`, sorted by whether the row has an event (and
maybe a phase) behind it. The test from §3 D1: *is the date a day inside an event or phase, and does the
row say which?* Where yes, it moved to the labeler. Where no, it stays a plain date on the viewer's own
clock (`clock.date` / `clock.dateTime` / `clock.deadline`), and that is the right answer, not a gap.

**Moved over in step 8**

- **The board's phase cards** (`board/PhaseCard.tsx`). The header used to read "Build · Thu – Build ends ·
  Fri" under a title that already said "Build". It now reads "Thu – Fri" in a short phase (the view is that
  phase). A card that merges same-named phases of several open events has no single event to read against
  and keeps plain dates, as before. `PhaseGroup` now keeps the phase's id.
- **A task's check-in date**, in five places: the board card's chip, the task page (twice), the
  coordination page's overdue list and the dashboard's check-ins. A task has an event and a phase, so
  "Check-in Fri" in a phase view, "Build · Fri" on the task page (its event is in a chip), and
  "Peach Please · Build · Fri" where events mix. The feed rows carry `cycleId` and `phaseId`.
- **Removed:** `formatDateLabel` and `PeriodDateContext`, which nothing used any more. Its cases are all
  pinned in `tests/day-labels.test.ts`; `tests/date-display.test.ts` keeps the seven-day line and the
  setting's inheritance.

**Left as a plain date, and why**

| What | Where | Why it stays |
|---|---|---|
| When something happened to a record: submitted, raised, requested, created, edited, sent, invited, arrived, published, granted, closed, completed, activated | dashboard, applications, recruitment and mediation, invites, messages, communication, feedback, documentation, settings, conflict reports, the cycles list, proposals, profile, and the task page's signals, join requests, notes, comments, pings and "done {date}" | A moment in a record's history. It has no phase to be in, and "submitted Fri" would be wrong a week later. |
| Deadlines, windows and cutoffs, with their zone | input rounds, assemblies, budget proposal deadlines, a task's browse period and nomination reply-by, the returning and joining windows, the community check, the wider discussion, "needed by" on questions | Owned by the community, a budget or a record, not by a phase. They state a moment on someone's clock (`clock.deadline`) and the zone matters. |
| Appointments with people | interviews (admission page, applications, `recruitment/interviews.ts`), scheduling polls (confirmed slot, the poll page, the poll's own availability grid) | A poll belongs to no event. An interview is with an applicant, outside any phase. |
| The periods' own definitions | the participation page's phase date range (`formatDateRange`), `EventParticipation`'s event range | They are where a period is set; they must show the real dates. |
| The visible week's range caption on the two Schedule grids (`gridDayLabel`: "Sat, Nov 28 – Sun, Nov 29 · week 1") | `schedule/AvailabilityGrid.tsx`, `OwnerAvailabilityGrid.tsx` | Deliberate: the column headings are now weekday-only in a short event, so this caption is where the real dates stay visible. |
| Answers to profile questions that are dates | `field-shape.ts`, `profile-questions/indicators.ts` (`formatExactDate`) | A person's own date (a birthday), nothing to do with an event. |
| Not dates at all, or not for display to a member | `PlotEditor` (m²), `budget/format.ts` (numbers), `settings/tabs/HistoryTab.tsx` (change-log timestamps), `TimeZoneNudge` (zone name) | Out of scope. |

**One thing found, since fixed:** `components/EventParticipation.tsx` formatted the event's range with
`toLocaleDateString(undefined, …)`, which uses the server process's locale rather than a fixed one. It now uses a
fixed `en-US` format in UTC like the rest of the app. It stays a plain range (it is the event's own, so out of scope
by the table above) and the output is unchanged on an en-US host.
