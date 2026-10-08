# Admission Plan — who joins, how, and what the community decides

> **Implemented and shipped; partly superseded (2026-10-06), archived 2026-10-08.** Every
> work-plan step landed: the lane table and `direct | referral` retirement, the third door, the
> mediation grant, support and nomination, consensus and consent, pairing, and every settings and
> participation surface that shows them. See [`../../../CHANGELOG.md`](../../../CHANGELOG.md) for
> what each step built and the real bugs found. The eight "Known limits" at the foot of this
> document are still accurate and still unfixed.
>
> **Partly superseded (2026-10-06).** The lane model, the objection discipline, the overrule
> threshold and the mediation grant (J1–J12 below) still stand. How the pieces connect — one ordered
> funnel, nobody a Member until admitted, the support *shortcut* in place of the nomination wait, one
> community check, the interview before the decision — is now in
> [`../admission-flow.md`](../admission-flow.md), which wins wherever the two disagree.

**Scope of this plan:** the whole joining surface — invites, applications, and the consensus machinery around them — redesigned around one idea: **the inviter's (or applicant's) declaration selects a lane, and the community's rule for that lane defines the newcomer's path.** It supersedes the two-flavor invite mode locked as D12 in `docs/plans/archive/cycle-scope-remediation-plan.md` (§4.3/8d: `joiningInviteMode` `direct | referral`), extends D13's door set with a third independent door (interviews), and keeps D14 (joining seeds participation). Nothing here touches the task-permission model; `task.cycleId` scoping stays exactly as it is.

The working principle, agreed with the user over several rounds:

> **A declaration picks a lane; the community's rule for that lane is the newcomer's experience.** Lanes are what the person's own situation declares — "invited by a member who knows me personally," "invited on a good-fit vouch," "invited with neither mark," or "applying on my own." For each lane the community sets a *verification* (how much extra social proof the admission needs) and a *process* (whether an application form and/or an interview is required). One rule per lane, never a stacked matrix.

Design goals: keep today's behavior as the defaults (a community that touches nothing gets what it has), make every rule legible in the UI as a consequence sentence rather than abstract cells, and give communities *maximal freedom* about who holds the few human authorities this design needs — without creating any community-wide decision-maker by default.

---

## 1. Current state

### 1.1 The invite path

- **Invites are private and single-use** (`community_invite`, `src/db/schema/community-invite.ts` — token shared in plaintext, label, `expiresAt`, `revokedAt`, `redeemedAt`). The public `/invite/[token]` page deliberately reveals nothing about the inviter or roster; the token itself is the proof.
- **Per-cycle mode** `joiningInviteMode` `direct | referral` (default `direct`, `src/db/schema/cycle.ts:18`; D12):
  - **`direct`** — `/invite/[token]` immediately creates the Member and seeds Participation (`coming`); an **outstanding direct invite holds a capacity slot** from creation until redeemed, revoked, or expired (`expiresAt` required into capacity-capped cycles).
  - **`referral`** — never redeems; routes into the evaluated application (`/apply?invite=<token>`, the token is the vouch — `applications.ts:91`), holds no capacity, outstanding counts visible to recruitment holders.
- **Inviter marks** (`inviterKnowsPersonally`, `inviterThinksGoodFit`) are recorded but, per D12, do not alter the path — they feed the recommendation context and `referred_by_member_id` (accompaniment default). The spec's original posture (marks feed the decision mapping, "no separate skip-flag system," `spec.md:1090`) was *changed* by D12 into a flat per-cycle skip. This plan restores the marks as the *primary* selector — but as lanes, not as a hidden scoring system.

### 1.2 Doors, periods, capacity

Per-cycle `applicationsOpen` / `invitesOpen` plus community-wide `recruitmentApplicationsOpen` / `recruitmentInvitesOpen` (D13), a joining period (`returningWindowClosesAt` → `joiningWindowClosesAt`), and capacity with the held-slot rule (`joining.ts` — `periodOpen && door && !atCapacity`). **There is no third door**: the pipeline's call stage ("the interview") exists as machinery (`src/lib/recruitment/intro-call.ts`, `introCallPollId` on the decision, statuses `call_pending`/`call_scheduled`) but is *not independently toggleable* — it always runs for evaluated applications and is skipped wholesale by direct invites.

### 1.3 The consensus machinery already exists (on the evaluated path)

- **Wider-discussion window**: time-boxed `objectionWindowHours` (settings), subscribed members raise **anonymous-to-community, visible-to-evaluators** objections (`src/lib/recruitment/objections.ts`); an objection sends the outcome **pending** until a holder resolves it (`resolve-wider-discussion`), not auto-followed.
- **Recusal precedent**: `conflict_report_exclusion` implements all three exclusion routes (reporter-excludes-at-creation, self-recusal, peer-recusal) in one table (`src/db/schema/conflict-report.ts:36`).

### 1.4 What's missing

- No "interview" concept or `interviewsOpen` anywhere (`grep interview` → zero hits in `src/`).
- No support/nomination mechanics for invites, no poke/notification, no fallback when "no one can second."
- No community-check shape on the *invite* path (D12's direct invites bypass community visibility entirely; the wider-discussion window never sees them).
- No "who are you sticking with" pairing — `space_preference.groupWith`/`sharingWith` and the accompaniment default exist, but nothing ties a newcomer (or two applicants) together through the admitting funnel.
- The lone-objector problem has no bounded exit on the evaluated path: an objection holds the outcome pending until holders act, i.e. **veto-by-inaction** when the team is passive, and a pattern of objections is invisible outside the holders.

---

## 2. Target model

### 2.1 Four admission lanes

| Lane | Who declares it | Verification applies? |
|------|-----------------|----------------------|
| **Invited — knows personally** | A member invites and marks `knowsPersonally` (both marks count as this — the stronger signal) | Yes |
| **Invited — vouches (good fit)** | A member invites, marks `thinksGoodFit` only | Yes |
| **Invited — neither mark** | A member invites with neither mark | Yes |
| **Public application** | The person applies on their own (`/apply`, no invite) | Yes |

Each lane is a row the community configures. An invite's lane is fixed by the inviter's declaration at send time; nothing about the lane can make the invitee's path dependent on a checkbox being *guessed right* later.

### 2.2 Verification modes (one per lane, never stacked)

- **Basic** — one member's declaration suffices. For the knows-personally lane this is today's direct invite; for the public lane it is the open door.
- **Nomination** — the referral needs the support of another member: a second's support converts it to the light path. For the public lane the applicant *recruits* their support (support link). **Fallback** (§2.5) guarantees nobody is trapped behind a support window.
- **Consensus** — the arrival is announced for a time-boxed community-check window before admission completes; objections are mediated (§2.6).

Mode is **exclusive** per lane (`direct`, `nomination`, `consensus`, mutually exclusive). Stacking nomination *and* consensus per lane is deliberately not offered — both are time-boxed verification windows, and stacking them splits responsibility (two windows, two timers, unclear who resolves what) for negligible added safety. Only consensus carries consent.

### 2.3 Process per lane

Each lane also configures, independently: **application form** (on/off) and **interview** (on/off). "Interview" is the existing intro-call stage made a first-class, independently toggleable door:

- Three independent doors everywhere doors exist — **`applicationsOpen` / `interviewsOpen` / `invitesOpen`** (per cycle, falling back to community-wide; D13 gains `interviewsOpen`).
- **Process is per-lane, not per-mode.** The user's instinct, locked: a lane that says "application required" means it for basic, nomination, *and* consensus arrivals; the mode and the process compose freely (a nomination lane can still star a full application; a consensus lane can skip both). We deliberately do **not** multiply process per mode — the per-lane process covers every case that matters, and any "nomination + full process" configuration is just that lane's two settings.
- Both toggles off + basic = open door. Both on = today's full evaluated pipeline.

### 2.4 Support links and pokes (one machinery, both uses)

A nomination carries a **support token**. Options for getting it to people who know the nominee:

- **Poke** — at invite creation the inviter names members they think also know the invitee; those members get a notification ("you've been asked to support {name}'s nomination") carrying the support link. Deliberate, per-person — nothing broadcasts the nominee's existence beyond who the inviter chose.
- **Share a link** — the inviter hands it to whoever. A member who opens it can **second** the nomination, recording their own `knowsPersonally`/`thinksGoodFit` marks; the parties see "supported by {name}." Support count default **1**, tunable per lane.

The public applicant gets the same shape: "here's your support link — go pretty-please the people in the community who know you."

**One link, auth-branched** (this is also the whole *pairing* mechanism, §2.8): the same support/join token renders differently by session — a logged-in member sees the **support view** (with the know/good-fit options, plus an "already a member? log in to support" affordance); a logged-out visitor is routed to the **application**, pre-tagged with the token so the pair link is recorded.

### 2.5 Nomination fallback

A support window that lapses must **not** auto-fail the newcomer (task-candidacy endorsements auto-fail; invites must not):

- At any time during the window, the invitee can choose **"skip the nomination, I'll do the application instead"** — dropping straight onto the lane's configured process.
- If the window lapses unsupported, the invite **falls through automatically** to the lane's process path.
- The decision rests with the person it's about — which is the only place the "the inviter knows nobody who can second" case can be solved.

### 2.6 Consensus: objections, shielded mediation, and the overrule-as-exception

One discipline, applied to *both* consensus-lane arrivals and the existing evaluated-path wider-discussion:

- **No objection by the deadline → auto-admitted** (existing auto-follow behavior).
- **An objection is never thrown out by a timer.** It *stands* — admission holds — and becomes a duty item handled by the **mediation body** (§2.7). Inaction never silently admits; inaction never silently excludes either, because the objection *forces* a mediation window onto the body's pipeline.
- **Shielded mediation.** The mediation body (holders of a task granted the new module, §2.7) sees the objector's identity and leads the conversation — talking with the objector, the inviter/applicant, and the invitee separately. The objector's identity is **never public and never made available to the person being objected to** (and, for robustness, not to the *inviter* either — the shield leaks through the invitee's friend). The objector can, like a conflict reporter, **recuse specific people** from even the mediation body's view (mirroring `conflict_report_exclusion`'s three routes: reporter-excludes-at-creation, self-recusal, peer-recusal) and can **consent to named parties knowing**.
- **Overrule is the exception, not the rule.** If mediation does not clear the objection, the default is **the objection stands**. The one exception: a **majority of the mediation body** (threshold configurable in recruitment settings — majority-of-current-holders default, fixed quorum selectable) can overrule → admitted. A lone objector — including the community's chronic excluder — must win the room each time, and a pattern of failing to persuade is visible to the body on its own records.
- **Consent.** A consensus lane requires two consent steps: an **awareness tick at send** (the inviter asserts "I've told {name} their join includes a community-check window" — awareness, never proxy consent) and a **binding consent at redemption** (the invitee reads the disclosure and checks a box; recorded on the invite row). Without consent the arrival never becomes visible to anyone.

This replaces the current evaluated-path behavior where an objection holds the outcome pending *indefinitely* on a holder's action.

### 2.7 The mediation authority is its own grant — nobody decides for the community by default

- **New module `recruitment_mediation`** in `PERMISSION_MODULE_KEYS`, **community-shaped** (a standing, relationship-shaped body, mirroring `conflict_team` — mediation is not cycle-scoped even though the applications it mediates may be).
- The community grants it to **whatever task it likes**: the recruitment task, the conflict-team task, a third dedicated "mediation/exceptions" task, or several. Inline with the permission-grant model, each of those tasks can carry its own candidacy/endorsement rules — a community that wants all three roles endorsed (recruitment, conflict team, mediation) simply sets that per task. **No member holds community-wide decision power by default**, because no task with this grant exists by default.
- **The hint text must be exemplary**, since this module sees identities everyone else is shielded from and can make exception decisions: *"Holder mediates recruitment objections (invite-consensus and evaluated-path alike), sees objector identities that are shielded from everyone else, and may exercise the majority overrule where the community has enabled it."*
- Multi-cardinality per scope (a mediation *team* is fine).

### 2.8 Pairing: "who are you sticking with" and shared interviews

The "who are you sticking with this event" answer names people, and each named person gets the auth-branched link (§2.4):

- **Named person is a member** → logged-in link lands on the support view — that *is* the nomination second (or an extra support).
- **Named person is applying too** → the anonymous side of the same link is the application, pre-paired with the namer ("A is sticking with B, who is also applying"). The pair is a fact recorded at the funnel; the platform never decides anything from it — placement/space/accompaniment get the fact, humans get the say.
- **Manual linking.** If the applicant names another applicant but neither used the link, the mediation/recruitment team can **link them manually**; the linked party receives an **accept-the-pairing link** (same token shape).
- **Shared interview.** Paired applicants are offered a **joint interview** when the lane's interview is on, their schedules align, and they say they prefer it — one intro-call poll with *both* applicants plus the interviewers as required participants (a small extension of the existing `intro-call.ts`/scheduling-poll machinery). Opt-in; never automatic.

### 2.9 Defaults = today's behavior

The default configuration reproduces exactly what exists today, so the migration is behavior-preserving:

| Lane | Verification | Application | Interview |
|------|-------------|-------------|-----------|
| Invited — knows personally | Basic | off | off | *(= today's `direct`)* |
| Invited — vouches (good fit) | Basic | on | on | *(= today's `referral`)* |
| Invited — neither mark | Basic | on | on | *(= today's `referral`)* |
| Public application | Basic | on | on | *(= today's `/apply`)* |

Nomination and consensus are **deliberate upgrades** a community opts into; nothing changes until it does.

> **One honest caveat to "behavior-preserving":** an *unmarked* invite (neither lane) used to redeem directly on a direct-mode cycle or as a general invite. Under §2.9 it is the **neither** lane — basic, application on, interview on — so it now routes through the evaluated application. Preserving that would contradict the lanes themselves; the changes are confined to unmarked invites, and inviters who want the instant path mark "I personally know this person."

---

## 4. Backend work

### 🔴 4.1 Lane model + the third door (schema + migration)

A lane-config table (cycle-scoped rows fall back to community-wide):

- `joining_lane` — `(communityId, cycleId nullable, lane enum)`: `verificationMode` (`basic | nomination | consensus`), `supportCount` (default 1), `applicationRequired`, `interviewRequired`, and nomination's `applyInsteadAvailable` (default true). A cycle that doesn't configure a lane row uses the community's row (same fallback pattern as the existing per-cycle joining columns).
- **Third door**: `interviewsOpen` on `cycle` and `community` (default true), joining `applicationsOpen`/`invitesOpen` in the door composition.
- New settings knobs: `nominationWindowHours` (support window, default e.g. 48h — a companion to `objectionWindowHours`, which is reused as the consensus window) and the objection **overrule threshold** (majority-of-current-holders | fixed quorum).
- Migration seeds one community-wide row per lane with §2.9 defaults; the old `joiningInviteMode` column is read once and retired (D8-style single migration — a test instance only).

**Files:** `src/db/schema/cycle.ts`, `src/db/schema/community.ts`, `src/db/schema/joining-lane.ts` (new), `src/lib/recruitment/joining.ts` (lane resolution in `getCycleJoiningState`), `src/lib/settings/*`. **Effort:** Large.

### 🟠 4.2 Support tokens, pokes, and nomination semantics

- Support tokens on the invite/application paths (one token family, auth-branched rendering); support records (who, when, which marks); the poke → notification write (reusing the existing notification machinery); support-count enforcement per lane.
- Nomination fallback semantics in the redemption flow: "apply instead" during the window + automatic fall-through on lapse (no auto-fail).

**Files:** `src/lib/recruitment/invites.ts`, `src/lib/recruitment/applications.ts`, `src/lib/recruitment/notifications.ts` (or the shared notify lib), `src/db/schema/community-invite.ts`, `src/db/schema/recruitment.ts`. **Effort:** Medium.

### 🟠 4.3 Consensus: shield, recusal, mediation handoff, overrule

- Objection gains an identity shield at rest (only mediation-holders can read `raisedBy`), an exclusion table mirroring `conflict_report_exclusion`, and consent records (inviter awareness tick, invitee binding consent with disclosure text).
- The objection → duty-item handoff to the mediation body (needs-action signals), the **overrule action** gated on the threshold, and the timebox semantics ("objection stands" default, auto-admit only when no objection was ever raised).
- Same discipline on the evaluated-path wider-discussion: `resolve-wider-discussion` gains the mediated/overrule shapes instead of holder-only resolve.

**Files:** `src/db/schema/recruitment.ts` (objection), `src/lib/recruitment/objections.ts`, `src/lib/recruitment/decisions.ts`, `src/db/schema/recruitment-mediation.ts` (new, exclusions + consents), routes. **Effort:** Medium–Large.

### 🟠 4.4 The `recruitment_mediation` module

Add to `PERMISSION_MODULE_KEYS` with the (§2.7) exemplary hint: tier entry (community-shaped), grant/cardinality handling (multi per scope), settings + task-detail grant rows via the ordinary §5.1 machinery, and the resolver wiring the mediation body's scope (who sees objections, who may overrule).

**Files:** `src/lib/permissions.ts`, settings + task-detail grant forms, a small `src/lib/recruitment/mediation.ts` (resolver). **Effort:** Medium.

### 🟡 4.5 Pairing + shared interviews

- Pairing records (link-initiated and manual), the accept-the-pairing link, and `intro-call.ts` extended so a *pair* can share one poll (both applicants as required participants) when offered.

**Files:** `src/db/schema/recruitment.ts`, `src/lib/recruitment/intro-call.ts`, `src/lib/recruitment/applications.ts`. **Effort:** Medium.

---

## 5. Interface work

### 🟠 5.1 Settings → Recruitment: "Admission rules"

Four **trust-ordered lane cards** (knows-personally → vouches → neither → public), each with: verification select, period field when relevant, application/interview checkboxes, and a **live consequence sentence** ("→ they join straight away" / "→ a second member must support the invite, then they join" / "→ they consent to a community-check window, are announced, and join unless a member raises a concern"). A **preset** select (Welcoming / Vouched / Community-checked / Fully screened) fills all four lanes, still editable per card afterward. Alongside: the three doors, the two period knobs, and the overrule threshold. The settings tab's existing recruitment area hosts the overrule threshold beside `objectionWindowHours`.

**Files:** `src/app/(app)/settings/page.tsx` (+ actions). **Effort:** Medium.

### 🟠 5.2 Participation page cycle config

The cycle-config form (which already owns capacity/`returningWindowClosesAt`/joining fields) gains the same lane cards as per-cycle overrides, falling back to the community-wide rows.

**Files:** `src/app/(app)/[cycleScope]/participation/*`. **Effort:** Medium.

### 🟠 5.3 Inviter and applicant surfaces

- Invite creation: the knowing/good-fit marks are shown with their *consequences* ("knows personally → they join straight away"), the poke member-picker or share-link option for nomination lanes, and the consensus **awareness tick** when the lane is consensus.
- Public application: the support link is returned ("send this to people in the community who know you"), plus the "who are you sticking with" question wiring the auth-branched link.
- The support page (`/support/[token]`-shaped): session-branched between support view (know/good-fit marks) and the pairing application.
- Consensus redemption: disclosure + binding consent checkbox.

**Files:** `src/app/(app)/invites/*`, `src/app/(app)/applications/*`, `src/app/apply/*`, `src/app/support/[token]/*` (new), `src/app/(app)/profile/*` (marks → lanes wiring). **Effort:** Medium–Large.

### 🟡 5.4 Mediation surfaces

Objections render only to mediation-holders (shielded `raisedBy`), with recusal/consent controls, the objection state at a glance on the applications pipeline, and the **overrule action** with its threshold and an audit note when an exception is made (the chronic-objector pattern is visible on the body's own records).

**Files:** `src/app/(app)/applications/page.tsx`, `src/app/(app)/[cycleScope]/participation/page.tsx`. **Effort:** Small.

---

## 6. Decisions (locked) & what's left open

**Decided — locked with the user across the design rounds:**

- **J1 — Four lanes.** Invited-knows-personally, invited-vouches (good fit), invited-neither, public application. The public application is a first-class lane with the same rule shape as the invite lanes.
- **J2 — One verification mode per lane.** `basic` | `nomination` | `consensus`; exclusive, never stacked (they are all time-boxed social-verification shapes; stacking splits responsibility for no added safety). Periods are community-wide per mechanism, not per lane.
- **J3 — Process is per lane, not per mode.** Application/interview toggles per lane; `interviewsOpen` becomes a third independent door (per cycle + community fallback, D13 extended); "interview" means the existing intro-call stage, now independently toggleable. Both-off + basic = open door.
- **J4 — Both marks count as knows-personally.** The stronger signal wins; three invite lanes, no fourth.
- **J5 — Support links + pokes, auth-branched.** Nomination support rides one token that renders as the support view for logged-in members and the (paired) application for everyone else, with an explicit "log in to support" affordance. Support count defaults to 1, tunable per lane.
- **J6 — Nomination never auto-fails.** "Apply instead" is available during the window; lapse falls through to the lane's process path. The decision rests with the invitee.
- **J7 — The objection discipline.** An objection *stands* by default and is mediated; it is never thrown out by a timer. Overrule is the exception: a majority of the mediation body (threshold configurable: majority-of-holders default, fixed quorum selectable). The objector's identity is never public and never revealed to the person objected to (nor to the inviter); the objector can recuse people from the mediation body and can consent to named parties knowing. The same discipline applies to the evaluated-path wider-discussion window.
- **J8 — `recruitment_mediation` is its own community-shaped grant module**, grantable to any task(s) the community chooses (recruitment's, conflict team's, a third task — or several); endorsed-task requirements are per-task as everywhere. No community-wide decision-maker exists by default; the module's hint text states exactly what it sees and can do.
- **J9 — Pairing is fact-only.** Named-person links pair through the auth-branched token; the mediation/recruitment team can manual-link with an accept link; paired applicants may opt into a **shared interview** when the interview door is on. The platform never decides anything from a pair.
- **J10 — Consent for consensus.** Awareness tick at send (inviter asserts the invitee was told) + binding consent at redemption (the invitee's own checkbox, recorded). Consent is what makes the community-visible announcement legitimate.
- **J11 — Defaults preserve today's behavior** (§2.9 table): knows-personally = today's `direct`; vouches and neither = today's `referral`; public = today's `/apply`. Nomination and consensus are opt-in upgrades.
- **J12 — D14 stands.** Accepting or redeeming seeds `participation(cycle, member, "coming")` idempotently, whatever lane the newcomer arrived through.

**Supersedes:** D12's `joiningInviteMode direct | referral` (the mode is replaced by lanes × verification, §2.1–2.2); D13 gains `interviewsOpen` (J3). D14 unchanged.

**Open:** implementation-level details tracked inside the work items — the exact support-token columns (invite-token reuse vs. a parallel token), how the seeded lane defaults render in the pipeline's held/outstanding counts, and where the shared-interview poll lives in the pipeline status feed (a `call_scheduled` variant or its own stage).

---

## Work plan (suggested order)

1. **Lane model + migration** — §4.1, seeded with §2.9 defaults; old `joiningInviteMode` retired in the same migration. *Deviation (implemented, see commit): "existing tests must pass unchanged" could not fully hold — the tests that named `joiningInviteMode`, and the many that created unmarked invites and redeemed them directly, were rewritten to the lane model (an unmarked invite is the neither lane and routes through the application, per the §2.9 caveat); every other test passes unchanged.*
2. **The third door** — `interviewsOpen` on `cycle`/`community`, composed into the joining-state gates (a candidate submitting, an interview being scheduled, an invite redeeming each check their own door + period + capacity).
3. **`recruitment_mediation` module** — §4.4 (module key, hint, resolver, settings/task-detail grant rows) — unblocks the objection machinery that hangs off it.
4. **Support + nomination** — §4.2 (tokens, pokes, support records, fallback semantics).
5. **Consensus + objections** — §4.3 (shield, recusal, consent, mediation handoff, overrule; evaluated path unified).
6. **Pairing + shared interviews** — §4.5.
7. **Interface** — §5.1 → §5.2 (the config) → §5.3 (inviter/applicant surfaces + support page + consent flows) → §5.4 (mediation surfaces).
8. **Tests + docs close-out** — lane-resolution, door, fallback, consent, overrule-threshold, and pair tests; this plan's status annotated with hashes.

Cross-referenced from: `docs/plans/archive/cycle-scope-remediation-plan.md` (§4.3, D12–D14), `docs/spec.md` (Recruitment: "Invite links", "Wider discussion window", "Conversation scheduling"), `docs/plans/development-plan.md` (Conflict management — recusal).

---

## Execution status

Steps 1–8 are implemented. Everything below is a *deviation from the plan as written*, a *resolved open question*, or a *known limit* — the plan's own text above is untouched, so the disagreements stay legible.

### Where each step landed

| Step | Where | Notes |
|---|---|---|
| 1. Lane model | `src/db/schema/joining-lane.ts`, `src/lib/recruitment/joining-lanes.ts`, `drizzle/0059_joining_lane_model.sql` | Landed first, before the rest. The rule *shape* then moved to a pure module (`src/lib/recruitment/lanes.ts`) so the settings panel's client component and the server-side resolvers can share one definition; a schema file can't import a lib file, so `resolveLaneRuleRow` is the single projection between them and fails to compile on drift. |
| 2. The third door | `cycle.interviewsOpen`, `community.recruitmentInterviewsOpen`, `getCycleJoiningState`, `canScheduleInterview` | Checked in three places rather than one: creating an invite on a lane that asks for an interview, scheduling the poll when a decision is reached, and offering a shared interview. Without the first, "interviews closed" would be a promise the backend broke a moment later. |
| 3. `recruitment_mediation` | `src/lib/permissions.ts`, `src/lib/recruitment/mediation.ts`, `src/db/schema/recruitment-mediation.ts` | Community-shaped, multi-cardinality, the §2.7 hint verbatim. |
| 4. Support + nomination | `src/lib/recruitment/support.ts`, `src/app/support/[token]/*`, `src/app/(app)/invites/*` | One token family, one state machine, one poke path. |
| 5. Consensus + objections | `src/lib/recruitment/consensus.ts`, `mediation.ts`, `objections.ts`, `decisions.ts` | One objection discipline for both windows, as §2.6 asks. |
| 6. Pairing | `src/lib/recruitment/pairs.ts`, `src/app/pair/[token]/*` | |
| 7. Interface | `settings/tabs/RecruitmentTab.tsx`, `LaneRulesEditor.tsx`, `[cycleScope]/participation/*`, `invites/*`, `apply/*`, `invite/[token]/*`, `support/[token]/*`, `recruitment/mediation/*` | Plus a rebuild of the settings screen itself — see the CHANGELOG entry. |
| 8. Tests | `tests/joining-lanes.test.ts` (29 tests) | Full suite: 1668 tests across 84 files, green. |

Migration `0083_joining_admission_back_end`. It was first written as `0080` on a branch that predated three migrations landed on `main` in the meantime (the sensitive-data collapse, the indicator-consent collapse, the emergency consent), so it was renumbered rather than rewritten — the schema diff is identical either way, but see the two notes under Deviations for the one thing that *did* have to be hand-fixed, and for a pre-existing breakage in `db:generate` that had to be repaired before any of it could be generated at all.

### Resolved open questions (§6)

- **"The exact support-token columns (invite-token reuse vs. a parallel token)."** A parallel one, on a new `joining_nomination` row rather than a column on `community_invite`. Reuse would have meant the invite's own join URL doubling as the support URL, and the two have genuinely different jobs: the join URL is single-use and *spends* the invite, the support URL has to stay open for the whole window and be **handed to a second person** — who is not the invitee. A nomination can also exist for a public applicant, who has no invite at all, so the shape had to serve both subjects either way.
- **"How the seeded lane defaults render in the pipeline's held/outstanding counts."** Only a `direct` path holds a capacity slot. A nomination is still waiting on people, a consensus window on the community, and a process lane on evaluators — none has reserved a place yet, and counting them would let a community fill its room with invitations it hasn't committed to. They all appear in the *outstanding* list instead, which is the count a recruiter actually acts on.
- **"Where the shared-interview poll lives in the pipeline status feed (a `call_scheduled` variant or its own stage)."** Neither — it reuses `recruitment_decision.intro_call_poll_id`. Accepting the offer points the second applicant's decision at the first's poll and adds them to `requiredParticipantIds`, so the existing must-overlap machinery does the aligning for real. A shared interview is then a `call_pending`/`call_scheduled` row like any other, and a new stage would have meant a stage only two people in every candidate can reach — which is exactly the "a pair must never become a unit the platform treats differently" the plan rules out.

### Deviations from the plan as written

- **§2.5's "apply instead" needed a fourth destination.** A skipped nomination has to go *somewhere*, and where depends on the lane: a lane with a form wants the application, one without a form wants the join form. The literal reading — a link to `/apply` — sends the second kind of person to a page saying "not accepting applications". `skipNomination` therefore hands back the invite's own token and the support page sends them to `/invite/<token>`, the one page that knows both. The same question decides where a *settled* window goes: `settledPathForRule` asks the lane's **process**, not its mode, so a process-less nomination lane admits straight away once its window closes (§2.2's "a second's support converts it to the light path"). Asking the mode instead — the obvious thing — routes every settled nomination lane to the application, including the ones that asked for no application.
- **The two consent steps live on the invite row; the public applicant's is on a new table.** §2.6 says the invite's consent is "recorded on the invite row" and it is. A public applicant has no redemption step, so the disclosure and the tick happen at the application itself, and `recruitment_application_consent` is the one place the same fact is stored in two shapes. Putting it on `formResponse` instead was considered and rejected: `form_response` is a fully generic Forms primitive (its own schema comment says so), and a Recruitment-specific column there is the coupling `recruitment_application_invite` already exists to avoid.
- **The "arrival" a consensus window holds back is the participation row, not the membership.** A consensus invitee becomes a Member at redemption — they had to be able to be told what was happening to them — but their `participation` row, which is what the roster and the capacity count are built from, is seeded only when the window closes clean. That is what makes the consent gate real: before the window closes there is an account and no place in the event. An upheld objection leaves the account, which is a deliberate limit rather than an oversight — you cannot un-ring a bell, so what the mediation record is for is the conversation that follows.
- **A cycle's lane override is a row, and "inherit" is that row's absence.** Copying the community's current rule down into the cycle would freeze it, and a frozen copy is how a per-event override quietly becomes a second, unmaintained version of the community's admission design. Un-ticking a lane deletes the row, so the event starts tracking the community rule again immediately — including rules changed after the override was written.
- **`objection.community_id` is denormalized, and its backfill is hand-written.** The mediation queue has to scope by community, and both subjects it can hang off (a `form_response`, an invite) are one join away from the community — but a queue that joins through a polymorphic subject has to join twice and can't be indexed well, so the column is denormalized. That makes it `NOT NULL` on a table with existing rows, and drizzle-kit diffs schemas rather than data, so it cannot emit the `UPDATE` that fills them. The statement is in `0083` under the `ALTER` with a comment saying why it's there. Rows with no response behind them would fail the `ALTER` on purpose: an objection attached to no community is one no mediation body could ever find, and failing the migration is the honest outcome.
- **Two hand-written snapshot entries on `main` had to be repaired before this migration could be generated at all.** `profile_answer_rule_consent` (added in `0081`) and `profile_answer.emergency_consent` (`0082`) were written into their snapshots by hand rather than by `drizzle-kit generate`, and in an older snapshot format: no `primaryKey` on their columns, no `name`/`schema`/`isRLSEnabled` on the table, `hasDefault` where the generator writes `default`, index `columns` as bare strings rather than `{expression}` objects, and foreign keys qualified as `public.foo` where the generator writes the bare name. zod rejects all of it, so `npm run db:generate` failed on `main` with `0081_snapshot.json data is malformed` — which means no migration at all could be generated, not just this one. Both entries were rewritten in the current format from their schema definitions. No semantics changed; the fix is mechanical and `db:generate` works again.

### Known limits

- **A consent-recorded-but-unannounced consensus invitee is a member with no place anywhere.** Nothing routes them, nothing tells them, and the mediation queue only knows about them once someone objects. The plan doesn't say what happens to the account after a refusal, and inventing a deletion (or a suspension) is a decision this codebase shouldn't make for a community silently.
- **`describeObjectorRecord` is built and reachable but not on a surface.** §2.6 asks for "a pattern of failing to persuade … visible to the body on its own records". The queue shows every objection and its outcome, which *is* the record; the per-objector roll-up is a query away, but it has nowhere to render that isn't a leaderboard, so it was left unwired rather than given a home.
- **A public applicant with no invite can't name a pairing.** `recruitment_pair.requested_by_id` is a real member, and an applicant who arrived on their own has none — so a pair from their side needs the manual link (§2.8's third route) rather than the automatic one. The alternative was a nullable `requested_by_id`, which is a pairing with nobody behind it.
- **The shared-interview offer requires exactly one side to have a poll of its own.** Merging two existing interviews is a different operation from sharing a new one, and quietly re-pointing somebody's already-scheduled call at a new grid isn't something to do behind their back. A pair where both sides already have polls is simply not offerable.
- **`GET /api/invite/[token]` still reports only `{ status }`.** The four redemption outcomes come back from `POST …/redeem` and are consumed by the page, but the read route wasn't widened: widening it means deciding what a public, unauthenticated caller may learn about a lane *before* redeeming, and that's a privacy question the plan doesn't settle.