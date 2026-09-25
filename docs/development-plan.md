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

The by-phase foundation is committed — see `CHANGELOG.md`'s entry for the full record (schema, files touched, real bugs found, manual verification). The current board follow-up below adds the remaining view/filter and selection behavior on top of that foundation: the `view=kanban|phase|coverage` switcher, by-phase cards (`src/lib/tasks/board-views.ts`'s `groupTasksByPhase`, `PhaseCard.tsx`), and `TaskMilestone.isDeadline` (a flagged-milestone deadline concept, resolved by `getTaskDeadline` and surfaced by `listTasksWithAssignments`'s new `deadlineDate` field).

---

## Branch coverage view + advanced filters

**Status:** Built and verified in the board revamp. The historical audit/remediation documents still describe this as missing; use this section and `docs/BOARD-HANDOFF.md`'s current follow-up for the present state.

**Implemented:**
- `/board?view=coverage` groups active tasks by branch and shows a public health status for every branch.
- Detailed task lists, soft/hard/escalated counts, and worst-first ordering are limited to the coordination scope that actually covers the task: branch-column holders see the whole branch; cycle-row holders see their cycle's tasks. Everyone else sees only the public status.
- The advanced-filters disclosure combines attention, phase, one-off duration, open slots, assigned-to-me, and due-within-N-days with the existing board filters. `capacity = null` is treated as genuinely uncapped when evaluating open slots.
- Selection is shared across the Unclaimed, Kanban, By phase, and Branch coverage card renderings. Claim, Task Pack export, and bulk placement moves use that shared selection; export is scoped to the active filtered view.

**Validation:** `npx tsc --noEmit`, `npm run lint -- --no-warn-ignored`, `npx vitest run tests/board-views.test.ts tests/nav-config.test.ts tests/task-pack-reassignment.test.ts`, and `npm run build` pass. Full DB-backed integration suites still require the repository's local Postgres credentials.

---

*Living document. Once the next feature is chosen, draft its Goal/Scope/Depends-on/Done-when here before building it.*
