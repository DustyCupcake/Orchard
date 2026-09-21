# 🛠️ Orchard — Development Plan

*Expands `spec.md`'s "Build order" and "MVP scope" sections into phases sized for individual Claude Code sessions — each phase should be small enough to pick up cold, build, and leave in a working, demoable state. Assumes `architecture.md`'s stack: Next.js (App Router) + Drizzle + Postgres, Docker Compose deployment, Auth.js/Lucia magic-link auth.*

**How to use this:** hand one phase to a Code session at a time, in order (phases 0-4 are strictly sequential; later phases have noted dependencies but some can run in parallel once their prerequisites land). Each phase lists its goal, what's in scope, what's explicitly not, and how to know it's done.

---

## Organizational prerequisite — before this goes live with real member data

Not a build phase — a legal/organizational step outside the codebase, but a real blocker before any real Community runs on this with actual member data. Peach Please currently has no legal entity behind it (a French "association de fait"), which means GDPR/data-protection liability for whoever sets up and runs the server would fall personally on that individual, not on any organization. Resolved direction (2026-08-30): incorporate Peach Please as a French *association loi 1901* (free registration, ~5 business days, full separate legal personality) before real member data goes live — the incorporation itself lives in the association's own governance docs, not here. Once it exists, the board — not just whoever holds the sysadmin task — needs to be the one actually deciding what data gets collected and why; see `spec.md`'s new **Data governance** subsection (under Sensitive data) for how that's meant to interact with the platform's task-based model.

---

## Phase 0 — Scaffolding & deployable skeleton

**Goal:** prove the whole deployment path end-to-end before writing any real feature — so every later phase deploys onto infrastructure that's already known to work.

**Scope:**
- Next.js (App Router) project scaffold, TypeScript, `output: 'standalone'`.
- Drizzle wired to Postgres, one trivial migration to prove the pipeline (e.g. a health-check table or just a connection check).
- `docker-compose.yml`: app + postgres + caddy, per `architecture.md`.
- Env config (`.env.example` covering DB connection, SMTP settings, session secret).
- A single health-check route (`/api/health`) that confirms DB connectivity.
- Deploy this to the actual target VPS and confirm it's reachable over HTTPS via Caddy.

**Out of scope:** anything resembling a real feature. This phase is infrastructure only.

**Done when:** `docker compose up -d` on the VPS produces a working HTTPS site showing a health-check page reading real data from Postgres.

---

## Phase 1 — Core schema & migrations

**Goal:** the foundational data model in place as real Postgres tables via Drizzle.

**Scope (from the tech spec's Data model section):** Community, Branch, Cycle, Phase, Tier, Member, Task, TaskComment, TaskWikiRevision, TaskResource, TaskAssignment, TaskDependency, Requirement — full schema + migrations, matching the field lists in `spec.md`. No API or UI yet.

**Depends on:** Phase 0.

**Out of scope:** module-specific entities (Recruitment, Budget, Spatial planning, etc.) — those wait until their own module gets built, much later.

**Done when:** migrations run clean against a fresh database; a seed script can create a Community, a Branch, and a Task by hand (via a script or Drizzle Studio) and the relationships hold.

---

## Phase 2 — Auth & minimal profile

**Goal:** a member can log in and has a minimal profile.

**Scope:**
- Auth.js (or Lucia + OIDC plugin) wired for magic-link only.
- SMTP relay configured (Brevo, per `architecture.md`) and sending real magic-link emails.
- Minimal Member profile: name, tags, manual tier assignment (no computed tier criteria yet).
- Session handling, a logged-in vs. logged-out state in the UI.

**Depends on:** Phase 1.

**Out of scope:** OIDC/Zitadel provider (later, without touching this layer again, per the spec's design — see Phase 57), tier *criteria* computation (tenure/completion/cohort — manual assignment only for now), contact-method visibility settings.

**Done when:** a real email address can request a magic link, click it, and land in a logged-in session with an editable name/tags profile.

---

## Phase 3 — Task CRUD & lifecycle API

**Goal:** the task state machine, server-enforced.

**Scope:**
- Task CRUD.
- Lifecycle transitions as explicit endpoints — `claim` / `release` / `park` / `resume` / `finish` — rather than a generic PATCH, so business rules live server-side (can't finish a task with open dependencies, can't claim past capacity via TaskAssignment).
- Multi-slot capacity via TaskAssignment.

**Depends on:** Phase 1 (schema), Phase 2 (need a member to own a claim).

**Out of scope:** Requirement-based filtering of who *can* claim (Phase 5), any UI beyond what's needed to exercise the API (Phase 4).

**Done when:** the full lifecycle diagram from the tech spec (Unclaimed → Claimed → Waiting → Done, with release/park/resume) is exercisable via API calls, with the noted business rules actually enforced and tested.

---

## Phase 4 — Kanban board UI

**Goal:** the task board becomes usable by a human, not just an API.

**Scope:** group-by-status kanban view, filter by branch, claim/release/park/resume/finish from the UI, minimal styling (functional, not polished).

**Depends on:** Phase 3.

**Done when:** a logged-in member can see the board, claim an unclaimed task, and walk it through its lifecycle entirely through the UI.

---

## Phase 5 — Requirement filtering

**Goal:** eligibility checks gate claiming.

**Scope:** Requirement CRUD (type: tier/language/completed_task/custom — `individual_gate` mode only, per MVP scope), claimable-pool filtering based on member tags/tiers vs. task requirements. Reused, not duplicated, for cycle-initiation eligibility (Phase 6).

**Depends on:** Phase 4.

**Out of scope:** `group_coverage` and `soft_priority` modes (schema field is cheap to include now per the spec, but the surfacing/ranking logic they drive is deferred past MVP).

**Done when:** a task with a Tier requirement is unclaimable by a member who lacks that tier, and claimable by one who has it, enforced server-side (not just hidden in the UI).

---

## Phase 6 — Cycle creation

**Goal:** a Community can start a cycle.

**Scope:** create a Cycle blank or by cloning the most recent prior cycle (the pack-export/import code path, scoped narrowly to just this one use per MVP scope), define per-cycle phases. No automated Round 0/1/2 sequencing — coordination manages rounds manually against the task list, per MVP scope.

**Depends on:** Phase 5 (cycle-initiation eligibility reuses Requirement filtering).

**Done when:** a Tier-eligible member can create a new cycle from scratch or by cloning the previous one, phases included, and tasks correctly attach to it.

---

## Phase 7 — Task proposal flow

**Goal:** anyone can propose a task without knowing its full metadata up front.

**Scope:** low-friction create form (title + description only), a review/activate step where coordination fills in branch/tags/requirements before it goes live.

**Depends on:** Phase 4.

**Done when:** a non-coordination member can submit a bare-bones proposal, and it shows up in a review queue coordination can complete and activate onto the board.

---

## Phase 8 — Task notes (wiki, comments, resources)

**Goal:** the task detail view carries the goal-not-method content the spec treats as core, not polish.

**Scope:** three small tables (TaskWikiRevision, TaskComment, TaskResource) + a plain "edit the wiki / add a comment / add a resource link" UI on the task detail view, visually separated from the description field. Per MVP scope, the one-click Done-prompt integration and carry-forward-on-clone behavior can wait for a later phase — schema and basic UI are enough here.

**Depends on:** Phase 4.

**Done when:** any member can edit a task's wiki summary (with revision history), post a comment, and add a labeled resource link, all visible on the task detail view.

---

## Phase 9 — Settings screen

**Goal:** a Community's shape (branches, tiers, cycle/phase structure) is configurable without touching the database by hand.

**Scope:** a plain form-based settings screen — doesn't need wizard polish per MVP scope — for defining branches, tiers, and cycle/phase structure at Community setup. No Admins gating yet (per MVP scope, directly editable by whoever's running the install).

**Depends on:** Phase 1; realistically built alongside or just after Phase 6 once Cycle/Phase exist to configure.

**Done when:** a fresh Community can be fully configured (branches, tiers, whether cycles/phases are on) through the UI, no direct DB edits required.

---

## Phase 10 — Attention-level job

**Goal:** stale or at-risk tasks surface without a human having to notice by eye.

**Scope:** the in-process scheduler (`node-cron`, per `architecture.md`) doing its first real job — scheduled recomputation of attention level from the three triggers the spec defines: staleness (days unclaimed/inactive), phase-based (if phases enabled), and dependency-based (predecessor completion unlocking dependents). This phase is also where the general "scheduler + due-item polling" infrastructure gets built — later phases (Input rounds, Assemblies, non-response nudges, once those are scheduled) reuse this rather than each building their own.

**Depends on:** Phase 6 (phases), Phase 3 (task lifecycle/dependencies).

**Done when:** a task that goes stale (or misses a phase deadline, or has an unblocked dependency) visibly flags on the board within one scheduler tick, without manual intervention.

---

## Phases 0-10: done

Phases 0-10 above cover the tech spec's MVP scope in full and are built — see the repo's git log and README for what's actually landed (each phase's commit message records what was verified and how). Everything below is the next slice: closing the gap between "bare lifecycle" and what spec.md's "Coordination mechanics" section treats as core to how coordination actually functions day to day, plus the first real access gate the system has had (Admins). Unlike Phases 0-10, these were scoped after the codebase existed, so they cite real schema fields and call out real gaps rather than assuming.

## Phase 11 — Subtasks

**Goal:** a task holder can break off a piece of what they're doing as its own claimable card, without releasing the whole thing.

**Scope:** a "split off a subtask" action on a task's detail view, available to any current holder — creates a new Task with `parent_task_id` set to the source task (already in the schema since Phase 1, unused so far), pre-filled branch/cycle/phase from the parent (editable), fresh title/description/effort. Parent and child both show the relationship on their detail views — a "Subtasks" list on the parent, a "part of [parent]" link on the child.

**Depends on:** Phase 3 (Task CRUD), Phase 8 (the detail view to host this and show the links).

**Out of scope:** any approval step — per spec, splitting off a subtask is a unilateral act by a current holder ("the structural equivalent of the 'talk to my coordinator' button," not a request).

**Done when:** a member holding a task can create a subtask from its detail page, and both the parent's and the child's detail views correctly show the relationship.

## Phase 12 — Task openness & request-to-join

**Goal:** `Task.openness` — in the schema since Phase 1, accepted by create/update since Phase 3, but inert — actually changes what claiming looks like. Right now every task claims instantly regardless of its value.

**Scope:** a join table recording a pending request to join an already-held task (check whether spec's `BrowseInterest` shape actually fits, or whether this deserves its own smaller table — `BrowseInterest` is defined for the browse-period contested-claim case specifically, which is a different, still-deferred mechanism). Enforce at claim time: `open` claims instantly, as every task does today. A task with **no current holder** still claims instantly regardless of openness — a resolved interpretation, not stated explicitly in spec, but necessary since "request routes to the owner" has no owner to route to yet. Once a task has at least one holder, a further claim on a `request` or `coordination_approved` task creates a pending request instead of an instant claim; the current holder(s) accept or decline (optionally with a reason, per spec's "Request to join" language). `coordination_approved` specifically should be approvable by a holder whose `TaskAssignment.is_coordination_slot` is set, if one exists.

**Depends on:** Phase 3 (openness field, claim lifecycle), Phase 5 (Requirement gating still applies on top of this).

**Out of scope:** `community_endorsed` (needs the full candidacy/endorsement mechanism — see Phase 13); Browse mode's own contested-slot resolution flow (superficially similar, but a genuinely different, still-deferred mechanism per the tech spec's MVP scope).

**Done when:** claiming an already-held `request` or `coordination_approved` task creates a pending request instead of an instant claim, and the current holder can accept or decline it — enforced server-side.

## Phase 13 — Admins & Community-endorsed openness

**Goal:** the first real access gate anywhere in the system. Everything built in Phases 0-12 is open to any authenticated member; this is where `/settings` stops being one of those things.

**Scope:** `community_endorsed` openness (the fourth value from Phase 12) — during a task's browse/candidacy window, expressing interest creates a candidacy rather than an instant claim; other members can endorse it; a candidacy that clears the task's `endorsement_threshold` before the window closes converts to a real claim. This is spec's `BrowseInterest`/`Endorsement` shape. Admins itself is then just the flagship instance: a `community_endorsed` task (uncapped by default) that gates `/settings` — replace Phase 9's "any authenticated member" check with "must currently hold the Admins task," falling back to "any member" if the Community has never had an Admins task claimed at all (so a fresh install isn't locked out of its own settings before anyone's been endorsed).

**Depends on:** Phase 9 (the settings screen this actually gates), Phase 12 (the openness/claim plumbing this extends).

**Out of scope:** the spec's two-tier "ordinary vs. foundational settings" distinction (an Assembly-quorum expectation for foundational changes like membership model or phase-spine on/off) — that needs Assemblies, itself deferred well past this phase.

**Done when:** a member can put themselves forward for the Admins task, other members can endorse the candidacy, it converts to a real claim once the threshold clears, and `/settings` is reachable only by a current Admins holder (or by any member, on a Community that's never had one).

## Phase 14 — Shadow slots & succession

**Goal:** someone can join a task specifically to learn it without carrying equal weight, and an owner can flag they're not continuing it next cycle.

**Scope:** a "shadow" claim option setting `TaskAssignment.is_shadow` (in the schema since Phase 1, unused so far) — exempt from the task's `individual_gate` Requirements by design, doesn't count toward capacity or a `group_coverage` need. An "outgoing" flag (`TaskAssignment.is_outgoing`, also unused so far) an owner can set on their own assignment, triggering the same wiki-edit nudge Phase 8's notes UI could prompt on Done, but earlier and more pointed, per spec. Carry-forward: Phase 6's clone logic already sets a cloned task's `suggested_member_id` from a proposal's suggestion — extend it to also pre-fill from a filled shadow slot on the source task, per spec's "Carrying forward" language.

**Depends on:** Phase 3 (TaskAssignment), Phase 6 (the clone logic this extends), Phase 8 (the notes/nudge surface).

**Done when:** a member can join a task as a shadow (bypassing its `individual_gate` Requirements, not counted toward capacity), and cloning a cycle whose task had a filled shadow slot pre-fills the new task's `suggested_member_id` from that shadow.

## Phase 15 — Remaining coordination mechanics

**Goal:** the rest of what spec's "Coordination mechanics" section treats as core, not optional — talk-to-my-coordinator, self-assign confirmation check, anonymous task signal, requirement waiving, escalation view, bulk task selection.

**Who "does branch coordination" (resolved):** the spec already answers this — branch coordination is placement, not doing, and it's *just a task*, the same as everything else here. Round 0/1 of a cycle's kickoff exist specifically to get these tasks filled before Round 2 opens the season generally: "the critical coordination tasks (community-tagged, e.g. `backstop`)." No new relationship needed between Branch and a designated coordinator — a task counts as branch X's coordination task by carrying `branchId = X` plus a community-configured tag, not a dedicated boolean or a `Branch → Task` foreign key. Concretely:

- New `Community.coordinationTag` column (text, default `"coordination"`), editable on `/settings` alongside the other Phase 9 fields — a small addition to that existing screen, not a new one.
- "Whoever does branch coordination for branch X" = the current `TaskAssignment` holders, unioned across every task where `branchId = X` and `tags` contains the community's configured tag. A community with no branches (or a task not meaningfully branch-scoped) just uses the same tag unscoped by branch. A community can tag more than one task this way per branch if it wants several coordination-flavored roles rather than one — the mechanics below apply to whichever task the member is actually routed through, not to a single privileged task.
- This is also, retroactively, the honest way to read Phase 6's Round 0/1/2 language: manual/by-eye today (per MVP scope — no automated round sequencing), but "manual" already means "coordination looks at which tasks carry this tag," not an undefined human judgment call.

**Scope:**
- Requirement waiving — a current holder of the relevant branch's coordination task(s) can waive an `individual_gate` Requirement for one specific claim, with a required reason, left as a standing visible flag on the task afterward (`TaskAssignment.gate_waived_by`/`gate_waived_reason` are already in the schema, unused since Phase 1).
- Self-assign confirmation check — when a coordination-task holder tries to self-claim a flagged or unclaimed task, a confirmation step first ("are you sure there isn't someone better suited?").
- Anonymous task signal — a lightweight, closed-choice-only flag (stalled / might need help / something feels off / worth a look) on any task, visible to that branch's coordination-task holders.
- Escalation view — unplaceable tasks in one shared view, visible to all coordination-task holders community-wide, cross-branch placement encouraged.
- Talk to my coordinator — one-button trigger notifying the current holders of the task's branch's coordination task(s), no categorization required.
- Bulk task selection — cluster tasks (e.g. "all pre-launch Fruit tasks") for select-and-claim-with-exceptions.

**Depends on:** Phase 9 (the settings screen `coordinationTag` extends), Phase 12 (openness/holder plumbing).

**Done when:** a member holding a branch's coordination-tagged task can waive a Requirement on another task in that branch (reason required, visible afterward), and the self-assign confirmation step fires when they try to claim a flagged or unclaimed task themselves.

---

## Phase 16 — Profile questions

**Goal:** the shared "standing fact about a person" mechanism spec calls for (`ProfileQuestion`/`ProfileAnswer`) — not built as a shared-primitive-with-no-consumer gamble, but landing its first real, non-Recruitment consumer: finishing off the two Coordination-mechanics items Phase 15 explicitly left out because they needed this (capacity-aware fitted asks, availability non-response).

**Scope (from spec's "Profile questions" and "Coordination mechanics: Capacity-aware fitted asks / Availability non-response"):**
- `ProfileQuestion`: label, response type (free text / single-choice / multi-choice), `scope` (`once_ever` / `per_cycle` / `phase`), which surface(s) it applies to, required flag, `archived_at`. `phase_name_hint` set only when `scope = phase`, matched against the *current* cycle's actual Phase names (a cycle with no matching phase name just doesn't surface the question).
- `ProfileAnswer`: member, question, `status` (`answered` / `deferred`), value (present when answered), `cycle_id` (set for `per_cycle` and `phase`, null for `once_ever`).
- A member's own profile page (Phase 2) surfaces their outstanding questions — no real answer yet, or `deferred` — and lets them answer or defer. A `once_ever` answer edits like any other profile field; a `deferred` `per_cycle`/`phase` one resurfaces automatically as time moves closer to the relevant date, not through a second flow.
- One concrete standing question type: **Availability**, `scope = phase`, one real `ProfileQuestion` row per phase name a community actually wants a check-in for (e.g. "Availability — Recruiting"). Answering it declares a member's bandwidth for that phase. Carries its own `capacity_visibility` setting (`flag_only` default / `open`) living with the answer itself, not a general settings page.
- Coordination view gets capacity-aware fitted asks: a member's declared Availability for the current phase minus their current Effort-magnitude load across everything they hold, shown as exact numbers only if `capacity_visibility = open`, otherwise a coarse flag (*has room · about right · over*).
- Coordination view also gets an availability non-response list: who has no real answer (none, or `deferred`) for the current phase — visible regardless of `capacity_visibility`, since whether an answer exists is different information than what it says.
- Minimal `ProfileQuestion` CRUD, gated the same way Requirement CRUD already is — coordination/Admins-level, not a public form builder.

**Depends on:** Phase 2 (Member profile), Phase 6 (Cycle/Phase, for `phase_name_hint` matching), Phase 15 (`src/lib/coordination.ts`'s branch coordination holders — the audience for both new Coordination-view lists).

**Out of scope:** Forms (a related but separate shared primitive — see Beyond Phase 19); Recruitment's own use of Profile questions (application/onboarding surfacing); a no-code question-authoring UI (spec's own stretch goal — see Phase 58); the "follow up with non-responders" auto-task escalation pattern (spec treats it as an optional next step once the non-response list itself exists, not part of the list's own Done-when).

**Done when:** a coordination-tagged branch holder can see, for the current phase, which members have declared Availability (as an exact number if they've opted `capacity_visibility = open`, a coarse flag otherwise) and which members haven't answered at all — both enforced server-side, and a member can answer or defer an Availability question from their own profile.

## Phase 17 — Input rounds

**Goal:** the recurring-batch mechanism for task-linked questions spec designed specifically because an open-ended comment thread was the wrong shape — not a chat feature, a queued, cadence-driven Q&A unit.

**Scope:**
- `Question`: posed against a specific task, by anyone, no approval needed. Free text or closed-choice (options list, same response-type shape `ProfileQuestion` uses from Phase 16). Optional deadline, optional priority flag ("I can't move forward without this").
- Posing a question queues it — no immediate notification to anyone.
- Scheduled batching, on `Community.inputRoundIntervalDays` (already in the schema since Phase 1, unused until now) — reuses Phase 10's scheduler. A reminder fires a day ahead of the cutoff; at the cutoff, every queued question bundles into that round's answering window, sorted by proximity to its own deadline then priority. One notification when the round opens; a round with nothing queued doesn't fire at all.
- `QuestionResponse`: member, question, value — answering is always independently optional per question, never an all-or-nothing submission (the behavioral line that keeps this a different mechanism from Forms, per spec).
- Results land back with whoever asked and stay visible on the task itself to anyone else — no separate "closing rationale" step required.

**Depends on:** Phase 10 (scheduler), Phase 3 (Task, for what a Question attaches to).

**Out of scope:** Assemblies (a different container reusing this same Question/QuestionResponse shape — see Phase 18); Scheduling polls (a genuinely different mechanism, not built on Question/QuestionResponse at all — see Phase 19); Forms.

**Done when:** a question posed against a task queues silently, bundles into the next scheduled round with everything else queued, notifies once when the round opens, and the asker (and anyone viewing the task) sees the answers afterward — all without manual intervention beyond posing the question.

## Phase 18 — Assemblies

**Goal:** the community-wide-decision counterpart to Input rounds' task-execution-question scope — reuses the Question/QuestionResponse shape Phase 17 just built, inside a genuinely different, phased lifecycle.

**Scope:**
- `Assembly`: proposed by any member, no gatekeeping. Four sequential, independently-durationed windows set per Assembly (not fixed per Community): **agenda-building** (anyone can add an item), **notice** (agenda locked and visible, voting not yet open), **voting**, then **close** (tally + publish).
- Uses Phase 17's `Question`/`QuestionResponse` rows for the actual agenda items and their answers — no second content type.
- Results are always advisory and published, never auto-applied to Community configuration — turning a result into an actual change (a Tier's criteria, a new Branch) stays a deliberate, separate human action outside this phase's scope.
- No built-in urgent notification — an Assembly is just a page with a link; getting the word out fast is a human pasting that link wherever the community already posts urgent things, the same boundary Input rounds draws.

**Depends on:** Phase 17 (the Question/QuestionResponse shape this reuses directly).

**Out of scope:** Budget's ranked-choice voting (spec keeps that as its own mechanism deliberately, not folded in here); actually applying a passed Assembly's result to Community settings (a human does that by hand, through the ordinary settings screen).

**Done when:** a member can propose an Assembly, others can add agenda items during the agenda window, the agenda locks for the notice window, members answer the agenda's questions during the voting window, and results tally and publish on close — all four window durations independently configurable per Assembly.

## Phase 19 — Scheduling polls

**Goal:** "when can enough of the right people actually meet" — spec's third distinct input-collection mechanism, sharing no infrastructure with Questions (the output is a confirmed time, not an answer or a tally).

**Scope:**
- `SchedulingPoll` + `SchedulingEntry`: blind submission — an organizer opens a poll, members paint their own available windows on a day-by-time grid without seeing anyone else's submission first; only the aggregate overlap is visible until a slot is confirmed. Timezones render per viewer.
- Two resolution modes: **must-overlap-specific-people** (a fixed required-participant list; a slot missing one of them isn't an option at all) and **maximize-attendance-above-threshold** (nobody required, but a configurable floor on how many need to be free before a slot can confirm).
- Once resolved, calendar invites go out only to whoever submitted availability for the confirmed slot.
- Attendance, when tracked, is recorded after the fact by whoever ran the call against the expected audience (a branch's explicit roster, if the Community uses one — see Branch).
- **Call agenda & summary**, optional per poll, independently of each other: `CallAgendaItem` (poll, added-by, text) anyone in the call's audience can add beforehand; scheduling a poll auto-creates two tasks ("Facilitate [date]'s call" / "Take notes & publish the summary," `Task.source_poll_id` plus a role flag) claimable like any other task; the summary task's output is a `CallSummary` (body, `published_at`); an optional `require_read` flag drives `CallSummaryRead` tracking, surfaced as an unread Dashboard item for the call's audience (the Dashboard hook itself is a no-op stub until Dashboard exists — this phase just writes the read-state, doesn't need to render it there yet).
- Wires up the per-Branch/Community call-default fields already in the schema and unused since Phase 1 (`defaultCallHasAgenda`, `defaultCallNeedsSummary`, `defaultCallRequireRead`, on both `Community` and `Branch`) — a branch without its own defaults inherits the Community's.

**Depends on:** Phase 3 (Task, for the auto-created facilitate/summary tasks), Phase 9 (settings, for the branch/community call-default fields this wires up).

**Out of scope:** Recruitment's use of this for intro calls (a future consumer, not this phase's concern); a live-filling grid (spec explicitly notes this is the one thing not carried over from the LettuceMeet-style reference tool, since it contradicts blind submission — see spec's Open questions).

**Done when:** an organizer can open a poll, members submit blind availability on a grid, the poll resolves under either mode, calendar invites go out to whoever's free at the confirmed slot, and a poll opted into agenda/summary produces the two auto-created tasks with a publishable, optionally read-tracked summary.

---

## Phase 20 — Documentation

**Goal:** knowledge that doesn't have a natural home on any single task — general reference, platform how-to, camp policy/lore, FAQs — plus a browsable index over task wikis. The one module that **defaults on**, same footing as Task notes rather than something a Community has to remember to enable.

**Scope:**
- `WikiPage`: freestanding pages, open to edit by any member, a lightweight revision history mirroring `TaskWikiRevision`'s exact shape from Phase 8 (a new page is just a fresh page; each edit is a new revision, "current" is the latest). Optional nullable `branch_id` for filing (null = general).
- Linking convention: plain text/URLs in the content, same as `TaskWikiRevision` already is — this codebase has no markup-parsing engine to extend, so no new one gets invented here either. A page can informally reference another page/task/branch by name or link; nothing enforces or resolves that mechanically yet.
- FAQ without a separate schema: a page can be created with just a question and no body, flagged `question_pending`, sitting there until someone fills in a real answer — at which point it's an ordinary published page. `duplicate_of_page_id` (nullable, self-referencing) resolves a pending question by pointing it at an existing page instead of writing new content — it drops out of the main index but shows on the canonical page as "also asked as…".
- The index over task wikis is a read-only view, not new storage: every task's current wiki revision, grouped by branch to start.

**Depends on:** Phase 8 (the `TaskWikiRevision` shape this mirrors), Phase 9 (branches, for optional filing).

**Out of scope:** an actual on/off toggle in settings — Documentation defaults on with no module-gating infrastructure needed yet (see Phase 22, which is where the real `modulesEnabled` on/off mechanism gets built, for a module that actually needs to default off).

**Done when:** any member can create a freestanding wiki page with revision history, post a bare FAQ question that later gets a real answer or gets marked as a duplicate of an existing page, and browse an index of every task's current wiki content grouped by branch.

## Phase 21 — Conflict management

**Goal:** the reporting/recusal flow spec gives real design weight to, not a thin deferred afterthought — including a genuine invisibility guarantee for a recused team member, not just an access-denial.

**Scope:**
- `Community.conflictTeamTaskId` — a pointer to which task *is* the conflict team, mirroring the exact field the schema comment in `community.ts` has flagged as deferred since Phase 1 ("would create a Community ↔ Task circular import ... only meaningful once the conflict-management module is built"). Resolved here the same way `Requirement.value`'s `completed_task` reference already handles a logical-but-not-DB-level FK in this codebase: a plain `uuid` column with no `.references()` call, validated at the application layer (task exists, same community) rather than a real foreign key — sidesteps the circular import without inventing a new pattern. A community with this unset simply doesn't have the module on; no separate flag needed.
- `ConflictReport`: `reportedBy` (recorded, not anonymous like `task_signal` — spec says "visible only to the reporter and whoever's handling it," which means access-restricted, not identity-omitted), optional `description`, `createdAt`, nullable `acknowledgedAt`/`acknowledgedBy`, nullable `resolvedAt`/`resolutionNote`, and an `escalated` flag — a resolved interpretation for a case spec names but doesn't fully define the mechanics of: escalating widens visibility from the single handler to the whole non-excluded team, rather than to some undefined higher authority.
- `ConflictReportExclusion` (reportId, memberId, addedBy, addedAt): one table for all three exclusion routes spec describes — reporter-excludes-at-creation, self-recusal, peer-recusal — differentiated only by who added the row and when, not a type enum, matching spec's "all three routes land in the same place."
- **The invisibility guarantee is real, not cosmetic:** `listConflictReports(actor)` excludes any report where `actor.id` appears in that report's exclusion list via the query itself (a join/anti-join), never a post-fetch filter or a redacted placeholder — an excluded team member's report count and queue look exactly as if the excluded reports don't exist.
- Flow: report → acknowledged within a community-configurable window → whichever eligible (non-excluded) team member takes it becomes point of contact → resolution noted.

**Depends on:** Phase 3 (Task, for the conflict-team task pointer and its multi-slot capacity).

**Out of scope:** View-as (doesn't exist yet — still blocked per "Beyond Phase 24," below — so there's no View-as access path to guard against yet; whoever eventually builds View-as needs to route it through this same filtering, noted here for them); the post-cycle-feedback-to-conflict-report handoff (needs Forms, unbuilt, and spec is explicit this stays human-mediated, never automatic — nothing here to build).

**Done when:** a community can designate its conflict-team task; any member can file a low-friction report, optionally excluding specific team members up front; a team member can recuse themselves or another; an excluded team member's view of the report queue is genuinely indistinguishable from the excluded report not existing; a non-excluded team member can acknowledge, become point of contact, and record a resolution.

## Phase 22 — Sensitive data

**Goal:** purpose-bound (not role-bound) access to a small set of sensitive member fields — health, allergies, orientation, emergency contacts. Off by default, and the phase that finally builds real on/off gating for `Community.modulesEnabled` (unused since Phase 1) — Documentation didn't need it (defaults on), Conflict management's own `conflictTeamTaskId` being set already doubles as its on/off signal, but Sensitive data has no natural pointer field to double as one.

**Scope:**
- `isModuleEnabled(community, key)` reading `Community.modulesEnabled`, plus a `/settings` checkbox list to toggle modules on/off — the flat on/off list the schema comment already describes, not spec's richer off/testing/on `ModuleState` (a Tier-scoped testing rollout stays out of scope, same as it's been every time this doc has mentioned it).
- A small, fixed set of sensitive fields on Member (not a user-definable field system — spec's own example list is short, and a generic field-definition builder is real extra scope spec doesn't ask this module to carry) — health conditions, allergies, emergency contact, orientation.
- `SensitiveFieldAccessRule` (communityId, fieldKey, unlockedByTaskId nullable, unlockedByTierId nullable) — "a Community defines which task or tier unlocks which field." A member can always see and edit their own values regardless of any rule (an obvious, unstated invariant — only *others'* access is purpose-bound).
- A new `/sensitive-data` page rather than individual member-detail pages (which don't exist anywhere in this app yet, and building them is real scope beyond what this module needs): for each field the current viewer is unlocked for, a table of every member's value — the same "surface exactly what's relevant to what you hold, in one place" pattern `/coordination` and `/escalation` already use, rather than requiring N separate member-page visits.

**Depends on:** Phase 2 (Member), Phase 9 (settings, and the tasks/tiers a rule references).

**Out of scope:** a user-definable sensitive-field system (fixed field set only); member-detail pages as general infrastructure; the richer off/testing/on `ModuleState`.

**Done when:** a community can turn Sensitive data on, define which task or tier unlocks which of the fixed sensitive fields, a member can set their own values, and a member currently holding the configured task/tier — and only such a member — sees the unlocked field(s) for the community's members on `/sensitive-data`.

## Phase 23 — Contribution tracking

**Goal:** a member sees their own picture of what they've done, are doing, and will do — broken down by category, computed from state that already exists, never a second number kept in sync by hand.

**Scope:**
- Contribution category = Phase. Spec's own example categories for this ("planning, build, live operation, wind-down, or whatever categories fit the Community's own work") read exactly like Phase names, so this reuses the existing Cycle/Phase schema from Phase 6 rather than inventing a second categorization concept. A Community with phases off (or a task with no `phaseId`) falls back to one implicit "Overall" category — no separate config needed.
- Three buckets per category, per spec: **completed** — TaskAssignment on a Done task, attributed to the week/period the task actually transitioned to Done (`Task.statusChangedAt` from Phase 10, not `createdAt` or claim time); **active** — current TaskAssignment on a non-Done task, sized by that task's Effort magnitude; **future signed-up** — TaskAssignment already made for a later-phase or Browse-period task not yet started.
- A new `/contribution` page: the member's own breakdown by category, computed live off Task/TaskAssignment — no new storage beyond the visibility flag below.
- `Member.contributionVisible` (boolean, default false) — a member can toggle their own breakdown visible to the rest of the Community, off by default, the same private-by-default/explicit-opt-in pattern Sensitive data (Phase 22) and contact-method visibility already use. Turning it on shares exactly the breakdown they see themselves, nothing more granular.

**Depends on:** Phase 3 (Task/TaskAssignment), Phase 6 (Phase, for category — only meaningful when phases are on), Phase 10 (`statusChangedAt` for Done-attribution).

**Out of scope:** the community-average-per-category comparison line — spec is explicit this waits on Recruitment's Participation status (`coming`), which doesn't exist yet, and a same-shape "current active members" substitute isn't built here since it would need ripping out once real Participation lands; shift completions (spec mentions these alongside completed task assignments, but Shifts/rota is unbuilt — nothing to read yet); arrival/departure-date context (also a Participation field).

**Done when:** a member can see their own completed/active/future breakdown by category (or one "Overall" category on a Community with phases off) on `/contribution`, computed live with nothing separately entered, and can toggle it visible to the rest of the Community.

## Phase 24 — Dashboard

**Goal:** a member's home view — what's currently relevant to *them*, computed from state other mechanics already produce, never a separately-maintained to-do list. Becomes the new post-login landing page (replacing the current redirect to `/profile`).

**Scope — the slice that needs nothing unbuilt.** Spec's Dashboard section describes a longer personalized feed (recruitment items, onboarding progress, Spatial-planning approvals/invites); those stay out of scope below since Recruitment is unbuilt and Spatial planning is paused (see below) — this phase covers only what's actually computable today:
- New `/dashboard` page, wired as the post-login landing page.
- Personalized feed for anyone with active or held tasks: pending join requests on tasks they own (Phase 12), upcoming Waiting check-ins/nudges due (Phase 10), and tasks they currently hold that are flagged (soft/hard/escalated attention level, Phase 10) — all reads off state Phases 3/10/12 already produce.
- **Community snapshot panel**, always visible: composition breakdown (Tier distribution off `Member.tierIds`, Branch spread off `Task`/`Branch`), plus this session's new **Branch health** rollup from `docs/spec.md`'s Dashboard section (added 2026-08-28) — a per-branch coarse status (*on track · attention needed · struggling*) visible to everyone, computed from each branch's mix of OK/soft/hard/escalated task attention levels (Phase 10) with no new tracked field; coordination-view holders (Phase 15's `isCoordinationHolder`) additionally see the real flag counts behind that status, for every branch, not just their own.
- A link from the snapshot panel out to the member's own `/contribution` picture (Phase 23) rather than duplicating that breakdown inline.

**Depends on:** Phase 3 (Task/TaskAssignment), Phase 10 (attention level, `statusChangedAt`), Phase 12 (join requests), Phase 15 (branch coordination, for the Branch health coordinator-detail tier), Phase 23 (Contribution tracking, linked from the snapshot panel).

**Out of scope:** recruitment-facing feed items (new applicants, pipeline stuck-list) and onboarding progress — Recruitment unbuilt; Spatial-planning approval/invite feed items — Spatial planning paused, below; active-member-count and community-average-contribution lines in the snapshot panel — both scoped to Participation status `coming`, same Recruitment dependency Phase 23 already defers.

**Done when:** a logged-in member lands on `/dashboard` and sees their own pending join requests, upcoming check-ins, and flagged held tasks, plus a community snapshot panel showing Tier/Branch composition and the two-tier Branch health rollup (coarse status for everyone, real flag counts for coordination-view holders) — all computed live from existing state.

---

## Phase 25 — Forms (shared primitive) + post-cycle feedback

**Goal:** the last core shared primitive without a scoped consumer — `Form`/`FormResponse`, generic across whatever module needs a structured, single-event submission — landing its first real, non-Recruitment consumer (post-cycle feedback) in the same phase, the same reasoning Phase 16 used for Profile questions ("not built as a shared-primitive-with-no-consumer gamble, but landing its first real consumer").

**Scope:**
- `Form`: communityId, title, description, fields (jsonb array of `{key, label, responseType, options, required}` — the exact same shape `Question`/`ProfileQuestion` already use; per spec's "Forms made of Questions? Partly," this reuses that vocabulary rather than inventing a second one), allowAnonymous (boolean), createdBy, createdAt, archivedAt (nullable).
- `FormResponse`: formId, submittedBy (nullable — set unless the form allows anonymous and the submitter chose it; submitting still requires being an authenticated member, matching this app's no-public-write-path posture everywhere else — "optionally anonymous" means not recorded, not that login isn't required), values (jsonb keyed by field key), submittedAt. Submission is all-or-nothing against the form's field definitions — required fields block the whole submission — the real behavioral line spec draws between a Form and a Question (always independently optional to answer).
- Minimal Form CRUD, gated the same way Sensitive data's access rules are (Phase 22) — `requireAdmins` at the Server Action/API layer, since defining what data gets collected from members is a real configuration decision, not an open one.
- `Community.feedbackReviewTaskId` — a plain uuid pointer to whichever task reviews feedback responses, the same conflictTeamTaskId/"the task is the authority" pattern Phase 21 established, and a real FK is fine here (a new schema file can import `task.ts` directly, same reasoning Phase 22's `SensitiveFieldAccessRule` already relied on). `Community.postCycleFeedbackFormId` points at the one standing Form a community defines for this — configured together on `/settings`.
- Post-cycle feedback itself: any member can submit a response to the community's configured feedback form at any time — no automatic per-cycle-close trigger in this phase (matching the manual-first posture the rest of this codebase uses before automating anything — see Phase 6's Round 0/1/2). Responses are visible to whoever currently holds `feedbackReviewTaskId`.
- New `/feedback` page: submit a response if a form is configured; the review-task holder additionally sees every submission there.

**Depends on:** Phase 9 (settings, for the two new Community pointer fields), Phase 3 (Task, for `feedbackReviewTaskId`).

**Out of scope:** a no-code Form-field-authoring UI (spec's own named stretch goal — fields are defined via the create-form action for now, same "hardcoded per use" MVP posture spec names — see Phase 58); automatic per-cycle-close triggering of the feedback ask (a real scheduling feature, not needed to prove the shape); Recruitment's application-intake use of Forms (a future consumer); the feedback-response-to-conflict-report handoff (spec is explicit this stays human-mediated, never automatic — nothing to build).

**Done when:** an admin can define the community's standing post-cycle feedback form (fields, anonymous or not) and designate its review task; any member can submit a response (optionally anonymous); whoever holds the review task sees every submission.

## Budget (Phases 26-27)

Spec's own bullet structure splits cleanly along a real seam: collecting what's on the table, then deciding what actually gets funded. `docs/spec.md`'s Budget section is the source of truth for both; re-read it before starting either.

### Phase 26 — Budget: fixed costs & proposals

**Goal:** the intake half — locking in the non-negotiable floor and collecting itemized funding proposals before voting opens.

**Scope:**
- `Community.modulesEnabled` gains `"budget"` — Phase 22's `MODULE_DEFINITIONS` registry extended, the reuse that phase was built to support.
- `BudgetCycle`: communityId, cycleId (nullable — ties to a real Cycle when cycles are on, the same optional-association pattern Task itself already uses), title, fixedCosts (jsonb array of `{label, amount}`, entered by the budget owner before proposals open), proposalDeadline (timestamptz), status (enum: `proposals_open` / `voting` / `confirmed`), ownerTaskId (plain uuid pointer, same conflictTeamTaskId/feedbackReviewTaskId pattern — "the budget owner" is just whoever holds this task).
- `BudgetProposal`: budgetCycleId, submittedBy, title, description, lineItems (jsonb array of `{label, amount}` — the itemized breakdown spec asks for), totalAmount (stored alongside lineItems for cheap sorting/display), branchId (nullable), phaseId (nullable), submittedAt. Any member can submit before the deadline; editable by the submitter until it passes.
- New `/budget` page: the current BudgetCycle's fixed costs and open proposals, plus a submission form while `proposals_open`.

**Depends on:** Phase 22 (modulesEnabled gating), Phase 1 (Branch/Phase, for a proposal's optional tags), Phase 6 (Cycle, optional association).

**Out of scope:** ranked-choice voting, the contribution-signal question, confirmation, and the real contribution ask — all Phase 27; multiple concurrent BudgetCycles per Community (one active cycle at a time for v1, the same "the current one" posture Cycle itself already has elsewhere in this codebase).

**Done when:** a community with Budget on can designate its budget-owner task, enter fixed costs, open a proposal window with a deadline, and any member can submit an itemized proposal before it closes — all visible on `/budget`.

### Phase 27 — Budget: ranked-choice voting, confirmation & contributions

**Goal:** turning a closed proposal list into an actual funded budget — the vote, the human confirmation, and the real ask that follows it.

**Scope:**
- Once `proposalDeadline` passes, the owner (ownerTaskId holder) moves the cycle to `voting` — proposals lock, no further edits or new submissions.
- `BudgetVote`: budgetCycleId, memberId, rankedProposalIds (jsonb ordered array — a member's full ranking), contributionSignal (numeric, nullable — "how much would you contribute this year?"), submittedAt. One vote per member per cycle, replaceable until voting closes.
- Voting view: each proposal's total and itemized cost, cost-per-member (totalAmount ÷ current member count — the same all-members reading Phases 23/24 already settled on in place of a still-unbuilt Participation `coming` scope), and a running total if everything above a given rank were funded. **Resolved interpretation, since spec doesn't name an algorithm:** a straightforward positional (Borda-style) rank score — not instant-runoff elimination, whose threshold/elimination mechanics are real extra complexity this phase doesn't need to carry to produce a defensible ranked order. Revisit if a real Community's results ever feel wrong for it.
- Confirmation: the owner moves the cycle to `confirmed`, entering `confirmedProposalIds` (a human selection informed by, not bound to, the ranked order) and a `confirmationRationale`, required whenever the confirmed set differs from the ranked order — spec's "published rationale for any deviation."
- Contributions: once confirmed, `/budget` shows the final funded set and fixed costs, and — reading each member's own `contributionSignal` from their vote — a real per-member ask. Still just a number shown to that member, not a payment integration; spec never asks this module to move real money.

**Depends on:** Phase 26 (BudgetCycle/BudgetProposal).

**Out of scope:** real payment collection/processing (the ask stays a number on a page, the same numbers-not-actions posture Contribution tracking already has); instant-runoff ranked-choice (the Borda-style count above is the resolved v1 algorithm); a formal minimum-quorum requirement on voting (not named in spec).

**Done when:** the owner can close proposals to voting, every member can submit a full ranking plus a contribution signal, the voting view shows live running totals by rank, the owner can confirm a final funded set with a required rationale for any deviation from the ranked order, and confirmed members see the real ask against what they signaled.

## Phase 28 — Event scheduling

**Goal:** a community's own internal programme — proposals, conflict resolution, and a published schedule — reusing the same task-pointer module-ownership pattern Budget and Conflict management already established rather than inventing a new one.

**Scope:**
- `Community.modulesEnabled` gains `"event_scheduling"`. `Community.eventSchedulingOwnerTaskId` — the task whose holder reviews proposals, same pattern as `ownerTaskId`/`conflictTeamTaskId`/`feedbackReviewTaskId`.
- `EventProposal`: communityId, cycleId (nullable), submittedBy, host (text — may differ from the submitter, proposing on someone else's behalf), title, description, durationMinutes, spaceNeeds (text), preferredSlots (jsonb array of `{startsAt, endsAt}` — the proposer's own preferred windows, not yet a confirmed slot), status (enum: `proposed` / `conflict` / `confirmed` / `declined`), confirmedSlot (jsonb `{startsAt, endsAt}`, nullable until confirmed).
- Conflict detection, on owner review: flags proposals whose slots (preferred, or confirmed once set) overlap in time **and** share a space. **Resolved interpretation**, since spec doesn't define what counts as "the same slot": overlapping time range + an exact `spaceNeeds` string match — no room-graph or capacity modeling.
- Conflict notification: flagged proposals' hosts get pinged (reusing the one-button coordinator-ping pattern Coordination mechanics already built) and can each propose a different slot, or the owner mediates directly — the scheduler "facilitates but doesn't arbitrate by default," so nothing resolves conflicts automatically.
- Publication: the owner confirms a slot per proposal (clearing its conflict flag); once every proposal in the cycle is confirmed or declined, the owner publishes — locks every proposal from further edits and makes the schedule visible to all members on a new `/schedule` page.

**Depends on:** Phase 22 (modulesEnabled), Phase 3 (Task, for the owner-task pointer).

**Out of scope:** public/non-member submission links (a genuinely different, unauthenticated write path — this app has no public write surface anywhere yet; a real follow-up once actually needed, not guessed at now); Export profiles (community-configurable downstream constraints shown at entry time — cheap to add once the core proposal shape is proven, but a distinct enough concern to land as its own fast-follow rather than padding this phase); automatic slot-conflict resolution (spec is explicit this stays human-mediated).

**Done when:** a community with the module on can designate its scheduling-owner task; any member can submit a proposal with preferred slots; the owner sees flagged conflicts (overlapping time + space) and can confirm a slot per proposal; once every proposal resolves, the owner publishes a schedule visible to all members on `/schedule`.

## Shifts / rota (Phases 29-30)

Spec gives this module a single sentence — "recurring, never-'done' work distinct from tasks" — so unlike Budget or Event scheduling, real design resolution happens in this scoping pass, not just transcription. Two concrete anchors elsewhere in spec ground the design: Coordination mechanics' "genuinely unloved tasks... rotate it (it becomes a recurring shift)" (a Task can convert into a Shift — an origin, not a requirement), and Contribution tracking's "completed task assignments **and shift completions**" (a shift occurrence needs its own "did this happen" signal, separate from a Task's Done transition, which Phase 23 already expects to read). Split along the same seam Spatial planning used: the standing structure first, then the completion signal that closes the loop.

### Phase 29 — Shifts/rota: series, occurrences & sign-ups

**Goal:** a rota of dated/timed slots members sign up for — recurring, standing work that never reaches a single Done, distinct from a Task's one-shot claim/finish lifecycle.

**Scope:**
- `Community.modulesEnabled` gains `"shifts"`.
- `ShiftSeries`: communityId, branchId (nullable), title, description, defaultCapacity, sourceTaskId (nullable — set when a series was rotated off an existing Task; a series can also be created directly with no originating task), createdBy, createdAt, archivedAt (nullable, for retiring a series without losing its history).
- `ShiftOccurrence`: seriesId, startsAt, endsAt, capacity (nullable override of the series default). Occurrences are explicitly, batch-created — a coordinator picks a date range and either a weekly day-of-week + time, or a plain explicit list of datetimes for a dense one-off event schedule, and the system inserts the resulting rows once. **Resolved interpretation:** no live-evaluated recurrence-rule engine — explicit rows only, the same posture Phase/Cycle already take over a derived schedule.
- `ShiftSignup`: occurrenceId, memberId, status (enum: `signed_up` / `completed` / `no_show`), signedUpAt. Any member can sign up for an occurrence up to its capacity (first-come, the same as an `open`-openness Task claim — no waitlist for v1); can withdraw before it starts.
- New `/shifts` page: browse upcoming occurrences grouped by series, sign up or withdraw; a coordinator view (the series creator, or whoever holds `sourceTaskId` if set) listing each occurrence's current signups.

**Depends on:** Phase 22 (modulesEnabled), Phase 3 (Task, for the optional rotate-from-task origin).

**Out of scope:** completion/no-show marking and the Contribution tracking integration — Phase 30; a full recurrence-rule engine (explicit batch-generated rows only); waitlists past capacity; any no-show pattern-tracking (mirroring Response tracking's escalation ladder is real extra scope, not asked for here).

**Done when:** a community with the module on can create a Shift series (optionally from an existing Task), batch-generate a run of dated occurrences for it, and any member can see upcoming occurrences on `/shifts` and sign up or withdraw, capacity-limited per occurrence.

### Phase 30 — Shifts/rota: completions & contribution tracking

**Goal:** closing the loop spec names directly — a shift occurrence's own completion signal, and Contribution tracking actually reading it.

**Scope:**
- Marking a signup `completed` — self-reported by the signed-up member once the occurrence's `endsAt` has passed, the same trust posture (access follows the task, not a verification chain) everything else in this codebase already uses; a series coordinator can also mark a signup `no_show` — a real, visible, logged call, not automatic, the same posture Requirement waiving already established.
- `getContributionBreakdown` (Phase 23) extended to also read `ShiftSignup` rows with status `completed`, surfaced as their own entry alongside a category's existing task lists — spec's exact phrase is "completed task assignments **and shift completions**," read together, not folded into the same count. A shift isn't a Task, so it doesn't inherit a Task's Effort magnitude for the hours figure — completions are counted, not hour-weighted, for v1.
- "Rotate this task into a shift" — a one-click action on a Task's detail view, available to any current holder (the same unilateral-act posture Subtasks already established, per spec's own "genuinely unloved tasks" framing): creates a `ShiftSeries` with `sourceTaskId` set and branch/description pre-filled from the task. The original Task is left untouched — still exists, still holdable — converting is a starting point for coordination to actually retire it, not an automatic archive.

**Depends on:** Phase 29 (ShiftSeries/ShiftOccurrence/ShiftSignup), Phase 23 (Contribution tracking, the breakdown this extends).

**Out of scope:** automatically archiving/releasing the source Task once rotated (a human coordination step, matching spec's "leads consciously absorb or cut it" framing for the other unloved-task options — a deliberate human call throughout, never automatic); a no-show consequence/pattern-tracking ladder (same call as Phase 29).

**Done when:** a member can mark their own past signup completed (or a coordinator can mark another's no-show), a community member's `/contribution` page shows their shift completions alongside their task breakdown, and any task holder can convert their task into a new Shift series in one action.

---

## Recruitment (Phases 31-35)

Scoped cold on 2026-08-29 at the user's explicit request, in this order: Recruitment, then Spatial planning (picked back up from its S1-S3 pause below), then Cycle type, then On-site mode. `docs/spec.md`'s "Recruitment" section (plus the Data model's Cycle/Participation/Member/CycleType entries and the *Recruitment* module-entity table) is the source of truth throughout — re-read it before starting any of these, it's dense and the real design detail lives there, not in this summary.

Spec itself calls this "the biggest single module," and the text backs that up — application intake, invite links, a public inquiry inbox, a recommendation-to-outcome mapping, a wider-discussion objection window, accompaniment, and a computed pipeline view are each real mechanisms, not variations on one theme. Split into five phases along natural seams: the one prerequisite Recruitment leans on but spec insists isn't actually gated by it (Participation & capacity), the foundational access-boundary change (public entry points), the actual evaluated-admission funnel (application/evaluation), what happens between a recommendation and full membership (scheduling/discussion/accompaniment), and finally the computed view that ties all of it together. Phases 32-35 depend on each other in that order; Phase 31 is a genuine prerequisite for Phase 33's returning-priority-window reference and Phase 35's remaining-capacity display, but is otherwise Recruitment-independent — a Community could pick it up on its own even with Recruitment off.

### Phase 31 — Participation & capacity (Cycle)

**Goal:** who's actually planning to be at a Cycle, and how much room is left — core Cycle machinery spec is explicit isn't gated behind Recruitment at all ("even a community that never recruits new members wants to know how many people are actually coming"), scoped now because Recruitment's own pipeline view and returning-priority window both reference it directly.

**Scope:**
- `Participation`: cycleId, memberId, status (enum `unknown`/`coming`/`maybe`/`not_coming`, default `unknown`), arrivalDate, departureDate, note, updatedAt — resubmittable as plans change, one row per member per cycle (upserted in place, the same select-then-update-or-insert posture Assemblies/Budget votes already use).
- Wire up `Cycle.capacity` and `Cycle.returningWindowClosesAt` — both already in the schema since Phase 6, unused. A simple "remaining capacity" computation (capacity minus count of `coming` Participation rows, null capacity = unlimited) and a plain "declare your participation" form on the member's own profile or a new small `/participation` surface.
- The returning-priority window itself, as far as it can go without Recruitment existing yet: a computed open/closed state purely from `now()` vs. `returningWindowClosesAt` (the same purely time-computed, no-scheduler-job pattern Assemblies' `computeAssemblyPhase` already established — no new cron tick needed), surfaced as a plain "the returning-priority window is open/closed" banner. What actually *happens* when it closes (recruitment opening against remaining capacity) is Phase 33's to wire up once there's a recruitment funnel to open.
- **Close two real, explicitly-named TODOs this unblocks:** Phase 23's deferred community-average-contribution line ("waits on Recruitment's Participation status `coming`, not the whole all-time community roster") and Phase 24's deferred active-member-count line in the Dashboard snapshot panel — both read literally off `Participation.status = 'coming'` for the current cycle, which is real data the moment this phase lands, independent of whether the Recruitment module itself is ever turned on.

**Depends on:** Phase 6 (Cycle, the two already-scaffolded fields this wires up), Phase 23 (Contribution tracking, the average-line TODO this closes), Phase 24 (Dashboard, the active-member-count TODO this closes).

**Out of scope:** anything that requires Recruitment to actually exist (the window closing and *opening general recruitment against remaining capacity* is Phase 33's consequence to wire up, not this phase's); a formal waitlist when capacity is full — spec is explicit that hitting zero early is "not a special case, just room hitting zero early," visible the same way any other limit here is, not a queue.

**Done when:** a member can declare (and update) their own Participation for the current cycle; anyone can see the cycle's remaining capacity and whether the returning-priority window is currently open; and `/contribution`'s community-average line and `/dashboard`'s active-member-count both show real, live numbers instead of being absent.

### Phase 32 — Recruitment: public entry points (invite links & inquiry inbox)

**Goal:** the first genuinely public, unauthenticated surface this app has ever needed, and the real access-boundary change that has to come with it.

**A resolved decision that changes existing behavior, not just adds new surface — read this before touching auth code:** every Member this app has ever created has come through the exact same door: request a magic link, verify it, and `findOrCreateMemberByEmail` (see `src/app/api/auth/verify/route.ts`) silently creates a Member for any email that verifies, recognized or not. That's the *correct* default for a Community that's never turned Recruitment on — spec's own framing treats "an open door" as the alternative to evaluated admission, not a bug everyone should be fixed away from. But once `Community.modulesEnabled` includes `"recruitment"`, that auto-create-on-unrecognized-email behavior has to stop, or nothing else in this phase (or Phase 33) means anything: an *unrecognized* email verifying an ordinary magic link while the module is on gets redirected to a "no account found — apply or use an invite link" page instead of silently becoming a Member. Existing members keep logging in exactly as before, module on or off — only *new* membership creation is gated once it's on, and from then on only ever happens through this batch's own code paths (a redeemed invite, this phase; an accepted application, Phase 33) instead of the generic verify route.

**Scope:**
- `Community.recruitmentTaskId` — the same non-FK "task is the authority" pointer pattern `conflictTeamTaskId`/`feedbackReviewTaskId` already established (community.ts can't import task.ts back); whoever currently holds it is "a recruitment-facing task" holder throughout this whole batch, not a dedicated role. `Community.modulesEnabled` gains `"recruitment"`.
- `CommunityInvite`: token, label (nullable), inviterThinksGoodFit, inviterKnowsPersonally (both boolean), expiresAt (nullable), revokedAt (nullable), redeemedAt/redeemedByMemberId (nullable), createdBy, createdAt. Any member can generate one — open, unilateral, the same posture as everywhere else a member-initiated action doesn't need approval first. Always single-use; no multi-use variant, per spec's explicit CampTool-lesson callout.
- A public `/invite/[token]` page, no login required: shows nothing about the inviting member or the community's roster (a searchable member list on a public page is its own privacy problem, per spec), just a path to become a Member. Redeeming creates the Member with `referredByMemberId`/`joinedViaInviteId` set and starts a real session directly — no magic-link round-trip needed, since redeeming a valid, unexpired, unredeemed, unrevoked token *is* the proof of legitimacy.
- `Member.referredByMemberId` (nullable, self-FK) and `Member.joinedViaInviteId` (nullable FK → CommunityInvite) — both new columns, per spec's Member table.
- `Inquiry`: message, contactInfo, submittedAt, claimedBy/claimedAt/resolvedAt (all nullable). A public, unauthenticated "message us" box, no application structure — lands in a queue visible to whoever holds the recruitment task, claimable to answer personally (same low-stakes claiming as everywhere else, mainly so two people don't unknowingly cold-message the same person).

**Depends on:** Phase 22 (modulesEnabled), Phase 2 (magic-link auth — the verify route this phase modifies).

**Out of scope:** application intake itself (Phase 33 — this phase only builds the two low-structure public entries, not the evaluated-application form); rate-limiting/abuse protection on the new public endpoints beyond the obvious (no CAPTCHA, no IP throttling) — a real follow-up once this is live somewhere with an actual abuse problem, not guessed at now, the same "don't build storage infrastructure against a hypothetical" posture spec itself takes with task resources.

**Done when:** a community can turn Recruitment on and designate its recruitment-facing task; any member can generate a single-use invite link with both checkboxes; visiting an unredeemed link lets a brand-new visitor become a Member (with `referredByMemberId` set) and land in a real logged-in session; an unrecognized email verifying an ordinary magic link no longer silently creates a Member while the module is on; and any visitor can submit a message to the public inquiry inbox, visible and claimable by the recruitment-task holder.

### Phase 33 — Recruitment: application intake, evaluation & decision logic

**Goal:** the actual evaluated-admission funnel — a public application, however many evaluators the Community assigns, and a configurable mapping from what they say to what happens next.

**Scope:**
- `Community.recruitmentApplicationFormId` — a plain pointer at a Form (Phase 25), the same `postCycleFeedbackFormId` pattern already established, deliberately *not* spec's own `form.purpose` field: this codebase already has a working, tested convention for "which Form does X," and reusing it keeps one pattern rather than growing a second next to it (the same reasoning Phase 25 itself gave for reusing Question's field shape instead of inventing one). A new `submitPublicFormResponse` in `src/lib/forms.ts`, alongside the existing member-only `submitFormResponse` — applying is the one Form use case that has to work before someone's a Member at all, so it can't just be the existing function with a looser gate. A public `/apply` page renders the configured form and posts to it, reusing Phase 32's new unauthenticated-write path.
- `RecruitmentSubscription`: memberId, active, consecutiveNoAvailabilityCount. A standing opt-in (not a task claim) any qualifying member activates for application alerts and the availability tool Phase 34's scheduling needs. Auto-lapses after a community-configured N consecutive applications with no availability given (`Community.recruitmentSubscriptionLapseThreshold`), with a warm one-tap resubscribe prompt, never a penalty notice, per spec's own framing.
- `Evaluation`: formResponseId, evaluatorId, recommendation (resolved as a small enum — `proceed`/`decline`/`unsure`, since spec asks for "a recommendation" without naming its shape), notes. However many evaluators the Community assigns (`Community.recruitmentEvaluatorCount`, a plain integer, default 2) file one each; "the evaluators" are resolved as whoever currently holds the recruitment task (Phase 32), the same no-dedicated-relationship posture every other coordination role in this codebase already takes — not a separate assignment mechanism.
- The recommendation→outcome mapping: `Community.recruitmentDecisionRules` (jsonb). Resolved interpretation, since spec asks for this to be configurable without naming a concrete shape: an ordered list of `{conditions, outcome}` rules evaluated top-to-bottom, first match wins, with a required fallback rule so every combination resolves to something. `outcome` is one of `proceed`/`wider_discussion`/`decline`; `conditions` reads the filed recommendations *and*, when the applicant came through an invite link, its `inviterThinksGoodFit`/`inviterKnowsPersonally` checkboxes as additional same-mapping inputs, per spec — never a separate decision path for invited applicants.
- On submission, every member with an active RecruitmentSubscription gets alerted — this codebase's existing "visible flag surfaced on a page, not a push notification" posture, not real outbound email.

**Depends on:** Phase 32 (the public entry points and module gating this extends), Phase 25 (Forms, for the application itself).

**Out of scope:** conversation scheduling and acting on a `wider_discussion` outcome beyond recording it (Phase 34); accompaniment and rejection templates (also Phase 34); the pipeline status view (Phase 35).

**Done when:** a community with Recruitment on can designate its application Form, evaluator count, and decision rules; a non-member can submit a public application; the current recruitment-task holder(s) can each file a recommendation against it; and the Community's own decision rules resolve every recommendation combination (including invite-link checkboxes, when relevant) to a real, stored outcome.

### Phase 34 — Recruitment: conversation scheduling, wider discussion & accompaniment

**Goal:** what happens between "we have a recommendation" and "this person is fully in" — the intro call, the one real objection window, and the handoff to someone who'll actually accompany them.

**A real wrinkle worth naming up front:** Scheduling polls' participant model (Phase 19) assumes every participant is a Member — an applicant isn't one yet. Resolved interpretation: the intro-call SchedulingPoll is created in must-overlap-specific-people mode against the two evaluators as real, required Member participants, while the applicant is tracked by the contact info on their own FormResponse and sent the poll link directly — submitting blind availability the same way anyone else would, without needing a Member row to do it. A confirmed slot still requires all three per spec; "required participant" for the applicant's side means their own token-linked availability submission, not a `memberId`.

**Scope:**
- Conversation scheduling: auto-creates the SchedulingPoll above once evaluation resolves to a `proceed`-adjacent outcome (Phase 33's decision rules).
- `Objection`: formResponseId, raisedBy, note — visible only to evaluators, never the wider community, per spec. The wider-discussion window itself is a time-boxed period (`Community.recruitmentWiderDiscussionHours`) that opens on a `wider_discussion` outcome; its open/closed state and auto-resolution use the same purely time-computed, no-scheduler-job pattern Phase 31's returning-priority window and Assemblies' `computeAssemblyPhase` already established. No objection by the deadline → the recommendation auto-follows into the outcome Phase 33's rules already computed; an objection → evaluators see it and the outcome waits on a human call, not the timer.
- Accompaniment: on an outcome that resolves to acceptance, auto-creates a real Task ("Accompany [new member]"), pre-filling `suggestedMemberId` from the new member's `referredByMemberId` when set — the same "carry a shadow forward as a suggested next claimant" reasoning Phase 14 already established for succession, applied here to a referrer instead of a shadow. Claimable like any other task; no dedicated relationship table.
- Rejection templates: `Community.recruitmentRejectionTemplate` (plain text), surfaced to whoever's about to send an actual decline, never sent automatically. Resolved as a single field for v1 — a Community wanting more than one starting-point message is real but not asked for here.

**Depends on:** Phase 33 (Evaluation and the decision rules this acts on), Phase 19 (Scheduling polls), Phase 14 (the `suggestedMemberId` carry-forward precedent this reuses).

**Out of scope:** the pipeline status view tying all of this into one legible feed (Phase 35); any objection-pattern consequence tracking beyond visibility, matching this codebase's consistent no-automatic-consequence-ladder posture (Conflict management, Shifts' no-show).

**Done when:** a proceed-adjacent outcome auto-schedules a real intro call the applicant can submit availability for without an account; a `wider_discussion` outcome opens a real time-boxed window where evaluators-only can see a raised objection, auto-resolving to the original outcome if none arrives by the deadline; an acceptance auto-creates a claimable Accompaniment task pre-filled from the applicant's referrer when known; and a configured rejection template is available wherever a decline actually gets sent.

### Phase 35 — Recruitment: pipeline view & computed status

**Goal:** the payoff for building the rest of this module first — a single, computed, never-separately-maintained view of everyone currently in flight, the same "list of people and where they are" instinct the task board already gives for tasks, applied to candidates.

**Scope:**
- The computed status derivation itself, read live off FormResponse/Evaluation/SchedulingPoll/Task state, no new stored field: *applied* → *evaluation in progress* → *call pending* → *call scheduled* → *decision pending* → *accepted*/*declined*/*waitlisted* → *accompaniment assigned* — exactly spec's own state machine.
- A new `/recruitment` pipeline page, visible only to recruitment-task holders: every candidate, their computed stage, how long they've sat there, plus the Cycle's remaining capacity (Phase 31) and a composition breakdown (Tier/Branch, reusing Phase 24's own snapshot-panel composition logic) as informational context — never a scoring formula the platform applies on anyone's behalf, per spec's explicit caution.
- The "needs action" signal (evaluated-but-uncalled, called-but-undecided) surfaced on `/dashboard` for recruitment-task holders — closing Phase 24's own explicitly-deferred "recruitment-facing feed items" line.

**Depends on:** Phase 33 (Evaluation), Phase 34 (SchedulingPoll/Accompaniment linkage), Phase 24 (Dashboard, the feed item and composition-panel reuse this closes out).

**Out of scope:** a member's own onboarding-progress view once accepted — spec is explicit this is a different, non-domain-specific concern (see "Member onboarding & first session" in spec, still its own unscoped item, not part of Recruitment — don't conflate the two when this comes up next).

**Done when:** a recruitment-task holder can see every candidate currently in flight with a live-computed stage and how long they've been there, alongside the cycle's remaining capacity and composition breakdown; and stuck candidates (evaluated-but-uncalled, called-but-undecided) surface as real, concrete `/dashboard` action items rather than something a recruiter has to remember to check for.

---

## Spatial planning (Phases 36-38)

Picked back up here, in the order the user asked for on 2026-08-29, after having been paused since 2026-08-28 in favor of Forms/Budget/Event scheduling/Shifts (Phases 25-30, all now built). Nothing about the scope below needed rework as a result of the pause or this renumbering — Phases 36/37/38 map onto what were S1/S2/S3 (themselves Phase 25/26/27, originally 23/24/25), straight 1:1.

Spec calls this "the heaviest module to build" and asks for deliberate scoping rather than folding it into a generic modules slice — split into three phases along its own natural seams: the site itself, the things placed on it, then the collaborative editing rights layer. `docs/spec.md`'s Spatial planning section (including the "Cloning across cycles" and "Shared placements: invite → accept" subsections) is the source of truth for all three; re-read it before starting any of them.

**2026-08-29, later the same day — scope revised** after reviewing a comparable real-world tool (a barrio/camp placement map another Burning-Man-style organization built and open-sourced), which surfaced several concrete gaps in what was written down here: Plot/Zone/Placement are now Cycle-scoped rather than one-per-Community, with two distinct cloning paths (see Phase 36's cloning bullet and Phase 38's Cycle-creation-integration note); Plot gains optional GPS geo-anchoring for external data exchange (Phase 36); a Community-scoped shape template/inventory library (Phase 37); self-service propose→pending→approve editing extends to Task-linked Placements, not just Member-linked ones (Phase 38); the vague "draw primitives... snapping, and rotation" line is now a concrete vertex-editing and rotation-handle interaction model; and export gets a real scope-and-format choice (image or GeoJSON) instead of image-only. Snap-to-boundary/grid tooling was considered and deliberately deferred — not clearly needed yet, worth adding only once real use of the tool surfaces an actual need. None of this changes the three-phase split itself, just fills in real design detail within it.

### Phase 36 — Plot, Zones & viewer

**Goal:** the base a site gets planned against, and the SVG viewing surface everything else in this module renders onto.

**Scope:**
- `Plot`: an imported base (raster image or vector/GeoJSON) with a scale calibration (mark two points, enter the real-world distance, everything else scales off that), or a boundary drawn from scratch if there's no import. One per Cycle, not one per Community — a Community running recurring Cycles genuinely re-plans its site each time, so nothing here persists across Cycles by default (see the cloning bullet below).
- **Optional geo-anchoring**: either calibration point can carry a real GPS coordinate instead of, or alongside, the plain real-world distance, giving a similarity-transform (translate/rotate/uniform-scale) mapping between the Plot's local coordinates and WGS84. Purely opt-in metadata for data exchange (importing a boundary an external event organizer hands over as a real geo object, exporting a point for something like a power-grid connection) — not a map renderer; a Plot with no geo-anchor behaves exactly as if this bullet didn't exist.
- **Cloning a Plot's Zones from a previous Cycle**, as a standalone action independent of Cycle creation itself: geometry, category, name, and color copy over as fresh rows for the new Cycle. The picker lists past Cycles most-recent-first; that ordering gets smarter once Phase 40 (Cycle type) exists (see that phase's own note), no schema change needed either time.
- `Zone`: named polygon regions within a plot (camping area, kitchen, parking, quiet zone, …) — name, category, color, purely organizational.
- The SVG-based editing surface itself (per spec's own call: browser-native, scale-friendly, fits the mold everything else here already uses over canvas + a heavier library):
  - Render the plot's base, draw/edit Zone polygons with real-world-scaled dimensions: drag an existing vertex to move it, click an edge's midpoint to insert a new vertex there, select-and-delete to remove one.
  - A live area label at a polygon's center and a live length label on each edge, both recomputed continuously while dragging (not just after a save) — a geometry library operating on plain coordinate arrays (e.g. Turf.js), not a geospatial-specific one, handles the area/length math regardless of whether a Plot has a geo-anchor.
  - Layer/visibility toggles.
  - **Export**, scoped to a Zone or the whole Plot at this phase (Placement export is Phase 37's): a choice of image (for sharing outside the platform) or GeoJSON (real WGS84 coordinates if the Plot has a geo-anchor, local coordinates otherwise).
- Gated behind the `modulesEnabled` on/off mechanism Phase 22 builds.

**Depends on:** Phase 22 (module on/off gating).

**Out of scope:** Placements (Phase 37); automatic per-event geometry computation — spec's own confirmed direction stays no auto-computed layout regardless of the optional geo-anchor above, which is opt-in coordinate metadata for import/export, not a map-rendering system; snap-to-boundary/grid drawing tooling — worth adding later if the tool's actual use surfaces a real need, not guessed at now; any editing-rights complexity — Zones are edited directly by whoever holds the Spatial-planning task, same single-editor-with-save model spec keeps for anything unowned; the full-Cycle-clone integration described in Phase 38's own note (that one touches Phase 6's already-shipped Cycle creation flow, so it waits until the whole module — Phases 36-38 — actually exists).

**Done when:** a community with the module on can import or hand-draw a Plot for the current Cycle (optionally geo-anchored), clone a previous Cycle's Zones into a new one as a starting point, calibrate scale against a real-world distance, draw/edit Zones down to the vertex level with live area/length feedback, and export a Zone or the whole Plot as an image or GeoJSON — visible to any member, edited by whoever holds the Spatial-planning task.

### Phase 37 — Placements & space preferences

**Goal:** the actual things drawn on the site — tents, vehicles, structures, furniture — sized and positioned to real-world scale, plus the profile data that informs planning them.

**Scope:**
- `Placement`: rectangle, circle, polygon, or line shapes with real-world dimensions (not pixel size), position, rotation (set via a drag handle on the selected shape, not a typed angle), a label, a category (tent/vehicle/structure/furniture/generic — rendered color follows category, no separate stored color field, unlike Zone), and an optional link to a Task (the structure that task is building).
- `PlacementTemplate`: a small reusable-shape library, scoped to the Community — geometry, category, and label, seeded with a couple of common defaults (a standard 2-person tent, a van) and otherwise grown by saving any existing Placement into it (decoupled from the Placement it came from, no live link back). Starting a new Placement from a template pre-fills shape/dimensions/category; it's still freely resized, rotated, and repositioned afterward.
- `PlacementMember` (placementId, memberId, status): links zero or more Members to a Placement — this phase creates them already `confirmed` (the task holder places people directly, same single-editor model as Zones); the `invited` state and the accept/decline flow that actually uses it are Phase 38's.
- `SpacePreference`: a member-profile extension, only present when the module is on — sleep/space arrangement, vehicle dimensions, an optional "prefer to be placed near" list (`group_with`), an optional "sharing this space with" list (`sharing_with` — a different question from proximity, see spec), accessibility notes. Purely informational in this phase: it feeds the conversation, doesn't grant anything and doesn't auto-place anyone (that stays true even after Phase 38 — a preference alone never confirms a Placement).
- All Placement creation and editing in this phase goes through whoever holds the Spatial-planning task, same as Zones — no self-service editing by a linked Member or Task holder yet (that's Phase 38's).
- Extends Phase 36's standalone cloning action to also copy Placements: geometry/category/label/template-origin copy over, both Member and Task links are dropped (neither who's attending nor which Task instance carries a guaranteed match on this path — see Phase 38's note for the one path where a Task link *does* carry over).
- Extends Phase 36's export to include Placement as an export scope, same image/GeoJSON choice.

**Depends on:** Phase 36 (Plot/Zone/viewer foundation).

**Out of scope:** self-service editing by a Placement's own linked Member or Task holder, the propose→pending→approve/revert flow, and the invite→accept/decline flow for shared Placements — all Phase 38, since they're genuinely one coherent "who can change this and what happens when they do" layer, not three separable pieces.

**Done when:** whoever holds the Spatial-planning task can draw Placements at real-world scale (optionally starting from a saved template), rotate one via its drag handle, link zero or more confirmed Members or a Task to one, save a drawn shape into the template library and start a new one from it, clone a previous Cycle's Placements into a new one (links dropped), export a Placement as an image or GeoJSON, and any member can set their own Space preferences (visible to whoever's drawing the layout).

### Phase 38 — Collaborative placement editing

**Goal:** the distributed-editing-rights layer spec designs in real detail — self-service moves for a Placement's own linked Members or linked Task, and the invite → accept/decline flow that actually grants that right for a shared Placement.

**Scope:**
- **Propose → pending → approve/revert:** any confirmed Member linked to a Placement — or, for a Placement linked to a Task instead (no Member), whoever currently holds that Task — can move/resize/rotate it immediately (never feels blocked) — the change applies right away but flags the Placement `pending` with `pending_prev_geometry` kept for a clean revert. Whoever holds the Spatial-planning task reviews: approve locks it in as `confirmed`, revert restores the prior geometry and notifies whoever made the change, if they left a note. Three tiers of editing rights on a Placement, not two: Member-linked → its confirmed Member(s); Task-linked, no Member → whoever holds that Task (the kitchen crew adjusting their own structure without routing every tweak through the Spatial-planning holder); neither link, and every Zone regardless of any link → direct-edit-only by the Spatial-planning task holder, unchanged. Deliberately doesn't extend to a Task or Branch claiming a whole Zone's editing rights — a bigger, deliberately-deferred question, worth revisiting only if it turns out to matter in practice.
- **Every linked Member or Task holder — confirmed or still-invited, in the Member case — gets notified when a Placement they're linked to moves**, regardless of who moved it. Visibility, not a sign-off requirement.
- **Shared placements: invite → accept.** Creating or editing a shared Placement names co-occupants, added as `invited` (pre-filled from their own `sharing_with` answer or anyone else's that names them back, but not limited to that). An invited Member shows up on the Placement but has no edit rights until they act; accepting promotes to `confirmed` (full co-editor under the flow above); declining just drops them, no explanation required.
- Placements with neither a linked Member nor a linked Task (communal structures with no specific owner) and Zones keep skipping the pending state entirely — edited directly by the task holder, unchanged from Phases 36-37, since there's no other owner to protect against.
- No live push/broadcast channel — a save is visible on the next reload, the same plain request/response model the rest of the app already uses. Deliberately not a SignalR-style live-cursor/live-broadcast layer some prior art in this space builds, since the actual need here is "announce a save on a call, everyone refreshes," not simultaneous shared-canvas editing.
- **Touches Phase 6's already-shipped Cycle creation flow:** cloning the immediately-previous Cycle gains one more prompt — also clone its spatial plan? If yes, it's a genuine full clone: Tasks are already being recreated in the same operation (`cloned_from_task_id` per Task Pack's existing carry-forward), so a cloned Placement's Task link is remapped onto the new Task instance rather than dropped, since both ends were cloned together and stay meaningfully linked. Member links never carry over regardless — attendance isn't known yet at clone time. This option only exists on the immediately-previous-cycle path, the same restriction Phase 14's shadow-slot `suggested_member_id` carry-forward already established (a generic Task Pack import never drags along someone else's physical site layout). This is distinct from Phase 36/37's own standalone spatial-plan cloning, which always drops Task links since it isn't cloning the Tasks alongside them.

**Depends on:** Phase 37 (Placement/PlacementMember/SpacePreference), Phase 6 (Cycle creation's clone-previous-cycle flow, which this phase's last bullet extends).

**Out of scope:** real-time multiplayer editing of unowned Placements/Zones (spec's own resolved direction: stays single-editor-with-save-and-reload, the heavier case is real but much smaller in practice than the owned-Placement case this phase actually solves); snap-to-boundary/grid tooling, same as Phase 36.

**Done when:** a Member linked to a Placement, or a holder of a Placement's linked Task, can move it themselves, the change applies immediately as `pending`, the Spatial-planning task holder can approve or revert it, every linked Member or Task holder is notified when it moves, a member named on a shared Placement can accept (becoming a full co-editor) or decline (dropping off it) an invitation to share it, and cloning the immediately-previous Cycle offers to bring its spatial plan along with Task links intact.

---

## Phase 39 — Cycle & Phase date model

**Goal:** give Cycle and Phase a real, resolvable date spine — the shared absolute/relative date shape spec defines once and reuses for Task milestones, Freestanding events, and the Pack import date preview — so all three have an anchor to resolve against. Newly specified 2026-08-29 alongside Task milestones/Freestanding events/Calendar view (Phases 41-43 below), and the natural point to fold in since it touches the same Cycle/Phase tables Phase 40 (Cycle type) also touches.

**Scope:**
- `Cycle.start_date`/`end_date` (both nullable date columns) — never required to start a cycle; a cycle missing them isn't blocked, it just gets a visible, ongoing flag wherever something needs them to resolve (Phase auto-placement, relative milestones/events, the Pack import preview).
- `Phase` gains the full per-boundary shape spec's data model lays out, replacing the plain `start_date`/`end_date` columns Phase 6 shipped: `{start,end}_date_type` (absolute/relative), `{start,end}_date` (resolved value — authoritative only in absolute mode), `{start,end}_relative_mode` (offset/percent), `{start,end}_offset_anchor` (cycle_start/cycle_end), `{start,end}_offset_days`, `start_percent`/`end_percent`. A real migration of existing Phase rows: every phase built since Phase 6 has a plain date today and needs to land as `absolute` with that date preserved, not lost.
- A shared resolution helper (e.g. `src/lib/dates/resolve.ts`) that, given an anchor's current start/end and a relative-mode record, computes the live date — used here for Phase boundaries and reused as-is by Task milestones (Phase 41) and Freestanding events (Phase 42), not reimplemented per consumer.
- **A real, deliberate exception to this codebase's usual "never persist derived state" posture, worth flagging explicitly:** `src/lib/contribution.ts` and `src/lib/attention/job.ts` already do plain `SELECT`s against `phase.startDate`/`phase.endDate` expecting a real date column, not a live computation. Relative mode's resolved value has to stay eagerly cached in those same columns — recomputed on every write that could move it (the anchor's own date changing, or this row's own mode/offset/percent changing) — rather than computed lazily at read time the way Assemblies'/Recruitment's/Dashboard's own derived state all work. This is spec-directed (the data model explicitly calls `phase.start_date`/`end_date` "resolved and cached... always recomputed live from the relative fields," never a bare date), not a new precedent to reach for elsewhere without the same justification.
- The soft "this drifted closer to the other boundary than the one it's anchored to" flag spec calls out for offset-mode items — surfaced wherever a relative item's resolved date renders; not a blocking validation, `percent`-mode items are structurally immune to it.
- Editing UI for a relative item: type a new offset/percent directly, or drag it to a new date on a calendar-style control — either path recomputes and persists the offset/percent, never a bare date.

**Depends on:** Phase 6 (Cycle/Phase — this phase migrates its existing tables).

**Out of scope:** Task milestones, Freestanding events, and the Calendar view itself (Phases 41, 42, 44); the Pack import date preview UI (Phase 44, once milestones/events exist to preview too — this phase only needs Cycle/Phase dates to be resolvable, not previewed); any change to Phase auto-placement's own logic beyond having real dates to place against.

**Done when:** a Cycle can carry optional start/end dates, a Phase boundary can be set absolute or relative (offset or percent, anchored to either cycle boundary) with its resolved date recomputing live as the anchor moves, existing Phase rows migrate cleanly to `absolute` with their current dates preserved, `contribution.ts`'s and `attention/job.ts`'s existing plain reads of `phase.startDate`/`endDate` keep working unchanged against the cached resolved value, and the "drifted toward the other boundary" flag surfaces on an offset-mode item when relevant.

---

## Phase 40 — Cycle type

**Goal:** let a Community group its Cycles into named types — Season, Reunion, Workday, whatever distinction actually matters to them — mainly so a Tier criterion can count occurrences of one *kind* of cycle without a lighter gathering padding the number.

**Scope:**
- `CycleType`: id, communityId, name, defaultPackId (nullable) — a label plus an optional suggested starting pack, a nudge never enforced, the same posture Task Pack already takes everywhere else.
- `Cycle.cycleTypeId` (nullable FK → CycleType) — the exact column `cycle.ts`'s own schema comment has flagged as deferred since Phase 6 ("not yet included ... until Cycle type gets built").
- `Tier.criterionType` gains `cycle_type_count` — the fifth value the enum has been scoped for since Phase 1, unused until now: "had Participation `coming` in at least N Cycles of a given Cycle type," computed live off Phase 31's Participation table joined through `Cycle.cycleTypeId` — the same live-computed-not-stored posture every other Tier criterion already takes, not a new pattern.
- A `/settings` UI for defining Cycle types and picking one (or none) when starting a new Cycle.
- Once this phase exists, Phase 36's standalone spatial-plan cloning picker (see that phase's own note) starts defaulting to the most recent Cycle *of the same type* as the one being planned, instead of just the most recent Cycle overall — a query-only change on top of Phase 36-38's existing tables, no schema addition needed on either side.

**Depends on:** Phase 31 (Participation — what `cycle_type_count` actually counts), Phase 6 (Cycle), Phase 9 (Tier CRUD, extended with the new criterion type). Independent of Phase 39 despite both touching the Cycle table — sequenced right after it purely so the two adjacent Cycle-schema changes land back to back, not because either needs the other.

**Out of scope:** anything beyond the label-plus-suggested-pack-plus-counting-criterion shape spec itself asks for — no richer typing system, no enforcement of a type's suggested pack.

**Done when:** a community can define named Cycle types with an optional suggested pack, tag a Cycle with one at creation, and define a Tier whose criterion counts how many Cycles of a given type a member has had Participation `coming` in — computed live, matching every other Tier criterion.

---

## Phase 41 — Task milestones

**Goal:** let a task carry zero or more user-labeled dates ("deposit due," "order arrives"), using Phase 39's shared date shape and reusing Phase 38's propose→pending→approve pattern for who can add one to someone else's task rather than inventing a fourth confirmation model.

**Scope:**
- `TaskMilestone`: task_id, label (free text, no fixed category list — same "no fixed category list" precedent as Resource tags or Requirement's `custom` type), Phase 39's shared date shape (date_type/relative_mode/offset_anchor/offset_days/percent), status (confirmed/pending), added_by, confirmed_by (nullable).
- A phase-anchored milestone's Phase defaults to the task's own but can point elsewhere (e.g. a Recruiting-phase task carrying a milestone tied to Build's start); it should belong to the same Cycle as the task's own, except when the task has no Cycle at all. A cycle-anchored milestone needs no Phase at all — it resolves off the task's own Cycle (works even with phases off) and simply doesn't resolve if the task has no Cycle.
- **Confirmation follows ownership**, reusing Phase 38's exact `isPlacementEditor`-style pattern rather than reinventing it for a fourth time: the task's current holder (any co-holder on a multi-slot task, no rank) adds/edits/removes a milestone directly; anyone else's addition applies and shows immediately but lands `pending` until a current holder confirms or rejects it (rejecting just removes the row); an unclaimed task has no holder to gate against, so any addition lands `confirmed` immediately — same reasoning Placements/Zones with no linked Member already use.
- **Carrying forward:** only relative milestones travel through a Task Pack (a pack is timeless, so an absolute milestone can't meaningfully export — the deliberate trade spec names for pinning a date to the real world); a cloned task simply starts without one that didn't carry over.
- New Milestones section on the task detail page, alongside the existing wiki/comments/resources.

**Depends on:** Phase 39 (date model, resolution helper), Phase 38 (the propose→pending→approve pattern this reuses), Phase 8 (task detail page).

**Out of scope:** the Calendar view surfacing these (Phase 44); wiring `next_checkin_at`-style Waiting nudges off an upcoming milestone — spec names this as a real but explicitly deferred future hook, not something this phase builds.

**Done when:** a task's current holder can add/edit/remove a milestone directly; anyone else's addition shows immediately but needs a holder's confirmation or is dropped on rejection; an unclaimed task's additions confirm immediately; a relative milestone's resolved date tracks its anchor (a Phase or the task's own Cycle) as that anchor moves; and only relative milestones carry through a Task Pack export/clone.

---

## Phase 42 — Freestanding events

**Goal:** a personal or shared calendar entry that isn't about any one task — "applications close," "the potluck" — owned solely by its creator, using Phase 39's date shape and reusing Phase 38's invite→accept pattern rather than a fifth version of it.

**Scope:**
- `CalendarEvent`: community_id, member_id (creator, sole owner — no authority-based confirmation gate the way Branch creation by non-Admins has, and no "confirmed community-wide" state to be promoted into), cycle_id (nullable — null = cycle-independent, shown in the Calendar view's Community-wide bucket), share_target (personal/branch/community), shared_branch_id (nullable), title, description, Phase 39's shared date shape anchored to the cycle only (never a Phase — a Phase-scoped date belongs on a TaskMilestone instead).
- `CalendarEventInvite`: event_id, member_id, status (invited/confirmed/declined), invited_by, invited_at, responded_at — one row per invitee, mirroring `PlacementMember`'s invited/confirmed shape exactly. Sharing generates these by inviting an individual by hand, or bulk-inviting a whole Branch's current roster or the whole Community in one action.
- Only the creator can ever edit, delete, or invite more people — and can do so at any time, not just at creation; there's no approval step anywhere in this flow for anyone.
- Each invitee accepts or declines for themselves: accepting is what actually puts it on their own calendar; declining just drops it, no explanation required — same as declining a Placement invite. A still-pending invite surfaces on the Dashboard awaiting a response, same as an invited-but-unconfirmed Placement already does.
- A create/manage surface for a member's own events plus responding to pending invites (folds into the Calendar view, Phase 44, rather than a separate page).

**Depends on:** Phase 39 (date model), Phase 38 (the invite→accept pattern this reuses).

**Out of scope:** the aggregated Calendar view itself (Phase 44) — this phase covers creating, sharing, and responding to events, not the community-wide read surface that plots everything together.

**Done when:** any member can create an event (optionally cycle-scoped), share it with an individual, a Branch's current roster, or the whole Community (fanning out one invite per invitee), each invitee can independently accept (landing on their own calendar) or decline (dropping it, no explanation needed) it, the creator can invite more people at any time, and a pending invite shows on the Dashboard.

---

## Phase 43 — Navigation shell & Tailwind adoption

**Goal:** replace the placeholder flat `Nav` (a single inline-styled row of ~25 links, unscoped by module or permission) with a real, scalable shell — a collapsible icon-rail on desktop, a hamburger drawer on mobile, grouped/nested by function, and reusing every module's own existing enablement/holder checks so the nav itself can never drift out of sync with what a member can actually see or do. First real UI/styling pass since Phase 0 — nothing about look-and-feel had been decided before this. Picked up ahead of the already-scoped Phases 44-46 below since it's cross-cutting UI infrastructure every future page benefits from, not a spec.md module — there was no reason to make it wait behind them.

**Scope:**
- Tailwind CSS v4 adopted project-wide (`postcss.config.mjs`, `src/app/globals.css`). Convention going forward: use the numeric default spacing/color scale directly (`p-4`, `gap-8`, ...) rather than inventing semantic aliases; treat an arbitrary-value class (`p-[13px]`, `text-[#3a3a3a]`) as a smell worth a second look, since it bypasses the one shared scale that keeps pages built months apart looking consistent; pull a repeated visual pattern into a shared component (as this phase does for every nav element) rather than re-typing the same class string on multiple pages.
- All ~26 authenticated route folders moved under a new `src/app/(app)/` route group (URLs unchanged). `src/app/(app)/layout.tsx` is now the one place that calls `getCurrentMember()` + redirects to `/login`, computes nav context, and mounts the shell — replacing the individual `<Nav memberName={...} />` line every one of those ~26 pages used to render for itself. Public/unauthenticated routes (`/login`, `/invite/[token]`, `/inquiry`, `/apply`, `/intro-call/[token]`) deliberately stay outside the group, unauthenticated and shell-free. **New authenticated pages belong under `src/app/(app)/` going forward**, not directly under `src/app/`.
- `src/lib/nav.ts`'s `getNavContext(actor)` is the nav's only data source. Module visibility reuses `isModuleEnabled` (Phase 22) directly; per-item auto-pinning reuses each module's own existing holder check as-is — `isCoordinationHolder`, `isRecruitmentTaskHolder`, `isEventSchedulingOwner`, `isBudgetOwner` + `getCurrentBudgetCycle`, `isShiftCoordinator` + `listShiftSeries`, `isSpatialPlanningHolder` — plus one new small `holdsTask()` helper for the two Community-level pointers that had no existing exported check (`conflictTeamTaskId`, `feedbackReviewTaskId`). No second permission system, no new schema: whoever currently holds one of these gating tasks gets that module auto-pinned to the top of the nav; everyone else finds it nested under "Modules." Manual pin-it-yourself is explicitly deferred (see Out of scope).
- `src/components/nav/nav-config.ts` is the static source of truth for grouping (Tasks / Calendar / Community / Modules). **Add new nav destinations here** — gated by `moduleKey` (checked against `NavContext.visibleModules`) or `coordinatorOnly` as needed — rather than hand-adding a link to individual pages.
- `src/components/nav/AppShell.tsx` — the shell itself: collapsible desktop rail (icon-only ↔ labeled+grouped, state kept in `localStorage`, no server round-trip), a mobile hamburger drawer, active-route highlighting, an unread-style badge on Dashboard (count from the existing `getPersonalFeed`, no new notification schema), and a user block (name + logout) pinned to the bottom of the rail below Settings. This is the second deliberate client-JS component in the codebase — the same kind of exception Scheduling polls' grid (Phase 19) already established; everything else stays server-rendered.
- `getPersonalFeed` (`src/lib/dashboard.ts`) and `getCurrentMember` (`src/lib/session.ts`) wrapped in React's `cache()` — both are now called once by the shell layout and again by whichever page needs the full detail; `cache()` dedupes that to one query set per request instead of two.

**Depends on:** nothing structurally new — layers over every route that exists through Phase 42. Independent of Phase 44 and Phases 46-47 below (Phase 45 builds on this one directly, see its own "Depends on").

**Out of scope:** migrating the ~26 existing page bodies off their own inline `style={}` props — every page keeps working exactly as before and moves to Tailwind opportunistically as it's next touched, not as a retrofit pass. Manual per-member pinning (only auto-pin-by-task-holdership shipped this phase) — would need one new preference field, small enough to be its own fast-follow if auto-pin alone doesn't cover it. A hover-flyout submenu for a group's other items while the rail is collapsed (collapsed mode links straight to the group's first item instead, same as the group's own icon). Per-group collapse/accordion inside the expanded rail (every visible group renders fully open, no nested toggle).

**Done when:** every authenticated route renders inside the collapsible/hamburger shell instead of the old flat bar; a module disabled via `Community.modulesEnabled` (or an unset `conflictTeamTaskId`/`postCycleFeedbackFormId`) doesn't appear in the nav at all; a member holding the gating task for Budget/Shifts/Recruitment/Event scheduling/Conflict reports/Feedback/Spatial planning/Coordination sees it auto-pinned; the Dashboard nav item shows a live badge count matching the personal feed; and the mobile drawer and desktop collapse-to-icons both work end to end in the browser, in both directions.

---

## Phase 44 — Calendar view & date previews

**Goal:** the payoff view — one Community-wide calendar reading every dated thing that already exists across the app as its own layer, same "one database, many lenses" posture as every other View, plus the Pack-import date preview spec names as a natural extension of the same resolved-date machinery.

**Scope:**
- `/calendar`: reads Phase boundaries (Phase 39), TaskMilestone (Phase 41), and CalendarEvent (Phase 42 — respecting share_target and invite status, so a personal event only shows for its creator and a declined invite drops out) as its own layers, plus read-only layers off Input rounds' cutoffs, Assemblies' notice/voting windows, Scheduling polls' deadlines, and Event scheduling's confirmed slots (Phases 17/18/19/28 — no schema or scope changes to any of them, this view just reads what's already there).
- `ProfileQuestion.responseType` (Phase 16's schema) gains a `date` option — its only real consumer here is an opt-in birthday surfaced as its own Calendar layer, visible per whatever visibility the answering member already controls for their profile answers.
- The Pack import review screen (Phase 6/7's existing clone/import flow) gains the date preview spec names: calendar or list view, toggled by the reviewer, showing every phase's resolved dates and every task's resolved milestone dates against the *destination* cycle's own start/end, before anything commits — reuses Phase 39's resolution helper and Phase 41's milestone data as one more pane in the existing staging step, not a new gate. List mode collapses by phase, denser than the grid.

**Depends on:** Phase 39 (date model), Phase 41 (Task milestones), Phase 42 (Freestanding events), Phase 16 (Profile questions — extended), Phase 6/7 (Pack import/clone flow — extended).

**Out of scope:** any change to the underlying mechanics of the phases/modules this reads from — a read layer only, same as every other View.

**Done when:** a member can open one Calendar view showing Phase boundaries, their own task milestones and calendar events, any module deadline that already exists elsewhere in the app, and (if answered) their own opted-in birthday — and the Pack import screen shows a real date preview against the destination cycle before a clone or import commits.

---

## Phase 45 — Nav reorganization & pinning (personal and phase-linked)

**Goal:** Phase 43's nav shipped with a flat "Calendar" group and three separate Recruitment entries — reasonable guesses before Phase 44's actual Calendar view and its cycle-creation UI existed, wrong once they did. This phase corrects the grouping in light of what actually got built, and adds two new ways a nav item ends up pinned beyond Phase 43's own auto-pin-by-task-holdership: a member pinning something themselves, and a Phase declaring "pin this module for everyone coming while I'm current."

**Scope:**
- Nav regrouping (`src/components/nav/nav-config.ts`): **Calendar** is now a single top-level item beside Dashboard/Settings, not a group — `/calendar` (Phase 44) is a read-only aggregating view with no sub-pages of its own, structurally different from things that have a real working surface. **Scheduling polls** and **Input rounds** moved into **Tasks** (both are core coordination mechanics tied directly to tasks, not calendar content). **Event schedule** and **Shifts** moved into **Modules** (both already module-gated, joining Budget/Recruitment/Spatial planning on the same footing). **Recruitment**, **Invites**, and **Applications** collapsed into one **Recruitment** nav entry — the latter two stay real pages, just reachable from within Recruitment itself rather than separately nav-linked. **Community** gained **Cycles**, pointing at `/participation` — the community's relationship to cycles over time (history, current-cycle composition/participation stats), with a member's own participation declaration as one part of that picture rather than a separate destination, distinct from Calendar's when-things-happen dates.
- Collapsible nav group headings (`AppShell.tsx`): every group label (including "Pinned for you") is now a button with a chevron that shows/hides its item list, state kept in `localStorage` per group key — separate from Phase 43's collapsed-to-icons rail state, which this doesn't touch.
- Manual pinning: `Member.pinnedModuleKeys` (text array, default empty) — a hover-revealed pin button on every item inside a nav group, toggled by `toggleFavoriteNavItem` (`src/app/(app)/nav-actions.ts`), a Server Action called directly from the client component rather than through a `<form action>`, followed by `router.refresh()` to pull fresh nav state. No authorization gate beyond being a member — pinning is a personal preference, not access to anything. A stale key (a since-disabled module, a coordinator-only item after losing that status) is filtered against current visibility at render time, same "silently drops, no cleanup needed" posture the rest of this pinning system already takes.
- Phase-linked pinning: `Phase.highlightModuleKey` (nullable text) — while a Phase is the *current* one (reusing `getCurrentPhase`, `src/lib/profile-questions/capacity.ts`, already established for Availability's phase-scoped question rather than a second "what's current" resolution) and a member's `Participation.status` for that Cycle is `coming`, its highlighted module gets pinned for them too — e.g. Recruitment during a Recruitment-named phase, so non-holders can still track progress and invite people; Shifts once sign-ups matter, ahead of the event. Configured via a small new form on `/participation`'s existing per-Phase card (`updatePhaseHighlightAction`), same `requireCycleInitiationEligibility` authority gate as every other Phase/Cycle-configuration write. Never bypasses `Community.modulesEnabled` — only promotes an already-visible module into the pinned section.
- `NavContext.pinnedKeys` (task-holdership auto-pins, phase-linked pins, and manual pins) and `NavContext.manualPinnedKeys` (raw, for the pin button's own toggled/not-toggled state) are now the two lists `AppShell.tsx` reads — a nav item can end up in "Pinned for you" for any of three independent reasons, all just contributing to the same list.

**Depends on:** Phase 43 (the nav shell and auto-pin mechanism this extends), Phase 44 (Calendar view — the reason Calendar drops out of being a group), Phase 39 (Cycle & Phase date model — `getCurrentPhase`'s resolution), Phase 31 (Participation — the `coming` signal phase-linked pinning gates on).

**Out of scope:** any change to Invites'/Applications' own pages — only their nav-level visibility changed, not their functionality. A richer "which modules should a Phase highlight" UI beyond a plain dropdown (e.g. multiple modules per phase) — one `highlightModuleKey` per Phase for now, extensible later without a breaking change if a real need for more than one surfaces.

**Done when:** the nav renders the regrouped shape end to end; every group heading (and "Pinned for you") collapses/expands independently and remembers its state; a member can pin and unpin any group item themselves and see it reflected in "Pinned for you" immediately; and a Phase configured with a highlighted module correctly pins that module for a `coming` member holding no gating task at all, verified live against a real Postgres.

---

## Phase 46 — Member contact & privacy: consent, contact visibility & emergency access

**Goal:** close two long-deferred gaps spec groups under one "core, not optional" data-model section — contact-method visibility (explicitly deferred since Phase 2) and a real consent framework gating Sensitive data (Phase 22) — plus the vital-interests-basis emergency access spec deliberately keeps outside that consent framework. Newly specified 2026-08-30.

**Scope:**
- `ContactMethod`: member_id, type, value, visibility (everyone/task_or_group_mates/emergency_only) — member-controlled per method. The screen that sets a method to emergency-only states plainly what that means (any member can invoke it, both parties are notified, it's logged) — that transparency is doing the informed-choice work consent does elsewhere.
- `EmergencyAccessLog`: activated_by, target_member_id, explanation (nullable — can be added after the fact, doesn't block activation), activated_at. Any member can activate emergency access on another member's emergency-only contact info; both parties get notified; every activation is logged. Runs on GDPR Art. 6(1)(d) vital-interests basis, deliberately outside the consent machinery below — no `ConsentRecord` gates it, and none should ever be added (an emergency feature that could silently stop working because a consent flag lapsed defeats the point).
- `ConsentPurpose`: community_id, key (e.g. sensitive_health, sensitive_dietary, sensitive_orientation, photo_publication, marketing_comms), label, notice_version, notice_text, requires_explicit (true for anything gating an Art. 9 field) — one row per distinct purpose needing its own consent. Ordinary/operational processing (task history, availability) gets no row here at all — admin-gated CRUD, same posture Forms/SensitiveFieldAccessRule already established.
- `ConsentRecord`: member_id, purpose_id, notice_version (denormalized at grant time, so a later edit to the purpose's wording doesn't retroactively rewrite history), granted_at, withdrawn_at (nullable), method (explicit_action/form_submission/…). `withdrawn_at = null` means currently active; a member can have several rows over time for the same purpose (grant → withdraw → re-grant).
- **Wires into Phase 22 directly:** turning on any Sensitive-data field for a member now requires an active, non-withdrawn `ConsentRecord` against the matching `ConsentPurpose` before the field populates or shows to anyone — `SensitiveFieldAccessRule`'s existing task/tier gating stays on top of this, not replaced by it. Withdrawing consent has to actually revoke access (re-checked at read time, not just flagged at grant time) — a real gap to get right, since Phase 22 shipped with no consent check at all.
- Member-facing consent grant/withdraw UI at the point a gated field is first populated (e.g. filling in a health condition prompts the matching consent first, not a separate settings screen visited in advance).

**Depends on:** Phase 22 (Sensitive data — extended), Phase 2 (Member/contact — extended). Independent of Phases 39-45 above; there's no reason it couldn't have been picked up in any order relative to them.

**Out of scope:** any change to Emergency access's legal basis or a `ConsentRecord` gate on it — spec is explicit this stays ungated; a general-purpose consent-and-privacy-notice content-management system beyond what `ConsentPurpose`'s own fields already carry; a stricter-than-Admin governance gate on `ConsentPurpose` CRUD (spec's own principle that purpose/means data decisions belong to the Community's board or an Assembly, not whoever holds the sysadmin task — worth revisiting once `/settings` access tiers grow beyond Phase 13's plain Admins gate, not assumed now).

**Done when:** a member can set each contact method's visibility (including emergency-only, with clear inline copy about what that means), any member can activate emergency access on another's emergency-only method with a logged, both-parties-notified activation, a Community can define `ConsentPurpose` rows, a member can grant or withdraw consent against one, and a Sensitive-data field genuinely stops showing the moment its backing consent is withdrawn — verified live, not just flagged in the row.

---

## Phase 47 — On-site mode

**Goal:** the "physical/on-site mode" row spec gives a single sentence to ("governs shift-lock / read-only-reference / resync behavior") — real design resolution happens in this scoping pass, the same way Shifts/rota's own scoping pass had to turn a bare-sentence spec into concrete mechanics.

**Resolved interpretation, since spec names the three effects without defining any of them:**
- **Shift-lock** — while `Community.onsiteModeEnabled` (already in the schema since Phase 1, unused) is true, structural/configuration changes are blocked: `/settings` (branches, tiers, cycle/phase structure, modules, every pointer field), starting a new Cycle, and Requirement CRUD all reject with a real, visible error instead of silently degrading. Everything an event actually runs on stays fully live — task claim/release/finish, wiki/comments/resources, Shift sign-up/withdraw/completion, coordination mechanics — nothing about *doing the work* freezes, only *reshaping what work exists*.
- **Read-only-reference** — resolved narrowly, not as a separate mode: while on-site mode is on, further edits to the published Event schedule (Phase 28 — no new publish, no un-publishing) and the Spatial planning layout (Phases 36-38 — Placement/Zone edits, including the propose→pending→approve/revert flow) are blocked, since re-arranging the physical plan or the programme mid-event is exactly the kind of change this mode exists to prevent. Everything else stays exactly as readable/writable as it already was.
- **Task milestones and Freestanding events (Phases 41-42) stay unaffected on purpose** — personal/task-level dates, not structural or programme-level ones, so on-site mode doesn't lock them; only the published Event schedule and the Spatial-planning layout do, per the bullet above. Worth stating explicitly now that those phases exist, so a future session doesn't read the silence as an oversight.
- **Resync — explicitly out of scope for v1.** Real offline-first behavior (a service worker, local caching, conflict-resolving sync on reconnect) is genuinely disproportionate to everything else in this codebase, which assumes a live connection throughout and has deliberately avoided client-side complexity everywhere else (Scheduling polls' grid is the one deliberate exception). "Resync" in v1 means exactly what it already means for the rest of this app: if a request fails, retry it once the connection's back — no special handling, no scope creep into building a PWA. Worth revisiting if a real deployment's connectivity genuinely needs it, not guessed at now.

**Scope:**
- Wire up the existing `Community.onsiteModeEnabled` toggle on `/settings`, gated by `phasesEnabled` per spec's own table ("only offered if phases are on").
- The shift-lock and read-only-reference checks above, added at the Server Action/API layer of each affected surface.
- A visible, community-wide banner when the mode is active, so nobody's confused about why a settings save just failed.

**Depends on:** Phase 6 (phasesEnabled), Phase 28 (Event scheduling, for the schedule-lock surface), Phases 36-38 (Spatial planning, for the layout-lock surface).

**Out of scope:** resync/offline behavior (see above); any per-Cycle granularity — this is a Community-wide toggle, matching the existing schema field exactly, not a new per-Cycle concept.

**Done when:** a community with phases on can enable on-site mode from `/settings`; while it's on, settings/branch/tier/cycle-start/Requirement changes and further Event-schedule/Spatial-planning edits are all rejected with a clear reason, while task/wiki/comment/shift/milestone/calendar-event actions keep working exactly as before; and turning it back off restores normal editing immediately.

---

## 2026-09-02 — Phases 48-56 scoped: gap-analysis batch

Scoped cold this session by re-reading `docs/spec.md` and `docs/development-plan.md` in full against the actual codebase (not against memory of either), specifically hunting for two kinds of hole: real inter-module wiring that got missed because a later module never reached back to extend an earlier one, and the big spec-defined areas the old "Beyond Phase 47" section below named but never turned into real phases. Every gap below was confirmed by reading the actual source, not assumed from the docs:

- **Recruitment's own acceptance path is a dead end** — `src/lib/recruitment/decisions.ts`'s own comment says so directly: an outcome that resolves to acceptance never creates a real Member. Combined with Phase 32's own auth change (an unrecognized email gets turned away once Recruitment is on), an "accepted" candidate today has no path to becoming a logged-in Member at all unless someone separately hands them an invite link. `RecruitmentSubscription.consecutiveNoAvailabilityCount` is similarly dead — initialized to 0, never incremented anywhere. **Phase 48.**
- **Dashboard (24) and Calendar (44) both stopped extending after a few modules.** Recruitment, Spatial planning, Calendar events, and Emergency access each got wired into Dashboard's personal feed as they landed (see each phase's own note above); Budget (26-27), Event scheduling (28), Shifts (29-30), and Conflict management (21) never did, despite spec's own Dashboard text naming "Spatial-planning **or other module reviews**" generically. Calendar likewise never picked up Shifts' or Budget's own dated moments, despite both predating Phase 44. **Phase 49.**
- **`Requirement.mode`'s `group_coverage`/`soft_priority` values have done nothing since Phase 5** — confirmed directly in `src/lib/tasks/requirements.ts`'s own comment ("MVP scope only enforces individual_gate"). Spec gives both real design detail (a live coverage status line, a surfacing boost in "what fits me") that none of the other 42 phases since ever picked back up. **Phase 50.**
- **Notifications & communications is entirely unbuilt** — confirmed by grep, there's no nomination/response/auto-release mechanism anywhere in the codebase. Split along spec's own three pieces: the nomination-and-one-click-response mechanic and the shared action-token infrastructure it needs (**Phase 51**), the engagement-record pattern-tracking that reads off it plus this codebase's existing nudge/read-tracking mechanisms (**Phase 52**), and the two remaining outbound-message tiers (**Phase 53**).
- **Support/View-as is entirely unbuilt** — Conflict management (Phase 21) already pre-committed to respecting it once it existed; nothing since has built it. **Phase 54.**
- **Task Packs never grew past the one clone-previous-cycle path** — Phase 6's export/import logic already does the real work internally; this phase gives it a real, standalone, shareable `TaskPack` row instead of only ever running inline. Also closes Phase 40's own flagged `CycleType.defaultPackId` gap. **Phase 55.**
- **Member onboarding & first session was never picked up** — the one MVP-scope item that's sat completely unscoped this whole time. Timely now that Phase 48 means an accepted Recruitment applicant is finally a real Member with a genuine first session to have. **Phase 56.**

Real dependency shape for this batch: 48 needs 32-34 (Recruitment) and 2 (Member/MemberIdentity shape); 49 needs 21, 24, 26-30, 44; 50 needs 5 and 14 (shadow exemption); 51 needs 2 (SMTP relay) and 15 (declined-request precedent); 52 needs 51, 10, 19, and 48 (a real Member for Accompaniment to read a record for); 53 needs 2, 15, 31, and reuses 51's outbound-email plumbing (not its action-token machinery); 54 needs 21 (the recusal exception it must respect) and 46 (EmergencyAccessLog's logging pattern); 55 needs 6, 39, 41, 15, and closes 40's gap; 56 needs 2, 16, 24, 50, and works best (though not exclusively) after 48. Not a strict 48→56 order otherwise — pick per each phase's own "Depends on."

---

## Phase 48 — Recruitment: applicant→Member conversion & subscription lapse

**Goal:** close two real gaps flagged in passing during Recruitment's own build (see Phases 33-34's notes above) but never turned into scoped work — an accepted applicant never actually becomes a Member, and the subscription auto-lapse spec describes has no trigger wired to it.

**Scope:**
- `recordDecisionIfReached`'s `proceed` path (`src/lib/recruitment/decisions.ts`) gains a real conversion step: on an outcome resolving to acceptance, create a real `Member` row (communityId; name and `MemberIdentity.loginEmail` sourced from the application FormResponse's own fields; `referredByMemberId` from the linked invite's creator when known, same precedent Accompaniment's own `suggestedMemberId` pre-fill already established) — the same two-row Member/MemberIdentity shape `findOrCreateMemberByEmail` already creates for an ordinary magic-link signup, just triggered from here instead.
- **Resolved interpretation, since a Form's fields are opaque to the platform** (spec's own test in the Forms section): the recruitment application Form needs one field each tagged as the applicant's name and email — a small `isNameField`/`isEmailField` flag on `Form.fields`, set when defining the application form on `/settings`. An application Form missing either tag can still exist for a Community; conversion just can't run for it, and the decision records exactly as it does today with no Member created — a real, visible limitation (surfaced on the Accompaniment task's own description), not a silent failure.
- The new Member's first login is an ordinary magic link to the email captured on their FormResponse — no separate "welcome" flow needed here (see Phase 56 for what that first session actually looks like).
- `RecruitmentSubscription.consecutiveNoAvailabilityCount`: `Community.recruitmentSubscriptionLapseThreshold` already exists in the schema and on `/settings` (added ahead of its own consumer, per that phase's own scope note) — this phase is what finally reads it. **Resolved interpretation of an under-specified spec mechanic:** spec's one sentence ("auto-lapses after N consecutive applications with no availability given") reads most naturally against the intro-call SchedulingPoll (Phase 34) each subscriber is expected to weigh in on, not against evaluators specifically (evaluators are resolved separately, as whoever holds the recruitment task — Phase 33's own posture, unrelated to subscription). Every subscriber gets pinged when an intro-call poll opens (the same "every active subscriber alerted" posture Phase 33 already established for new applications); one who never submits an `AvailabilityEntry` before that poll confirms gets their count incremented by one, reset to 0 the moment they do submit for any later poll. Hitting the threshold sets `active = false` with a one-tap resubscribe prompt, never a penalty notice, per spec's framing.

**Depends on:** Phase 33 (Evaluation/decision rules), Phase 34 (the intro-call SchedulingPoll this reads), Phase 32 (referredByMemberId/invite-creator precedent), Phase 2 (the Member/MemberIdentity shape being replicated).

**Out of scope:** a general "convert any FormResponse into a Member" primitive — stays specific to the recruitment application Form's own tagged fields; retroactively converting an already-accepted applicant from before this phase (a one-off data-fix, if ever needed, not this phase's Done-when).

**Done when:** a recruitment application Form's name/email fields can be tagged; an outcome resolving to acceptance creates a real, loggable-in Member from those fields, with a visible fallback when the form isn't tagged; a subscriber who skips giving availability for an intro-call poll sees their count increment, sees it reset on a later submission, and auto-lapses (with a resubscribe prompt) once the configured threshold hits.

---

## Phase 49 — Dashboard & Calendar: module-coverage gap

**Goal:** Recruitment, Spatial planning, Calendar events, and Emergency access each got wired into Dashboard's personal feed the moment they landed; Budget, Event scheduling, Shifts, and Conflict management never did, despite spec's own Dashboard text meaning to cover all of them ("...Spatial-planning **or other module reviews** awaiting their approval if they hold that kind of task"). Calendar likewise never picked up Shifts' or Budget's own dated moments, despite both predating Phase 44.

**Scope:**
- `src/lib/dashboard.ts`'s `getPersonalFeed` gains four new needs-action sources, each gated and computed only for the relevant holder — the same posture `listRecruitmentActionItems` already established, never a community-wide list:
  - **Budget** — for the current `BudgetCycle`'s `ownerTaskId` holder: `proposalDeadline` passed but still `proposals_open` ("close proposals to voting"); `voting` status with no `confirmedProposalIds` yet ("confirm the funded set"). For any member: `voting` status with no `BudgetVote` row from them yet ("cast your vote").
  - **Event scheduling** — for `eventSchedulingOwnerTaskId`'s holder: any `EventProposal` with `status = 'conflict'`, or `status = 'proposed'` with no `confirmedSlot` set.
  - **Shifts** — for whoever `isShiftCoordinator`s a non-archived series: any `ShiftOccurrence` past `endsAt` with a `signed_up` (not `completed`/`no_show`) signup still open. For any member: their own past `signed_up` shift (mirroring the existing self-mark-completed prompt already on `/shifts`).
  - **Conflict management** — for a non-excluded `conflictTeamTaskId` holder: any `open` `ConflictReport` past the community's acknowledgment window — reusing `listConflictReports`' own invisibility-guarantee query exactly as it exists today, never a second, unfiltered path.
- `src/lib/calendar/view.ts`'s `getCalendarView` gains two new entry kinds, following the exact read-only pattern every existing source already uses: `shift_occurrence` (the actor's own upcoming `signed_up` occurrences, via `listMySignupsWithOccurrence`) and `budget_deadline` (the current `BudgetCycle`'s `proposalDeadline` while `proposals_open`), visible to every member the same way `/budget` itself already is.

**Depends on:** Phase 24 (Dashboard), Phase 44 (Calendar), Phase 21 (Conflict management), Phase 26-27 (Budget), Phase 28 (Event scheduling), Phase 29-30 (Shifts).

**Out of scope:** any new schema — every source read here already exists; a "Modules" summary tile beyond the existing composition/Branch-health panel.

**Done when:** a Budget owner, Event-scheduling owner, Shift coordinator, and Conflict-team holder each see real, live needs-action items on `/dashboard`, the same way a Recruitment- or Spatial-planning-task holder already does; a member's own upcoming signed-up shift and the current Budget cycle's deadline both appear on `/calendar`.

---

## Phase 50 — Requirement: group_coverage & soft_priority surfacing

**Goal:** `Requirement.mode` has carried three values since Phase 1, but only `individual_gate` has ever done anything — `src/lib/tasks/requirements.ts`'s own comment says as much. Spec gives both remaining modes real design weight (a whole paragraph on how each should surface, plus a callback in Views' "what fits me"); this sat as a deliberate MVP-only deferral through all 47 phases since, worth picking up now that both surfacing surfaces (board/Explore, Coordination view) exist to extend.

**Scope:**
- `group_coverage`: a live "covered / not yet covered" status line per requirement, wherever a task renders (detail view, board, Explore) — computed by checking whether *any* current `TaskAssignment` holder satisfies it (excluding shadows, per Phase 14's own exemption), the same live-check posture remaining capacity already uses. No new bookkeeping table; a task that fills to capacity with the line still unmet is already picked up by the existing attention-level job (Phase 10) — this phase only adds the visible line, it doesn't touch that job.
- A **surfacing boost**, resolved narrowly per spec's own explicit split from full automated matching (MVP scope: "capacity as a manual sort/filter dimension does not [merge into the automated-matching deferral] and ships independently" — the same split applies here): a "requirements that fit you" sort/filter dimension on the board and Explore, never a default ranking applied without the member choosing it. `individual_gate` gets a static boost (sorted toward the top the narrower its eligible pool is, computed as 1/eligible-member-count — a cheap live count). `group_coverage` gets a dynamic one, live to whether the line is currently unmet, that stops pulling on a member the moment someone else already covers it. `soft_priority` never blocks and never flags a gap — it only ever contributes to this same sort dimension.

**Depends on:** Phase 5 (Requirement, the `mode` field), Phase 4 (board/Explore, what this extends), Phase 14 (the shadow-slot exemption this respects).

**Out of scope:** any change to claim-time enforcement — neither mode ever blocks a claim, exactly as spec requires; full automated tag→task matching (still permanently deferred per MVP scope — this is a sort dimension a member opts into, not a default the platform picks).

**Done when:** a task with an unmet `group_coverage` requirement shows a live "not yet covered" line that clears the moment a real holder satisfies it; a member can sort/filter the board or Explore toward tasks where they'd help meet an `individual_gate` or `group_coverage` need, narrower pools and currently-unmet needs surfacing more strongly; `soft_priority` requirements feed the same sort dimension and nothing else.

---

## Phase 51 — Task assignment notification (nomination, response, one-click actions)

**Goal:** spec's Notifications & communications section opens with a real, specific mechanic that's never been built — a coordinator (or a peer, per Coordination mechanics' own multi-slot nomination language) hands a task to a specific member, who gets a yes/no/not-now choice with a real deadline, auto-releasing on silence. Distinct from the ordinary claim flow and from Browse mode's own "I'd suggest this person" field (Phase 7), neither of which offers a formal, deadlined accept/decline.

**Scope:**
- `TaskNomination` (taskId, slotId nullable — for a multi-slot task's specific open slot, nominatedMemberId, nominatedBy, message nullable, status enum `pending`/`accepted`/`declined`/`not_now`/`expired`, respondByDeadline, createdAt, respondedAt nullable). Nominators: a branch coordination-task holder, or (per spec's peer-nomination language) an existing co-holder on the target task. Only the nominee can respond.
- Responding: **accept** claims the task/slot exactly as an ordinary claim would (same Requirement/openness checks apply — nomination never bypasses eligibility); **decline**/**not-now** just closes it, visible afterward the same way a declined join request already is (Phase 15's "declined requests stay visible to branch coordination" precedent, reused as-is); silence past `respondByDeadline` auto-expires it, notifies the nominator, and logs the non-response (feeding Phase 52).
- **One-click action emails.** This app already sends real outbound email — the magic-link SMTP relay (Phase 2) — but every notification since has stayed a visible in-app flag, deliberately, since nothing needed a click-to-act email before. A nomination is the first mechanic that genuinely calls for one: a signed, single-use, short-lived action token (hashed at rest, same precedent as a magic-link token) embedded in the email, resolving directly to a response with no login required — spec's exact button-set framing (*Done / Still on it / I need help / Hand it back*), adapted here to *Accept / Not for me / Not right now*. **This phase is also where the shared token-action infrastructure gets built** (`src/lib/notifications/action-tokens.ts`: issue/verify/consume, one-time) — meant to be reused as-is by Phase 52, not rebuilt per consumer.
- A plain "nominate a member" form on a task's detail view, and a response surface on the nominee's own Dashboard, alongside the email.

**Depends on:** Phase 3 (TaskAssignment/claim), Phase 2 (SMTP relay, MemberIdentity), Phase 15 (the declined-request visibility precedent this reuses).

**Out of scope:** the engagement-record pattern-surfacing this feeds (Phase 52 — this phase only logs the raw event); targeted messages/announcements (Phase 53); retrofitting the existing Waiting-nudge (Phase 10) or CallSummaryRead machinery onto this new token infrastructure — a real, worthwhile follow-up once this phase proves the pattern, not this phase's own Done-when.

**Done when:** a coordination-task holder or existing co-holder can nominate a specific member for a task/open slot with an optional message; the nominee can accept (claiming exactly as an ordinary claim, gated the same way), decline, or say not-now, from either the platform or a real one-click email action needing no login; silence past the deadline auto-expires the nomination, notifies the nominator, and is logged.

---

## Phase 52 — Response tracking & engagement record

**Goal:** spec's Response tracking section (an escalating read on a member's own non-response pattern — one noted, a couple a soft flag, three-plus a real conversation prompt, resetting on re-engagement) and Recruitment's own Accompaniment text ("the accompanier gets explicit visibility into the new member's engagement record") both assume this exists; neither has anything to read today.

**Scope:**
- `EngagementEvent` (memberId, kind enum — `task_nomination_expired` (Phase 51), `nudge_ignored` (Phase 10's existing Waiting check-in nudge, extended to log past its own grace period rather than only re-flagging the task), `call_summary_unread_past_window` (Phase 19's `CallSummaryRead`, extended similarly) — every kind a genuine non-response this codebase already produces somewhere, not a new detection mechanism per kind — createdAt, resolvedAt nullable, set the moment that member responds to *anything* tracked here, per spec's "the pattern resets once the person responds and re-engages" (a global reset, not per-kind).
- A per-member, live-computed pattern level (`none`/`noted`/`soft_flag`/`pattern`) — spec's own three-tier language, thresholds community-configurable, defaulting to spec's reference counts (1/2/3) — read the same "count open EngagementEvent rows since the last reset" way this codebase computes every other live status, never stored.
- Surfaced two places: the Coordination view (a branch coordination-task holder sees the pattern for members on tasks they coordinate — access-follows-the-task, same as every other coordination surface here), and — the concrete Accompaniment consumer spec names — directly on an Accompaniment task's own detail view for its holder, once Phase 48's real Member conversion means there's an actual member to read a record for.

**Depends on:** Phase 51 (the nomination-expiry event this reads), Phase 10 (Waiting-nudge grace period, extended to emit an event), Phase 19 (CallSummaryRead, extended similarly), Phase 48 (a real converted Member for Accompaniment's own consumer).

**Out of scope:** any automatic sanction or consequence — spec is explicit this is "never an automatic sanction," matching this codebase's consistent no-consequence-ladder posture elsewhere (Shifts' no-show, Conflict management); a member's own visibility into their own record (spec frames this coordination-facing only).

**Done when:** an expired nomination, an ignored Waiting nudge past its grace period, and an unread-past-window call summary each log a real EngagementEvent; a member's pattern level computes live and resets the moment they respond to anything tracked; a branch coordination holder sees it for members on tasks they coordinate, and an Accompaniment task's holder sees it for their assigned new member.

---

## Phase 53 — Outbound communications: targeted messages & announcements

**Goal:** the two remaining tiers of spec's Outbound communications section — direct asks are Phase 51's nomination; this closes targeted messages (branch/task-holder/arrival-window scoped, sent by whoever already has the relevant coordination access) and community-wide announcements (the most restricted tier, gated by holding a real, tagged task — the same "the gate is a task, not a role" pattern Admins itself established).

**Scope:**
- `OutboundMessage` (communityId, sentBy, scope enum `branch`/`task_holders`/`arrival_window`/`community`, scopeRef jsonb, subject, body, sentAt) — every send resolves its recipient set live at send time (never a stored roster) and logs itself, per spec's "all outbound messages get logged either way."
- **Targeted messages**: sendable by whoever already has the relevant access for that scope — a branch's coordination-task holder for `branch` (Phase 15's `isCoordinationHolder`, reused as-is), a task's current holder for `task_holders`, and — since arrival/departure windows are cycle-wide — whoever can initiate a cycle (Phase 6/31's `requireCycleInitiationEligibility`) for `arrival_window`.
- **Community-wide announcements**: gated by a new `Community.announcementTaskId` pointer (the same "task is the authority" pattern every other module-owner pointer already uses), configured on `/settings`.
- Delivery reuses Phase 2's SMTP relay directly (real email). A new flat `Member.emailNotificationsEnabled` (boolean, default true) — resolved as one toggle rather than per-category granularity spec doesn't ask this phase to build; distinct from Phase 46's `ContactMethod` visibility, which controls who can *see* a contact method, not whether the platform emails it.
- A new `/messages` page: send a targeted message or (if eligible) an announcement; a log of what's gone out — an announcement's log visible to everyone (it's public-facing anyway), a targeted message's log visible only to its sender and recipients.

**Depends on:** Phase 2 (SMTP relay), Phase 15 (branch coordination check), Phase 31 (Participation, for arrival-window scoping), Phase 51 (the outbound-email plumbing this reuses — not its action-token machinery, since a plain message has nothing to click).

**Out of scope:** any bridge to an external chat platform (spec: "a deliberate, opt-in decision per Community, not a default," no platform named as a target now); per-category notification preferences beyond the one flat toggle; message threading/replies (one-way outbound, mirroring Talk-to-my-coordinator's own "routing mechanic, not a chat system" framing).

**Done when:** a branch coordination holder can email their branch's roster (or task holders across a branch), whoever can initiate a cycle can message everyone in a declared arrival window, whoever holds the community's designated announcement task can message the whole Community, every send is logged and visible to whoever's allowed to see it, and a member can turn off email delivery entirely for themselves.

---

## Phase 54 — Support task type & View-as

**Goal:** spec's Transparency & access section names a real capability — View-as, unlocked by holding a Support task, a strict read-only render of exactly what another member sees — that's never been built; Conflict management (Phase 21) already pre-committed to respecting its own recusal filtering under View-as before View-as existed at all.

**Scope:**
- No new Community pointer field — Support is "claimable like any other" task, resolved the same way branch coordination already is: a new `Community.supportTag` (text, default `"support"`, the same `coordinationTag` pattern from Phase 15) tags whichever task(s) count; current holders are the Support pool.
- `viewAsMember(actor, targetMemberId)`: a signed, short-lived session overlay (never a real session swap — the actor's own identity/audit trail never changes) that every existing `actor`-scoped read function in this codebase threads through as its first argument. **A spot-check this session already confirms the pattern mostly holds** — `getCurrentMember()` is only ever called directly in `src/lib/session.ts`/`src/lib/api.ts`, the session/API boundary itself, exactly where actor resolution belongs, not deep inside lib functions — but this phase's real work is a full audit of every `requireXHolder`/`isXHolder`/`listMyX` function to confirm none silently reads the session instead of its passed-in `actor`, fixing any that do, since View-as only works if every read path genuinely composes through it. A visible, persistent banner ("Viewing as [Member] — read-only") for the duration; every write action is disabled at the UI layer and re-checked/rejected server-side regardless.
- **The one hard exception, per spec:** Conflict management reads stay gated on the *viewed* member's own exclusion list — `listConflictReports` (confirmed today it already takes `actor` as a parameter) renders exactly the filtered queue that member sees, never the unfiltered one, with no override, matching spec's explicit "a real bug in the filtering logic needs a code-level fix, not a live view-as session."
- Every activation logged (`ViewAsLog`: activatedBy, targetMemberId, startedAt, endedAt nullable) — the same accountability-trail pattern Emergency access (Phase 46) already established for a comparably sensitive capability.

**Depends on:** Phase 21 (the recusal exception this must respect), Phase 46 (EmergencyAccessLog's logging pattern, reused).

**Out of scope:** acting *as* another member (claim, submit, vote) while viewing as them — spec is explicit this is strictly read-only; a formal Default/Explore/Coordination "tiered views" redesign beyond what already exists piecemeal across `/`, `/coordination`, `/escalation` (those already function as the three tiers spec describes; this phase only adds the ability to render any of them as someone else).

**Done when:** a Support-task holder can view the platform exactly as any chosen member would, read-only, with a persistent banner; every write stays blocked client- and server-side throughout; viewing as an excluded conflict-team member renders the same filtered-empty queue they'd see themselves, with no bypass; every activation is logged.

---

## Phase 55 — Task Packs as a portable, shareable mechanism

**Goal:** Phase 6 already builds the real mechanism underneath a Task Pack — cloning a cycle *is* "export as an implicit pack, import it into the new cycle," per spec's own framing — but only that one path exists, running inline against an in-memory implicit pack rather than a real, persisted, shareable entity. This phase gives it one, and closes Phase 40's own flagged gap in passing.

**Scope:**
- `TaskPack`/`TaskPackItem`/`PackPhase` as real, persisted tables (communityId nullable — null for a pack authored for cross-community sharing, set for one that stays private to its origin) matching spec's data-model shape. Mostly about giving Phase 6's already-working export/import *logic* a real row to persist into and read back from, rather than the in-memory recipe clone-previous-cycle runs today.
- Export: a new action on `/participation` — the current cycle, or a hand-picked task subset via the board's existing bulk-selection mechanism (Phase 15), as a named `TaskPack` (manifest: name, description, source, version, domainTags). Reuses `cloneMostRecentCycle`'s own recipe-deriving logic (`deriveClonedBoundaryRecipe`, Phase 39) and `cloneTaskMilestones`'s relative-only carry rule (Phase 41) — no second implementation.
- Import: the existing Pack import review screen (branch/phase name-matching, the date preview — already built for clone-previous-cycle, per Phase 44's own note that this "falls out for both flows at once") now also accepts a saved `TaskPack` as its source, not only an implicit previous-cycle export.
- A small `/task-packs` page: this Community's own saved packs, plus JSON-file upload/download for moving a pack between two separate Orchard deployments — this codebase's consistent no-object-storage posture, a pack round-trips as a plain file, the same "link, don't host" precedent Task Resources already established, not a hosted registry.
- `CycleType.defaultPackId` (spec's own field; `CycleType` today only has `defaultSourceCycleId`, per Phase 40's documented deviation) gets wired up now that real `TaskPack` rows exist to point at.

**Depends on:** Phase 6 (the export/import logic this formalizes), Phase 39 (date-recipe derivation), Phase 41 (milestone carry-forward), Phase 15 (bulk task selection, for a partial export), Phase 40 (the `defaultPackId` gap this closes).

**Out of scope:** a public, cross-deployment pack registry/marketplace (a hand-delivered JSON file is the v1 mechanism, matching this app's self-hosted posture everywhere else); fuzzy/near-match branch-name suggestion on import (spec: "a reasonable stretch, not a first-cut requirement" — see Phase 59).

**Done when:** a member with cycle-initiation eligibility can export the current cycle (or a bulk-selected task subset) as a named, downloadable `TaskPack`; that file can be uploaded and imported into a *different* Community's cycle through the same review/date-preview screen clone-previous-cycle already uses; a `CycleType` with a `defaultPackId` set correctly pre-selects that pack when starting a new Cycle of that type.

---

## Phase 56 — Member onboarding & first session

**Goal:** the one MVP-scope item never picked up at all — what a newly-accepted member's first real session looks like, deliberately distinct from Recruitment's own application/evaluation flow (spec: "this is what a newly-accepted member actually experiences the first time they open the platform, and it's not domain-specific"). Timely now that Phase 48 means an accepted Recruitment applicant is finally a real, logged-in Member with a genuine first session to have.

**Scope:**
- `Member.hasCompletedOnboarding` (boolean, default false), cleared once the sequence below finishes or is explicitly skipped — skipping is always available, a nudge, never a gate, consistent with this codebase never blocking access behind a required flow.
- **Bite-size tutorial** — a handful of static cards, no CMS/authoring UI — content as plain constants, the same "hardcoded per use" posture Forms' own MVP fields take, since spec calls this "a handful of cards, not a manual."
- **Strengths + participation preferences** — reuses `Member.tags` (free-editable on `/profile` since Phase 2) and Phase 16's `ProfileQuestion` surfacing mechanism directly (`surfaces` gaining a new `"onboarding"` entry) rather than a second intake form.
- **Suggested fitted tasks** — 2-3 open tasks on first login. **Resolved narrowly, per the same MVP-scope split Phase 50 relies on:** a plain tag-overlap heuristic (unclaimed tasks whose `tags` intersect the member's own, or that carry an `individual_gate` Requirement they satisfy — reusing Phase 50's own eligibility check), not a scored recommendation engine — the same "surfacing, not deciding" line every other soft signal in this codebase draws.
- **Search/filter escape hatch** — already exists on the board (branch filter, since Phase 4); this phase links onboarding's suggestions out to it rather than dead-ending if none fit.
- **Related tasks after finishing one** — a Done confirmation gains a "you might also like" strip using the same tag-overlap heuristic, not a second mechanism — spec's own framing: "the growth engine for the 'start small, take on more' participation type."
- Dashboard (Phase 24) gains the onboarding-progress panel its own scope explicitly deferred pending this phase's existence.

**Depends on:** Phase 2 (Member/tags/profile), Phase 16 (ProfileQuestion surfacing), Phase 50 (the eligibility/tag-overlap check this reuses), Phase 24 (Dashboard, the panel this fills in), Phase 48 (the clearest real consumer, though this phase works identically for a Community with Recruitment off or invite-only — onboarding is universal, not Recruitment-gated).

**Out of scope:** any scored/ranked task-matching algorithm (still permanently deferred per MVP scope, same line Phase 50 draws); a Community-authorable tutorial-content system (static cards for v1, per spec's own "cards, not a manual" framing).

**Done when:** a new member's first login shows the tutorial cards, surfaces any onboarding-tagged ProfileQuestions they haven't answered, and shows 2-3 tag-matched open tasks with a link to the full board; marking a task Done shows a related-tasks strip using the same heuristic; the Dashboard's onboarding-progress panel renders for anyone who hasn't finished or skipped the sequence and disappears once they have.

---

## 2026-09-03 — Phases 57-59 scoped: three named stretch goals promoted off the "Beyond" list

Three items that sat in "Beyond Phase 56" as one-line deferrals turned out to have enough real design content — and enough of it already confirmed in `docs/spec.md`, not guessed — to earn their own scoped phases rather than staying a bullet forever. All three were picked at the user's explicit request; none was blocking anything else, they just hadn't been written up. Confirmed against the actual codebase before scoping: `src/db/schema/auth.ts`'s `authProviderEnum` and `memberIdentity.providerSubject` have carried an `"oidc"` slot, unused, since Phase 2 — the schema was already built for this, only the login path was missing; no auth library (Auth.js/Lucia) was ever actually adopted, so this batch treats OIDC as a real client integration to add, not a plugin to flip on; `Form.fields`/`ProfileQuestion` already share the exact `{key, label, responseType, options, required}` shape spec's own stretch line assumes; and Phase 55 (Task Packs as a portable, shareable mechanism) is still itself only scoped, not built, which is exactly why fuzzy-matching stays sequenced after it rather than promoted to run standalone — there's no cross-community import path yet for an exact-match lookup to ever fail against.

## Phase 57 — OIDC second auth provider (Zitadel)

**Goal:** wire the confirmed second login path — Zitadel, per `docs/spec.md`'s Authentication section — alongside magic-link, with the two real behaviors spec insists matter beyond "SSO is on": role-gated provisioning and `sub`-keyed identity.

**Scope:**
- A real OIDC client integration (e.g. `openid-client`), added fresh rather than retrofitted onto a framework — Phase 2 never actually adopted Auth.js or Lucia despite the original spec naming them as options; auth today is hand-rolled magic-link only (`src/app/api/auth/*`, `src/lib/session.ts`, `src/lib/magic-link.ts`), and this phase adds exactly the library the feature needs on top of that, the same "add what's needed, not a framework" posture Spatial planning took with Turf.js.
- New `/api/auth/oidc/login` (redirect to the configured issuer's authorize endpoint with state/nonce/PKCE) and `/api/auth/oidc/callback` (code exchange, ID token verification) routes, alongside — never replacing — the existing magic-link `/api/auth/request`/`/api/auth/verify` routes.
- **Role-gated provisioning:** the callback only resolves or creates a Member when the token/userinfo carries a role scoped to Orchard's own project in the IdP. `Community.oidcRequiredRole` (plain text, configured on `/settings`) is the authority — the same "a string/pointer is the gate, not a role table" pattern this codebase's other community-level fields already use. No qualifying role → a real, visible "not authorized for Orchard" page, never a silent account creation — the same precedent Phase 32 set turning off magic-link's own silent auto-create once Recruitment's real gate existed.
- **Identity keyed on `sub`, never email:** `memberIdentity` (its `provider`/`providerSubject` columns unused since Phase 2) is looked up by `(provider = 'oidc', providerSubject = sub)` first; a new Member + MemberIdentity row is only created when no `sub` match exists. On every login, if the token's email differs from `MemberIdentity.loginEmail`, update it in place — per spec, email is free to drift upstream without breaking the identity link.
- `Community.oidcConfig` (issuer URL, client ID; the client secret lives in env, never the row) plus the required-role string, configured on `/settings` behind the existing Admins gate (Phase 13). A community with no OIDC configured sees magic-link only, unchanged.
- Login page gains a second "Sign in with [IdP name]" button, shown only when a community has OIDC configured — magic-link's own form stays exactly where it is.

**Depends on:** Phase 2 (the `auth_provider`/`providerSubject` schema this activates), Phase 9 (settings screen this extends), Phase 32 (the stop-silent-auto-create precedent this mirrors).

**Out of scope:** dropping or gating magic-link once OIDC is on — spec is explicit both stay live, "provider-pluggable, not one fixed method"; automatically merging a pre-existing magic-link Member into an OIDC login that happens to share an email (a real edge case, but a manual admin action if it ever comes up — an automatic identity-merge needs more security thought than this phase should carry); supporting more than one OIDC issuer at a time (Zitadel is the one confirmed target; a second OIDC-speaking IdP needs no new code path, just a second configured issuer, itself not asked for yet).

**Done when:** a community can configure an OIDC issuer, client ID, and required role on `/settings`; a Zitadel user carrying that role can log in via "Sign in with Zitadel" and lands in a session tied to their `sub`, with `MemberIdentity` created on first login and reused on every later one; a Zitadel user lacking the required role gets a clear "not authorized" page instead of an account; an existing member's `loginEmail` updates automatically when the IdP's email differs from what Orchard has on file; and the existing magic-link flow keeps working completely unchanged throughout.

---

## Phase 58 — No-code Form & Profile question field authoring

**Goal:** replace "fields defined via the create action" with a real settings-screen builder — the one stretch goal spec names twice, once each for Forms and Profile questions, in identical language, because both modules already share the exact same field shape.

**Scope:**
- A field-builder UI added to the existing `/settings` Form CRUD (Phase 25) and ProfileQuestion CRUD (Phase 16) screens: add/remove/reorder fields, edit label/responseType/options/required per field — replacing whatever raw-JSON-array or code-constructed-object path those screens use today, without changing either table's underlying shape. `Form.fields` stays the same jsonb array; `ProfileQuestion` stays one row per question — the builder becomes the *input path* for both, not a new storage shape.
- A live preview pane rendering the form/question exactly as a submitter or answering member would see it, updating as fields are edited — the same "nothing commits unseen" instinct the Pack import date preview (Phase 44) already established for a different kind of pre-commit check.
- Inline validation before save: a `single_choice`/`multi_choice` field needs at least one option; a field `key` must be unique within the same Form (or across a member's onboarding-surfaced ProfileQuestions) — caught in the builder itself, not left to a runtime error on first submission.
- Existing hardcoded content (the recruitment application form, post-cycle feedback form, the Availability question) isn't migrated or rewritten — this phase changes how a *new* Form/ProfileQuestion gets authored going forward; opening an existing one in the builder just shows its real current fields, editable the same as a freshly-created one.

**Depends on:** Phase 25 (Form CRUD, the shape this builds a UI over), Phase 16 (ProfileQuestion CRUD, same).

**Out of scope:** any change to submission or answering behavior, or to either table's schema — authoring UI only; a generalized field-type system beyond the response types both already support (`free_text`/`single_choice`/`multi_choice`, plus ProfileQuestion's own `date`); Question's own definition (Input rounds/Assemblies) — spec's stretch line names Form/ProfileQuestion specifically, and a Question is posed ad hoc per task or agenda item, never authored as standing structure the way a Form or ProfileQuestion is.

**Done when:** an admin can create or fully edit a Form or a ProfileQuestion through the settings UI alone — adding, removing, reordering, and configuring fields with live preview and inline validation — with no code change or raw-JSON edit required anywhere in the flow, and an existing hardcoded Form/ProfileQuestion opens in the same builder showing its real current fields.

---

## Phase 59 — Fuzzy/near-match suggestion on Pack import review

**Goal:** the one piece Phase 55's own reconciliation screen deliberately deferred — catching "Wood" vs. "Woods" as a suggested match instead of forcing "create new" on anything short of an exact name.

**Scope:**
- Extends Phase 55's per-hint-value review row: when no exact (case-insensitive) match exists against the destination's branches/phases, run a lightweight string-similarity check (e.g. Levenshtein or Dice-coefficient distance under a fixed threshold) and surface the closest candidate as a suggested match — clearly labeled "similar match," never presented as if it were exact.
- Still just a suggestion, never auto-applied: a row's pre-fill changes from "create new" to the near-match candidate when one clears the threshold, but every row stays exactly as freely editable as Phase 55 already made it — remap to any other existing branch/phase, or override to "create new" even with a near-match found.
- No new schema, no new table, no change to the review screen's own layout — a pure function (e.g. `src/lib/task-packs/match-name.ts`) the existing row-resolution logic calls in place of its current exact-match-only lookup.

**Depends on:** Phase 55 (Task Packs as a portable, shareable mechanism — the review screen this extends; without a real cross-community import path, there's no case where an exact match can plausibly fail in the first place).

**Out of scope:** any change to the review screen's own flow beyond the pre-filled suggestion — Phase 55's grouped-by-hint layout, the decline/reassign second screen, and the date preview all stay exactly as they are; applying near-match suggestions anywhere outside Pack import (e.g. Requirement's `custom` free-form flags) — spec names this specifically for Pack import, not as a general-purpose fuzzy-matching utility.

**Done when:** importing a pack whose branch or phase name nearly (but not exactly) matches an existing one — "Wood" against "Woods" — pre-fills that row with the near-match as a clearly-labeled suggestion instead of defaulting to "create new," while every row stays exactly as freely editable as before.

---

## 2026-09-04 — Phases 60-64 scoped: task-authoring, onboarding, endorsement & permissions gaps found by code audit

Not spec-reading this time — a direct audit of the actual running app, prompted by the user asking how task dependencies/permissions are configured through the UI and how a fresh install (or an existing group's roster) gets onboarded. Real gaps turned up, each real enough to warrant its own phase rather than a one-line "Beyond" bullet: (1) Requirement and Dependency gating are both fully built and enforced server-side, yet neither has ever had a UI (or, for Dependencies, even an API) to actually create one — `docs/spec.md`'s own description of requirements being filled in on the Task Proposal activation screen was never wired into `ProposalCard.tsx`; (2) an existing real-world group adopting Orchard has no way to bring its already-known roster in except one member at a time through Recruitment or magic-link. A third candidate — a single-founder Community supposedly unable to ever clear its own Admins candidacy, since self-endorsement is forbidden — turned out not to be a real gap on inspection: the existing "any member" pre-latch fallback already gives a lone founder full admin access, and normal endorsement works fine the moment a real second member exists to do the endorsing. But considering that case surfaced a genuinely separate, real one: `endorsementThreshold` is already a real per-task configurable field, yet it's arbitrarily restricted to a positive integer, and — independently of that restriction — confirmation is only ever evaluated as a side effect of someone actually endorsing, never at candidacy-creation time, so even relaxing the restriction wouldn't by itself make a zero-threshold candidacy confirm. That's Phase 62. Discussing that also surfaced the bigger picture the user actually asked about first: every one of these gates is scattered across a long settings page as inconsistent field shapes (a raw UUID paste for a task pointer, a bare tag string for the rest), one (`supportTag`) has no configuration path at all, and there's no way to grant a permission from the task's own side — only by hunting down the right settings field. Digging into why the shapes differ turned up a real, previously-unnoticed bug, not just an inconsistency: the tag-based gates match against `Task.tags`, the exact same freeform field the board's own tag filter reads, so a task tagged for ordinary categorization reasons can silently grant real access if it happens to share a string with a Community's configured gate tag. That split into two phases: Phase 63 replaces both shapes with one real `PermissionGrant` table (no behavior change, just a safer and unified mechanism), and Phase 64 is the actual panel plus a user-requested addition — a task's own creation/edit screen gains a way to declare which module-level gate(s) it grants, module-level granularity only for now (see the finer-grained subset-permission idea already logged below, deliberately not built here).

## Phase 60 — Requirement & Dependency authoring UI

**Goal:** close the authoring gap directly, not by building new mechanism — `src/lib/tasks/requirements.ts`'s CRUD and the `/api/tasks/[id]/requirements` routes (Phase 5) already work, and `task_dependency` enforcement (Phase 3) already blocks finishing with open dependencies; nothing today lets a coordinator actually attach either one to a task without an API client or a direct DB edit.

**Scope:**
- Requirement authoring: add a Requirements section to the Task Proposal activation screen (`src/app/(app)/proposals/ProposalCard.tsx`, `src/lib/proposals/crud.ts`'s already-accepted `requirements` array on `activateProposalInput`) — type (tier/language/completed_task/custom), mode (individual_gate/group_coverage/soft_priority, per Phase 50), value. Calls the existing `createRequirement`/`updateRequirement`/`deleteRequirement` and REST endpoints as-is — no new backend logic. Add the same add/edit/remove affordance to the task detail view (`src/app/(app)/tasks/[id]/page.tsx`, currently read-only display only) too, since coordination needs to adjust a requirement on a task that's already live, not only at proposal-activation time.
- Dependency authoring: a "depends on" multi-select on the same two screens, listing other tasks in the task's own Cycle (scoped to the same Phase or branch by default to keep the list manageable). Needs a small new write path — today the *only* place a `task_dependency` row is ever written is Cycle-cloning's re-pointing logic (`src/lib/cycles/crud.ts`), which only carries an existing dependency onto cloned tasks, never originates one. Reject a circular dependency (A→B→A) server-side at write time — finish-time enforcement already exists, but nothing today stops circular data from being written, since nothing writes it at all yet.

**Depends on:** Phase 5 (Requirement CRUD/enforcement), Phase 7 (the proposal-activation screen this extends), Phase 50 (`group_coverage`/`soft_priority` modes), Phase 3 (TaskDependency schema, finish-time enforcement).

**Out of scope:** any change to enforcement itself — claim-time Requirement gating and finish-time Dependency gating both already work correctly; this is authoring UI only. A generic freestanding "create task" screen — both attach through the existing proposal-activation and task-detail surfaces, not a new form.

**Done when:** a coordinator activating a task proposal, or editing an already-live task, can add/edit/remove a Requirement of any type/mode with no API client or DB edit; a coordinator can set which other tasks in the same cycle a task depends on, with a circular dependency rejected server-side; both are editable from screens a member already uses today.

---

## Phase 61 — Existing-roster bulk onboarding

**Goal:** an existing real-world group adopting Orchard has no way to bring its already-known roster in except one member at a time through Recruitment or magic-link — real friction for anyone besides Peach Please standing this up, where every "member" showing up is someone the person running the install already personally knows and vouches for, not a stranger who needs evaluating.

**Scope:**
- A new action on `/settings`, gated the same way everything else there already is (Admins-task holder, or "any member" pre-latch, per Phase 13), to create multiple real Members directly from a pasted or CSV-uploaded name+email list — each landing exactly where a magic-link first-login would today (a real Member row, a `memberIdentity` row, no password), skipping Recruitment's application/evaluation funnel entirely. Explicitly distinct from `CommunityInvite`, which stays single-use by deliberate design (the CampTool lesson already on record in spec) — this is an admin directly vouching for people already known to be real members of their own group, not a public-facing invite link.
- A review step listing exactly who's about to be created (name/email, one row per prospective member) before committing — the same "nothing commits unseen" instinct Pack import's date preview (Phase 44) already established.

**Depends on:** Phase 9 (settings screen this adds to), Phase 2 (Member/MemberIdentity, the magic-link provisioning shape this mirrors), Phase 13 (the Admins gate this action sits behind).

**Out of scope:** any change to Recruitment's own funnel or to `CommunityInvite`'s single-use design — both stay exactly as they are for the public-facing case; a general CSV-import system beyond Member rows (Task Packs, Phase 55, already cover bulk task/branch structure).

**Done when:** an Admins-task holder (or, pre-latch, any member) can create a batch of real Members directly from `/settings` from a pasted or uploaded list, after a review step showing exactly who'll be created, with no Recruitment application required for any of them.

---

## Phase 62 — Endorsement threshold: zero-threshold support & eager confirm

**Goal:** `community_endorsed` openness's `endorsementThreshold` is already a real, per-task, coordinator-configurable field (set on the Task Proposal activation screen, Phase 7/13) — but it's arbitrarily restricted to a positive integer, and confirmation is only ever evaluated as a side effect of an actual endorsement action, never at candidacy-creation time. Both are real gaps in the mechanism itself, not a special case for any one scenario: a threshold of zero should mean "no endorsement needed, confirms as soon as Requirements are met" — which incidentally also covers a lone-founder or trusted-single-approver task, without any bootstrap-specific carve-out anywhere.

**Scope:**
- Relax `requireEndorsementFields` (`src/lib/tasks/crud.ts:44-50`) to accept `endorsementThreshold = 0` on a `community_endorsed` task — still rejecting missing/negative, since zero is a deliberate choice distinct from "unset."
- Evaluate confirmation eagerly, not only reactively: today the threshold-clearing check (`endorsementCount >= threshold`, capacity allows) lives solely inside `endorseCandidacy` (`src/lib/tasks/endorsements.ts:114`), triggered only by someone actually endorsing — `expressCandidacy` (`endorsements.ts:17`) just creates an "open" `browseInterest` row and never checks the threshold itself. Factor the clearing check into a function both call, so a candidacy whose threshold is already met at creation (a zero-threshold task, or any other already-satisfied case) confirms immediately — rather than sitting open until the browse window closes and getting incorrectly marked `failed` by the scheduled `resolveBrowsePeriods` job, which is what happens today.

**Depends on:** Phase 13 (the endorsement/candidacy mechanism this fixes).

**Out of scope:** a percent-of-membership threshold option (e.g. "25% of current members") instead of, or alongside, a flat integer — a real, separate feature, but one that needs its own design (does it recompute live as membership changes? round up or down? apply only above some minimum community size?) rather than folding in here unreviewed.

**Done when:** a `community_endorsed` task can be created or edited with `endorsementThreshold = 0`; expressing candidacy for such a task (or any candidacy whose threshold is already met at creation time) confirms immediately rather than waiting on an endorsement that may never come, with the existing endorsement flow completely unchanged for a task with a real (≥1) threshold.

---

## Phase 63 — Unify access gates into a real PermissionGrant table

**Goal:** the two shapes this app's access gates use today — a tag string matched against a task's general-purpose, freeform `tags` array (Admins/coordination/Support) versus a single scalar task-ID pointer column on Community (conflict team/feedback review/event scheduling owner/recruitment/spatial planning/announcements) — aren't a deliberate design split; they're just what two different phases reached for on two different days (Phase 15's own text explains choosing a tag specifically so several differently-purposed tasks could each confer coordination powers; nothing ever revisited whether the other six gates might want the same). Worse, the tag-based half has a real, previously-unnoticed footgun: `Task.tags` (`src/db/schema/task.ts:51`) is the exact same freeform field the board's own tag filter reads (`src/app/(app)/board/TagFilter.tsx`) — nothing distinguishes a tag used for ordinary board categorization from a Community's literal permission-gate string, so a task tagged `"support"` for unrelated logistics reasons would silently grant its holders real View-as access. Replacing both shapes with one real join table removes the collision risk and gives Phase 64's panel/authoring UI one mechanism to build on instead of two.

**Scope:**
- New `PermissionGrant` table: `communityId`, `moduleKey` (enum covering the nine existing gates: `admin`, `branch_coordination`, `conflict_team`, `feedback_review`, `event_scheduling_owner`, `recruitment`, `spatial_planning`, `announcements`, `support`), `taskId`, plus two forward-compatible columns that this phase adds but leaves entirely inert: `cycleId` (nullable, references `Cycle`) and `permissionKey` (nullable text). One row per (module, task) that currently grants that module's access, replacing both the scalar pointer columns and the tag-string match.
- `cycleId` stays null for every row this phase writes or reads — every existing gate remains exactly as cycle-independent as it is today; this phase doesn't decide which modules should become cycle-scoped, or how "the current cycle" resolves (that's the concurrent-cycles view-model question, still open — see "Beyond," below). The column exists purely so that whichever future phase does resolve it can start writing a real `cycleId` on the relevant modules' grants without a second migration on this table.
- `permissionKey` likewise stays null for every row this phase writes or reads — null is what every enforcement check in this phase's scope actually looks for, meaning "this grant covers the whole module," the only kind of grant that exists today. No specific narrower permission keys are defined, and nothing here reads a non-null value — that's the finer-grained subset-permission idea, still just a documented possibility (see "Beyond"). Reserved now so that idea, if it's ever picked up, extends this table instead of replacing it.
- Per-module cardinality, preserved from today's actual behavior and enforced at the application layer instead of by storage shape: `admin`/`branch_coordination`/`support` allow multiple simultaneous granting tasks (today's real behavior, via the tag match); the other six enforce at most one granting task per (`communityId`, `moduleKey`, `cycleId`) — today's real behavior, via the scalar pointer, expressed with `cycleId` in the constraint now so a future cycle-scoped module naturally gets one grant per cycle instead of needing the constraint itself redefined later. A real constraint this phase must keep, not a side effect to lose in the rewrite.
- Rewrite every enforcement read this touches — `requireAdmins` (`src/lib/settings/admins.ts`), branch-coordination resolution (`src/lib/coordination.ts`), `listConflictReports`'s exclusion logic and every other `conflictTeamTaskId` reader, the Recruitment/feedback-review/event-scheduling/spatial-planning/announcements gate checks, and View-as's Support-pool resolution (`src/lib/view-as.ts`) — to query `PermissionGrant` instead of the old fields. No behavior change intended anywhere in this list; this is a storage/lookup migration, not a policy change.
- A one-time data migration: for each existing Community, match `adminsTag`/`coordinationTag`/`supportTag` against every task's current `tags` to seed the equivalent `PermissionGrant` rows, and copy each of the six scalar pointer columns directly into one row apiece; then drop all nine old Community columns — a clean cut-over, not a dual-write compatibility period, since there's no real member data live on this yet (see the Organizational prerequisite note at the top of this doc).

**Depends on:** Phase 13 (Admins), Phase 15 (`coordinationTag`), Phase 21 (`conflictTeamTaskId`), Phase 53 (`announcementTaskId`), Phase 54 (`supportTag`) — every existing gate this migrates.

**Out of scope:** any change to who actually holds access today — every Community's current gates migrate 1:1, nothing regranted or revoked; a UI to manage any of this (Phase 64, next); loosening or tightening any module's single-vs-multi cardinality policy — this phase preserves today's real per-module behavior, it doesn't reconsider it; folding Budget's/Shifts' own narrower per-cycle/per-series owner concepts into this table — deliberately kept separate pending the concurrent-cycles view-model question (see "Beyond," below), not conflated with this migration.

**Done when:** every access-gate check in the app reads `PermissionGrant` instead of a Community scalar field or a `Task.tags` string match; a task's own general-purpose tags no longer have any bearing on what access it grants; every existing Community's gates migrate with identical effective permissions before and after; the six previously-single-pointer modules still enforce at most one granting task, while Admin/coordination/Support still allow several; and the table carries `cycleId`/`permissionKey` columns, present in the schema and untouched by any row this phase writes.

---

## Phase 64 — Unified access & permissions panel, plus grant-from-task authoring

**Goal:** Phase 63 gives every access gate one real, uniform mechanism; nothing yet lets anyone actually see or edit it except a raw DB query. This is the UI layer that was the point of unifying it: one settings panel listing every gate, and a second entry point letting a task's own creation/edit screen declare what it grants.

**Scope:**
- A new "Access & permissions" section on `/settings` listing all nine `moduleKey`s in one table: label, the task(s) currently granting it (title + branch, not a raw ID), and an edit control — a search-by-title task picker to add a grant, a remove control per row, and the appropriate single-cardinality warning on a module that only allows one.
- **Grant permissions from the task's own form, not only from settings.** A "Permissions granted by this task" section on the Task Proposal activation screen and the task detail edit view (same host screens Phase 60 also extends — additive, no conflict regardless of build order): a checkbox per module, inserting/deleting the task's own `PermissionGrant` row directly. On a single-cardinality module already granted elsewhere, checking it shows the same "currently held by [task] — checking this moves it here" warning the settings panel shows, backed by the identical write path (remove the old grant, insert the new one) — one code path, two entry points, never two sources of truth.

**Depends on:** Phase 63 (the `PermissionGrant` table and enforcement this reads and writes), Phase 9 (settings screen), Phase 7 (the proposal activation screen this also extends).

**Out of scope:** anything Phase 63 already ruled out — no enforcement change, no cardinality-policy change, no cycle-scoping of any gate, no subset/fine-grained permissions (module-level grants only, per the already-logged "Beyond" idea); unifying Budget's/Shifts' own narrower per-cycle/per-series owner fields into `PermissionGrant` — surfaced here only as read-only cross-references/links out to where they're actually set.

**Done when:** a single screen lists all nine access-gated capabilities, showing every task currently granting each one in human-readable form, addable/removable through a search picker; and from a task's own creation or edit screen, a coordinator can directly check which module-level gate(s) that task grants, with the same single-cardinality warning and identical underlying write path as the settings panel.

---

## 2026-09-04 — Phases 65-69 scoped: concurrent-cycle support

The four blocking design questions from the concurrent-cycles discussion above are resolved: the view-scope URL is a real route segment, not a query parameter; closing a cycle is an Admin action with an overridable (not blocking) warning if the current Budget owner hasn't marked their own budget done; a cycle-less task always shows on the board regardless of the selected scope, carrying a visible indicator and its own show/hide filter, since whether a community wants those once it has real cycles running is the community's own call, not a platform rule; and Dashboard's community-overview section gets a general/this-cycle toggle (one control for the whole section, not per item) where "general" means the union of members across every open cycle, while Branch health drops its accidental cross-cycle behavior and becomes genuinely this-cycle-only, no toggle needed. One more refinement folded in: the switcher's real default isn't a single arbitrary cycle, it's "all cycles the member is actively participating in" — a genuine improvement over both extremes (not "every task ever," not one arbitrary pick) — with narrowing to one specific cycle staying a deliberate action from the dropdown, not the default state. That resolves enough to write real phases: 65 lays the actual Cycle lifecycle and view-scope foundation (and retires `getCurrentCycle()`'s old heuristic everywhere that's a mechanical fix); 66-69 are the concrete consumers. Calendar's own layer redesign and Recruitment's cycle-linked applications remain genuinely unresolved — no phase yet, see "Beyond" below. None of Phases 60-64 needed reordering: nothing in them touches cycle-scoping, and Phase 63's already-reserved `PermissionGrant.cycleId` column turns out to be exactly what Phase 68 needs.

## Phase 65 — Cycle lifecycle & the global view-scope switcher

**Goal:** Cycle has no open/closed lifecycle state today — just start/end dates used for phase-boundary computation — and no explicit "which cycle is this view scoped to" concept exists anywhere; `getCurrentCycle()`'s "most recently started" heuristic (`src/lib/profile-questions/capacity.ts:16`) is the closest thing, and it doesn't survive more than one cycle being open. This phase gives Cycle a real lifecycle, gives every member a real way to set which cycle their whole view is scoped to, and retires the old heuristic everywhere that's a straightforward swap — the foundation every other phase in this batch depends on.

**Scope:**
- `Cycle.closedAt`/`closedBy` (new, nullable) — a cycle stays fully open (writable) past its own nominal end date until someone deliberately closes it; nothing auto-closes it at end date.
- Closing action: any current Admin (Phase 63/64's `PermissionGrant`, `admin` module) can close an open cycle. New `BudgetCycle.ownerMarkedDoneAt` (nullable) — a small confirmation action for the current Budget owner, on `/budget`. If Budget is enabled for that cycle and its owner hasn't marked it done, the close action shows a warning naming that, overridable — the Admin can close anyway, it never hard-blocks. Closing locks everything about that cycle, no exception; reaching a closed cycle afterward (by URL, by the switcher's "Other" search) is a normal, first-class, read-only state, not an error.
- Starting a second Cycle while one's already open (nothing stops this today) now shows an explicit confirmation step naming the cycle that's already open, rather than silently succeeding.
- A global cycle-switcher in the nav itself, not a per-module picker, with three real states: **all active cycles** (the genuine default — every currently-open cycle the member has actually declared Participation `coming` for, unioned; not "every cycle ever," and not an arbitrary single pick) shown in the nav as something like "All active cycles" rather than one name; **one specific cycle**, narrowed to deliberately from a dropdown listing every currently-open cycle (hover reveals a settings icon to that cycle's own settings once one's picked); and **a closed cycle**, reached through an "Other" button opening a search interface, never appearing in the default aggregate. A "start a cycle" prompt takes the switcher's place when no cycle is open at all, at which point only community-scoped nav items show.
- The selected state lives in the URL as a real route segment, not a query parameter — every cycle-scoped page moves under it, including the "all active cycles" aggregate state itself (its own segment, e.g. `active`, not the absence of one). The last-viewed selection persists across logins as a real per-member field (`Member.lastViewedCycleId`, nullable — null means the aggregate default), not a browser cookie, so it stays consistent across devices.
- Pages that inherently need exactly one cycle at a time — Budget, and (per Phase 68) Event scheduling and Spatial planning, all single-owner-per-cycle by design — can't render the aggregate state as one blended view. When the switcher is in "all active cycles" mode and the member is actually participating in more than one open cycle, those pages show a lightweight "which cycle?" prompt instead of guessing; with zero or exactly one candidate, they resolve automatically and skip the prompt.
- Retiring `getCurrentCycle()`'s heuristic for the call sites that are a direct, mechanical swap: `/participation`'s declaration form and Contribution's community-average comparison (`src/lib/contribution.ts`) both switch to reading the active view-scope cycle; Outbound messages' `arrival_window` scope (`src/lib/messages.ts`) does too, since composing that message is naturally done from the view of the cycle it's about. Profile-question/Availability phase-surfacing (`src/lib/profile-questions/answers.ts`, `capacity.ts`) gets a *different* fix, not a view-scope swap: it switches to the member's own actual Participation-declared cycle, so a member glancing at a different cycle in their nav never stops seeing their own real outstanding questions.

**Depends on:** Phase 6 (Cycle), Phase 9 (settings, for the cycle-settings link), Phase 63/64 (`PermissionGrant`, for Admin-gated closing), Phase 16 (Profile questions), Phase 23 (Contribution), Phase 31 (Participation), Phase 53 (Outbound messages).

**Out of scope:** the board's own cycle-scoping and Task-Pack-export gating (Phase 67), Event scheduling/Spatial planning ownership (Phase 68), and Dashboard (Phase 69) — each gets its own phase since each needed its own real decision, not just a mechanical swap; Recruitment pipeline's capacity display and Calendar's phase/milestone layer keep using the old heuristic for now, since their own resolutions (cycle-linked applications; selectable/nested layers) are still undesigned — see "Beyond."

**Done when:** an Admin can close an open cycle, seeing (and able to override) a warning if the Budget owner hasn't marked their own budget done; starting a second cycle while one's open requires explicit confirmation; the nav shows a working cycle-switcher defaulting to "all active cycles," narrowable to one specific open cycle or (via "Other") a closed one; the selected state is a real URL segment; a member's last-viewed selection persists across logins; single-cycle-shaped pages prompt to pick when the aggregate default covers more than one candidate; and Participation declaration, Contribution's community average, Outbound messages' arrival-window scope, and Profile-question/Availability surfacing all read correctly under the new model instead of the old single-cycle heuristic.

---

## Phase 66 — Cross-cycle-boundary linking

**Goal:** an object (a task, say) found through some history or search interface can belong to a different cycle than whatever the viewer currently has as their active view scope — Phase 65 makes that scope a real, URL-visible thing for the first time, which means it can now visibly disagree with an object's own actual cycle. This phase makes that disagreement legible instead of confusing, and gives sharing a way to route around it.

**Scope:**
- An object-detail page (a task, a wiki page — not a list/module view, which has nothing to detach from a scope) shows a banner when its own real cycle differs from the viewer's active view-scope segment in the URL, naming both.
- A "copy link" control on the same pages producing a URL with no view-scope segment at all — visiting or sharing it never changes the visitor's own active scope; the page renders using the object's own cycle, with the same banner if that differs from the visitor's actual active scope.
- Following a link that *does* carry an explicit, different view-scope segment prompts the visitor to confirm switching their active scope to match, rather than silently switching or silently ignoring it.
- Scope-free viewing is per-page-view only — navigating anywhere else from that page (the board, coordination view) uses the viewer's own real active scope again, never carrying the object's scope forward.

**Depends on:** Phase 65 (the URL-based view scope this reconciles against).

**Out of scope:** any change to read/write access itself — a closed cycle's objects are already readable per Phase 65; this only affects which scope a page renders under and what its URL looks like.

**Done when:** opening an object whose own cycle differs from the active view scope shows a clear banner naming both; a "copy link" produces a scope-free URL that never forces the recipient's active scope to change; following a scoped link that disagrees with the visitor's current scope prompts a confirm-switch step; and none of this persists past the single page view it happened on.

---

## Phase 67 — Board becomes cycle-scoped

**Goal:** the board shows tasks from every cycle ever created today, mixed together with no cycle filter at all — not a deliberate design, just nothing needing fixing while only one cycle was ever worth looking at. Phase 65 gives every view a real selected state, including a genuine "all active cycles" default; the board is the natural first real consumer of that default, since a list view is exactly the shape that can render a multi-cycle aggregate sensibly (unlike Budget/Event scheduling/Spatial planning, which can't).

**Scope:**
- `listTasksWithAssignments` (`src/app/(app)/board/page.tsx`) filters by the switcher's current state: in the default "all active cycles" state, tasks from every cycle the member is actually participating in (unioned); narrowed to one specific cycle's tasks when the switcher is pointed at just one (including a closed one, reached via "Other" — read-only, matching Phase 65's closed-cycle behavior). Existing branch/tag/fit filters apply on top, unchanged.
- A task with no `cycleId` (evergreen work, or anything predating cycles) always shows regardless of the selected state, carrying a visible "not cycle-scoped" indicator — resolved not to hide these; whether a community wants out-of-cycle tasks once it has real cycles running is left to the community, not enforced either way.
- A new filter, alongside the existing branch/tag filters, to show or hide cycle-less tasks specifically.
- Task-Pack export gating (`exportableInView`, same file) — export only ever targets one real cycle, so it switches from `getCurrentCycle()`'s old heuristic to whichever single cycle the switcher is actually narrowed to; exporting is unavailable (not guessed at) while the switcher is in the multi-cycle aggregate state, the same "ambiguous — ask, don't guess" posture Phase 65 establishes for Budget/Event scheduling/Spatial planning.

**Depends on:** Phase 65 (the switcher state — aggregate or single-cycle — this filters against).

**Out of scope:** any restriction on creating a cycle-less task, even on a community with cycles fully active — a community preference to enforce, not a platform rule to add.

**Done when:** the board shows the union of every actively-participating cycle's tasks by default, narrows to one cycle's tasks when the switcher is pointed at it, and always shows cycle-less tasks (visibly marked); a filter lets a viewer hide cycle-less tasks entirely; and Task-Pack export requires narrowing to one specific cycle first, rather than guessing which one during the aggregate state.

---

## Phase 68 — Event scheduling & Spatial planning ownership becomes genuinely per-cycle

**Goal:** Budget's owner is already per-cycle; Event scheduling's and Spatial planning's owner `PermissionGrant` rows are still community-wide only — the inconsistency flagged when `PermissionGrant` itself was built (Phase 63, which reserved a `cycleId` column for exactly this). Resolved: every cycle gets its own fully independent Event schedule and Spatial layout, the same way Budget already works — not a per-community configurable choice.

**Scope:**
- `event_scheduling_owner` and `spatial_planning` grants start carrying a real `cycleId` — Phase 64's access panel and grant-from-task form both gain a cycle picker for these two modules specifically (every other module's grant stays community-wide, `cycleId` null, exactly as Phase 63/64 left it).
- `/events` and `/spatial-planning` read whichever single cycle the switcher is actually narrowed to, the same way `/budget` already resolves its per-`BudgetCycle` owner — a fresh cycle starts with no programme/layout of its own until someone builds one for it, same as Budget already works. When the switcher is in its "all active cycles" aggregate state (Phase 65) and the member is genuinely participating in more than one open cycle, both pages use Phase 65's "which cycle?" prompt rather than guessing or blending two owners/layouts into one view.

**Depends on:** Phase 63 (`PermissionGrant.cycleId`, reserved for this), Phase 64 (the panel/grant-from-task form this extends), Phase 65 (the active view-scope cycle this reads).

**Out of scope:** a "community savings"-equivalent concept for Event scheduling/Spatial planning — nothing analogous has been asked for; any change to Budget's own already-per-cycle behavior.

**Done when:** Event scheduling's and Spatial planning's owner grants can be set per-cycle through the same panel/task-form Phase 64 built; each concurrently-open cycle has its own independent programme and layout; and a fresh cycle starts with neither until someone builds one, exactly like Budget already behaves.

---

## Phase 69 — Dashboard: you/community × general/this-cycle

**Goal:** Dashboard's sections conflate two independent axes today — about you vs. about the community, and true regardless of cycle vs. meaningful only for one — and its community-snapshot active-member count has no honest single answer once more than one cycle can be open. This phase splits the sections properly and resolves that.

**Scope:**
- Personal action items (pending join requests on tasks you own, upcoming Waiting check-ins, flagged held tasks) stay cross-cycle always — "you, generally" — the same reasoning Phase 65's Profile-question fix already established: a member holding tasks in two concurrently-open cycles sees flags from both, never just whichever one their nav happens to be scoped to.
- Tier/Branch composition stays exactly as it is — "community, generally," already cycle-agnostic in the real code.
- The community-overview section gains a section-level general/this-cycle toggle — one control for the entire section, not per individual line within it. "General" reads as the union of distinct members declared `coming` across every currently-open cycle — available regardless of the nav switcher's own state. "This cycle" reads `Participation.status = 'coming'` for whichever single cycle the switcher is actually narrowed to, and is simply unavailable while the switcher itself is in its "all active cycles" aggregate state — narrowing the switcher to one cycle first is what makes "this cycle" meaningful, rather than Dashboard guessing or prompting separately.
- Branch health (`getCommunitySnapshot`, `src/lib/dashboard.ts:216`) becomes genuinely cycle-scoped — its task-attention-level computation filters to the active view-scope cycle's own tasks, dropping its previous cross-cycle-by-accident behavior. No general/this-cycle toggle for Branch health specifically — it's this-cycle only now.

**Depends on:** Phase 65 (the active view-scope cycle and open-cycle list this reads).

**Out of scope:** Calendar's own still-undesigned cycle-awareness (see "Beyond") — a separate view, not touched here.

**Done when:** personal action-item sections never hide an item just because a different cycle is selected; the community-overview section's toggle switches active-member-count between "this cycle's declared-coming members" and "the union across every open cycle"; and Branch health always reflects only the active view-scope cycle's own tasks.

---

## Beyond Phase 69

Every real mechanism `docs/spec.md` describes is now scoped into a numbered phase. What's left is what spec itself names as a deliberate stretch goal, or something "worth adding only once real use surfaces a need" — not a missed gap, deferred on purpose, same posture as everywhere else in this codebase:

- Native file storage for Task resources (spec's own bet is that link-only holds up; revisit only if that friction actually shows up).
- Real-time multiplayer editing of unowned Spatial-planning Placements/Zones, and snap-to-boundary/grid drawing tooling (both explicitly deferred pending real use surfacing an actual need).
- On-site mode's resync/offline-first behavior (explicitly out of scope for v1 — "if a request fails, retry it once the connection's back," no PWA/service-worker layer).
- Multi-tenancy (explicitly decided against — single-tenant, self-hosted per Community).
- A public cross-deployment Task Pack registry/marketplace beyond Phase 55's JSON-file hand-off.
- **`ModuleState`'s richer off/testing/on rollout** — Phase 22 built the flat on/off list only; the Tier-scoped `testing` state spec describes (a module visible-but-labeled to everyone, or scoped to a "Playtesters"-style Tier) is genuine, real, unscoped work, not a deliberate non-goal like the rest of this list — worth a session of its own whenever a Community actually wants a soft-launch rollout for a new module.
- A "community savings" concept — a persistent community-level pot a cycle can move money into or draw from, for anything that needs to span cycles now that Budget (and, per Phase 68, Event scheduling/Spatial planning) are always fully per-cycle. Not yet scoped; nothing has asked for it concretely yet.
- **Calendar's "layers" never got a real selectable/toggleable UI, cycle-nested or otherwise.** Checked against what actually got built: Phase 44's `/calendar` merges every dated thing into one flat list tagged by `kind` (`phase_start`, `milestone`, `calendar_event`, `assembly_voting_ends`, etc. — `src/lib/calendar/view.ts`), with no filter or show/hide control for any of them, and no cycle-based grouping at all. Spec's own data model even names a "Community-wide bucket" for a cycle-independent `CalendarEvent` (`event.cycle_id = null`, `docs/spec.md:649`) — but that distinction was only ever specified, never actually built: a cycle-linked and a cycle-independent event render identically today, mixed into the same flat list. Selectable layers (toggle a kind on/off) nested by cycle (a concurrently-open cycle's items grouped and independently collapsible) is a real, coherent redesign of this view — worth its own look once concurrent cycles are real (Phase 65 onward), rather than assuming today's flat list still reads clearly once two cycles' worth of milestones and deadlines are mixed into it.
- **Cycle-linked Recruitment applications, an "accepting applications" toggle, and baseline vs. per-cycle questions.** Genuinely new ground, not just a `getCurrentCycle()` audit item: an application should link to the specific Cycle it's for, not just to the community in the abstract — which would resolve Recruitment pipeline's remaining-capacity display too (a candidate's own `cycleId` is what "remaining capacity" would read off, instead of the old single-cycle heuristic Phase 65 left untouched there) — and enables the real need that prompted this: some cycles (a members-only Reunion weekend, say) shouldn't be open to outside applicants at all. Sketched direction: a `Cycle.acceptingApplications` flag (or similar), off by default for a cycle type like Reunion; if more than one cycle is currently accepting, the public application flow asks the applicant which one it's for before anything else. Since joining *any* cycle as a new applicant means joining the community itself, there's a baseline set of application questions every applicant answers regardless of which cycle they pick, plus optional cycle-specific supplemental questions layered on top once a cycle is chosen — one submission, two question sources merged, the same field-shape reuse pattern Phase 58's Form/ProfileQuestion builder already established. Left open: the exact schema shape for "baseline Form plus a cycle's own supplemental questions" (most likely a second, smaller question-set attached to the Cycle itself, rather than a second Form entity); whether evaluator/decision-rule configuration (today entirely community-wide) should ever vary per accepting cycle — not raised yet, flagged only in passing. Explicitly distinct from **existing** members joining a cycle, which already goes through Participation declarations (Phase 6/31), not this application funnel at all — this toggle and the cycle-choice step only affect prospective new members.
- **A finer-grained, subset-based permission model for tasks.** Every gate in this codebase today is all-or-nothing per module (or, for coordination, all-or-nothing per task carrying the tag) — holding the gating task grants everything that module's owner can do. A real, more expressive alternative exists: a task's grant could specify a *subset* of a module's permissions rather than the whole thing (e.g. a task that can approve programme slots but not budget spend), and even today's single `coordinationTag` bundle could in principle be split into more targeted sub-permissions (waive requirements vs. nominate vs. see the escalation view, handled separately). Module-level (or task-level, for coordination) granularity is almost certainly adequate for most communities' actual needs, so this stays a documented possibility rather than a scoped phase — worth a real look only once a specific community's use case actually needs it. Phase 63's `PermissionGrant.permissionKey` column already reserves the storage for this (null today, meaning "the whole module") — a future phase would define real keys and teach specific enforcement checks to read them, not redesign the table.

---

*Living document. Update phase scopes as they turn out to be too big/small once real sessions start working through them.*
