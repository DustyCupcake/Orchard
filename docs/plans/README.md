# Plans

Working documents for how something is going to get built: proposals, audits, design decisions not
yet turned into code, and the plans for features that are still partly open.

Nothing here is specification. The authoritative statements about what Orchard **is** are
[`../spec.md`](../spec.md), [`../roadmap.md`](../roadmap.md) for what's deliberately unbuilt, and
[`../../CHANGELOG.md`](../../CHANGELOG.md) for what actually shipped and how it was verified. A
plan document is a record of intent at a point in time; when intent and reality disagree, reality
is what the code and those three files say.

## The two directories

| | |
|---|---|
| **This directory** — live plans | Work that is still open. Every document here has something unbuilt in it. |
| [`archive/`](archive/) — shipped plans | Work that is done. Kept for the reasoning behind a decision, never cited as current state. |

A plan moves to `archive/` once its work is built, tested and committed, and its outcome is written
up in `CHANGELOG.md`. Moving it is a `git mv` plus a status line at the top of the document saying
what shipped — the body is left as written, because the point of keeping it is to show how the
decision was reached, not to describe the code.

Archive a plan **in the same commit** as the last piece of its work, not later. A plan whose
outcome is already in `CHANGELOG.md` and which still sits here is a document the next person will
read as pending work.

## What goes here, and what doesn't

**Goes here:** anything describing work to be done. Audits of the spec against the code, per-feature
build plans, design proposals awaiting a decision, the scratch plan for whatever's being scoped
next ([`development-plan.md`](development-plan.md)).

**Doesn't go here:** anything describing what exists. Reference material, defaults tables,
conventions, and design hand-offs belong in `docs/` proper, because those are read as current
truth rather than as pending work. When a plan turns out to be a durable answer rather than a
proposal — a defaults set the code is written from, say — promote it out of here rather than
archiving it.

## Writing a new plan

Plans in this repo are detailed, and deliberately so. They carry the *reasoning* behind a decision,
not just the decision, because the reasoning is the part that can't be recovered from the diff once
someone asks why. A plan that states what to build without saying why this way rather than the
obvious way will be re-litigated the next time the question comes up.

Three things every plan here does:

- **States the working principle in a blockquote**, in the product owner's words, agreed with them
  rather than inferred. Where a plan is a reversal of an earlier decision, it says which one and why.
- **Marks its own decisions** (D1, J3, and so on) so later documents can cite them by number instead
  of restating them, and so a superseding document can point at exactly which decisions survive.
- **Notes supersession explicitly**, at the top, naming the document that wins and what of this one
  still stands. Two of the archived plans here (`open-permissions-plan.md`,
  `recruitment-access-plan.md`) were each partly superseded by the other; that's only legible
  because both said so.

Every plan carries a **status line** at the top saying what has actually been built. Update it in
the same commit as the work, not in a cleanup pass later — a stale status line is worse than no
status line, because it reads as current. When a plan's own text drifts from reality mid-build
(a count here, a finding there), add a dated note saying so rather than silently rewriting the
original text; the drift is itself information about how the work went.

## Referencing a plan from code

Code comments and tests cite plans as `docs/plans/<name>.md` for live work and
`docs/plans/archive/<name>.md` for shipped work, which is how the test files and schema comments
across `src/` refer to them. The convention has been in place since the move into these
directories, when the mechanical path update was applied repo-wide.