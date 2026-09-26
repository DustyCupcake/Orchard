# Handoff: Orchard design conventions

## Overview
Global visual conventions for Orchard (the Next.js app in the attached `Orchard/` codebase) — colors, type, spacing, radius, elevation, icons, and core component patterns — plus the mechanism for per-community branding (two accent colors + logo) and a personal light/dark preference. This is foundations only: no specific page layouts beyond the existing sidebar (`AppShell.tsx`) were redesigned.

## About the design file
`Orchard Design Conventions (reference).dc.html` is an **HTML design reference**, not code to copy verbatim. It's a Design-Components-runtime file (custom `{{ }}` templating, a `DCLogic` class) that won't run as-is in Next.js. Recreate the patterns it shows using React + Tailwind CSS, matching the codebase's existing conventions (see `src/components/nav/AppShell.tsx`, `src/components/nav/Icon.tsx`, `src/app/globals.css`).

## Fidelity
High-fidelity for tokens (exact hex/formulas below) and component patterns (buttons, tags, forms, cards, table, banners, tabs, empty state). The rest of the app's pages (dashboard, board, settings, etc.) are currently unstyled server-rendered forms with inline styles — apply these conventions to them as a separate pass; they weren't individually redesigned here.

## Design system note
This design project has Anthropic's **Nocturne** design system bound to it (dark, soft-8px-radius, Inter, mono-accent, outline-only buttons). The conventions below **deliberately override** several of its defaults per the product owner's explicit choices: sharp 2–4px radii (not soft 8px), filled/bold primary buttons (not outline-only), two independent accent hues per community (not a mono scheme), and both light and dark themes (not dark-only). Keep those overrides — don't "correct" them back toward Nocturne's defaults.

## Design tokens

All values below are CSS custom properties in the reference file. Recommended integration: compute them server-side from the `community` row and the signed-in member's theme preference, and either (a) render them as inline CSS custom properties on `<body>`/a root wrapper so Tailwind's arbitrary-value syntax (`bg-[var(--accent-1)]`) and plain `style` props can consume them, or (b) generate a `<style>` block with the resolved values. Static/neutral values can stay as plain Tailwind classes (`bg-neutral-50`, etc.) — only the two accents and the light/dark switch need to be dynamic.

### Neutral ramp (light)
`bg #fff` · `surface #fff` · `surface-sunken #fafafa` · `border #e5e5e5` · `text #171717` · `text-muted #737373`
Steps 50–800: `#fafafa #f5f5f5 #e5e5e5 #d4d4d4 #a3a3a3 #737373 #525252 #404040 #262626` — matches the Tailwind `neutral` scale already used in `AppShell.tsx`.

### Neutral ramp (dark)
`bg #14151f` · `surface #1c1e2a` · `surface-sunken #20222f` · `border #333648` · `text #e9e9ed` · `text-muted #9a9db0`
Steps 50–800: `#1c1e2a #20222f #2a2d3d #3a3d52 #565a72 #767a94 #9a9db0 #c1c3d1 #e2e3ea`

### Accent 1 & Accent 2 (community-set, any hex)
Each accent derives a small ramp at runtime via CSS `color-mix()` — no need to store a full ramp per community, just the two base hex values:
- `soft`: `color-mix(in oklch, {accent} 10%, {surface-base})` (10% light theme, 20% dark theme)
- `softer`: same at 6% / 12%
- `border`: `color-mix(in oklch, {accent} 45%, {surface-base})`
- `hover`: `color-mix(in oklch, {accent} 88%, black)` light theme, `color-mix(in oklch, {accent} 85%, white)` dark theme
- `active`: same pattern at 78% / 72%
- `fg` (text on filled accent): `#ffffff` — **validate the picked accent is dark/saturated enough for white text** when building the Settings picker (reject or warn on very light/pale picks)

Defaults if a community hasn't set one yet: Accent 1 `#3a6cd9` (cobalt), Accent 2 `#8a3fa8` (plum).

### Status colors — fixed, never themed by community accent
Light: danger `#dc2626` / soft `#fef2f2` / border `#fecaca` — warning `#b45309` / soft `#fffbeb` / border `#fde68a` — success `#15803d` / soft `#f0fdf4` / border `#bbf7d0`
Dark: danger `#f87171` — warning `#fbbf24` — success `#4ade80` (soft/border: same accent-style `color-mix` pattern against the dark base colors at 18%/38%)

### Typography
Font: **Inter** (400/500/600/700), fallback `system-ui, sans-serif` — replaces the current plain `system-ui`. Scale: H1 32px/600, H2 24px/600, H3 18px/600, Label 15px/500, Body 15px/400, Small 13px/400 muted, Mono 12px (ids/counts/code) via `ui-monospace, monospace`.

### Spacing (balanced density)
`space-1..8` = `4px 8px 12px 16px — 24px — 32px` (space-5/7 unused, kept sparse intentionally).

### Radius — sharp, overriding Nocturne
`sm 2px` (checkboxes, small tags), `md 4px` (buttons, inputs, cards), `lg 4px` (dialogs — same as md, no larger radius anywhere). No pill shapes except an optional small round status dot.

### Elevation
Light: `sm 0 1px 2px rgba(0,0,0,.06)` / `md 0 4px 14px rgba(0,0,0,.08)` / `lg 0 16px 40px rgba(0,0,0,.14)`
Dark: `sm 0 0 0 1px #333648` / `md 0 0 0 1px #3a3d52, 0 8px 24px rgba(0,0,0,.55)` / `lg 0 0 0 1px #565a72, 0 20px 48px rgba(0,0,0,.65)`

### Icons
**Phosphor** (phosphoricons.com), Regular weight, 20px in grids / 16px inline. The **Fill** weight, tinted Accent 1, is reserved for the active/selected state only (e.g. the active sidebar item) — never for a default icon. This replaces the app's current hand-rolled `Icon.tsx` SVG paths; recommend `@phosphor-icons/react` and retiring `Icon.tsx` once every call site is migrated (grep `nav-config.ts`'s icon keys for the mapping).

## Components
See the reference file for exact markup/states of each — reproduce as Tailwind + inline `style` (for the two accent-driven properties) React components:
- **Buttons**: primary (filled Accent 1, white text), secondary (neutral outline), ghost (Accent 1 text, no border), destructive (filled danger), icon button (36×36, icon only), disabled (45% opacity).
- **Tags/status badges**: rectangular (radius-sm), neutral/Accent-1/Accent-2/warning/danger/success variants — used for task status, roles, flags.
- **Form fields**: text input, select, textarea, checkbox (custom square with check icon, not the browser default), radio (custom dot), segmented control (2–3 options) — border/focus states in Accent 1.
- **Cards**: kicker/title/body/meta pattern (matches `TaskCard.tsx`'s content shape) plus an elevated variant.
- **Table**: uppercase 11px muted header, row hover tint, bottom-rule per row.
- **Sidebar**: extend `AppShell.tsx` — logo slot replaces the "Orchard" text wordmark when a community sets one (falls back to community name in Inter 600); active nav item becomes Accent-1-soft background + Accent-1 text + Fill-weight icon (currently `bg-neutral-200/70` neutral).
- **Banners**: info (Accent-1-soft, e.g. the View-as banner), warning (fixed amber, e.g. On-site mode), danger (fixed red, e.g. conflict alerts) — same three-banner pattern already used in `AppShell.tsx`, just restyled onto the new tokens.
- **Tabs**: underline style, Accent 1 on the active tab.
- **Empty state**: centered icon + line + ghost action, dashed border container.

## Interactions & behavior
- Hover/active/focus states are all token-driven (see `hover`/`active` accent steps and `:focus-visible`-equivalent Accent-1 border/outline) — no browser-default focus rings.
- **Theme is personal, not communal**: default from `window.matchMedia('(prefers-color-scheme: dark)')`, with an explicit override stored per-member (e.g. a nullable `theme_preference` enum column on `member`, or simplest: client-only `localStorage`, no DB/round-trip needed unless cross-device sync matters). Give it a control on `/profile`, not `/settings`.
- **Accent 1, Accent 2, and logo are communal**: set once by whoever holds Admins, on `/settings`, applied for everyone.

## Task UI grammar

Decided 2026-09 with the product owner. This is the component-level grammar for everything task-shaped — cards, the task detail page, and any future list/dashboard surface that renders tasks. It builds on the tokens/components above; it doesn't replace them.

### Action hierarchy — one primary, everything else in a menu
Every task surface shows **at most one primary action** (state-dependent) plus at most one secondary; all remaining actions live in a `⋯` overflow menu (`src/components/ui/ActionMenu.tsx`, a client dropdown — the one place a real dropdown is used; `<details>` stays the pattern for *edit* disclosures). Menu items that need input (e.g. Park's date+note) are not menu rows — they're a `<details>` disclosure containing the form.

| Task state (for the current viewer) | Primary | Secondary | Menu |
|---|---|---|---|
| Unclaimed, eligible | **Claim** | — | Escalate (coord only) |
| Claimed, mine | **Finish** | Park (disclosure w/ form) | Release, Escalate |
| Claimed, mine, attention-flagged | **Still on it** (detail page nudge panel) | — | Park, Finish, Release |
| Waiting, mine | **Resume** | — | Mark done, Re-snooze, Release |
| Claimed, not mine, has room | **Request to join** | — | Shadow, Escalate |
| Any, not mine | — | Shadow | Escalate (coord only) |

### Status iconography — one icon, two channels
Status and attention are orthogonal, so they share one visual element: **shape = lifecycle status, color = attention level**.

| | ok | soft | hard |
|---|---|---|---|
| Unclaimed | `Circle` gray | amber | red |
| Claimed | `PlayCircle` accent-1 | amber | red |
| Waiting | `PauseCircle` gray | amber | red |
| Done | `CheckCircle` green | — | — |

- **Escalated overrides the shape** → `Megaphone`, red. It's a manual coordinator action, a different kind of thing from automatic staleness.
- **View-dependent visibility**: the status icon only appears where tasks of *mixed* status render together (dashboard, contribution, coverage groups, search). On kanban the column already carries status — an icon there is noise. `TaskCard` therefore takes no status icon; it keeps the 3px colored left border as its attention signal plus the word-tag on non-ok tasks.
- Color is never the *sole* attention channel (the word-tag always accompanies non-ok), so colorblind users are covered.
- **Known risk**: a community accent-1 too close to amber/red would collide with the attention tints on the claimed icon. Accepted for now; the escape hatch is rendering status icons in the neutral ramp and reserving hue for attention only.

### Metadata — icon chips
Task metadata renders as small icon+value chips, not a `·`-separated sentence: `GitBranch` branch · `Clock` effort · `Users` capacity `1/2` · `Ticket` event · `CalendarBlank` deadline/check-in. Used on cards (one wrapping row) and under the detail-page title. The event chip is `Ticket` rather than a recurrence glyph (`ArrowsClockwise` was the original) to match the nav — "Event" means one discrete occasion a member attends or holds a place at, which is what a ticket is, and the same `TicketIcon` now serves `CycleChip` and nav-config's `cycle` key alike.

### Terminology — UI copy speaks outcomes, not schema
| Internal value | User-facing copy |
|---|---|
| `open` | Open to claim |
| `request` | Ask to join |
| `coordination_approved` | Requires approval |
| `community_endorsed` | Chosen by endorsement |
| `individual_gate` | Required of each person |
| `group_coverage` | Someone on the team must have this |
| `soft_priority` | Helpful, not required |

Canonical mapping lives in `src/lib/format.ts` (`OPENNESS_LABELS`, `REQUIREMENT_MODE_LABELS`) — never inline these strings.

### Contextual strip — what earns the top of the task page
Only *actionable-right-now-for-this-viewer* content appears above the standing content, in this priority order: (1) attention flag + response actions, (2) waiting check-in due + response actions, (3) coordinator self-assign confirmation, (4) cross-cycle mismatch, (5) my pending join request, (6) overdue/upcoming milestone. Nothing else earns a top slot without explicit discussion — that discipline is what keeps the page from becoming a wall again.

### Card density
- Description clamps to 2 lines (full text one click away).
- Requirements summarize: unmet `individual_gate` items listed (danger), met ones collapse to "N of M met"; `group_coverage` keeps one status line each; `soft_priority` is hidden on cards (shown on the detail page).
- The park form is never always-visible — it lives behind its disclosure.

### Task detail page — two-column, collapsing
`lg` and up: main column (description, notes/wiki/comments inline — never tab-gated, per spec — subtasks, people/coordination sections) + 300px right rail (status/actions card, holders, requirements summary, milestones, dependencies, admin-ish disclosures like permissions/cycle-change). Below `lg`: the rail stacks under the main column — nothing is lost, actions stay in the always-top page header. The old 6-tab bar is gone; sections replaced it.

## Data model changes needed
- `community`: add `accent_primary text`, `accent_secondary text` (hex strings), `logo_url text` (or a stored-asset reference, matching however the codebase handles uploads — none exists yet for images, so this may need a small upload/storage utility).
- `member` (optional): `theme_preference text` enum `system | light | dark`, default `system` — only if cross-device sync of the preference is wanted; otherwise skip and keep it `localStorage`-only.
- `/settings`' existing "Community" `fieldset` form (`src/app/(app)/settings/page.tsx`) is the natural place for the two accent color inputs (`<input type="color">`) and a logo upload/URL field, next to `updateCommunityAction`.

## Assets
No logo asset exists yet — it's a per-community upload, empty by default (falls back to the community's text name). Phosphor icons are a CDN/npm dependency, not a bundled asset (`@phosphor-icons/react` on npm, or `@phosphor-icons/web` for a CSS/class-based approach if avoiding a React dependency).

## Files
- `Orchard Design Conventions (reference).dc.html` — the full HTML reference (open in a browser; view source for exact markup/values).
- Target codebase files to update: `src/app/globals.css` (font import, remove hardcoded `system-ui`), `src/components/nav/AppShell.tsx` (sidebar restyle + logo slot), `src/components/nav/Icon.tsx` (retire in favor of Phosphor), `src/app/(app)/settings/page.tsx` + `actions.ts` (add accent/logo fields), `src/db/schema/community.ts` (+ migration for the new columns).

## Styling progress
Living checklist — update it in the same commit whenever a page/piece moves from ⬜ to ✅, so any session can tell at a glance what still needs a pass. "Restyled" means: onto the tokens below (colors/type/spacing/radius via CSS custom properties, not hardcoded hex/`system-ui`), sharp radii, Phosphor icons where the page has icons at all — not necessarily a re-layout of the page's actual content/fields.

**Foundations — done**
- ✅ Design tokens (`src/app/globals.css`): neutral ramp, accent-1/2 ramps, status colors, spacing/radius/shadow, both themes.
- ✅ Typography: Inter via `next/font` (`src/app/layout.tsx`).
- ✅ Icons: `@phosphor-icons/react` installed; `src/components/nav/phosphor-icon-map.tsx` maps existing nav icon keys. `src/components/nav/Icon.tsx` (the old hand-rolled SVGs) is **not yet retired** — still the only icon source for every unrestyled page below.
- ✅ Community branding: `community.accentPrimary`/`accentSecondary`/`logoUrl` columns + migration, settings-page color/URL inputs, dynamic `--accent-1`/`--accent-2` injected inline on `<html>` in the root layout (falls back to the documented cobalt/plum defaults when a community hasn't set its own). Logo is a plain hosted-image URL field — no upload/storage utility exists in this codebase, building one is still out of scope.
- ✅ Personal theme preference: `data-theme="light"/"dark"` override on `<html>`, `localStorage`-only (no DB field — matches the README's own "skip unless cross-device sync matters"), a System/Light/Dark control on `/profile` (`ThemeToggle.tsx`), a blocking init script in the root layout to avoid a flash.

**Shared UI kit** — `src/components/ui/kit.tsx`: `Tag`/`Tone`/`ATTENTION_TONE`, `Banner`, and `BUTTON_PRIMARY`/`BUTTON_SECONDARY`/`BUTTON_GHOST`/`BUTTON_DESTRUCTIVE`/`INPUT`/`SELECT`/`CARD`/`LABEL` class-string constants. Extracted once the same button/tag markup started repeating verbatim across dashboard/board/task pages — reach for these instead of re-typing the token classes on any new page.

**Nav pattern — two header styles, and two defaults, picked per group**: `NavGroup.headerIsLink` (`nav-config.ts`) decides which header style, and `NavGroup.defaultOpen` decides whether it starts expanded. `true` (`headerIsLink`): the header becomes a real link (icon + label, styled like Dashboard/Calendar) to its "main view" — `NavGroup.href` when set, else its first item — with a separate chevron button just for expand/collapse, and sub-items render without icons (indented text only) *and without the pin toggle* (items only get pinned as a whole via the group header/hub, never individually), since these items are lightweight views into one domain, not individually meaningful destinations to pin. Tasks (`/board`), Community (`/community`), and Communication (`/communication`) have genuine hub pages; Library is a deliberate header-only destination at `/documentation` (the documentation/wiki surface, not the separate Task Pack library). Absent/`false` (`headerIsLink`): the header stays a plain uppercase toggle-only label, every item keeps its own icon, and every item keeps the pin toggle — pinning is deliberately a Modules-only affordance now, since each item there is a full, independently pinnable module unlike the lightweight views above. Decided after the user tried the initial everywhere-the-same version live and it didn't fit Modules or the pin affordance. See `AppShell.tsx`'s `NavGroupBlock`.

**…and the defaults follow that same distinction**: a `headerIsLink` group starts **collapsed**, Modules starts **open** — because the flag already encodes "this row is a destination first", and expanding them all made the sidebar a wall of indented text that duplicated hubs the headers already link to. `defaultOpen` is a fallback behind each member's own explicit per-group choice, so changing a shipped default never overrides someone who already opened or closed it. This is why the sidebar's persisted state is a per-group *chosen state* (`groupOpenOverrides`, `orchard.sidebar.groupOpen.v2`) and not the older *set of closed groups*: a closed-set can only ever grow, so a group defaulting to closed could never be opened again. The v1 `closedGroups` key is read once and converted so existing sidebars don't reset. Verified live: defaults on a clean profile, a group opened by click and surviving a reload, the legacy key converting, and Modules still expanded with its items visible.

**Icons**: a few Modules icons were swapped after review to stop colliding or read better — Budget is now a piggy bank (was a coin), Conflict reports is a handshake (was a shield, which collided visually with Sensitive data's — also a shield, kept), Event schedule is a calendar-with-heart and Shifts a clipboard-with-text (both were a plain calendar, colliding with each other and with the top-level Calendar nav item). Tasks' 7 sub-items still all share the checkbox icon and 4 of Community's share the people icon, but that's no longer a live concern now that those two groups' items aren't individually pinnable — the only place a shared icon could have surfaced twice at once.

**Restyled**
- ✅ Sidebar / `AppShell.tsx` — nav rows, banners, icon-button chrome, mobile drawer, community name/logo slot, the two-style group-header pattern above.
- ✅ `/dashboard` — plus the declare-joining surfaces added on top: the same "Current and upcoming events" cards when the nav switcher isn't narrowed to one event, or a top-of-page "You're not down as coming for *event*" ribbon (one button, and nothing at all once you've said you're coming) when it is. Both share `EventParticipation.tsx` with `/community`, and both hand over to `/questions` when the event has questions of its own.
- ✅ `/questions` — new page aggregating every unanswered ProfileQuestion, grouped by scope (once-ever / this event / this phase), with `?cycle=` focus so the declare-joining controls can send someone straight to one event's questions. **No nav item**: it's a supporting page, not a destination, and its count rides the Dashboard badge (folded into `taskBadgeCount`) alongside a Dashboard element above the feed. Its per-question form is `src/components/ProfileQuestionForm.tsx`, now shared with `/profile` and the Dashboard's onboarding panel (which previously had its own near-copy).
- ✅ `/board` (+ `TaskCard.tsx`, `BranchFilter.tsx`, `TagFilter.tsx`) — "the main task view": one primary Propose a task action plus a board overflow for Proposals/My contribution/Input rounds (+ Coordination/Escalation for a coordination holder) and shared batch Claim/Export/Move actions. Kanban columns get uppercase muted headers with a count Tag; each TaskCard is a proper token-styled card with tone-colored attention/critical Tags and Claim/Release/Finish/etc. as real primary/secondary buttons.
- ✅ `/propose`, `/proposals` (+ `ProposalCard.tsx`), `/contribution` (+ `[id]`, + `ContributionCategories.tsx`), `/coordination`, `/escalation`, `/scheduling-polls` (index), `/scheduling-polls/new`, `/input-rounds`
- ✅ `/tasks/[id]` — the big one (~1300 lines: candidacy, coordination, subtasks, shadows, requirements, notes, milestones, questions, and more). A new "Schedule a poll" button in the top action row links to `/scheduling-polls/new?branchId=…&title=…` (pre-filling that task's branch and title) — offered on every task, not conditionally, since there's no field on Task to condition it on; say if you'd rather it were scoped tighter. `MilestoneDateFields` (the shared fieldset both the add- and edit-milestone forms use) restyled too.
- ✅ `/community` — the Community group's hub at `/community`, with its own links to Members/Assemblies/Settings, an Invite-a-member action when Recruitment is enabled, a compact community snapshot, the "Current and upcoming events" cards (`src/components/EventParticipation.tsx` — one long horizontal card per open event, with dates, the coming count out of capacity, and a one-click Coming/Maybe/Not coming control), and an "Open Assemblies" section (`CommunityAssembliesSection.tsx`) listing every un-closed Assembly with its phase, closing countdown, how many items you've answered, and a "Waiting on you" tag on the ones `isAwaitingMyAnswer` flags. A passive listing, not a notification — spec.md's "no built-in urgent notification, on purpose" rules out pushing, not showing, and this is the same treatment the events cards above already get. Ordered outstanding-first, then by which closes soonest. `/members` is intentionally only the member directory; it is not a second Community hub. Events left the Community nav group for the top level (see nav-config's `EVENTS_ITEM`), so the hub links to it no longer.
- ✅ `/settings` — fully restyled and split into 9 tabs (General/Coordination/Modules/Recruitment/Branches/Cycles & Tiers/Profile & Privacy/Forms/Members), selected via `?tab=` (a plain `<Link>` bar, no client JS). This was a real backend split, not just a visual one: the old single `updateCommunityAction` covered ~15 concerns in one form/one submit, which would have silently wiped fields on other tabs if just given a tabbed UI on top (several fields are checkboxes/arrays whose "absent from this submission" means "turn off," not "unchanged"). Split into `updateGeneralSettingsAction`/`updateCoordinationSettingsAction`/`updateModulesSettingsAction`/`updateRecruitmentSettingsAction` (`actions.ts`), each parsing only its own tab's fields through the same shared `updateCommunityInput`/`updateCommunity()` (untouched) — every field lives in exactly one tab's action, so there's no cross-tab overwrite risk. `redirectWithError` gained a `tab` param so an error redirects back to the tab that produced it. Verified live by toggling a Modules checkbox, saving, and confirming General/Coordination/Recruitment's own DB columns were byte-identical before and after. **Real bug caught during that verification**: a shared `CheckField` helper didn't accept a `value` prop, so all of Modules' checkboxes (which share one `name="modulesEnabled"`) silently got the same generic `"on"` value instead of their own module key — would have broken module enablement on save. Fixed before shipping.
- ✅ Settings moved out of the sidebar's old fixed bottom slot (next to the profile/logout block, which reads as "your own stuff") into the Community nav group as a real item, reachable from the `/community` hub — see the nav-relocation note in the project memory for the full reasoning.

**Moved**: Scheduling polls is no longer a Tasks sub-nav item — it's about *when* things happen, not the task itself, so it's now a button on `/calendar` instead.

- ✅ `/calendar` — month grid, Upcoming list, invites/your-events/on-your-calendar sections, and the create/edit/invite forms all moved onto the tokens. The grid's per-day entry chips and the Upcoming list's `Tag` both derive from a new `KIND_TONE: Record<CalendarEntryKind, Tone>` map that collapses the view's 13 distinct entry kinds onto the shared 6-tone palette (confirmed/settled things — phase boundaries, poll confirmations, programme slots — read success/accent; personal calendar events and birthdays read accent2; cutoffs/deadlines read warning; assembly milestones and shifts stay neutral) rather than inventing a 13-color bespoke scale. Needed a small kit.tsx addition: `TONE_CLASSES` (previously private to `Tag`) is now also exported, since the day-grid chips are too small for `Tag`'s own padding and need the same token colors in a bare `<a>`. Verified live in both themes (light via a temporary `data-theme` override, dark as the default) — chip/card/button colors and the month grid's today-ring all resolve correctly; a real event's Edit/Invite/Delete disclosures and the Create form all still submit through the same unchanged actions.

- ✅ `/scheduling-polls/[id]` + `AvailabilityGrid.tsx` — the poll detail/voting flow. `AvailabilityGrid` (the one real client-side pointer-drag component in the app) only had its `style` props swapped for token classes — every handler (`onDown`/`onEnter`/`paint`/the `dragging`/`paintValue` refs/`save`) is untouched. Its painted-cell color moved from a hardcoded green to `var(--accent-1)` (painting availability reads as "primary action taken," not "success" — that tone is reserved for confirmed/settled states elsewhere), and its two-tier gridline distinction now reuses `var(--border)` (hour lines) vs. `var(--surface-sunken)` (half-hour/day lines) rather than inventing new tokens for what was `#ddd`/`#eee`.
- ✅ `/schedule` (+ `EventReviewSection.tsx`) — Event scheduling. Proposal status (proposed/conflict/confirmed/declined) now reads as a `Tag`, toned via a `STATUS_TONE` map mirroring `tasks/[id]`'s existing `NOMINATION_STATUS_TONE` convention (awaiting→warning, settled→success, rejected/blocking→danger). That map (plus `STATUS_LABEL`) had to move into its own `status.ts` module rather than staying as a named export on `page.tsx` — **caught a real Next.js build failure this way**: the framework's page-export validator rejects any named export from a `page.tsx` beyond its own recognized set, which `next build`'s type-checking pass enforces but plain `tsc --noEmit` does not, so the mistake passed typecheck cleanly and only surfaced once the Docker image build actually ran `next build`. The ambiguous-multi-cycle-scope picker (shared shape with the not-yet-restyled `/budget` and `/spatial-planning`) got a first token pass here too.
- ✅ `/shifts` (+ `MySeriesSection.tsx`) — series status (Active/Archived) as a `Tag` (success/neutral), upcoming-shift and past-shift cards on `CARD`, the coordinator's per-series management view (occurrences, roster, no-show marking, the weekly-pattern and explicit-list occurrence-generation forms) fully tokenized.

- ✅ Community group: `/members/[id]`, `/messages`, `/assemblies` (+ `[id]`/`new`), `/documentation` (+ `[id]`/`new`), `/feedback`, `/participation`. The bare `/participation` most members reach is actually a redirect shim to `/[cycleScope]/participation` (Phase 65) — that's where the real, substantial page (~720 lines: your plans, cycle settings, phase dates with drift/order-invalid warnings, Task-Pack export, close-cycle, start-a-new-cycle with a clone-date preview) lives, and it's what got restyled. Its shared `ClonePreview.tsx` (`ClonePreviewGrid`/`ClonePreviewList`, also used by the not-yet-restyled `/task-packs/import/[packId]`) moved onto tokens too, since it renders inline on this page — same "restyle a shared component when the page you're doing actually renders it" precedent as `FieldPreview.tsx` (Batch 1) and `AvailabilityGrid.tsx` (Batch 2). `/documentation`'s "unanswered" marker and `/assemblies`' phase (agenda/notice/voting/closed) both now read as a toned `Tag`. Verified live: the emergency-access reveal-Banner flow on `/members/[id]`, an assembly's closed-phase read view, a wiki page's revision history disclosure, and — on `/participation` — both the aggregate (all-open-cycles) and narrowed single-cycle view scopes, the clone-preview grid actually resolving real phase-boundary entries, and the already-open-cycle warning banner.
  - ✅ **`/participation`'s phase cards** — a later pass, and the one place this page still broke a rule the rest of the app follows: each phase rendered its whole authoring form inline, so the section read as a wall of controls with the phase buried under it. Each card is now a name, its resolved date range, and a plain-language statement of where it sits relative to the event ("4 days before the event starts"), with the date and module controls behind an `Edit` disclosure — the `<details>`-for-edit pattern above, which every other form on the app already used. The prose is `src/lib/dates/describe.ts`, one shared definition, because a phase boundary and a task milestone are the same stored recipe and had already grown two near-identical inline formatters that printed the raw number. The rule worth keeping: **a stored number is machinery, so say the day, not the figure** — a negative offset is "before" and a positive one is "after", and a proportion is never 0% or 100%, because those are just the first and last day of the event. A pinned module became a `Tag` in the header rather than a dropdown value nobody could see.

- ✅ **Field shapes** — `src/lib/field-shape.ts` is now the one definition of how a question is answered (six types, plus short/long, a format check, an "other" escape hatch and number bounds as orthogonal flags), shared by ProfileQuestion and `Form.fields` exactly as spec's "Forms made of Questions? Partly" always intended. It also removed the **four** separate per-type rendering switches this area had grown (`FieldPreview`, `ProfileQuestionForm`, the Dashboard's `PrefilledAnswersReview`, and the form pages' inline copies) — all of them now render through `FieldPreview`, and all value validation through one `validateFieldValue`, so a new type is an edit in one place. The settings `FieldShapeEditor` gained the per-type controls ("long answer", "check the format", "let people write their own answer instead", min/max/step) and zeroes the flags that no longer apply the moment a type changes, so the builder can't show a setting that isn't stored. The one trap worth remembering: the `EditableFieldShape` type and its helpers live in `field-shape.ts` and **not** in `FieldShapeEditor.tsx`, because that file is `"use client"` and a Server Component cannot call anything exported from one — `settings/page.tsx` needs to build a shape before rendering the builder, and doing that from the client module crashed the whole settings page.
- ✅ **The same six types now reach task questions and Assembly agenda items** (migration `0068`). Both carried their own three-value `free_text` enum, zod schema, validator and inline renderer — the third and fourth copies of a definition that already existed twice, and the reason "when could you do this?" was inexpressible on a task and "what budget do we need?" inexpressible on a motion. `field-shape.ts` also grew the two wording maps (`RESPONSE_TYPE_HINTS`/`RESPONSE_TYPE_NOUNS`) for the same reason: per-surface hand-written copy is what let `QuestionShape` call a date question "Written answer — Everyone answers in their own words". Three things worth remembering for whoever touches this next, because all three are the *same* class of mistake:
  1. **A tally that iterates `options` drops free-text answers while its total still counts them.** Both the Assembly and task-question tallies now count them as a visible "wrote their own answer" row so the bars still sum to the response count printed above them. Any new aggregate over a choice field has this bug by construction until it's handled.
  2. **A truthiness blank check silently discards `false` and `0`.** That's the real cost of a yes/no and a figure: not the display, but every `if (!value)` that stands between a member and being counted. `isBlankValue` is the one definition, and `formatFieldValue` is the read side of what `fieldValueFromFormData` writes (`String(r.value)` printed "false" and a raw ISO date at members deciding how to vote).
  3. **`AssemblyResponseType` and `agenda.ts`'s `isChoiceType` are re-exports now, not local definitions.** Leaving a lookalike in place is how the next type gets added to one and not the other.
  Also: `BallotForm` is a **controlled** client component and so cannot use `FieldPreview` — it renders all six itself. That was a real coupling, not a preference: the agenda composer can create types the ballot must be able to answer, so extending the schema without extending the ballot would have shipped questions the community's own voting form couldn't render. Verified live end-to-end: all six types authored, rendered, answered and stored as their real JSON types (a figure as a number, a "no" as a boolean), bounds enforced client-side and server-side, the escape hatch's sibling input round-tripping, the tally summing to the response count, and a boolean answer pre-filling back into the *No* radio — which only works because the stored value is the boolean rather than the string.
- ✅ **Community indicators** — a `ProfileQuestion` can be published as an aggregate on `/community` (migration `0070`). Three things here are decisions rather than implementation, and each is a way the feature could quietly do the wrong thing:
  1. **The display form is derived from the answer type, never chosen** (`indicatorFamilyFor`). Three families: `split` (`single_choice`, `boolean`), `distribution` (`multi_choice` — counts of *people*, deliberately not summing to the answerer count, because five people choosing three options each is fifteen picks over five people and a pie of that claims something false), `summary` (`number`, `date`). `text` has no family and **cannot be published at all** — the only honest total of a text field is the members' own words. The settings toggle is *disabled* with its reason attached rather than hidden, because a greyed-out option with no explanation reads as a broken app.
  2. **A withheld breakdown is withheld server-side.** `data: null`, computed away rather than hidden in CSS — grep the delivered HTML to confirm there's nothing to uncover. The *signal* (label + coverage) stays public either way, matching the `branchHealth.counts` / capacity-visibility precedent. "Signal public, number gated" means a member can always tell that their pronouns are a tracked fact about the community rather than an accident of one admin's settings.
  3. **Every number carries its denominator, and the escape hatch is a visible row.** The coverage line keeps "preferred not to say" and "haven't" apart — a refusal is not silence. The hatch's answers get their own "Something else" row (folding them into a neighbour undoes why the hatch exists; dropping them makes the parts fail to sum) and **only the count is ever published** — what someone typed is theirs, and no publish toggle can consent to it for them.

  Two traps worth remembering, both of which bit during the build. **A boolean is stored as a real `true`, not a string in an option's slot**, so routing it through the same counting path as a choice — where a `typeof v !== "string"` filter skips it — produced two empty rows for a published yes/no; it's a separate branch with both sides always present, and there's a test for the all-yes case so a real zero can't regress into a missing row. And **the refusal message composes a reason with a remedy, kept as two values**: concatenating one combined string told an admin editing a published question to "change the answer type to pick one first" — advice for someone trying to *publish* — immediately before "unpublish it first", which is advice for someone trying to *stop*. Relatedly, changing a published question's type is **refused, not silently unfixed** (the opposite of how a stale `min`/`max` is cleared), because clearing would let an admin editing an unrelated dropdown make a community-chosen disclosure vanish with nothing said; a plain label edit must still work, and a test pins that.

  The indicators also render on the **Dashboard**, and there the population follows the page's existing `?memberCount=cycle` toggle — one control for one question ("who are we talking about?"), not two that can disagree. Only the population narrows; the answers are once-ever facts, so an event-scoped indicator means "of the eight coming, five have told us their pronouns", never "what people said about this event". `memberCountView` is hoisted above the `Promise.all` so the indicators and the member count resolve the switcher's default identically — and note the indicator scope is *not* `singleCycleId` alone, since the switcher being narrowed to one event is not the same as the reader having chosen "This event". **An event population smaller than the community's floor falls back to the community-wide figures *with a note saying why*** (migration `0074`, `cycleIndicatorsEnabled` + `cycleIndicatorsMinMembers`, default 10 members and off) — never a silent substitution, and never an "0 of 0" chart. The floor is tested against the **post-exclusion population the chart will actually display**, resolved inside `listCommunityIndicators`, so the fallback note can never say "10 attendees" above a chart reading "of 8". Both halves of the old rule needed replacing: gating an indicator on a coordination grant was the wrong fix (see below), and an empty event chart is a broken widget rather than a privacy win.

  The remaining open risk, recorded rather than papered over: **there is deliberately no small-n suppression** beyond the community's own configured floor. A hidden threshold would read as a broken widget, and inventing a disclosure rule nobody agreed to is worse than the community choosing one.

  **A member's standing consent** is `member.consentsToCommunityIndicators`, its own section on `/profile` — the consent mechanism that was missing, because a decline is a response to *one* question and a question invented later has no decline for them to have used. Two things about it are load-bearing. It's a **reporting change, not an answering gate**: a member who declines can still answer everything and nothing becomes outstanding for them, since suppressing answering too would be a way to drop someone out of a *required* question by hiding the control. And they're removed from the **denominator too**, not just the numerator — keeping them in the population while dropping their answer produces a permanent "1 haven't" for someone still answering everything. `populationIds` is the single definition of who an indicator describes and both the count and the answer filter read it. The default is **true**, and it is the **opposite** of `contributionVisible` on purpose: a contribution record is passive (generated from task history, so sharing it must be asked for) while a profile question was asked and answered (so counting them is the expected consequence). The section is deliberately outside "Your answers", which only renders when there's something to show — the control has to be settable *before* answering, or it informs nobody. Migration `0076` flipped this column's polarity; the setter is `updateIndicatorConsent`, self-service with no Admin path, because an Admin ability to exclude a member is the same power as one to include them without asking, wearing a privacy label.

  **The settled design** — this supersedes the section's earlier three-category version, and
  `docs/default-profile-questions.md` holds the full write-up plus the proposed default question
  set. A profile question is **not** a member of a category; it carries independent attributes,
  because the three-category version failed on its own terms: "gated" turned out to be *access*,
  not a kind of data — t-shirt size isn't sensitive and still mustn't be readable by everyone.

  **Built so far:** the `sensitive` and `emergency_access` columns and their settings UI
  (`0076`); the refusal on the flags that contradict publication, in both directions and against
  the effective pair; section-level consent replacing the per-question machinery (`0077`); the
  `community_coordination` gate removed outright rather than left as a dead enum (`0073`); and
  the access rules and consent purposes retargeted to question ids, with
  `resolveReadableQuestions` as the single fail-closed definition of readability and the
  per-answer share box wired through the answer form (`0078`).
  **Not yet:** emergency *reads* — `emergency_access` is stored and guarded, but activating
  emergency mode doesn't yet surface question answers, and `emergencyAccessLog.explanation` is
  still nullable when a question read should require it. Then task-derived questions inheriting
  their task's scope, the community-chosen prominent profile set, and setup-time seeding.

  **The one thing to re-derive before touching the ladder:** `sensitive` performs no restriction
  of its own. It marks which questions the access rules apply to, and the rules are the entire
  mechanism — so "sensitive with no rule" means an *empty* audience, which the read side treats as
  nobody-but-the-owner. That is why marking one is refused without a rule, and why the settings box
  is disabled until a rule exists rather than accepted and silently useless. An early draft also
  required a rule to already find its question sensitive, which with the above is a **deadlock**:
  the rule names a question, the flag is refused until a rule exists, and neither can go first.
  Rules and consent purposes are therefore allowed against a not-yet-sensitive question and are
  *staged* — restricting nothing until the flag lands.

  | attribute | values | notes |
  |---|---|---|
  | **published** | on / off | Admin toggle on one question. Once-ever only. |
  | **sensitive** | on / off | On requires an access rule to exist. |
  | **scope** | once-ever / per-event / per-phase | Free — and free for *sensitive* questions, since "medication on site" is both. |
  | **access** | a set of rules | Orthogonal to sensitivity. |
  | **emergency** | on / off | Answering it consents to emergency reads. |

  **Sensitivity is made cheap-to-abuse deliberately not.** A non-sensitive, unrestricted
  question defaults to **readable by the whole community**, and restricting it at all requires
  marking it sensitive and configuring rules. So under-labelling a health question doesn't save
  work — it publishes the data to everyone, visibly. The shortcut and the danger can't point the
  same way, so nobody has to be trusted to tick the right box. This is the whole answer to the
  absurdity of a hardcoded `admin → allergies`, and it retires the need for the per-module
  opt-in list that pairing would have required.

  **Consent is granted once, at the section — never per question.** A member ticks "my answers
  in this section may appear in community indicators" and that covers every answer they give
  there, including to questions added later. Because a question can only enter the section at
  creation, the consent always predates the answer, so there is never a reason to ask again.
  This is why the `indicatorConsent` enum, the `pendingConsent` count, the "asked whether to be
  counted" coverage line, the `/questions` consent-request section and the Dashboard's consent
  element were all **built and then removed**: they solved a per-publication nagging problem that
  section consent makes impossible, and were triggered by an *admin's* action that had nothing
  to do with the member. The one thing that does re-open it is widening a sensitive question's
  audience, and only for the member whose answer it is.

  **Consent is to a rule, not to a list of people.** "Whoever holds the task" is consented to as
  a *relationship*, so a new claimer is inside what was agreed and needs no new conversation —
  the same shape as "anyone holding Kitchen" when Kitchen is open. Only edits to the rule
  re-open it: adding a task link, changing an access rule, turning on emergency access. A task
  being claimed by somebody new is **not** a consent event, and treating it as one would either
  spam members or produce a notification they learn to ignore.

  **Emergency access is an override, not a permission**, and that is why it behaves the way it
  does. Answering an emergency-marked question *is* consenting to emergency reads — no separate
  tick, and the only way to refuse is not to answer, exactly as a filled-in contact method has
  no opt-out from emergency reachability. Every emergency read notifies; every read under a
  permission the member granted is silent. That asymmetry is the accountability, and it is why
  an access that would be unacceptable as a silent permission is fine as an override. It is also
  why `emergencyAccessLog.explanation` being nullable is a problem: for "look up this phone
  number" that's defensible, but for reading a member's medication the member is being notified
  and the log should say why.

  **The permission ladder is three levels**, and the baseline is always bounded by the
  sensitivity declaration: non-sensitive unrestricted means everyone may read and a member can
  only decline; sensitive means the configured audience, and a member can uncheck to reduce to
  emergency-only; declining entirely is always available. Level 1's maximum default is what makes
  the flag hard to misuse. Level 2's checkbox defaults **on**, because the audience is already
  restricted by configuration, so unchecking is a reduction from an already-bounded exposure
  rather than the last line of defence.

  **Permissions are not presentation.** With non-sensitive answers readable by anyone, listing
  them flat on a profile is a mess — so a profile shows a **community-chosen prominent set**
  with the rest behind a disclosure, adjustable per member. Community-chosen rather than
  member-chosen because a purely member-curated profile starts empty for everyone, which is
  worse and almost certainly not the intent. The permission model must not double as a page
  layout.

  **Task-derived questions inherit the task's scope** rather than picking their own, so a task
  holder proposes a question, it attaches to their task, and the answer lives exactly as long as
  that task does — which is what a `cyclesEnabled: false` community needs, since with no event
  there is no other lifetime available. No fourth scope value: a task already carries a nullable
  `cycleId`, and a cycle-less task inherits the same "always applies" treatment the board gives
  it. The audience is the union of holders of any linked task, resolved the way `permission_grant`
  already resolves; `requirement` is the wrong table to reuse, being task-owned and about claim
  eligibility rather than readership.

  **Publishing governance is still the open gap**, and unchanged by any of the above. Per
  `docs/spec.md`'s two-tiers rule, foundational settings should reach Assembly quorum before
  Admins act. The spec is explicit that this is "a norm, not a platform-enforced gate" and that
  "Admins can technically still run the process ... the quorum expectation is about who has to
  weigh in for the result to actually mean what it claims, not about who's allowed to do the
  administrative work" — so an Admin ticking a box conforms, and the missing piece is a *nudge*,
  not a gate. No nudge is planned: the member-level consent above addresses the actual disclosure
  risk, and an Assembly would bind members who never voted, which is a worse trade for a
  question about adding a chart.

  **A published indicator requires `allowPreferNotToSay`** — publishing *is* counting people in a number, and without a decline the only way out is silence, which is itself visible as "2 haven't" in the coverage line, so the refusal leaks through the very gap meant to protect it. The alternative considered and rejected was a per-question "who may read the answers" rule modelled on `sensitive_field_access_rule` (allergies, emergency contact): that table exists because somebody must read a *named individual's* value, and an indicator has no such reader — the aggregate is the only thing that ever exists. "Who may see this?" is already answered; "may a member be counted without agreeing to be?" is not, and that is exactly what a decline is. Enforced in **three** places, and the third is the easy one to miss: refusing to publish a question that doesn't offer it, refusing to publish one on update, and **refusing to un-tick the decline on a published question** — an edit to a *consent* flag, which would otherwise leave a standing number members can no longer decline to be in. Withdrawing consent is a sequence, not one save: unpublish, withdraw, republish. The read side re-checks too (`canPublishAsIndicator` filters the query), so a row predating the rule stops rendering instead of quietly continuing. Note the reason strings are **noun phrases, not sentences**, because both callers splice them into their own — "published as a community indicator, and *<reason>*." reads badly when the reason is itself a clause with an "and" in it.
- ✅ `/assemblies` (+ `[id]`/`new`) — **restyled twice**: the token pass above, then a readability pass once the page was actually used. `options` had only ever rendered as a vote form's *inputs*, during voting, so the agenda was unreadable in exactly the phases that matter (you couldn't check the options you'd just typed; during notice — the phase whose whole purpose is that the agenda is readable — a pick-one question looked identical to a written-answer one). Every item now states its shape unconditionally and lists its answers whenever the vote form isn't. The three bare `…Minutes` number boxes became one number-plus-unit control with Urgent/Normal/Deliberate presets and a live "what that adds up to" preview. Voting is a single ballot for the whole agenda (one submit, blanks skipped, per-question failures) instead of a form and a round-trip per item, with results as proportional bars, member attribution on written answers, and a "your answer" marker in three places. The list page gained closing countdowns, participation, and a "Waiting on you" section. New shared components under `src/components/assemblies/`: `QuestionShape`, `BallotForm`, `AgendaItemForm`, `DurationFields`, plus a pure `time.ts` (`relativeTime`/`humanizeDuration`) — hand-rolled rather than `Intl` because these strings render on both server and client, and a locale/timezone-dependent formatter hydrates differently. Verified live: adding an item, the option editor's add/remove and duplicate warning, a rejected submit keeping its draft, the ballot saving and moving a tally, and withdrawing an item.

- ✅ Modules group: `/budget` (+ `BudgetVotingSection.tsx`), `/recruitment`, `/sensitive-data`, `/conflict-reports`, `/spatial-planning` (+ `PlotEditor.tsx`) — **the whole Modules group is now done**. Budget's proposal-status and Recruitment's/Conflict-reports' stage/escalated/overdue markers all now read as toned `Tag`s; the two real data tables (Budget's ranked-voting results, Recruitment's candidate pipeline, Sensitive data's per-member grid) all use the exact header/row convention `/coordination` established (`text-[11px] uppercase tracking-wide` muted headers, `hover:bg-[var(--surface-sunken)]` rows). **`PlotEditor.tsx` (1662 lines, the app's SVG plot/zone/placement drawing tool) got a deliberately partial restyle**: every surrounding control — buttons, fields, panels, the Zones/Placements list rows — moved onto tokens, but the canvas's own drawing colors (category hues for tent/vehicle/structure/furniture/generic, calibration-point magenta, vertex-handle red/white, the base-vector gray outline) and its fixed off-white "paper" background were deliberately left untouched. Those are the tool's own semantic color language — tent-is-blue regardless of which community's accent is purple — and forcing them onto accent/dark-mode tokens would both lose that meaning and risk illegibility (the canvas assumes a light backdrop for imported base images). Verified live end-to-end as the actual holder: calibrate, draw a real Zone by dispatching real click events at the canvas (screenshots of the canvas were unreliable — see the note below), save it, then delete it. **A real, pre-existing backend bug found during that verification, unrelated to styling**: deleting a Zone that a Placement's `zone_id` still points at 500s on an uncaught Postgres FK-violation instead of a friendly error — spawned as a separate background task (`task_59dbfe25`) rather than fixed inline, since it's out of scope for a styling pass; cleaned up the resulting test data by hand (nulled the placement's `zone_id`, deleted the test zone) so the dev DB was left exactly as found.

**A verification technique worth remembering**: reading `main`'s text or a screenshot *synchronously right after* a `dispatchEvent`/`.click()` call in the same `javascript_exec` script can read stale pre-render DOM — React's state update hadn't flushed yet within that same script tick, even though the click handler genuinely fired and did update state. Confirmed by re-querying in a **separate** subsequent `javascript_exec` call, which then showed the updated count. Don't conclude "the click didn't work" from a same-script immediate read; re-check in a follow-up call first.

**Batch 5 — `/profile` finished, `Icon.tsx` retired. Every page in the app is now on the design tokens.**
- ✅ `/profile` — theme toggle (already done), the main profile form (name/tags/manual tiers/email-notifications `CheckField`), cycle-type progress, outstanding/answered profile questions as `CARD`s, the sensitive-data form with its inline `ConsentCheckbox` notices, contact methods (edit-in-place + delete via `BUTTON_GHOST`, matching the "quiet remove" convention `tasks/[id]` established), and the consent-purposes list (Active/Grant via success text + `BUTTON_PRIMARY`/`BUTTON_SECONDARY`).
- ✅ `src/components/nav/Icon.tsx` deleted outright — turned out to already be fully unreferenced (every call site had already migrated to Phosphor across the earlier batches), confirmed by a repo-wide grep before deleting and a clean `tsc`/`next build` after.

**Styling pass complete.** All five batches are done: public/unauthenticated pages, the Tasks/Community/Modules nav groups in full, and `/profile`. Nothing in the app is left on the old plain inline-styled `system-ui` markup.
- ✅ Public/unauthenticated: `/`, `/login` (+ `LoginForm.tsx`), `/invite/[token]`, `/apply`, `/inquiry`, `/intro-call/[token]`, `/nomination-response`. `/` stopped being a bare Phase 0 DB-connectivity smoke test and became a real branded landing screen — the community's own name/logo (falling back to a plain name, same as `AppShell.tsx`'s `BrandMark`), a tagline, and a `Log in` button (or `Continue as {name}` + `Profile` when already signed in); the original health-check content is kept, not deleted, just demoted to a collapsed "System status" `<details>` at the bottom (still genuinely useful for confirming a fresh deploy talks to Postgres). `FieldPreview.tsx` (shared by `/apply` and the still-unstyled `/feedback`) moved onto tokens too, so `/feedback` gets its field rendering restyled for free once that page's own pass happens. `/intro-call/[token]` only restyled its own page chrome — `AvailabilityGrid.tsx` itself stays untouched, per its own careful-restyle note below. Verified live for both the logged-in and logged-out landing states, the login form's sent/error paths, an invalid invite/intro-call token, and a real intro-call token rendering the (unmodified) availability grid — in both themes, no console errors.
- ⬜ `src/components/nav/Icon.tsx` retirement — swap every remaining call site to Phosphor once its page is restyled, then delete the file.
