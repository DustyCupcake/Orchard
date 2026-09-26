# Recruitment Access Plan — the task-gated floor, and who may evaluate

**Status:** §1–§3 describe a defect that is live today and are partially mitigated by the
/recruitment hub (landed, see §5). §4 is **superseded** by `docs/open-permissions-plan.md`
(see its §2.3 for the scope semantics that now apply to Recruitment). Decisions D1–D5 in §6
below are specific to the *reporting* half of this doc and still stand; the *design* half has
moved.

**Scope:** the Recruitment module's access model — who can see the pipeline, who can file
an evaluation, who can decide — and the question of whether a Community should be able to
grant some of that to *everyone* rather than to a task holder.

**Working principle, agreed with the user:**

> **Task-gating decides who holds the role. A Community setting decides what the floor is**
> — what any member can already do or see without the role. These are additive, never
> either/or.

The distinction matters because the codebase's permission model is entirely task-shaped
(§2.1) and a proposal to widen it is, on its face, a proposal to add a second authority
system. It is not, if the widening is expressed as a *policy floor* rather than as an
alternative way to hold the role. §4 keeps that line.

---

## 1. The defect: no application can ever be decided, on defaults

This is the substantive finding, and it is the reason the widening question is worth
asking at all.

| Fact | Where |
|------|-------|
| A decision requires **N distinct filed evaluations**, N defaulting to **2** | `community.ts:103` (`recruitmentEvaluatorCount`, `.notNull().default(2)`) |
| No outcome is computed until `evaluations.length >= evaluatorsNeeded` | `evaluations.ts:145-147` — returns `outcome: null` below the threshold |
| Only a **current holder of a `recruitment`-granted task** can file an evaluation | `recruitment/access.ts:22-44` (`isRecruitmentTaskHolder` / `requireRecruitmentTaskHolder`), enforced again in `applications.ts` via `listApplicationsForEvaluation` |
| `recruitment` is **single-cardinality per scope** — at most one granting task, hence one holder | `permissions.ts:196-212` — `recruitment` is not in `MULTI_CARDINALITY_MODULES` |

Therefore, in a Community with one event and one recruitment-granted task, the maximum
number of distinct evaluators is **1**, while the default requirement is **2**. The
consequences compound:

- Every conditional decision rule is unreachable. The example the Recruitment settings tab
  offers the admin is literally `[{"conditions":{"minCounts":{"proceed":2}},"outcome":"proceed"}, …]`
  (`settings/page.tsx:603-616`) — a threshold of two that one person cannot reach.
- Only the mandatory unconditional fallback rule can ever match, so every application that
  accumulates enough evaluations resolves to `wider_discussion` by default rather than by
  the Community's actual policy.
- Applications park at `decision_pending` indefinitely. That stage is in `NEEDS_ACTION_STAGES`
  (`recruitment/page.tsx:42`) and in `listRecruitmentActionItems`, so the *only* recurring
  symptom is a Dashboard feed — "Recruitment candidates stuck waiting on you" — pointing at
  a stage that can never resolve, for a Community that did nothing wrong.

The schema comment is candid about the design rather than the bug
(`community.ts:97-102`): the evaluators "are resolved as whoever currently holds a task
granting the `recruitment` module … **not a separate assignment mechanism**." The data model
wants an evaluation *panel* — `evaluation.evaluatorId` is per-evaluator and
`recruitmentEvaluatorCount` is configurable — but the access model permits exactly one
person. The default configuration is therefore internally unsatisfiable.

**Decided — D1:** do not silently resolve this by changing defaults. A Community that has
tuned `recruitmentEvaluatorCount` to 3 has expressed an intent, and quietly rewriting it to
1 would destroy that signal. The hub reports the gap (§5); §4 is the fix.

---

## 2. Current state: what a member without the task can see

### 2.1 The permission model is entirely task-shaped

All thirteen `PermissionModuleKey` values resolve identically — "whoever, non-shadow,
currently holds a task carrying a `permission_grant` row for this module," scoped by the
granting task's own `task.cycleId` (`permissions.ts:104-126`, `171-180`; the scope rule is
`docs/cycle-scope-remediation-plan.md` §2.1). Phase 63 of the development plan
*deliberately removed* nine looser `Community` columns and a `Task.tags` match, because they
were a second authority path that could be set inconsistently — the `Task.tags` version could
silently grant live access from an ordinary board-categorisation tag.

This history is the main constraint on §4. Any widening mechanism must not become a third
way to grant Recruitment that can disagree with the first two.

### 2.2 The per-capability matrix as shipped

| Capability | Who can, today | Gate |
|---|---|---|
| See the pipeline (stage, timing) | holder only | `getRecruitmentPipeline` → `requireRecruitmentTaskHolder` (`pipeline.ts:134-147`) |
| See an applicant's own answers | holder only | `listApplicationsForEvaluation` (`applications.ts:272-320`) |
| File a recommendation | holder only | `submitEvaluation` (`evaluations.ts:180-221`) |
| Resolve wider discussion / decide | holder only | `resolveWiderDiscussionManually`, `recordDecisionIfReached` |
| Read the inquiry inbox | holder only | `listInquiries` (`inquiries.ts:34-41`) |
| See that *something* is pending | **any subscriber** | `listApplicationAlerts` (`applications.ts:230-261`) — requires an active `recruitmentSubscription` |
| Raise an objection during wider discussion | **any subscriber** | `raiseObjection` (`objections.ts:23-48`) |
| Submit intro-call availability | any subscriber | `listOpenIntroCallsForSubscriber` (`subscriptions.ts:72-94`) |

The last four rows matter for §4: **a per-person, non-task permission already exists.**
`recruitmentSubscription` is opt-in per member and confers alerts + objection rights with no
task anywhere in the picture. So "permission not derived from a task" is not a new concept
in this module — it simply has no Community-wide form. §4 is a widening of an existing
mechanism, not an invention of one.

### 2.3 The three states nothing reported

`isRecruitmentTaskHolder` returns `false` in three materially different situations, and the
old `/recruitment` page rendered the same sentence for all of them
(`recruitment/page.tsx:65-73`, pre-hub):

1. No task grants `recruitment` at all — `listGrantingTaskIds` is empty, so the early
   return at `access.ts:24` makes the answer `false` for **everyone, permanently**.
2. A task grants it, but nobody currently holds it (never claimed, or the holder left).
3. It is granted and held, but by somebody else.

State 1 and 2 are *unstaffed* — the Community has no one doing Recruitment — and they are
invisible on the page. In state 1 especially, the person shown "only a current
recruitment-task holder can see this view" is, in a fresh Community, likely the Admins
holder who could have granted the task in the first place. The message was true, useless,
and addressed to the wrong person. §5 fixes this.

### 2.4 A scoping gap found while doing this

`getRecruitmentPipeline` calls `requireRecruitmentTaskHolder` but never
`listHeldRecruitmentScopes`, unlike `listApplicationsForEvaluation`
(`applications.ts:279-288`) and `listOutstandingReferralInvites`. A cycle-scoped holder
therefore sees **every** Community's applications on `/recruitment`, while `/applications`
correctly shows only their own scope's. Not a permissions escalation (the route is still
holder-only) but a display inconsistency that violates the strictness rule D1 in
`docs/cycle-scope-remediation-plan.md` §6. Worth a separate fix; noted, not fixed here.

---

## 3. What "give everyone certain permissions" should mean

The phrase covers three capabilities with very different costs, and treating them as one
setting would be a mistake:

| Capability | Cost of opening | Recommendation |
|---|---|---|
| **See the pipeline** (stage + timing, no applicant answers) | ~none. No new data is exposed — `RecruitmentCandidate` already carries only `id`, `submittedAt`, `stage`, `stageSince` (`pipeline.ts:37-45`), no answers | **Open to all, default on** |
| **File a recommendation** | High, and *load-bearing on the decision rules* — `minCounts` thresholds only mean something if the evaluator pool is a curated panel. Widen it and the rules become a popularity signal | **Tier-gated, default off** |
| **Decide** (accept/decline, resolve wider discussion) | The expensive, accountable, hard-to-reverse act. Single decider is the point | **Keep task-gated** |

The middle row is why §4 does not propose a boolean. "Anyone may evaluate" and "anyone at
Tier Vouching-or-above may evaluate" are different communities, and the second is the one
that matches how this codebase already expresses "some members, not all" (Tiers are the
existing membership-quality axis — see `settings/page.tsx` Events & Tiers, `criterionType`
of manual/tenure/completion/cohort).

---

## 4. Proposed design (not built) — SUPERSEDED

> **Superseded by `docs/open-permissions-plan.md`.** What follows was written before the
> question was clarified: the mechanism is not a recruitment-only, Tier-based evaluator rule
> but a per-module "everyone has this permission" flag on all 14 modules, stored in a new
> `open_permission_grant` table. The *diagnosis* in §1–§3 still stands — the
> unsatisfiable evaluator count is real, and Recruitment is one of the modules that flag would
> cover. The design below is retained only as the record of the narrower proposal; **do not
> implement it.**

### 4.1 Shape: an unlock-route table, mirroring Sensitive Data Access

The precedent already exists and is the right one. `sensitive_field_access_rule`
(`sensitive-field-access-rule.ts:16-37`) unlocks a field by **Tier OR permission-grant OR
task id** — three independent unlock routes in one small table, with exactly-one-set
enforced. Community Settings → Profile & Privacy already configures it
(`settings/page.tsx:898-1237`, "Sensitive data access").

Proposed: a `recruitment_evaluator_rule` table, same shape, whose rows define who may file
an evaluation.

```
recruitment_evaluator_rule
  community_id     uuid → community
  unlocked_by_tier_id            uuid → tier      |  exactly one of
  unlocked_by_grant_task_id      uuid → task      |  the three is set
  subject                        enum            |
```

- `subject: 'evaluate' | 'see_pipeline'` — the two openable capabilities in §3. `decide`
  is deliberately not a subject.
- A holder of a `recruitment`-granted task satisfies every rule implicitly (the task grant
  is unchanged and remains sufficient on its own); rules only *widen* the floor.
- **No `unlocked_by_module_key` route.** Recruitment is already the module; a rule that
  unlocked itself would be circular.

### 4.2 Why not a `Community` boolean column

It would be one column and one migration, and it would be the wrong shape:

- It cannot express the Tier case in §3, which is the version most Communities will want.
- It reintroduces exactly the class of thing Phase 63 removed — authority held on the
  `Community` row, settable in a different tab from the one that describes the role, and
  therefore able to disagree with the grant table.
- It is not extensible to the next capability without another column, and the pattern
  already exists for doing it properly.

### 4.3 Why not a row in `permissionGrant` with a null `taskId`

`permissionGrant.taskId` is `NOT NULL` and every enforcement site resolves a grant by
joining `permissionGrant.taskId` → `taskAssignment`. A sentinel ("everyone") taskId would
match no assignment and therefore silently grant **nothing** — a failure mode that looks
exactly like "correctly closed" and is far worse than an obviously broken setting.
The `permissionKey` column is already dead (always null, per the file comment at
`permission-grant.ts:18-24`); this is not the place to revive that idea.

### 4.4 Read-side effects

`submitEvaluation` (`evaluations.ts:180-221`) would move from
`requireRecruitmentTaskHolder` to a new `requireRecruitmentEvaluator(actor, cycleId)`
that accepts either a holder **or** a matching rule row. Consequences to handle:

- `listApplicationsForEvaluation` currently returns full applicant answers and is
  holder-only. A Tier-evaluator needs the answers to evaluate, so it widens too — this is
  the real privacy consequence of the change and should be stated plainly in the settings
  copy, not buried.
- `recordDecisionIfReached` is called from the evaluate REST route; with a wider pool the
  decision can fire from a member who is not the decider. Confirm the accompanying side
  effects (intro-call creation, `maybeConvertApplicantToMember`, accompaniment task) are
  acceptable when triggered by a non-holder — `decisions.ts:336-371`. The conversion path
  creates a `Member` row, which is a bigger deal than filing a recommendation.
- Deduplication: `evaluation` has no unique constraint on `(formResponseId, evaluatorId)`
  (`recruitment.ts:42-53`); `submitEvaluation` upserts in place. With N evaluators this
  path gets exercised properly for the first time and should be tested for it.

### 4.5 Default

**Decided — D2:** the new rules default to *off*. An existing Community gains no new
authority; it gains a visible warning that its decision process cannot complete (§5). Widening
is opt-in and deliberate.

---

## 5. Landed with this change: the /recruitment hub

`/recruitment` is the Recruitment nav entry for **every** member — the nav filters only on
the module on/off flag (`nav-config.ts:173-179`) — but was a page whose entire output for a
non-holder was one paragraph saying the view was not visible to them. It is now a hub, in
this order:

1. **Bringing someone in** (all members) — community-level application/invite door state,
   the shareable `/apply` link, and a route to `/invites`. `/invites` previously had **no**
   inbound link from anywhere in the module, despite `nav-config.ts:171-172` documenting
   Invites and Applications as "reachable from within Recruitment itself."
2. **Events accepting people** (all members) — per-event door state, capacity, and
   outstanding-invite holds, which were previously only discoverable on each event's own
   participation page. Truncated to 6 rows.
3. **Authority state** (all members, actionable copy for whoever can fix it) — the three
   states of §2.3, now distinguished: *no task grants Recruitment* (with a link to
   `/settings?tab=permissions` for Admins), *granted but unheld* (naming the task and linking
   to it), vs. held-by-someone-else.
4. **The §1 contradiction**, shown to holders and Admins only.
5. **Your part in it** — links to `/applications` and `/invites` with capability-aware
   descriptions, and the subscriber's route to a say.
6. **Pending applications** (subscribers) — stage only, never answers, matching the rule
   `/applications` already enforces.
7. **The pipeline** (holders only, and last — it is no longer the page's premise).

Supporting addition: `describeRecruitmentAuthority` in `recruitment/access.ts:90-131`,
exported through the module barrel. It is a Community-scoped **status** read rather than a
capability — it exposes whether Recruitment is staffed and which task staffs it, both already
visible on the task page to any member, and no application content. It counts *distinct*
holders (two grants held by one person is one evaluator, since
`computeRecruitmentOutcome` counts distinct `evaluation.evaluatorId` rows) and applies the
same `isShadow: false` filter as `isRecruitmentTaskHolder`, so a placeholder assignment
cannot make an unreachable decision look reachable.

The module-off state and the holder pipeline are otherwise unchanged.

---

## 6. Locked decisions

- **D1 — Report, don't auto-repair.** The unreachable-decision condition is surfaced
  (`/recruitment` §4, and §4 of this doc) rather than silently fixed by rewriting
  `recruitmentEvaluatorCount`. A tuned value is a stated intent.
- **D2 — Widening is opt-in.** §4's evaluator rules default to off; no existing Community
  gains authority.
- **D3 — Decide stays task-gated.** Only `see_pipeline` and `evaluate` are openable
  subjects. Accept/decline and wider-discussion resolution are not.
- **D4 — Tier, not boolean, for `evaluate`.** The middle row of §3 is the one most
  Communities will want, and `sensitive_field_access_rule` is the existing shape for it.
- **D5 — Rules widen; they never replace.** Holding a `recruitment`-granted task remains
  sufficient on its own. No rule can revoke or narrow a task grant, so the two systems
  cannot produce a state where the task holder is locked out of their own role.

## 7. Open questions for the next pass

1. **Scope interaction.** `recruitment` is a `cycle`-tier module (§2.1): a cycle-placed
   task covers that event only. Does a Tier-based `evaluate` rule apply community-wide, or
   per event? A community-wide rule is far simpler and is probably right for a Tier (a Tier
   is not event-shaped), but it means any Tier-evaluator can see answers to applications for
   *any* event — worth confirming that is acceptable, since §4.4 widens
   `listApplicationsForEvaluation` with it.
2. **`decisions.ts` side effects.** Should `maybeConvertApplicantToMember` and the
   accompaniment task be triggered by a non-holder's evaluation at all (§4.4)?
3. **The §2.4 scoping gap** — a separate, small fix, not blocked on any of this.
4. **Tests.** Nothing here is covered without a working test database: the suite
   integration-tests against a real Postgres and each file truncates it, so pointing it at
   the development database would destroy local data. It needs either a dedicated test
   database or a per-run schema.
