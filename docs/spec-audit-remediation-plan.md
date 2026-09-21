# Spec Audit Remediation Plan

Generated from `docs/task-board-views-spec-audit.md` — a systematic audit of `docs/spec.md` against the live codebase.

**Audit coverage:** 211 behaviors checked across 38 spec sections  
**Results:** 154 built, 28 partial, 26 missing, 3 backend-only (no UI)

---

## Severity Legend

- **🔴 Critical** — Security risk, broken promise, or dead feature users can see
- **🟠 High** — Core workflow gap that contradicts spec guarantees
- **🟡 Medium** — Missing convenience or incomplete multi-step flow
- **🟢 Low** — Nice-to-have, cosmetic, or explicitly deferred by design

---

## 🔴 Critical (fix first)

### 1. View-as write-block bypass in Spatial Planning
**Gap:** `PlotEditor.tsx` uses `fetch()` directly, bypassing both the UI `disableWriteForms` sweep and `assertNotViewingAs()` server-side check. A Support+Spatial-planning holder can edit placements while "viewing as" someone else.
**Fix:** Add `assertNotViewingAs()` to all Spatial Planning API routes (or centralize in a middleware). Add a client-side guard in `PlotEditor.tsx` that checks the view-as state before any `fetch()`.
**Files:** `src/app/api/spatial-planning/**/route.ts`, `src/app/(app)/spatial-planning/PlotEditor.tsx`
**Effort:** Small (1–2 hours)

### 2. `/escalation` is a dead page
**Gap:** Nothing ever sets `attentionLevel = 'escalated'`. The page always shows "Nothing escalated right now." Either build the coordinator escalation action or remove the nav item.
**Fix:** Add a "Escalate" action on the coordination page (or task detail) that sets `attentionLevel = 'escalated'`, or remove `/escalation` from nav-config until it's real.
**Files:** `src/lib/tasks/escalation.ts`, `src/app/(app)/escalation/page.tsx`, `src/components/nav/nav-config.ts`
**Effort:** Small if removing; Medium if building the action

### 3. Admins reset on cycle clone is broken
**Gap:** Cloned "Admins" tasks win candidacy but don't copy `PermissionGrant` rows, so they confer no actual settings access until someone manually re-checks the Admin box.
**Fix:** In `commitPackImport` and cycle-clone paths, copy `permissionGrant` rows from source tasks to cloned tasks (or add a `grantsModule` field to `TaskPackItem` and respect it on import).
**Files:** `src/lib/task-packs/import.ts`, `src/lib/cycles/crud.ts`
**Effort:** Medium

---

## 🟠 High (core workflow gaps)

### 4. Branch coverage view + advanced filters
**Gap:** Only `kanban` and `phase` views exist. The spec calls for a branch-coverage view (group by branch → show coordinator coverage) plus filters: needs-attention, duration bucket, has-open-slots, assigned-to-me, due-within-N-days.
**Fix:** Add `view=coverage` to `VIEWS`, build `getBranchCoverage()` in `board-views.ts`, add filter controls to the board page.
**Files:** `src/lib/tasks/board-views.ts`, `src/app/(app)/board/page.tsx`
**Effort:** Medium–Large (2–3 sessions)
**Note:** Already drafted in `docs/development-plan.md:25-41` as "Branch coverage view + advanced filters"

### 5. Ordinary Browse mode (auto-claim + contested resolution)
**Gap:** Only `community_endorsed` candidacy exists. For `open`/`request` tasks: no browse window, no auto-claim on window close, no contested resolution (retract / open 2nd slot / shadow-instead / split / facilitate).
**Files:** `src/lib/tasks/endorsements.ts`, `src/db/schema/browse-interest.ts`, `src/lib/tasks/lifecycle.ts`
**Effort:** Large (new flow, needs careful UX)
**Note:** Not listed in roadmap — was silently dropped

### 6. 3 of 5 Tier criteria are non-functional
**Gap:** Only `manual` and `cycle_type_count` compute. `tenure`, `completion`, `cohort` are configurable in settings but silently do nothing.
**Fix:** Implement the three missing criterion computations in `src/lib/settings/tiers.ts`, or remove them from the settings UI until they're built.
**Files:** `src/lib/settings/tiers.ts`, `src/app/(app)/settings/page.tsx`
**Effort:** Medium (3 independent computations)

### 7. Branch membership (emergent vs explicit) is cosmetic
**Gap:** `branchMembershipModel` exists as a column but is never read. No `BranchMembership` / roster table exists. "Explicit" membership doesn't change anything.
**Fix:** Build a `branchMembership` table, wire it into attendance/expected-audience logic, and gate branch calls on the roster when `branchMembershipModel === 'explicit'`.
**Files:** New schema + `src/lib/calendar-events.ts`, `src/db/schema/call.ts`
**Effort:** Large

### 8. Round 0/1/2 cycle kickoff sequencing
**Gap:** `cycle.status` is `draft` → `active` only. The 3-round kickoff (Round 0 browse/claim, Round 1 freeze/confirm, Round 2 open) was never automated.
**Fix:** Build round-transition logic gated on `cycle.status`, with round-0 task visibility rules, round-1 freeze, and round-2 open.
**Files:** `src/lib/cycles/lifecycle.ts` (new), `src/db/schema/cycle.ts`
**Effort:** Large

### 9. Done-prompt → comment capture
**Gap:** `finishTask` takes no note/comment input. The "anything worth capturing?" prompt spec'd for the Done transition doesn't exist.
**Fix:** Add an optional `note` param to `finishTask`, surface a capture prompt in the Done flow (modal or inline), save it as a comment.
**Files:** `src/lib/tasks/lifecycle.ts`, `src/app/(app)/board/TaskCard.tsx`, `src/app/(app)/tasks/[id]/page.tsx`
**Effort:** Small–Medium

---

## 🟡 Medium (incomplete flows)

### 10. Spatial plan clone during cycle creation
**Gap:** Backend fully supports `cloneSpatialPlan` but the cycle-creation UI has no checkbox for it and `createCycleAction` never forwards the flag.
**Fix:** Add checkbox to participation page, forward flag in action, test end-to-end.
**Files:** `src/app/(app)/[cycleScope]/participation/page.tsx`, `src/app/(app)/[cycleScope]/participation/actions.ts`
**Effort:** Small

### 11. Assembly quorum fields missing
**Gap:** `quorum_basis` and `quorum_threshold` don't exist in the Assembly schema. The feature is entirely absent, not just unenforced.
**Fix:** Add columns to `assembly.ts`, add inputs to the new-assembly form, display on the assembly page.
**Files:** `src/db/schema/assembly.ts`, `src/app/(app)/assemblies/new/page.tsx`, `src/app/(app)/assemblies/[id]/page.tsx`
**Effort:** Small

### 12. Event scheduling export profiles
**Gap:** No `exportProfile` concept exists. Character caps, duration multiples, field limits for "Elsewhere export" are missing.
**Fix:** Add `exportProfile` JSON column to `eventScheduling` schema, add profile picker to proposal form, enforce limits.
**Files:** `src/db/schema/event-scheduling.ts`, `src/app/(app)/schedule/page.tsx`
**Effort:** Medium

### 13. Form `purpose` and `cycle_id` on FormResponse
**Gap:** Form has no `purpose` field (uses `Community.postCycleFeedbackFormId` pointer instead). `formResponse` has no `cycle_id`.
**Fix:** Add `purpose` enum to `form.ts`, add `cycle_id` to `formResponse.ts`, update conversion logic.
**Files:** `src/db/schema/form.ts`, `src/db/schema/form-response.ts` (or `form.ts`)
**Effort:** Small–Medium

### 14. ConflictReport ← FormResponse linkage
**Gap:** No `originated_from_form_response_id` column exists. A reviewer can manually file a ConflictReport but nothing records it came from a specific feedback response.
**Fix:** Add column to `conflict-report.ts`, set it when filing from a form response context.
**Files:** `src/db/schema/conflict-report.ts`
**Effort:** Small

### 15. Task notes tab-gated (spec says not behind a toggle)
**Gap:** Wiki/comments/resources are behind a "Notes" tab. Spec: "not buried behind a toggle, a mode switch, or a different part of the app."
**Fix:** Inline the notes sections on the task detail page (below description, always visible), or at minimum default-open the tab.
**Files:** `src/app/(app)/tasks/[id]/page.tsx`
**Effort:** Small

### 16. Waiting nudge: only 2 of 4 options directly available
**Gap:** From Waiting state, only Resume and Release are shown. Mark done and Re-snooze require Resume first.
**Fix:** Add "Mark done" and "Re-snooze with reason" buttons directly on the Waiting task card, with server actions that handle the state transition.
**Files:** `src/app/(app)/board/TaskCard.tsx`, `src/lib/tasks/lifecycle.ts`
**Effort:** Small

### 17. Nomination reminder email (mid-window)
**Gap:** Initial email and deadline auto-release exist, but no reminder partway through the nomination window.
**Fix:** Add a scheduled job (or cron) that sends reminder emails to nominees who haven't responded, at e.g. 50% of the window elapsed.
**Files:** `src/lib/tasks/nominations.ts`, `src/instrumentation.ts`
**Effort:** Small

### 18. Calendar invite not restricted to confirmed attendees
**Gap:** ICS download route only checks `requireMember()`, not `getConfirmedAttendees()`.
**Fix:** Add `getConfirmedAttendees` check to the invite route.
**Files:** `src/app/api/scheduling-polls/[id]/invite/route.ts`
**Effort:** Tiny

### 19. CallSummary unread Dashboard item
**Gap:** `CallSummary`/`CallSummaryRead` are built but never surfaced on the Dashboard.
**Fix:** Add unread call summaries to `getPersonalFeed` or a new Dashboard section.
**Files:** `src/lib/dashboard.ts`, `src/app/(app)/dashboard/page.tsx`
**Effort:** Small

### 20. Contribution tracking: no arrival/departure context
**Gap:** Participation dates are never shown in the contribution UI.
**Fix:** Add arrival/departure dates as context lines on the contribution page.
**Files:** `src/app/(app)/contribution/page.tsx`
**Effort:** Small

### 21. One-click action emails (Done/Still on it/I need help/Hand it back)
**Gap:** No email functions exist for these actions. The spec calls for one-click reply emails.
**Fix:** Add email templates + action-token routes for each action. This is a larger outbound-notification layer piece.
**Files:** `src/lib/mailer.ts`, `src/lib/tasks/nominations.ts` (or new), `src/app/api/action-tokens/**`
**Effort:** Medium–Large

### 22. Coordinator-initiated proactive check-in
**Gap:** "Propose a co-owner" exists, but "just check in without being asked" has no distinct mechanism.
**Fix:** Add a "Check in" action on the coordination page that sends a lightweight message to the task owner (distinct from nomination).
**Files:** `src/lib/coordination.ts`, `src/app/(app)/coordination/page.tsx`
**Effort:** Small

### 23. Input round: opens_at/closes_at/status, reminder notifications
**Gap:** Only `cutoffAt` exists. No round-open/close status, no reminder notification.
**Fix:** Add `opensAt`/`closesAt`/`status` to schema, build round-open/close transitions, add reminder job.
**Files:** `src/db/schema/input-round.ts`, `src/lib/input-rounds/scheduler.ts`
**Effort:** Medium

### 24. `is_coordination_slot` never written by real UI
**Gap:** Column exists and is read, but only test fixtures ever set it. No UI control lets a user flag a slot as coordination.
**Fix:** Add a checkbox in the task creation/edit form for "This is a coordination slot".
**Files:** `src/app/(app)/tasks/[id]/page.tsx`, `src/app/(app)/propose/actions.ts`
**Effort:** Small

### 25. Per-phase hours map: no create/edit UI
**Gap:** Backend reads `{phase_id: hours}` but no UI ever produces it. Only flat `hours_per_week` is written.
**Fix:** Add a phase-hours editor in the profile or onboarding flow.
**Files:** `src/app/(app)/profile/page.tsx`, `src/app/(app)/dashboard/page.tsx`
**Effort:** Small–Medium

---

## 🟢 Low (deferred by design, cosmetic, or nice-to-have)

### 26. ModuleState (off/testing/on)
**Gap:** Only flat `modules_enabled: string[]` exists. The richer per-module `state`/`testing_tier_id` was explicitly deferred.
**Disposition:** Keep deferred. Document in `docs/roadmap.md` if not already.

### 27. Foundational vs ordinary settings distinction
**Gap:** No UI distinction between settings that reshape the platform (e.g. `phasesEnabled`) and ordinary ones.
**Disposition:** Add a visual banner/warning on high-impact settings. Small UX improvement.

### 28. Onboarding axis count not capped at 3
**Gap:** Admin can flag any number of axes for onboarding; spec says "3 axes, the rest settable later at /profile."
**Disposition:** Add validation in settings to cap at 3, or in onboarding show first 3 only.

### 29. Profile-question cross-surface pulling incomplete
**Gap:** Application flow never pulls outstanding ProfileQuestions into the form; it's one-way static mapping.
**Disposition:** Medium effort for marginal gain. Document as known limitation.

### 30. Phase-name hint remapping missing
**Gap:** Unlike `branch_name_hint`, `phaseNameHint` has no remap mechanism. Renamed Phase orphans the question.
**Disposition:** Small fix — add remap UI in settings, similar to branch remap.

### 31. Recruitment "waitlisted" status is dead code
**Gap:** `waitlisted` is in the spec's stage list but `recruitmentDecision.resolution` only ever has `accepted`/`declined`.
**Disposition:** Either implement waitlist logic or remove the dead stage from the pipeline.

### 32. "Pay or swap" and "leads absorb" for unloved tasks
**Gap:** Only "rotate into a shift" is implemented.
**Disposition:** These are speculative coordination strategies. Document as deferred or remove from spec.

### 33. Bulk-select-and-assign in pack import screen two
**Gap:** Individual selects only; no checkbox/apply-to-selected control.
**Disposition:** Small UX improvement. Can be added when the pack import flow gets attention.

### 34. Cloned-from task link not surfaced in UI
**Gap:** `clonedFromTaskId` is set but never shown. Only `parentTaskId` is surfaced.
**Disposition:** Small — add a "Cloned from" link on task detail when present.

### 35. Drag-to-date milestone editing
**Gap:** Backend supports date reverse-computation, but UI is just a date input field.
**Disposition:** True drag-on-calendar is a nice-to-have. The current UI is functional.

### 36. Endorsement threshold as percentage of reference group
**Gap:** Only fixed-number mode exists; no percentage-of-membership mode.
**Disposition:** Small schema + UI change. Can be added when needed.

### 37. Current load excludes one-off tasks
**Gap:** `currentLoadHours` explicitly excludes one-off tasks, contradicting spec's "flat one-time addition."
**Disposition:** The comment explains this is deliberate (nothing comparable to sum). May need spec update rather than code change.

### 38. Contribution attributed to "week actually marked Done"
**Gap:** No week-granularity in contribution tracking; `statusChangedAt` is never read by contribution.ts.
**Disposition:** Medium effort. The current phase-category breakdown is functional.

---

## Suggested Work Order

### Sprint 1: Fix the broken promises
1. View-as write-block bypass (#1) — security
2. `/escalation` dead page (#2) — remove or build
3. Admins reset on clone (#3) — permissions integrity
4. Calendar invite restriction (#18) — tiny, security-adjacent

### Sprint 2: The board views you asked for
5. Branch coverage view + advanced filters (#4)
6. Task notes not tab-gated (#15)

### Sprint 3: Core workflow completion
7. Ordinary Browse mode (#5) — large, but fundamental
8. Done-prompt → comment (#9)
9. Waiting nudge 4 options (#16)
10. Nomination reminder (#17)

### Sprint 4: Tier/branch structural gaps
11. Tier criteria (3 missing) (#6)
12. Branch membership roster (#7)

### Sprint 5: Cycle + coordination polish
13. Round 0/1/2 kickoff (#8)
14. Spatial plan clone UI (#10)
15. Coordinator proactive check-in (#22)
16. CallSummary Dashboard (#19)

### Sprint 6: Forms + assembly + event scheduling
17. Assembly quorum fields (#11)
18. Event export profiles (#12)
19. Form purpose + cycle_id (#13)
20. ConflictReport form linkage (#14)

### Sprint 7: Notification layer
21. One-click action emails (#21)
22. Input round notifications (#23)

### Backlog (low priority)
- ModuleState, foundational settings distinction, onboarding axis cap, phase remap, waitlisted status, unloved task strategies, bulk-select in packs, cloned-from link, drag milestones, percentage threshold, one-off load, week-granular contribution

---

## Files to verify before starting any work

Per the project's workflow pattern, re-read the relevant `docs/spec.md` sections before implementing. Key sections for each sprint:

- Sprint 1: Transparency & access, View-as, Admins
- Sprint 2: Views, Task notes
- Sprint 3: Task openness, Browse mode, Lifecycle & attention
- Sprint 4: Member + Tier, Branch
- Sprint 5: Cycle, Concurrent cycles, Coordination mechanics
- Sprint 6: Assembly, Event scheduling, Forms, Conflict management
- Sprint 7: Notifications & communications, Input rounds

Also check `docs/roadmap.md` and `docs/development-plan.md` to confirm nothing is already scoped or deliberately deferred.
