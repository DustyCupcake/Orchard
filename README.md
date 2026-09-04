# 🌳 Orchard

A general-purpose engine for task-based, distributed-effort coordination — built first for [Peach Please](https://peachple.se), a theme camp, but not specific to burns or camps. Any group that gets things done through shared, voluntary effort runs into the same problems: willing people don't know what needs doing, coordination overhead outgrows the work itself, and institutional knowledge lives in one or two heads until they step back and it disappears with them. Orchard is an attempt to actually fix that, not paper over it with another shared spreadsheet.

The core idea: **work, not roles.** The atomic unit is the task, not the position. A task is claimed, not assigned; a role is just a description of what someone currently happens to be holding, not a fixed job. Everything else in this project — browsing and claiming, running a season, asking the community something, handling conflict — follows from that one starting point.

## Features

**Task coordination** — a claim-based kanban board (claim/release/park/resume/finish, multi-slot capacity, dependency gating — set through a real add/remove UI on the task detail view and the proposal-activation screen, with circular dependencies rejected server-side), requirement-gated claiming (tier/language/completed-task/custom eligibility, plus non-gating group-coverage and soft-priority requirements with a live "covered" status line and an opt-in "sort by what fits me" board dimension — attached and edited the same way, not just enforced), subtasks, shadow slots for succession, open/request-to-join tasks, requirement waiving with a standing reason, anonymous signals and coordinator pings, a community-wide Escalation view, bulk tag-based task selection, coordinator/peer task nomination — a real one-click claim on someone's behalf, confirmable from the platform or a genuine no-login email action, auto-releasing back to Unclaimed if it goes unanswered — response tracking: an expired nomination, an ignored Waiting nudge, or an unread required call summary each log a live-computed per-member engagement pattern (noted/soft flag/pattern), visible to branch coordination and on the Accompaniment task's own detail view, resolved automatically by any real response — and outbound messages: a branch coordination holder, a task's current co-holders, or whoever can start a cycle can each send a real, logged email to their own live-resolved audience (a branch's roster, a task's holders, or everyone arriving in a declared window), plus community-wide announcements gated the same "the task is the authority" way as everywhere else, all respecting a member's own email opt-out.

**Cycles & seasons** — create a Cycle blank or cloned from the previous one (phases and tasks included), a real resolvable date model for Cycle/Phase boundaries (absolute or relative — a day offset or a percent-through, recomputed as anchors move), named Cycle types (Season, Reunion, Workday) that Tiers can count occurrences of, and Participation declarations (coming/maybe/not-coming, arrival/departure) against a Cycle's capacity and returning-priority window.

**Task Packs** — save a cycle's task set (or a hand-picked subset) as a named, downloadable pack — phases, tasks, requirements, milestones, wiki seeds, and resources included — and import one into a new cycle in a different Community through a real branch-reconciliation review screen (an exact match, a flagged "similar match" suggestion for a close-but-not-quite name, remap, create new, or decline down to a per-task reassignment) plus a date preview, before anything commits. A Cycle type can suggest a default pack to quick-start from.

**Community input & governance** — Assemblies for community-wide decisions (propose → agenda → notice → voting → closed, always time-computed), Input rounds for small task-specific questions bundled on a standing cadence, Profile questions (once-ever, per-cycle, or phase-scoped) with a capacity-aware Coordination view, and Admins/branch-coordination access gates that are themselves just claimable tasks, not hardcoded roles — a task's endorsement threshold can be set to zero for a role that should confirm the moment someone steps up, no endorsement required.

**Documentation** — freestanding wiki pages (revision history, optional branch filing, FAQ-style unanswered/duplicate handling) alongside every task's own wiki notes, comments, and resource links.

**Conflict management** — a reporting/recusal flow where the conflict team is just whoever holds a designated task; database-enforced invisibility for excluded members, with visibility narrowing or widening as a report is acknowledged or escalated.

**Privacy & sensitive data** — purpose-bound (not role-bound) access to a small fixed set of sensitive member fields, off by default and configured per task or tier, with each field optionally gated behind an active, member-granted consent record that stops the field showing the moment it's withdrawn.

**Member contact & privacy** — per-method contact visibility (everyone/task-or-group-mates/emergency-only), logged Emergency access that any member can activate on another's emergency-only info, and a community-defined consent-purpose registry members grant or withdraw against.

**Contribution tracking** — a member's own completed/active/future picture across tasks and shifts, categorized by Phase, with an opt-in community-visible share and cycle-wide averages.

**Dashboard** — a personalized feed (pending join requests, upcoming check-ins, flagged tasks, pending invites, and needs-action items for whoever owns Budget/Event scheduling/Shifts/Conflict management) plus a community snapshot (tier composition, branch spread, per-branch health) and, for a member who hasn't finished or skipped it, an onboarding panel.

**Member onboarding** — a first-session nudge, never a gate: a handful of static orientation cards, any onboarding-tagged Profile questions still unanswered, and 2-3 open tasks tag-matched to the member's own strengths with a link out to the full board — the same tag-overlap heuristic that surfaces a "you might also like" strip once a task is marked done.

**Forms & feedback** — a shared form primitive (free text/single/multi-choice) reused across post-cycle feedback, recruitment applications, and more, authored through a real settings-screen builder (add/remove/reorder fields, live preview, inline validation) rather than hand-typed config — the same builder edits a Form's fields or a Profile question's shape after creation too, never just at first authoring.

**Budget** — fixed costs plus itemized member proposals, ranked-choice (Borda-style) voting with cost-per-member and a running total, and an owner confirmation step that requires a rationale only when it deviates from the ranked order.

**Event scheduling** — an internal programme where any member proposes slots, conflicts are recomputed automatically on review, and a designated owner mediates and publishes.

**Shifts / rota** — recurring, never-"done" work distinct from one-shot tasks: batch-generated occurrences, first-come sign-up, self-reported completion or coordinator-marked no-shows, and a one-click "rotate this task into a shift."

**Recruitment** — public invite links and an inquiry inbox, an evaluated-admission funnel (configurable evaluator count and decision rules) that converts an accepted applicant into a real, loggable-in member, blind-availability intro-call scheduling for not-yet-members with an auto-lapsing availability subscription, and a live pipeline view of every candidate in flight — alongside a separate door for an already-known roster: an admin can bulk-add a pasted or CSV-uploaded name/email list directly, after a review screen showing exactly who's new versus already a member, skipping the application funnel entirely for people already vouched for.

**Spatial planning** — an SVG-based collaborative site editor (plots, zones, and to-scale placements — tents, vehicles, structures), vertex-level editing with live area/length labels, optional GPS geo-anchoring, GeoJSON/image export, and a propose→approve flow for shared or task-linked placements.

**Calendar & scheduling** — click-and-drag blind-availability scheduling polls, task milestones, freestanding personal/shared calendar events with fan-out invites, and a unified Calendar view (a month grid plus an upcoming list) reading every dated thing in the app as its own layer — Phase/Cycle boundaries, milestones, events, Input round cutoffs, Assembly windows, resolved polls, the published programme, your own upcoming shifts, the current Budget cycle's deadline, and an opt-in birthday — plus a real date preview (calendar or list) before cloning a Cycle commits to anything.

**Authentication** — provider-pluggable, not one fixed method: magic-link (no password, no external dependency) is always available, and a community can additionally configure OIDC single sign-on (confirmed against Zitadel) alongside it — role-gated provisioning (no configured project role, no account, even for an otherwise-valid login) and an identity keyed on the provider's durable subject claim rather than email, so a login always resolves to the same member even after their email changes upstream.

**Navigation & UI** — a collapsible icon-rail sidebar on desktop and a hamburger drawer on mobile, grouped by function, with modules automatically hidden when disabled and auto-pinned for whoever currently holds their gating task.

**On-site mode** — a Community-wide toggle that locks structural/configuration changes (settings, branches, tiers, cycle types, starting a new Cycle, Requirement changes) and further edits to the published Event schedule or the Spatial-planning layout, while everyday task/wiki/shift work stays fully live throughout — a visible banner explains why, and turning it back off restores normal editing immediately.

**Support & View-as** — a claimable Support task (same pattern as Admins/branch coordination) unlocks a strict read-only "view exactly as this member would see it" mode for troubleshooting, with every write disabled and every activation logged — including the one hard exception spec calls for: viewing as a recused conflict-team member never bypasses their own exclusion.

Built incrementally, one phase at a time — see [`CHANGELOG.md`](CHANGELOG.md) for the full build history and [`docs/development-plan.md`](docs/development-plan.md) for what's scoped next.

## Documentation

- **[`docs/overview.md`](docs/overview.md)** — plain-language introduction: what Orchard is, how it feels to use, no technical detail. Start here if you're deciding whether this is useful to you or your community.
- **[`docs/spec.md`](docs/spec.md)** — the full technical specification: data model, mechanisms, module design, open engineering questions. Start here if you're building it or evaluating it as an engineer.
- **[`CHANGELOG.md`](CHANGELOG.md)** — phase-by-phase build history, one entry per shipped phase.

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

**After the first deploy**, redeploying a change doesn't need `deploy.sh` again — use `./scripts/rebuild.sh` instead. It hashes `.env`, `Caddyfile`, `docker-compose.yml`, and the app code separately and only does what each actually needs (a Caddy reload for a `Caddyfile` edit, `up -d` for an `.env` edit, a full image rebuild only when app code changed) — a no-op if nothing did. `./scripts/reset.sh` is the blunt version for when something's stale and you want to force a redo — `--app`/`--caddy`/`--db` to redo just one piece, or no args for everything; it never touches data volumes.

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
