# 🌳 Orchard

A general-purpose engine for task-based, distributed-effort coordination — built first for [Peach Please](https://peachple.se), a theme camp, but not specific to burns or camps. Any group that gets things done through shared, voluntary effort runs into the same problems: willing people don't know what needs doing, coordination overhead outgrows the work itself, and institutional knowledge lives in one or two heads until they step back and it disappears with them. Orchard is an attempt to actually fix that, not paper over it with another shared spreadsheet.

The core idea: **work, not roles.** The atomic unit is the task, not the position. A task is claimed, not assigned; a role is just a description of what someone currently happens to be holding, not a fixed job. Everything else in this project — browsing and claiming, running a season, asking the community something, handling conflict — follows from that one starting point.

## Status

Phases 0-17 of the [development plan](docs/development-plan.md) are in place. Phases 0-15 are the full original phase list; Phases 16-17 are part of a further slice closing out the rest of what the tech spec treats as "core, not optional." Phases 0-10 cover the tech spec's full MVP scope:

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

Not yet built: Phases 18-19 (Assemblies, Scheduling polls — the rest of spec's "core, not optional" list) and everything beyond MVP scope in the [tech spec](docs/spec.md) (Recruitment, Budget, Spatial planning, and the rest) — real, designed work that just isn't broken into phases yet. See [`docs/development-plan.md`](docs/development-plan.md) for what's next.

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
