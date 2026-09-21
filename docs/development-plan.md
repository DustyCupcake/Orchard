# 🛠️ Orchard — Development Plan

*Expands `spec.md`'s "Build order" and "MVP scope" sections into phases sized for individual Claude Code sessions — each phase should be small enough to pick up cold, build, and leave in a working, demoable state.*

**How to use this:** every phase from the original build-out is complete (see below) — this file is now empty and waiting for the next one. When a candidate phase gets picked off `docs/roadmap.md` (or a genuinely new need comes up that isn't on that list yet), draft it here in the same Goal/Scope/Depends-on/Done-when form the archived phases used, then hand it to a session to build. Once built, tested, and committed — real tests against a disposable Postgres, manual verification against the real Docker Compose stack, README/CHANGELOG updated in the same commit as the code — its outcome belongs in `CHANGELOG.md`, not left sitting here once it's done, so this file stays a small, current "what's being worked on right now," not a growing historical archive.

---

## Phases 0-69: complete

Every phase originally scoped here — the tech spec's full MVP (0-10), the rest of what spec treats as core-not-optional (11-19), every optional module (20-64), and the full concurrent-cycles batch (65-69) — is built, tested, and committed to `main`. `CHANGELOG.md` is the authoritative record of what each phase actually built, real bugs found along the way, and how it was verified; that record is far more detailed and more accurate than this file's own original forward-looking scope text, which described intent rather than outcome.

This file used to carry that full phase-by-phase detail (goal/scope/depends-on/done-when for all 69 phases) directly. It's been trimmed now that the plan is fully executed and `CHANGELOG.md` supersedes it — a complete copy of the pre-trim file, exactly as it stood through Phase 69, is kept alongside this one at `docs/development-plan.full-archive.md` (also deliberately out of git, same as this file) for anyone who wants to see how a phase was originally scoped as opposed to how it actually turned out.

See `docs/roadmap.md` for what's deliberately not built yet — both the stretch goals `spec.md` itself named, and the newer, genuinely-unscoped ideas that concurrent cycles and other later phases surfaced. That file is committed, unlike this one, since it's meant to be visible to anyone looking at the repo, not just whoever's driving the next session.

---

## Board views: by-phase layout and deadline milestones — shipped

Built, tested, and committed — see `CHANGELOG.md`'s entry for the full record (schema, files touched, real bugs found, manual verification). Left here only as a one-line pointer since the next feature below depends on what it built: a `view=kanban|phase` switcher on `/board`, a by-phase card layout (`src/lib/tasks/board-views.ts`'s `groupTasksByPhase`, `PhaseCard.tsx`), and `TaskMilestone.isDeadline` (a flagged-milestone deadline concept, resolved by `getTaskDeadline` and surfaced as `listTasksWithAssignments`'s new `deadlineDate` field).

---

## Branch coverage view + advanced filters

Not a phase — every numbered phase (0-69) is done, and per the user, we no longer number what comes after; this is just the next feature, picked off `docs/roadmap.md`/`spec.md`'s Views section the same way the by-phase view above was.

**Goal:** `spec.md`'s Views section also calls for "group by branch → coordinator coverage" — never built. `getCommunitySnapshot`'s branch-health rollup (`src/lib/dashboard.ts`) already computes almost exactly this signal for the Dashboard's summary panel; this turns it into a real board drill-down, plus rounds out the board's filtering with an advanced-filters disclosure.

**Scope:**
- `deriveBranchHealthStatus` exported from `dashboard.ts` for reuse (was module-private).
- `getBranchCoverage` — per-branch `{status, counts, tasks}`, `status` public to everyone, `counts`/`tasks` gated to that specific branch's coordination holders (`listCoordinationBranchIds`, already on the board) — deliberately per-branch, tighter than Dashboard's own community-wide `isCoordinationHolder(actor, null)` gate, which is left unchanged.
- `BranchCoverageCard` — same card/show-more shape as `PhaseCard`; `view=coverage` renders one per branch.
- An "Advanced filters" disclosure (collapsed by default): needs-attention, phase (as a filter, independent of the by-phase view), duration bucket (one-off tasks only), has-open-slots, assigned-to-me, due-within-N-days. All computed as an in-memory filter chain over the already-fetched task list, not pushed into `listTasksWithAssignments`'s SQL.

**Depends on:** the by-phase view above (`board-views.ts`, the view switcher, `deadlineDate`).

**Out of scope:** any change to Dashboard's own existing branch-health panel or its community-wide coordination gate.

**Done when:** `/board?view=coverage` shows every branch as a card with a publicly-visible health status and task list; a branch's actual coordination holder additionally sees real soft/hard/escalated counts and a worst-first task ordering that nobody else sees; each advanced filter narrows the board correctly, in combination with the basic filters and each other, without resetting any other active filter.

---

*Living document. Once the next feature is chosen, draft its Goal/Scope/Depends-on/Done-when here before building it.*
