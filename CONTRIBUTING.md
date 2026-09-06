# Contributing to Orchard

Orchard was built phase by phase against [`docs/spec.md`](docs/spec.md), each phase small enough to pick up cold, build, test against a real database, verify against a real deployment, and leave in a working state. [`CHANGELOG.md`](CHANGELOG.md) is the record of that — every phase, what it built, real bugs found along the way, how it was verified. The guidelines below are exactly the workflow that record reflects, written down so anyone picking up work here — not just whoever built the last phase — follows the same conventions.

## Before you start

- **Read the relevant part of [`docs/spec.md`](docs/spec.md) first**, even for something that sounds simple. Spec is dense and precise on purpose; a feature's exact shape usually comes from a specific paragraph there, not from guessing at what seems reasonable. Where spec is genuinely ambiguous, make a documented, defensible call rather than guessing silently — say so in a code comment and in the PR/commit message.
- **Check [`docs/roadmap.md`](docs/roadmap.md)** for what's already been considered and deliberately deferred, and why. If what you want to build is on that list, the reasoning for why it waited is there — read it before re-opening the question from scratch.
- **For anything beyond a small, obvious fix, open an issue first.** This is a single-tenant, self-hosted, community-governed tool with real design opinions running through it (task-based access, no leaderboards, private-by-default data) — worth confirming a change fits that shape before investing in a PR that might not land.

## Architecture

The actual, decided stack — as opposed to `docs/spec.md`'s own "Suggested architecture" section, which is exploratory and predates several of these choices being locked in.

- **Framework:** Next.js (App Router), TypeScript throughout. Two interfaces exist side by side, not one chosen over the other: most resource-shaped operations (tasks, members, branches, cycles, and similar CRUD-like entities) have a real REST route under `src/app/api/` alongside their page's own Server Action, useful for scripting/testing and any future non-browser client; the more deeply UI-integrated flows (the settings screens, permission-grant editing, proposal activation) are Server-Action-only (`<form action={fn}>`), since they don't reduce to a clean single-resource REST shape. Both call the same underlying `src/lib/` functions — neither is a thin wrapper reimplementing logic the other already has.
- **Database:** Postgres, via Drizzle ORM — chosen over Prisma for its closer-to-SQL query builder and lack of a separate codegen step blocking iteration.
- **Deployment:** Docker Compose — `app` (the Next.js server, `output: 'standalone'`), `postgres`, and `caddy` (automatic HTTPS via Let's Encrypt, or plain HTTP behind a bare IP before DNS is pointed at it). One deployment per Community — decided against multi-tenancy outright (see `docs/roadmap.md`); there's no tenant-scoping logic anywhere in the app.
- **Auth:** provider-pluggable from day one. Magic-link always works; a Community can additionally configure OIDC single sign-on (confirmed against Zitadel) alongside it.
- **Scheduling:** a lightweight in-process scheduler (`node-cron`, see `src/lib/scheduler/`), not a separate queue system or worker process — every recurring job (attention-level recomputation, browse-period resolution, input-round cutoffs, and others) registers here and polls on its own cadence. A deliberate scale call: single-tenant, one Community's worth of activity, not SaaS-scale job volume.
- **No native file storage.** Task resources (and anything else pointing at an external file) are links only, never an upload Orchard stores itself — spec's own bet is that this holds up in practice; revisit only if real friction shows up (see `docs/roadmap.md`). `docker-compose.yml` already mounts an unused `uploads` volume into the `app` container, reserved ahead of that feature landing.
- **Memory & swap budget.** The reference deployment targets a small VPS (1-2GB RAM). `scripts/harden.sh` provisions a swapfile and tunes `vm.swappiness` for exactly this reason; `APP_MAX_OLD_SPACE_MB`/`BUILD_MAX_OLD_SPACE_MB` (`.env.example`) cap the app's Node heap for the runtime process and the heavier one-off `next build` step separately.
- **Backups are full state, not just a database dump.** Since native file storage is out of scope, a plain `pg_dump` of the `postgres` volume is currently the whole of a Community's real state. If native file storage or any other externally-stored state is ever added, the backup path needs to grow to cover it explicitly — an export that quietly omits a category of state, discovered only at restore time, is worse than an honest partial export that says so upfront.

A few deliberate non-choices, so they don't get silently revisited: not a separate API-first backend (Server Actions colocate a form and its mutation, which fits this codebase's size better than a formal contract between two deployables); not Prisma (Drizzle's query builder stays closer to real SQL, which matters for queries this non-trivial); not Kubernetes or a managed platform (a single Compose stack on one VPS is the right complexity level for a self-hosted, single-tenant tool).

## Local setup

```bash
cp .env.example .env   # fill in a real SESSION_SECRET at minimum for local dev
npm install
docker run --rm -d -p 5432:5432 -e POSTGRES_USER=orchard -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=orchard postgres:16-alpine
DATABASE_URL=postgres://orchard:dev@localhost:5432/orchard npm run db:migrate
DATABASE_URL=postgres://orchard:dev@localhost:5432/orchard npm run dev
```

Or skip straight to a full deployment-shaped stack with `docker compose up -d` (see the README's own "Deploying" section for the production path — the same compose file works for local use with `DOMAIN=localhost`).

## Testing

**Tests run against a real, disposable Postgres — never mocked.** This project's whole `tests/` suite exercises the actual database through the actual Drizzle queries; a passing test means the SQL genuinely works, not that a mock was configured to agree with the code. Point it at any throwaway database:

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_USER=orchard -e POSTGRES_PASSWORD=test -e POSTGRES_DB=orchard --name orchard-test-pg postgres:16-alpine
DATABASE_URL=postgres://orchard:test@localhost:5433/orchard node scripts/migrate.mjs
DATABASE_URL=postgres://orchard:test@localhost:5433/orchard SESSION_SECRET=test npm test
```

(`SESSION_SECRET` is required even for tests that don't look auth-related — anything touching magic links or the generic action-token infrastructure throws immediately without it.) Never treat a phase's database-touching logic as verified from unit-level assertions alone if there's no real query behind them.

**Then verify manually against a real deployment.** Automated tests prove the logic; they don't prove the actual page renders, the actual button does the right thing, or that a redirect lands somewhere real. Build and run the real `docker-compose.yml` stack, log in through the real magic-link flow, and exercise the feature through the real UI. A `docker-compose.override.yml` with `ports: ["3000:3000"]` on the `app` service (gitignored, not meant to be committed) gives direct plain-HTTP access for this, bypassing Caddy's self-signed local TLS.

## Code conventions

- **No comments explaining *what* code does** — clear naming should already cover that. A comment earns its place only when it captures something a reader couldn't otherwise recover: a non-obvious interpretation of an ambiguous spec requirement, a subtle invariant, a workaround for a specific constraint. If deleting a comment wouldn't leave a future reader confused, delete it.
- **No abstraction ahead of a second real use.** Three similar lines beat a premature helper; extract a shared component or function once actual duplication shows up, not in anticipation of it. Several places in this codebase (e.g. `src/components/ui/kit.tsx`'s shared form-field components) were deliberately extracted only once a third call site needed the exact same markup — check git history/CHANGELOG for the reasoning if you're about to extract something.
- **Don't add error handling or validation for states that can't happen.** Trust internal invariants and framework guarantees; validate at real system boundaries (user input, external APIs) only.
- **A resolved ambiguity gets written down, not just decided.** Where spec.md leaves something open and you make a defensible call, say so in a short code comment and in your commit/PR description — future readers (and future you) shouldn't have to reverse-engineer *why* something works the way it does.
- **Follow the access model already established**: a permission is a claimable task, not a hardcoded role (see `src/lib/permissions.ts` and spec's own "Access follows the task"). If a new feature needs a gate, it almost certainly belongs in the existing `PermissionGrant` table under a new module key, not a new bespoke mechanism.

## Commit conventions

- **One commit per coherent, phase-sized change** — not one commit per file, not a giant commit bundling several unrelated changes. Look at `git log` for the established granularity before deciding how to split your own work.
- **Write a detailed commit message.** What was built, real bugs found and fixed along the way, what automated tests cover, and what manual verification actually exercised. These messages are themselves documentation — `CHANGELOG.md`'s own entries are written at exactly this level of detail, and future readers (including future sessions of whoever's building this) reconstruct context from git log and CHANGELOG, not from re-reading every diff.
- **Update `CHANGELOG.md` (and `README.md`'s feature list, if the change is user-facing) in the same commit as the code** — not a separate follow-up commit.
- **Never commit `docs/development-plan.md` or `docs/development-plan.full-archive.md`.** Both are deliberately local-only working notes (see their own text) — everything durable belongs in `CHANGELOG.md`, `docs/roadmap.md`, or `docs/spec.md` instead, all of which are committed.

## Where things live

- [`docs/spec.md`](docs/spec.md) — the authoritative technical specification: data model, mechanisms, module design, resolved open questions. Start here.
- [`docs/overview.md`](docs/overview.md) — the plain-language, non-technical pitch. Useful for understanding *why* a mechanic is shaped the way it is, not *how* it's implemented.
- [`CHANGELOG.md`](CHANGELOG.md) — what's been built, phase by phase, and how it was verified.
- [`docs/roadmap.md`](docs/roadmap.md) — what's deliberately not built yet, and why.
- `docs/development-plan.md` — local-only scratch space for scoping whatever gets built next. Not part of the repo's history; don't expect it to reflect anything durable.

## Questions or design feedback

No formal RFC process — for something that touches the platform's actual design decisions (not just an implementation detail), open an issue and lay out the reasoning, the same way `spec.md` and `docs/roadmap.md` do for existing decisions. If you're evaluating Orchard for your own community and have opinions rather than code, that's equally welcome as an issue.
