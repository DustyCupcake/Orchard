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

**Moved**: Scheduling polls is no longer a Tasks sub-nav item — it's about *when* things happen, not the task itself, so it's now a button on `/calendar` instead (which is otherwise still unrestyled — just that one button uses tokens).

**Partially restyled** (new UI added this pass uses tokens; the rest of the page is still the old plain inline-styled markup)
- 🟡 `/profile` — only the new theme-toggle block. Everything else (profile fields, sensitive data, contact methods, consent) is untouched.
- 🟡 `/calendar` — only the new "Scheduling polls" button. The month grid, upcoming list, event create/edit/invite forms are all still the pre-token Tailwind-utility styling from Phase 44 (not inline `system-ui` like most unrestyled pages, but not on the design tokens either).

**Not yet restyled** (still plain inline-styled `system-ui` forms — pick these up next, page by page)
- ⬜ `/scheduling-polls/[id]`, `AvailabilityGrid.tsx` (the poll detail/voting flow — the index and the `/new` form are both done now; `AvailabilityGrid` is the one real client-side pointer-drag component in the app, so restyle its visuals carefully without touching its interaction logic)
- ⬜ Community group: `/members/[id]`, `/messages`, `/assemblies` (+ `[id]`/`new`), `/documentation` (+ `[id]`/`new`), `/feedback`, `/participation`
- ⬜ Modules group: `/budget`, `/spatial-planning`, `/recruitment`, `/conflict-reports`, `/sensitive-data`, `/schedule`, `/shifts`
- ⬜ Public/unauthenticated: `/login`, `/invite/[token]`, `/apply`, `/inquiry`, `/intro-call/[token]`
- ⬜ `src/components/nav/Icon.tsx` retirement — swap every remaining call site to Phosphor once its page is restyled, then delete the file.
