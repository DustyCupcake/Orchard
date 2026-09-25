# Admission Plan — who joins, how, and what the community decides

**Scope of this plan:** the whole joining surface — invites, applications, and the consensus machinery around them — redesigned around one idea: **the inviter's (or applicant's) declaration selects a lane, and the community's rule for that lane defines the newcomer's path.** It supersedes the two-flavor invite mode locked as D12 in `docs/cycle-scope-remediation-plan.md` (§4.3/8d: `joiningInviteMode` `direct | referral`), extends D13's door set with a third independent door (interviews), and keeps D14 (joining seeds participation). Nothing here touches the task-permission model; `task.cycleId` scoping stays exactly as it is.

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

Cross-referenced from: `docs/cycle-scope-remediation-plan.md` (§4.3, D12–D14), `docs/spec.md` (Recruitment: "Invite links", "Wider discussion window", "Conversation scheduling"), `docs/development-plan.md` (Conflict management — recusal).