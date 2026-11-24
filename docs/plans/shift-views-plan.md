# Shift views: list, calendar and standing schedules

**Status:** planned 2026-11-23, being built on `feat/shift-views`. Reworks the first cut of this feature (found in
the `clever-eagle` worktree, never merged), whose review is summarised in §1.
Background: `docs/plans/archive/cycle-scope-remediation-plan.md` §2.6, §4.8, §5.6 and D9–D11 (how rosters work).

## 1. Why the first cut was not mergeable

It flattened every upcoming shift into one stream with one list and one calendar. That lost what belongs to a
*roster* as a whole, and it broke the calendar:

- **Roster state had nowhere to live.** An event's roster is just the series placed in it (`shift_series.cycleId`);
  the open/collecting state (`cycle.shiftSignupsOpenedAt`), the one-way "Open sign-ups" act and the shift manager
  all belong to the *event*. The flat stream dropped them (§5.6 of the old plan) and repeated "Open sign-ups" on
  every row.
- **Calendar blocks were placed on one continuous time axis**, so day 2's 09:00 landed 24h below day 1's.
- **Overlapping shifts drew on top of each other.**
- **Zones were mixed:** rows read on their event's clock, the axis on the community's.
- The time filter misread overnight shifts; tags were not normalised; the `0122` migration number clashed with
  main (`0122_recipe_box`); the unit test file did not type-check.

## 2. Decisions

- **One scope at a time, as tabs in the page header.** A scope is an event roster (cycle) or "Standing". The tab
  strip goes in `PageHeader`'s `tabs` slot (`?scope=<cycleId>|standing`, like `/calendar` and `/board`). With a
  single scope there is no strip. Default scope: the event whose next shift is soonest, else Standing.
  Which tabs: events that have an upcoming confirmed shift, are managed by the viewer, or are open and have
  proposals waiting; Standing when it has series or the viewer manages it.
- **Event tab** = a status strip (sign-ups open / collecting, who manages it, the single "Open sign-ups" act with
  its "can't be closed again" note), the viewer's pending proposals for that event, then the List/Calendar views.
  Everything reads on **the event's own clock**, so the zone mismatch cannot happen.
- **Standing tab** = one card per series (a weekly rhythm makes a day-by-day timeline noise): its title, branch,
  tags, a pattern line ("Weekly on Tuesday · 18:00–20:00" when it is regular), its next shift, and the next
  shifts expandable underneath with their own Sign up / Withdraw. Tag and branch filters only; no day or time
  filters and no calendar.
- **Days run 06:00 to 06:00**, the programme grid's convention. A shift's `day` is that 6am–6am day; its *offset*
  is the minutes since that day's 06:00 on the venue clock. Every calendar column and the time filter work in
  offsets, never in absolute instants, which fixes the column drift and overnight shifts at once.
- **Overlap: side-by-side lanes** (Google Calendar style). Overlapping shifts in a day share the column width, in
  a deterministic order (start, then series title). Past a per-width lane cap the last lane becomes a "+N more"
  chip that opens the hidden shifts.
- **Blocks sign up.** A block (or an overflow chip) opens the shift's card in a modal with the same Sign up /
  Withdraw forms the list rows have. Blocks are tinted when you are signed up, when full, and when sign-ups
  are not open yet.
- **Days per page follow the screen:** 1 on a phone (< 640px), 2 on a tablet (< 1024px), 3 on a desktop. Lane cap:
  3 lanes at 1 day, 2 otherwise. Changing the count keeps the first visible day.
- **Tags** are lowercased, trimmed and de-duplicated when parsed, so "Cooking" and "cooking" are one filter.
- The page keeps `PageHeader` and its existing actions; nothing about who may create/manage changes.

## 3. Pieces

1. **Migration `0124_shift_series_tags`** (was `0122`, regenerated on top of main's `0122_recipe_box`).
2. **`src/lib/shifts/views.ts`** (pure, tested): rows carry `startOffset`/`endOffset`; `shiftOffsets`,
   `assignLanes`, `calendarAxis`, `calendarWindowDays(start, n)`, `shiftsByWindowDay`, `describeSeriesPattern`,
   `resolveScope`/`pickDefaultScope`, offset-based `shiftMatchesFilters`, normalising `parseTags`.
3. **`DayColumnsGrid`** becomes zone-free and lane-aware (blocks carry offsets, lane and lane count).
4. **`ShiftViews`** (event tab), **`StandingShifts`** (standing tab), a shared **`ShiftFilters`**,
   **`ShiftBlock`** / overflow chip as modal triggers, a `useDaysPerPage` hook.
5. **`page.tsx`**: scope resolution, tabs, event status strip, proposals moved into the tab, restored empty-state
   hint, standing manager line.
6. **Tests**: the pure logic, plus real-Postgres tests that tags are saved on create and update.
7. **Docs**: `docs/spec.md` shifts section mentions views and tags; CHANGELOG.

## 4. Deliberately not done

- A per-series timeline view for events (rows by series). Possible later as a third view.
- DST-night edge: the axis labels are `06:00 + offset`, so on the one night a year the clocks change they read an
  hour off after the change. Accepted; shifts straddling a clock change are rare.
- Series-stable lane order across days (lane order is per overlapping cluster, deterministic but not per series).
