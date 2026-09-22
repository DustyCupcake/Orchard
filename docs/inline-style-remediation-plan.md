# Inline Style Remediation Plan

**182 `style={{}}` occurrences across 13 files.** The design-token migration (documented in `docs/design_handoff_conventions/README.md`) covered most pages but left several behind — these are the ones that still look rough.

## Severity Tiers

### 🔴 Tier 1 — Fully unstyled pages (entire page on `system-ui`, hardcoded colors)

These pages were never touched by the design-token pass. They look completely different from the rest of the app.

| File | Lines | Inline Styles | Notes |
|------|-------|--------------|-------|
| `src/app/(app)/applications/page.tsx` | 383 | 55 | Full recruitment pipeline page — largest gap |
| `src/app/(app)/task-packs/import/[packId]/page.tsx` | 240 | 33 | Pack import flow, two screens |
| `src/app/(app)/invites/page.tsx` | 199 | 30 | Invite management + inquiry claiming |
| `src/app/(app)/task-packs/page.tsx` | 99 | 21 | Pack list + import/export |
| `src/app/(app)/cycles/page.tsx` | 76 | 8 | Closed-cycle search |

**Total: ~147 inline styles, ~997 lines**

These five pages share the same old-shell pattern: `fontFamily: "system-ui"`, hardcoded `#666`/`crimson`/`#2a7a2a` colors, `padding: "0.4rem"` buttons, `border: "1px solid #ccc"` cards. They need a full page-level restyle: PageHeader, CARD, Banner, BUTTON_PRIMARY/SECONDARY, INPUT, Tag — the works.

### 🟡 Tier 2 — Partially restyled (client components with leftover inline styles)

| File | Lines | Inline Styles | Notes |
|------|-------|--------------|-------|
| `src/app/(app)/settings/FormBuilder.tsx` | 181 | 12 | Form builder layout + field list |
| `src/app/(app)/spatial-planning/PlotEditor.tsx` | 1658 | 9 | Canvas cursors + zone color swatches (some intentional — canvas colors) |
| `src/app/(app)/board/TaskCard.tsx` | 316 | 3 | Dynamic `statusColor` on requirements, card-level style |
| `src/app/(app)/tasks/[id]/page.tsx` | 1742 | 4 | Dynamic colors, one warning banner |
| `src/app/(app)/settings/page.tsx` | 1268 | 4 | Opacity toggles for archived items |

**Total: ~32 inline styles**

These are mostly legitimate dynamic values (colors computed from data, opacity toggles) but some can be moved to Tailwind classes with CSS variable lookups.

### 🟢 Tier 3 — Intentional dynamic styles (leave as-is)

| File | Count | Reason |
|------|-------|--------|
| `src/components/ui/kit.tsx` | 1 | `Banner` component's dynamic `style` for tone-derived border/bg |
| `src/app/(app)/[cycleScope]/layout.tsx` | 1 | Dynamic grid-template-columns |
| `src/app/(app)/[cycleScope]/budget/BudgetVotingSection.tsx` | 1 | Dynamic color from `formatBalance()` |

**Total: ~3 inline styles — these are correct as-is.**

---

## Work Plan

### Batch A: `/cycles` + `/task-packs` (2 pages, ~29 styles)
Smallest pages, good warm-up. Same patterns: PageHeader, CARD, Banner, BUTTON_*, INPUT.

### Batch B: `/invites` (1 page, ~30 styles)
Invite list, inquiry claiming, subscription toggle. Needs: CARD rows, Tag for status, BUTTON_SECONDARY for actions.

### Batch C: `/task-packs/import/[packId]` (1 page, ~33 styles)
Two-screen import flow. Uses `ClonePreviewGrid`/`ClonePreviewList` (already restyled). Needs: PageHeader, CARD, Banner, form layout.

### Batch D: `/applications` (1 page, ~55 styles)
Largest single gap. Full recruitment pipeline: subscription toggle, intro call list, application cards, evaluation forms, objection forms, decision resolution. Needs: full page restyle with sections, CARDs, Banner, Tag, BUTTON_*.

### Batch E: Partial cleanups (~32 styles)
- `FormBuilder.tsx` — replace layout styles with Tailwind flex classes
- `TaskCard.tsx` — 3 dynamic-color styles (may need to keep 1 for truly dynamic color)
- `tasks/[id]/page.tsx` — 4 styles (1 dynamic statusColor, 1 warning banner, 2 minor)
- `settings/page.tsx` — 4 opacity toggles (can use `className={cond ? "opacity-60" : ""}`)
- `PlotEditor.tsx` — 9 styles (canvas cursors are legitimate; 2 color swatches can use inline-block with CSS var)

---

## What "restyle" means per page

1. Replace `<main style={{ fontFamily: "system-ui" ... }}>` with the standard `className="mx-auto max-w-[...] px-6 py-10 md:px-12 md:py-14"` + `PageHeader`
2. Replace `style={{ color: "crimson" }}` with `<Banner tone="danger">`
3. Replace `style={{ color: "#2a7a2a" }}` with `<Banner tone="success">`
4. Replace `style={{ color: "#666" }}` with `text-[var(--text-muted)]`
5. Replace `style={{ color: "#b45309" }}` with `text-[var(--warning)]` or `<Banner tone="warning">`
6. Replace `style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem" }}` with `CARD`
7. Replace `style={{ padding: "0.4rem 1rem" }}` with `BUTTON_PRIMARY` or `BUTTON_SECONDARY`
8. Replace `style={{ padding: "0.3rem" }}` with `INPUT`
9. Replace `style={{ fontSize: "0.85rem" }}` with `text-[13px]`
10. Replace `style={{ fontSize: "0.8rem" }}` with `text-[12px]`
11. Replace `style={{ marginTop: "1rem" }}` etc. with `mt-4`, `mt-6`, etc.
12. Replace `style={{ display: "flex", gap: "0.5rem" }}` with `flex items-center gap-2`
13. Add `export const dynamic = "force-dynamic"` where missing
