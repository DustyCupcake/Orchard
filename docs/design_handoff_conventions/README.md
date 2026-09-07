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

**Nav pattern — two styles, picked per group**: `NavGroup.headerIsLink` (`nav-config.ts`) decides which. `true` (Tasks, Community): the header becomes a real link (icon + label, styled like Dashboard/Calendar) to its "main view" — `NavGroup.href` when set, else its first item — with a separate chevron button just for expand/collapse, and sub-items render without icons (indented text only) *and without the pin toggle* (items only get pinned as a whole via the group header/hub, never individually), since these items are lightweight views into one domain, not individually meaningful destinations to pin. Both Tasks (`/board`) and Community (`/members`) now have a genuine hub page with its own button row to the rest of the group (see below) — there's no group left that falls back to "first item, no real hub." Absent/`false` (Modules): the header stays a plain uppercase toggle-only label, every item keeps its own icon, and every item keeps the pin toggle — pinning is deliberately a Modules-only affordance now, since each item there is a full, independently pinnable module unlike Tasks'/Community's lightweight sub-views. Decided after the user tried the initial everywhere-the-same version live and it didn't fit Modules or the pin affordance. See `AppShell.tsx`'s `NavGroupBlock`.

**Icons**: a few Modules icons were swapped after review to stop colliding or read better — Budget is now a piggy bank (was a coin), Conflict reports is a handshake (was a shield, which collided visually with Sensitive data's — also a shield, kept), Event schedule is a calendar-with-heart and Shifts a clipboard-with-text (both were a plain calendar, colliding with each other and with the top-level Calendar nav item). Tasks' 7 sub-items still all share the checkbox icon and 4 of Community's share the people icon, but that's no longer a live concern now that those two groups' items aren't individually pinnable — the only place a shared icon could have surfaced twice at once.

**Restyled**
- ✅ Sidebar / `AppShell.tsx` — nav rows, banners, icon-button chrome, mobile drawer, community name/logo slot, the two-style group-header pattern above.
- ✅ `/dashboard`
- ✅ `/board` (+ `TaskCard.tsx`, `BranchFilter.tsx`, `TagFilter.tsx`) — "the main task view": a row of button-links to Propose/Proposals/My contribution/Input rounds (+ Coordination/Escalation for a coordination holder) sits right under the heading, the same destinations the sidebar's Tasks sub-list reaches. Kanban columns get uppercase muted headers with a count Tag; each TaskCard is a proper token-styled card with tone-colored attention/critical Tags and Claim/Release/Finish/etc. as real primary/secondary buttons.
- ✅ `/propose`, `/proposals` (+ `ProposalCard.tsx`), `/contribution` (+ `[id]`, + `ContributionCategories.tsx`), `/coordination`, `/escalation`, `/scheduling-polls` (index), `/scheduling-polls/new`, `/input-rounds`
- ✅ `/tasks/[id]` — the big one (~1300 lines: candidacy, coordination, subtasks, shadows, requirements, notes, milestones, questions, and more). A new "Schedule a poll" button in the top action row links to `/scheduling-polls/new?branchId=…&title=…` (pre-filling that task's branch and title) — offered on every task, not conditionally, since there's no field on Task to condition it on; say if you'd rather it were scoped tighter. `MilestoneDateFields` (the shared fieldset both the add- and edit-milestone forms use) restyled too.
- ✅ `/members` — now "the main community view" the same way `/board` is for Tasks: a button row to Messages/Assemblies/Documentation/Cycles/**Settings** sits under the heading, mirroring Board's hub-button pattern exactly.
- ✅ `/settings` — fully restyled and split into 9 tabs (General/Coordination/Modules/Recruitment/Branches/Cycles & Tiers/Profile & Privacy/Forms/Members), selected via `?tab=` (a plain `<Link>` bar, no client JS). This was a real backend split, not just a visual one: the old single `updateCommunityAction` covered ~15 concerns in one form/one submit, which would have silently wiped fields on other tabs if just given a tabbed UI on top (several fields are checkboxes/arrays whose "absent from this submission" means "turn off," not "unchanged"). Split into `updateGeneralSettingsAction`/`updateCoordinationSettingsAction`/`updateModulesSettingsAction`/`updateRecruitmentSettingsAction` (`actions.ts`), each parsing only its own tab's fields through the same shared `updateCommunityInput`/`updateCommunity()` (untouched) — every field lives in exactly one tab's action, so there's no cross-tab overwrite risk. `redirectWithError` gained a `tab` param so an error redirects back to the tab that produced it. Verified live by toggling a Modules checkbox, saving, and confirming General/Coordination/Recruitment's own DB columns were byte-identical before and after. **Real bug caught during that verification**: a shared `CheckField` helper didn't accept a `value` prop, so all of Modules' checkboxes (which share one `name="modulesEnabled"`) silently got the same generic `"on"` value instead of their own module key — would have broken module enablement on save. Fixed before shipping.
- ✅ Settings moved out of the sidebar's old fixed bottom slot (next to the profile/logout block, which reads as "your own stuff") into the Community nav group as a real item, plus the `/members` hub button above — see the nav-relocation note in the project memory for the full reasoning.

**Moved**: Scheduling polls is no longer a Tasks sub-nav item — it's about *when* things happen, not the task itself, so it's now a button on `/calendar` instead.

- ✅ `/calendar` — month grid, Upcoming list, invites/your-events/on-your-calendar sections, and the create/edit/invite forms all moved onto the tokens. The grid's per-day entry chips and the Upcoming list's `Tag` both derive from a new `KIND_TONE: Record<CalendarEntryKind, Tone>` map that collapses the view's 13 distinct entry kinds onto the shared 6-tone palette (confirmed/settled things — phase boundaries, poll confirmations, programme slots — read success/accent; personal calendar events and birthdays read accent2; cutoffs/deadlines read warning; assembly milestones and shifts stay neutral) rather than inventing a 13-color bespoke scale. Needed a small kit.tsx addition: `TONE_CLASSES` (previously private to `Tag`) is now also exported, since the day-grid chips are too small for `Tag`'s own padding and need the same token colors in a bare `<a>`. Verified live in both themes (light via a temporary `data-theme` override, dark as the default) — chip/card/button colors and the month grid's today-ring all resolve correctly; a real event's Edit/Invite/Delete disclosures and the Create form all still submit through the same unchanged actions.

- ✅ `/scheduling-polls/[id]` + `AvailabilityGrid.tsx` — the poll detail/voting flow. `AvailabilityGrid` (the one real client-side pointer-drag component in the app) only had its `style` props swapped for token classes — every handler (`onDown`/`onEnter`/`paint`/the `dragging`/`paintValue` refs/`save`) is untouched. Its painted-cell color moved from a hardcoded green to `var(--accent-1)` (painting availability reads as "primary action taken," not "success" — that tone is reserved for confirmed/settled states elsewhere), and its two-tier gridline distinction now reuses `var(--border)` (hour lines) vs. `var(--surface-sunken)` (half-hour/day lines) rather than inventing new tokens for what was `#ddd`/`#eee`.
- ✅ `/schedule` (+ `EventReviewSection.tsx`) — Event scheduling. Proposal status (proposed/conflict/confirmed/declined) now reads as a `Tag`, toned via a `STATUS_TONE` map mirroring `tasks/[id]`'s existing `NOMINATION_STATUS_TONE` convention (awaiting→warning, settled→success, rejected/blocking→danger). That map (plus `STATUS_LABEL`) had to move into its own `status.ts` module rather than staying as a named export on `page.tsx` — **caught a real Next.js build failure this way**: the framework's page-export validator rejects any named export from a `page.tsx` beyond its own recognized set, which `next build`'s type-checking pass enforces but plain `tsc --noEmit` does not, so the mistake passed typecheck cleanly and only surfaced once the Docker image build actually ran `next build`. The ambiguous-multi-cycle-scope picker (shared shape with the not-yet-restyled `/budget` and `/spatial-planning`) got a first token pass here too.
- ✅ `/shifts` (+ `MySeriesSection.tsx`) — series status (Active/Archived) as a `Tag` (success/neutral), upcoming-shift and past-shift cards on `CARD`, the coordinator's per-series management view (occurrences, roster, no-show marking, the weekly-pattern and explicit-list occurrence-generation forms) fully tokenized.

- ✅ Community group: `/members/[id]`, `/messages`, `/assemblies` (+ `[id]`/`new`), `/documentation` (+ `[id]`/`new`), `/feedback`, `/participation`. The bare `/participation` most members reach is actually a redirect shim to `/[cycleScope]/participation` (Phase 65) — that's where the real, substantial page (~720 lines: your plans, cycle settings, phase dates with drift/order-invalid warnings, Task-Pack export, close-cycle, start-a-new-cycle with a clone-date preview) lives, and it's what got restyled. Its shared `ClonePreview.tsx` (`ClonePreviewGrid`/`ClonePreviewList`, also used by the not-yet-restyled `/task-packs/import/[packId]`) moved onto tokens too, since it renders inline on this page — same "restyle a shared component when the page you're doing actually renders it" precedent as `FieldPreview.tsx` (Batch 1) and `AvailabilityGrid.tsx` (Batch 2). `/documentation`'s "unanswered" marker and `/assemblies`' phase (agenda/notice/voting/closed) both now read as a toned `Tag`. Verified live: the emergency-access reveal-Banner flow on `/members/[id]`, an assembly's closed-phase read view, a wiki page's revision history disclosure, and — on `/participation` — both the aggregate (all-open-cycles) and narrowed single-cycle view scopes, the clone-preview grid actually resolving real phase-boundary entries, and the already-open-cycle warning banner.

- ✅ Modules group: `/budget` (+ `BudgetVotingSection.tsx`), `/recruitment`, `/sensitive-data`, `/conflict-reports`, `/spatial-planning` (+ `PlotEditor.tsx`) — **the whole Modules group is now done**. Budget's proposal-status and Recruitment's/Conflict-reports' stage/escalated/overdue markers all now read as toned `Tag`s; the two real data tables (Budget's ranked-voting results, Recruitment's candidate pipeline, Sensitive data's per-member grid) all use the exact header/row convention `/coordination` established (`text-[11px] uppercase tracking-wide` muted headers, `hover:bg-[var(--surface-sunken)]` rows). **`PlotEditor.tsx` (1662 lines, the app's SVG plot/zone/placement drawing tool) got a deliberately partial restyle**: every surrounding control — buttons, fields, panels, the Zones/Placements list rows — moved onto tokens, but the canvas's own drawing colors (category hues for tent/vehicle/structure/furniture/generic, calibration-point magenta, vertex-handle red/white, the base-vector gray outline) and its fixed off-white "paper" background were deliberately left untouched. Those are the tool's own semantic color language — tent-is-blue regardless of which community's accent is purple — and forcing them onto accent/dark-mode tokens would both lose that meaning and risk illegibility (the canvas assumes a light backdrop for imported base images). Verified live end-to-end as the actual holder: calibrate, draw a real Zone by dispatching real click events at the canvas (screenshots of the canvas were unreliable — see the note below), save it, then delete it. **A real, pre-existing backend bug found during that verification, unrelated to styling**: deleting a Zone that a Placement's `zone_id` still points at 500s on an uncaught Postgres FK-violation instead of a friendly error — spawned as a separate background task (`task_59dbfe25`) rather than fixed inline, since it's out of scope for a styling pass; cleaned up the resulting test data by hand (nulled the placement's `zone_id`, deleted the test zone) so the dev DB was left exactly as found.

**A verification technique worth remembering**: reading `main`'s text or a screenshot *synchronously right after* a `dispatchEvent`/`.click()` call in the same `javascript_exec` script can read stale pre-render DOM — React's state update hadn't flushed yet within that same script tick, even though the click handler genuinely fired and did update state. Confirmed by re-querying in a **separate** subsequent `javascript_exec` call, which then showed the updated count. Don't conclude "the click didn't work" from a same-script immediate read; re-check in a follow-up call first.

**Batch 5 — `/profile` finished, `Icon.tsx` retired. Every page in the app is now on the design tokens.**
- ✅ `/profile` — theme toggle (already done), the main profile form (name/tags/manual tiers/email-notifications `CheckField`), cycle-type progress, outstanding/answered profile questions as `CARD`s, the sensitive-data form with its inline `ConsentCheckbox` notices, contact methods (edit-in-place + delete via `BUTTON_GHOST`, matching the "quiet remove" convention `tasks/[id]` established), and the consent-purposes list (Active/Grant via success text + `BUTTON_PRIMARY`/`BUTTON_SECONDARY`).
- ✅ `src/components/nav/Icon.tsx` deleted outright — turned out to already be fully unreferenced (every call site had already migrated to Phosphor across the earlier batches), confirmed by a repo-wide grep before deleting and a clean `tsc`/`next build` after.

**Styling pass complete.** All five batches are done: public/unauthenticated pages, the Tasks/Community/Modules nav groups in full, and `/profile`. Nothing in the app is left on the old plain inline-styled `system-ui` markup.
- ✅ Public/unauthenticated: `/`, `/login` (+ `LoginForm.tsx`), `/invite/[token]`, `/apply`, `/inquiry`, `/intro-call/[token]`, `/nomination-response`. `/` stopped being a bare Phase 0 DB-connectivity smoke test and became a real branded landing screen — the community's own name/logo (falling back to a plain name, same as `AppShell.tsx`'s `BrandMark`), a tagline, and a `Log in` button (or `Continue as {name}` + `Profile` when already signed in); the original health-check content is kept, not deleted, just demoted to a collapsed "System status" `<details>` at the bottom (still genuinely useful for confirming a fresh deploy talks to Postgres). `FieldPreview.tsx` (shared by `/apply` and the still-unstyled `/feedback`) moved onto tokens too, so `/feedback` gets its field rendering restyled for free once that page's own pass happens. `/intro-call/[token]` only restyled its own page chrome — `AvailabilityGrid.tsx` itself stays untouched, per its own careful-restyle note below. Verified live for both the logged-in and logged-out landing states, the login form's sent/error paths, an invalid invite/intro-call token, and a real intro-call token rendering the (unmodified) availability grid — in both themes, no console errors.
- ⬜ `src/components/nav/Icon.tsx` retirement — swap every remaining call site to Phosphor once its page is restyled, then delete the file.
