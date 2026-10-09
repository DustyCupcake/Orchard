# Plan archive

Shipped plans. Each document here describes work that is built, tested and committed, and its
outcome is recorded in [`../../../CHANGELOG.md`](../../../CHANGELOG.md).

These are kept for the reasoning, not as reference on how the system works. A plan documents what
someone decided to build and why they decided it that way — the "why this rather than the obvious
alternative" part, which is the part that can't be reconstructed from the diff once someone asks.
The bodies are left exactly as written for that reason: they describe the state of the code *before*
the change, so a reader has to know that. Each one's status line at the top says what actually
shipped, and where the shipped thing differs from the plan, that's called out.

For what Orchard currently does, read [`../../spec.md`](../../spec.md) — not these.

| Document | What it built |
|---|---|
| [`cycle-scope-remediation-plan.md`](cycle-scope-remediation-plan.md) | `task.cycleId` as the single source of truth for scoping a task-granted permission, retiring `permission_grant.cycle_id`; the `backstop` and `shift_management` modules |
| [`open-permissions-plan.md`](open-permissions-plan.md) | the per-module "open to everyone" Community setting, checked ahead of task-gating in every resolver. Superseded `recruitment-access-plan.md` §4 |
| [`joining-admission-plan.md`](joining-admission-plan.md) | the joining surface: lanes, the third door, the mediation grant, support and nomination, consensus, pairing (J1–J12). Flow half superseded by [`../admission-flow.md`](../admission-flow.md) |
| [`food-drinks-module-plan.md`](food-drinks-module-plan.md) | the Kitchen module — menu planning, meals, scaled ingredients, purchase lists, participatory input |
| [`development-plan.full-archive.md`](development-plan.full-archive.md) | the original Phase 0–69 build plan, pre-trim, not edited since |
| [`task-board-views-spec-audit.md`](task-board-views-spec-audit.md) | the raw spec-vs-code audit session, kept as the source for [`../spec-audit-remediation-plan.md`](../spec-audit-remediation-plan.md). A transcript, including the prompts — read the remediation plan instead |

Two plans here are only *partly* superseded and keep a live counterpart: `open-permissions-plan.md`
against [`../recruitment-access-plan.md`](../recruitment-access-plan.md), and
`joining-admission-plan.md` against [`../admission-flow.md`](../admission-flow.md). Each says so at
the top. Where the two disagree, the live one wins.

`development-plan.full-archive.md` exists because [`../development-plan.md`](../development-plan.md)
was trimmed once its 69 phases were all complete, and the trimmed file no longer shows how any
phase was originally scoped. It is not edited and not cited anywhere in `src/`.