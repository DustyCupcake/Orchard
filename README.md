# 🌳 Orchard

A general-purpose engine for task-based, distributed-effort coordination — built first for [Peach Please](https://peachple.se), a theme camp, but not specific to burns or camps. Any group that gets things done through shared, voluntary effort runs into the same problems: willing people don't know what needs doing, coordination overhead outgrows the work itself, and institutional knowledge lives in one or two heads until they step back and it disappears with them. Orchard is an attempt to actually fix that, not paper over it with another shared spreadsheet.

The core idea: **work, not roles.** The atomic unit is the task, not the position. A task is claimed, not assigned; a role is just a description of what someone currently happens to be holding, not a fixed job. Everything else in this project — browsing and claiming, running a season, asking the community something, handling conflict — follows from that one starting point.

## Status

Early. Phases 0-5 of the [development plan](docs/development-plan.md) are in place: a deployable skeleton, the core schema, magic-link auth with a minimal profile, a server-enforced Task lifecycle API (claim/release/park/resume/finish, multi-slot capacity, dependency gating), a kanban board UI to work that lifecycle by hand, and Requirement-gated claiming (tier/language/completed-task/custom eligibility, enforced server-side). No task-creation UI yet — that's Phase 7.

## Documentation

- **[`docs/overview.md`](docs/overview.md)** — plain-language introduction: what Orchard is, how it feels to use, no technical detail. Start here if you're deciding whether this is useful to you or your community.
- **[`docs/spec.md`](docs/spec.md)** — the full technical specification: data model, mechanisms, module design, open engineering questions. Start here if you're building it or evaluating it as an engineer.

## Deploying

On a fresh or existing Debian/Ubuntu VPS, as root:

```bash
git clone https://github.com/DustyCupcake/Orchard.git /opt/orchard
cd /opt/orchard
./scripts/deploy.sh
```

The script installs Docker if needed, prompts for your domain and TLS email on first run (generating random DB/session secrets into `.env`), builds the image, and brings the stack up under Caddy with automatic HTTPS. It's safe to re-run — after a `git pull`, running it again rebuilds and restarts without touching your data or an existing `.env`.

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
