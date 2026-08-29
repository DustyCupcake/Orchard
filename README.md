# 🌳 Orchard

A general-purpose engine for task-based, distributed-effort coordination — built first for [Peach Please](https://peachple.se), a theme camp, but not specific to burns or camps. Any group that gets things done through shared, voluntary effort runs into the same problems: willing people don't know what needs doing, coordination overhead outgrows the work itself, and institutional knowledge lives in one or two heads until they step back and it disappears with them. Orchard is an attempt to actually fix that, not paper over it with another shared spreadsheet.

The core idea: **work, not roles.** The atomic unit is the task, not the position. A task is claimed, not assigned; a role is just a description of what someone currently happens to be holding, not a fixed job. Everything else in this project — browsing and claiming, running a season, asking the community something, handling conflict — follows from that one starting point.

## Status

Phases 0-28 of the [development plan](docs/development-plan.md) are in place. Phases 0-15 are the full original phase list; Phases 16-19 close out the rest of what the tech spec treats as "core, not optional"; Phases 20-28 begin the next slice — real, designed modules from [`docs/spec.md`](docs/spec.md) scoped after the codebase already existed. Phases 0-10 cover the tech spec's full MVP scope:

- Deployable skeleton (Next.js + Drizzle + Postgres, Docker Compose, Caddy) and the core schema
- Magic-link auth with a minimal profile
- A server-enforced Task lifecycle API (claim/release/park/resume/finish, multi-slot capacity, dependency gating) and a kanban board UI to work it by hand
- Requirement-gated claiming (tier/language/completed-task/custom eligibility, enforced server-side)
- Cycle creation, blank or cloned from the previous cycle (phases and tasks included)
- A task proposal flow (bare title+description submissions, reviewed and activated onto the board)
- A task detail view carrying wiki notes (with revision history), comments, and resource links
- A settings screen for branches, tiers, and whether cycles/phases are on — no direct DB access needed
- A scheduled attention-level job flagging stale, overdue, or newly-unblocked tasks on the board automatically

Phases 11-15 add coordination mechanics beyond MVP scope:

- Subtasks — a current holder can split off a piece of a task as its own claimable card, without releasing the whole thing
- Task openness & request-to-join — claiming an already-held `request` or `coordination_approved` task now files a request the current holder(s) accept or decline, instead of an instant claim
- Admins & Community-endorsed openness — the first real access gate: `/settings` is now reachable only by a current holder of the Admins task, a real `community_endorsed` task on the board (put yourself forward, others endorse, it converts to a real claim once enough do) rather than a hardcoded role — falling back to any member until a Community's first Admins task is ever actually claimed
- Shadow slots & succession — join a task specifically to learn it (exempt from Requirements, doesn't count toward capacity), mark yourself outgoing to nudge the wiki summary before handing off, and a filled shadow slot pre-fills who a cloned cycle's task suggests next
- Remaining coordination mechanics — Requirement waiving with a required, standing-visible reason; a self-assign confirmation check for branch coordination holders (server-enforced, not just UI); an anonymous task signal and a talk-to-my-coordinator ping, both visible to that branch's coordination holders; a community-wide Escalation view; and bulk task selection (tag-based clustering, select-and-claim-with-exceptions)

Phase 16 adds Profile questions — a shared "standing fact about a member" mechanism (once-ever, per-cycle, or tied to one phase name), landing its first real use: a phase-scoped Availability question feeds a new Coordination view showing capacity-aware fitted-ask flags (has room / about right / over, or the exact declared number for members who've opted into sharing it) and who hasn't declared availability for the current phase at all.

Phase 17 adds Input rounds — small, task-specific questions (free text or closed-choice) that anyone can pose on any task at any time. Posing one queues it silently; on a fixed community-wide cadence, everything queued bundles into one round, answerable in a single sitting from a new `/input-rounds` page, and results stay visible on the task itself afterward. A round with nothing queued just doesn't fire.

Phase 18 adds Assemblies — community-wide decisions, from a genuinely urgent one-off to a slower structural question. Any member can propose one, picking their own agenda-building, notice, and voting window durations; the phase (agenda → notice → voting → closed) is always computed from those, never a separate status to keep in sync. Results are live-tallied and always visible, but never applied automatically — turning one into an actual change stays a deliberate human step through the ordinary settings screen.

Phase 19 adds Scheduling polls — "when can enough of the right people actually meet." An organizer opens a poll against a branch and a date range; members paint the windows they're free on a real click-and-drag day-by-time grid, blind — nobody, not even the organizer, sees who submitted what until a slot is confirmed, only the aggregate overlap. Two resolution modes (must overlap a fixed required list, or clear an attendance threshold) decide which slots qualify to confirm. Scheduling a poll also spins up two real tasks right away ("Facilitate…" and "Take notes & publish the summary…"), and a poll can optionally carry an open agenda and a read-tracked summary, each defaulting from its Branch's own setting, falling back to the Community's.

This closes out every phase from the plan's original list plus the "core, not optional" slice added after it.

Phase 20 adds Documentation — the one module that defaults on, same footing as Task notes rather than something a Community has to remember to enable. Freestanding `WikiPage`s carry the same revision-history shape as a task's wiki summary (any member edits, every edit is a new timestamped revision), optionally filed under a branch or left general. A page can also start as a bare question with no answer — it sits flagged unanswered until someone writes a real one, or until it's resolved as a duplicate of an existing page (dropping out of the main index, showing up on the canonical page as "also asked as…"). A new `/documentation` index browses these grouped by branch, alongside a read-only view of every task's own current wiki content — no new storage, just a different lens on data that already exists.

Phase 21 adds Conflict management — a reporting/recusal flow given real design weight, not a thin deferred afterthought. The conflict team isn't a dedicated relationship; it's just whoever currently holds a Community-designated task, same pattern as Admins and branch coordination. Filing a report takes nothing but wanting to talk to someone (no categorization or detail required up front), and recusal works from three directions — the reporter can exclude specific team members up front, and any team member can recuse themselves or a peer once a conflict of interest surfaces. The invisibility guarantee is enforced by the database query itself, not application-level filtering: an excluded team member's view of the report queue is genuinely indistinguishable from the report not existing. Acknowledging a report narrows visibility down to just the reporter and the point of contact; only the reporter can escalate it back open to the whole non-excluded team.

Phase 22 adds Sensitive data — purpose-bound, not role-bound, access to a small fixed set of member fields (health conditions, allergies, emergency contact, orientation). Off by default, and the first real use of `Community.modulesEnabled`'s on/off gating (unused since Phase 1) — later optional modules can register into the same small gate rather than each inventing their own. A Community defines which task or tier unlocks which field; a member always sees and edits their own values regardless. A new `/sensitive-data` page shows, for each field the current viewer is unlocked for, every member's value — the same "surface exactly what's relevant to what you hold" pattern `/coordination` and `/escalation` already use.

Phase 23 adds Contribution tracking — a member's own completed/active/future picture, computed live off Task/TaskAssignment, nothing entered by hand. Categories are Phases (spec's own example categories — "planning, build, live operation, wind-down" — read exactly like Phase names, so this reuses the Cycle/Phase schema rather than a second concept), merged across cycles by phase name; a phase-less task falls into a single "Overall" category. A task assigned in a phase that hasn't started yet counts as future signed-up regardless of its claim status — the same signal spec describes for Browse-period claims and later-phase assignments. A member always sees their own picture; a new opt-in toggle (off by default) lets them share it with the rest of the Community on `/contribution`.

Phase 24 adds the Dashboard — a member's home view, and the new post-login landing page (magic-link verification now lands here instead of `/profile`). A personalized feed reads live off existing state: pending join requests on tasks a member holds, upcoming check-ins on their Waiting tasks, and any currently-held task that's picked up an attention flag. An always-visible community snapshot panel shows Tier composition, Branch spread (distinct members currently holding a task per branch), and Branch health — a per-branch coarse status (*on track · attention needed · struggling*) computed entirely from existing task attention-level state, visible to everyone, with coordination-view holders additionally seeing the real flag counts behind it. Recruitment-facing items, onboarding progress, and anything Spatial-planning-dependent stay out of scope — those subsystems don't exist yet (Spatial planning is currently paused).

Phase 25 adds Forms — the last core shared primitive without a scoped consumer, landing its first real, non-Recruitment use in the same phase: post-cycle feedback. A Form's fields use the exact same free-text/single-choice/multi-choice shape Question and ProfileQuestion already use, but unlike a Question, a Form's fields are submitted together, once, as a single validated event — required fields block the whole submission. `Community.postCycleFeedbackFormId`/`feedbackReviewTaskId` name the community's standing survey and which task's holder reviews responses — the same "the task is the authority" pointer pattern Conflict management already established, not a dedicated role. A new `/feedback` page lets any member submit a response (anonymously, if the form allows it) and lets the review-task holder read every response.

Phase 26 adds the intake half of Budget — fixed costs and itemized proposals, before Phase 27 adds ranked-choice voting and confirmation on top. A `BudgetCycle` carries the non-negotiable fixed costs an admin enters up front, a proposal deadline, and an `ownerTaskId` (whoever holds that task is the budget owner, the same "the task is the authority" pattern Conflict management and post-cycle feedback already established) — only one active cycle per Community at a time for v1. Any member can submit an itemized `BudgetProposal` before the deadline, tag it to a branch, and edit it themselves until the cycle closes; a stored `totalAmount` gets recomputed on every write rather than summed on read. A new `/budget` page shows the current cycle's fixed costs and every proposal, with a submission form while proposals are open and an inline pre-filled edit form for a member's own proposals.

Phase 27 adds ranked-choice voting and confirmation — turning Phase 26's closed proposal list into an actual funded budget. Once the deadline's passed (or the owner judges the list complete), the `BudgetCycle`'s owner-task holder closes proposals to voting; any member can then submit a `BudgetVote` — a full ranking of every proposal plus an optional "how much would you contribute this year?" signal — replaceable until the owner confirms. The live voting view tallies a positional (Borda-style) score across submitted votes for the aggregate order, alongside each proposal's cost-per-member and a running total. Confirming locks in a funded set the owner chooses — informed by, not bound to, the ranking — with a rationale required only when that set actually deviates from what the ranked order alone would have funded. Once confirmed, `/budget` shows the final funded/not-funded breakdown and, for each member, the real ask against the number they signaled.

Phase 28 adds Event scheduling — a community's own internal programme, reusing the same "the task is the authority" pattern Budget/Conflict management/post-cycle feedback already established rather than inventing a new access model. Any member submits an `EventProposal` (host, title, duration, space needs, and a set of preferred slots) at any time; the `Community.eventSchedulingOwnerTaskId` holder reviews them, and every review recomputes fresh conflict flags — two proposals sharing a space with overlapping slots both get flagged, checked against whichever slots a proposal currently has (its confirmed one, once set, or its full preferred list otherwise). A flagged host can propose a different slot themselves, or the owner can ping them as a nudge, or just mediate directly and confirm a compromise slot outside what either side originally listed — ranked choice sets priorities, but the final call here is just as human. Once every currently-pending proposal is confirmed or declined, the owner publishes: a single timestamp locks them from further edits and makes them readable by every member on a new `/schedule` page, right alongside a member's own outstanding proposals and a submission form. There's no separate "the schedule" entity or cycle-wide gate — publishing just takes whatever's pending at the time, and a fresh batch can start accruing again immediately after.

Shifts/rota (Phases 29-30) is scoped in `docs/development-plan.md` but not yet built, alongside Spatial planning (Phases S1-S3, deliberately non-numeric while paused rather than reserving real phase numbers for it). See that doc for what's next.

## Documentation

- **[`docs/overview.md`](docs/overview.md)** — plain-language introduction: what Orchard is, how it feels to use, no technical detail. Start here if you're deciding whether this is useful to you or your community.
- **[`docs/spec.md`](docs/spec.md)** — the full technical specification: data model, mechanisms, module design, open engineering questions. Start here if you're building it or evaluating it as an engineer.

## Deploying

**On a fresh VPS**, harden it first — as root:

```bash
curl -fsSL https://raw.githubusercontent.com/DustyCupcake/Orchard/main/scripts/harden.sh | bash
```

Creates a non-root admin user, locks SSH down to key-only (with a safety gate — it won't disable root/password login until you've confirmed the new user works from a separate terminal), sets up `ufw`/`fail2ban`/`unattended-upgrades`, and adds a swapfile. Safe to re-run if it stops partway. Once it finishes, **log back in as the new admin user** (root SSH login is now disabled) and continue below with `sudo`.

**Then, on that VPS (fresh or existing):**

```bash
git clone https://github.com/DustyCupcake/Orchard.git /opt/orchard
cd /opt/orchard
sudo ./scripts/deploy.sh
```

Installs Docker if needed, prompts for your domain and TLS email on first run (generating random DB/session secrets into `.env`), builds the image, and brings the stack up under Caddy with automatic HTTPS. Safe to re-run — after a `git pull`, running it again rebuilds and restarts without touching your data or an existing `.env`. Skipping `harden.sh` is fine too (e.g. on an already-hardened box) — `deploy.sh` doesn't depend on it, it just picks up a couple of its settings (docker-group membership, IPv6 networking) if it finds them.

To run it locally instead: copy `.env.example` to `.env`, fill in `DOMAIN=localhost` and the rest, then `docker compose up -d`.

## Testing

The lifecycle/CRUD test suite runs against a real Postgres (no mocks — see `tests/`). Point it at any disposable database:

```bash
DATABASE_URL=postgres://orchard:test@localhost:5432/orchard SESSION_SECRET=test npm test
```

## Who this is for

Built first for Peach Please's own use — recruitment, running a season, coordinating a camp at a burn. The engine underneath isn't camp-specific: branches, tiers, cycles, and every module are community-configured rather than hardcoded, so the same tool should work for a housing cooperative, a mutual aid group, a software project, or any other group organizing itself around shared, claimable work. Other communities are welcome to use it, fork it, and adapt it to their own shape.

## License

[AGPL-3.0](LICENSE). Chosen deliberately: any community can self-host Orchard, modify it freely, and run it privately with zero obligations — that's the common case, and it stays completely unrestricted. The one thing AGPL prevents is someone taking this, improving it, and running it as a closed hosted product for other people without releasing those changes back. If that ever matters to you, it's already handled; if it doesn't, you'll never notice the license is there.

## Contributing

No code yet, so no contribution process yet either. If you want to weigh in on the design — whether you're evaluating this for your own community or just have opinions — open an issue.
