# Admission flow — one funnel, decided per lane

**Status:** proposed, not built. Written after an audit found that the front half of recruitment
(doors, lanes, nomination, consensus) and the back half (evaluation, interview, decision) are two
machines joined only where an invite is sent to `/apply`. This document replaces the *flow* parts of
[`archive/joining-admission-plan.md`](archive/joining-admission-plan.md). That plan's decisions about lanes, the
overrule threshold, shielding the objector and the mediation grant (J1–J12) still stand; what changes
is how the pieces connect.

The decisions below were made with the product owner (2026-10-06) and are marked **(decided)**.
Everything marked **(proposed)** is my reading and needs a yes or a correction.

---

## 1. Principles

1. **A person is not a Member until they are admitted. Admission is what makes membership.** (decided)
   One function creates members from the funnel; nothing else does. No account exists for someone
   who is still being considered.
2. **A lane decides the person's path; the path is fixed when they enter.** (decided: lanes; proposed:
   fixed at entry.) Today the rule is read live, so editing a lane while people are in flight strands
   them in states the new rule doesn't have (the audit's reading of the code: basic→consensus never collects
   the inviter's awareness tick, and consensus→basic leaves a state nothing reads again). The path a person will follow is recorded on them when they
   arrive. Changing a lane changes the *next* arrival, and the settings screen says so.
3. **Communities choose their own process, within what makes sense together.** (decided) The settings
   offer only combinations that mean something, and hide what a choice makes irrelevant.
4. **An application or interview exists to be evaluated.** (decided) Evaluation is not a separate
   switch: it exists exactly when the lane produces something to evaluate.
5. **Where a person is is *derived* from what has happened, never stored as a second opinion.** This
   is the rule `docs/spec.md` already gives the pipeline view ("a computed read-out of state that
   already exists"), applied to the whole funnel. The bugs found were all of the form "four fields each
   hold part of the answer and nothing reconciles them".

---

## 2. The funnel

Every arrival moves through the same ordered steps. A lane switches steps on or off; it never
reorders them.

```
 entry ─► verification ─► application ─► interview ─► evaluation ─► decision ─► admission
 (doors)   none |          form           a call       by the         rules       member
           community       (if on)        (if on)      interviewers   decide      created,
           check                                        (if 3 or 4                 told,
                                                         exist)                    placed
```

| Step | What it is | Ends when |
|---|---|---|
| **Entry** | A door is open and the person is allowed in: an invite is redeemed, or an application is submitted. | The arrival is recorded and the person is emailed their private link. |
| **Verification** | *None*, or *community check* (the arrival is announced; concerns stand until mediated). | Check: the window closes with no standing concern, or mediation clears it. |
| **Application** | The lane's form. | Submitted. |
| **Interview** | A call between the person and the evaluators, scheduled with the existing blind-availability poll. | The agreed slot has passed (or an evaluator marks it held). |
| **Evaluation** | Each evaluator files a recommendation and notes, seeing the application and what happened in the interview. | The community's evaluator count is reached (where there was an interview, the interviewers are the evaluators). |
| **Decision** | The community's rules turn recommendations into *proceed*, *decline* or *wider discussion*. | A rule matches. |
| **Admission** | The one function that creates the Member. | Done — see §6. |

**The interview comes before the decision (decided).** It is a step with the same standing as the
application, not something scheduled beside a decision that has already admitted the person.

**The recruitment holders are the process, and they offer their own availability (decided).** Anyone
who holds the recruitment task is part of the process; nobody is assigned. A holder can offer
interview availability two ways, and either counts:

- **Standing availability** — recurring windows set once ("Tuesday evenings"), applied automatically to
  every new interview. This is what the existing recruitment-mode subscription grows into: today it is
  an on/off alert flag, and the availability is re-painted on every poll.
- **Per application** — after reading an application and wanting to meet that person, a holder adds
  availability on that arrival's own poll.

The interview poll asks for *the person, plus at least the community's evaluator count of holders*
(one number for both — decided: if there is an interview, only the people who took part in it are
competent to evaluate). It confirms when enough of them overlap with the person.
The holders whose availability covers the confirmed slot are the **interviewers**, and are told. The
existing poll can say "don't confirm below N people" or "these people must overlap", but not both at
once; this needs a small extension, and any holder (not only the poll's organizer) must be able to
confirm once the floor is met.

**The interviewers write the report** — that report is the evaluation. For a lane with an application
and no interview, any holder may read it and file a report. For a lane with an interview, the reports
that count are the interviewers'. The decision rules read the reports exactly as they do today.

**The process belongs to the recruitment holders unless a wider discussion is called for** (decided).
Wider discussion is the one place the decision leaves the holders and goes to the community (§5).

### The paths a lane can produce

| Verification | Application | Interview | Evaluation | What the person experiences |
|---|---|---|---|---|
| none | off | off | — | admitted immediately (invite lanes only) |
| none | on | off | yes | applies; evaluated; decided |
| none | off | on | yes | interview only; evaluated on the call |
| none | on | on | yes | applies; interviewed; evaluated; decided |
| community check | *off, off — not offered* | | — | announced; admitted unless a concern stands |

The public-application lane always has an application (it *is* the door), so its application toggle is
fixed on.

### The support shortcut (decided)

Any lane that has a process (an application and/or an interview) can add a shortcut: **N supports from
members skip whatever is left and admit.** It is the same mechanism for a public applicant and for an
invitee, and it is off unless the community turns it on.

- **It runs alongside the path, not in front of it.** The person starts the lane's normal path at once.
  Whenever support reaches N, the rest — remaining application, interview, evaluation, decision — is
  skipped and they are admitted. If it never does, nothing happens: they simply complete the path. So
  there is no waiting window, no "skip the wait" button, no lapse job, and nothing for a person to be
  stuck behind. (This replaces the earlier "nomination" verification mode, which made people wait.)
- **Everyone gets a support link.** A public applicant is shown it when they apply and again on their
  own page: "send this to members who know you". An invitee gets the same. It is a separate link from
  the person's private one, so what supporters hold can never act for the person.
- **Who can support:** a member, once, recording how they know the person (personally, or as a good
  fit). Not the person; not the inviter. **Their vouches are shown to the evaluators** whether or not
  the shortcut is reached.
- **No link needed where a member can already see the arrival** (decided). A member who sees an
  application or an announced arrival — in the applications list, the pending list, or a community
  check — and knows the person can support it from there with one action. The link is only for members
  who would not otherwise see them.
- **It never overrides a standing concern.** If a community check is open on the arrival and a concern
  stands (§5), support cannot skip past it. Concerns are only ever resolved by mediation.
- **A lane without the shortcut is unchanged:** the person completes the lane's own path. A community
  that wants "unsupported people do exactly what a public applicant does" gets it by giving the invite
  lane the same application and interview as the public lane; the lane's own flags are what apply.

---

## 3. Settings: what is offered, and what is hidden

The settings screen draws its choices from the table above, and the consequence sentence under every
lane is generated from the same function that decides the person's path — so the screen cannot
describe a path the code doesn't follow (today it does: the "Community-checked" preset promises an
application and an interview that a consensus invitee never meets).

| If the lane's verification is… | …then |
|---|---|
| **community check** | Application and interview are not offered. The check *is* the process (decided: "mostly one or the other"). The body can still ask for more — see §5. |
| **none** | Application and interview are offered. Both off means "admitted immediately", stated plainly. If either is on, a **support shortcut** (a number of supports) can be added; with both off there is nothing to skip, so it is not offered. |

Whole sections follow from the lanes:

- **Evaluation** (evaluator count, decision rules, the interview door) is shown only when at least one
  lane — or event override — has an application or an interview on. Otherwise the section says there
  is nothing to evaluate. A community with no lane that evaluates is never asked to configure rules.
- **Community-check window, mediation grant, overrule threshold** appear only when a lane uses a
  community check or a decision rule can produce *wider discussion*. The rule builder offers *wider
  discussion* only when those exist.
- **Support-shortcut settings** appear only when a lane turns the shortcut on.
- **Doors** are always shown; the *interviews* door only when some lane has an interview.

A configuration that can't produce a person's path is refused when saved, with a sentence saying why,
not left to fail at redemption.

---

## 4. The arrival record

One row per person in the funnel (`admission`), replacing the overlapping state spread over the invite
(`redeemedAt`/`revokedAt`/`consensusState`), the nomination (`state`) and the decision (`resolution`).

- **Identity before membership:** email and name as given, the lane, how they arrived (invite and/or
  application), the event they are joining.
- **The path, fixed at entry (decided in principle):** `requiredSteps` — which of verification
  (and which kind), application, interview and evaluation apply, plus the support-shortcut count in
  force at that moment.
- **Facts, each written by exactly one function:** consent given; check passed; application
  submitted; interview scheduled / held; evaluations filed; decision recorded; supports received (and
  whether the shortcut was reached); admitted (and the resulting member); declined; withdrawn.
- **The stage is a pure function of the facts and the path.** It is what every screen, the pipeline,
  the dashboard "needs action" list and capacity counting read. It cannot disagree with itself.

Existing tables keep their jobs: `form_response` (the application), `evaluation`,
`recruitment_decision` (outcome rules), `joining_nomination`/`joining_support` (reduced to the support
link and the supports received — no state, no deadline), `objection` and its
shield tables, `recruitment_pair`, the invite itself (token, marks, expiry, revoked). Each now points
at the arrival, not at "a form response *or* an invite".

### The person's own link

Everyone in the funnel gets one private link, emailed when they enter (`/admission/<token>`). It is the
whole of their relationship with the process before they have an account:

- where they are, in plain words, and what happens next;
- the interview — pick availability (blind, as now) and see the confirmed time;
- **the support link to share** ("send this to members who know you") and who has vouched so far —
  the support link is a separate thing supporters hold, which can record a vouch and nothing else;
- the people they are applying with (pairing), and withdrawing.

---

## 5. One community check

Today there are two: *wider discussion* on applications and *consensus* on invites, built twice with
different subjects, timers and consequences. They become one mechanism (decided: "mostly one or the
other"):

- A **check** is a time-boxed window on an arrival. Any member can raise a concern (one route, for
  every arrival). A standing concern holds the arrival and goes to the mediation body; the objector's
  identity is shielded exactly as today.
- It opens in one of two ways: the lane's verification is *community check* (at entry, once consent is
  given), or the decision rules return *wider discussion* (after evaluation).
- No concern by the deadline: the check passes. A standing concern is never thrown out by a timer
  (J7): mediation can **clear** it, **uphold** it (the person is declined), **overrule** it (the
  threshold from the previous fix), or **ask for more**.
- **Ask for more** (new, decided in outline): the body adds an application and/or an interview to this
  arrival's path. The person is taken back to those steps, evaluated, and decided like anyone else; if
  the rules then return *wider discussion*, there is a second discussion moment. Nothing is invented
  for this: it is the ordinary funnel entered at a later step.
- Because nobody is a Member until admitted, **upholding a concern leaves no account behind**, and
  clearing one admits through the same function as everything else.

Mediation outcomes are applied by the funnel itself, not by calling back into recruitment-holder
functions — which is the cause of today's lost outcome (the objection is marked settled, then a
holder-only function refuses, and the timer later applies the *default* instead).

---

## 6. Admission, notification, doors and capacity

**Admission** is one function. It creates the Member (deduplicating against *every* existing identity,
not only magic-link ones), the login identity, the verified primary contact method (the login link
proves the address), mapped profile answers, languages, participation for the event, the accompaniment
task and the referral edge, and returns the person to the app through the first-login screen. It is the
only code path that creates a member from the funnel. The roster import stays an administrator's
bypass, and records an arrival marked "added by import" so the history is complete and welcome
behaviour is identical.

**What people are told (decided):** *received* (with their private link), *interview link / confirmed
time*, *accepted* (with their login link). Declines are written and sent by a person, using the
existing template; the app does not send them automatically.

**Doors (proposed).**
- Every door is checked where it matters: creating an invite, **redeeming** it, submitting an
  application, scheduling an interview. Today redemption checks none.
- Doors govern *entering*. A closed door stops new entries and says so; a person already in the funnel
  continues. An issued invite is not revoked when a door closes — redeeming it is refused with a
  message, and it works once the door reopens (or expires).
- A closed interviews door holds arrivals at the interview step; it never skips it.

**Capacity (proposed).** Capacity is checked at **admission**, which is the moment someone takes a
place. An outstanding direct invite still holds a place, as now. An arrival that is approved but
finds the event full is **waitlisted** (a stage `docs/spec.md` already names and the pipeline never
computed) and is admitted when room appears or an administrator overrides.

---

## 6a. Admission and the sign-in provider

For a community whose sign-in is its own identity provider (Peach Please runs Zitadel **v4.13.0**,
self-hosted, and only people with an account *and* the project role may log in), "admitted" has to mean
something there too.

**What happens today (read from `src/lib/member.ts` and the OIDC callback).**
- The Zitadel role is the real gate to logging in. First login with the role creates an Orchard member
  automatically, whether or not anyone was ever admitted through recruitment.
- So someone has to create the Zitadel user and grant the role **by hand**. Recruitment neither does it
  nor knows whether it has been done.
- The two don't connect. An accepted applicant becomes a member with a magic-link identity. When SSO is
  primary, the login page sends everyone straight to Zitadel and hides that form. If they then log in
  through Zitadel, the OIDC lookup is by `sub` only, never by email, so they get a **second** member and
  the first is orphaned with their participation, profile answers and accompaniment task.

**Automation, from Zitadel's reference docs (read, not yet run against a tenant).** A *service user*
(machine account) with a personal access token or key, holding an administrator role, can:
- create the user — `POST /v2/users/new` (permission `user.write`);
- send them an invite to set up their own sign-in and prove the address —
  `POST /v2/users/{user_id}/invite_code`;
- grant the project role. The Management API's `POST /management/v1/users/{user_id}/grants` is
  **deprecated**; the replacement is the authorization service's `CreateAuthorization` (`userId`,
  `projectId`, `organizationId`, `roleKeys`; permission `user.grant.write`), documented as available
  from v4, so it should exist on 4.13.0. A forum report of "Not Found" from that service means the
  exact URL form (REST path versus the RPC path) is the first thing the spike settles, and the old
  grant call stays as a fallback if it is missing.
Orchard would never see or store a password.

**Design.**
1. **An identity-provider step inside admission.** After the member row exists, if SSO is configured and
   "create accounts when someone is admitted" is on, admission finds the person in Zitadel by email
   (creating them if absent), sends the invite, and grants the role. It is idempotent: a person who
   already has a Zitadel account just gets the role added.
2. **The member is linked at admission.** The Zitadel user id *is* the `sub` claim, so admission stores
   the OIDC identity with that `sub` and their first login resolves to the same member.
3. **If the API isn't configured or is down, admission still completes** and the arrival shows "admitted
   — sign-in still being set up". Administrators get a to-do (the person's email and the role to
   grant) with a retry.
4. **The manual fallback (decided): connect the admitted member to the sign-in account.** For
   communities on another Zitadel version, another provider, or no API token:
   - *Automatically:* an admitted member with no OIDC identity is linked on their first sign-in when the
     provider asserts `email_verified` for the same address. Today that fallback is refused on purpose,
     because an unverified email must never take over an account; requiring a verified address **and**
     an admitted-but-unlinked member keeps the reason it was refused intact. This alone removes the
     duplicate-member bug.
   - *By hand:* an administrator action "link sign-in account" on the member, for when the addresses
     differ (a person who signs in to Zitadel with a different email). It links the member to the OIDC
     identity from an unmatched sign-in.
   - *Unmatched sign-ins are not lost.* A sign-in with the role but no admitted member and no matching
     address is held as an "unmatched sign-in" for administrators to link or turn away, instead of
     silently creating a member.
5. **A setting for who may join through the provider** (proposed): *anyone with the role* (today's
   behaviour, so nothing changes for a community that relies on it) or *only people admitted here*.
6. **Leaving closes the door** (decided, as a setting): when a member leaves or is removed, the role is
   revoked, so the provider and Orchard can't disagree about who belongs.
7. **Settings (decided).** Three switches, all shown only when SSO is configured and all off until a
   community turns them on: *create accounts when someone is admitted*, *revoke the role when someone
   leaves*, and *who may join through the provider* (above). The service token lives in the
   environment next to the client secret, never the database.
8. **What people are told.** Orchard's *accepted* email says Zitadel will email them separately to set
   up their sign-in, so there aren't two unexplained emails.

**The spike comes first.** Before any of this is built, a throwaway script run against the Peach Please
tenant: create a user, send an invite, grant the role, read the role claim back from a login, delete the
user. It settles the URL form, the minimum administrator role the service user needs (the docs name
organization- and project-level administrator roles; the narrowest one that works needs testing), and
what the `urn:zitadel:iam:org:project:roles` claim actually looks like on 4.13.0 (the code's own comment
admits its shape was assumed).

---

## 7. What goes away

- `community_invite.consensus_state`, the nomination `state`, `recruitment_decision.resolution` as the
  funnel's only memory — superseded by the arrival's facts.
- The nomination **waiting** model: the `awaiting` / `skipped` / `lapsed` states, the lapse job, the
  skip button, and the `recruitmentNominationWindowHours` setting. Support is now a shortcut, not a wait.
- Both consensus and wider-discussion as separate mechanisms; the separate `raiseObjection` /
  `raiseInviteObjection` pair.
- Member creation anywhere in recruitment other than the admission function.
- Code with no caller anywhere in `src/` (found by grep during the audit): `settleNominationIfSatisfied`
  (becomes real), `hasApplicationConsent`, `listObjectionsForMediation`, `standingObjectionCount`,
  `getCommunityInviteRedeemsDirectly`.
- `member.joined_via_invite_id`, which is written and never read.

---

## 8. Build order

Each step is its own set of commits, with the suite green, and nothing is left half-wired.

1. **Foundations.** The arrival table, `requiredSteps`, the derived stage function (pure, with tests
   for every row of §2), the private link and status page, the *received* and *accepted* emails, and the
   single admission function. A **populated-database migration test** first, because this migrates
   live rows (the 0083 lesson). Existing flows start writing arrivals; nothing else changes yet.
2. **Doors and capacity everywhere**, including redemption, the `/apply` "not accepting" copy, and
   the cycle-bound invite that currently lands on a refusal.
3. **Support shortcut and community check.** Support that actually short-circuits the path (and never
   past a standing concern), for public applicants as well as invitees; inviter excluded; vouches
   visible to evaluators. Community check without creating a member early.
4. **The funnel order.** Application → interview → evaluation → decision, lanes driving every step
   (including interview-only and application-less lanes). Standing and per-application interviewer
   availability, the extended poll (the person plus at least N holders), the interview link emailed, the
   interviewers' reports, and the pipeline's call stages becoming real.
5. **One community check**, one way to raise a concern, mediation outcomes applied by the funnel, *ask
   for more*.
6. **Settings.** Lane cards with the compatibility rules of §3, sections that appear only when
   relevant, and consequence sentences generated from the path function.
7. **Sign-in provider (§6a).** First a spike against the real Zitadel tenant with a throwaway user, then
   the provisioning step inside admission, the link by `sub`, the safe claim by verified email, the
   administrators' to-do and retry, and revocation on leaving.
8. **Pairing and clean-up.** The apply-together link on the person's own page, the manual-link route
   for holders, dead code removed, the in-app documentation and `CHANGELOG.md` brought in line.

Two defects are fixed in step 1 rather than separately, because the code they live in is being
replaced: the unchecked shared-interview answer, and the lost mediation outcome.

---

## 9. Decisions and what's left

**Decided (2026-10-06):**
1. Interviewers and evaluators are the recruitment holders, offering standing or per-application
   availability; the interviewers write the report (§2).
2. An approved arrival at a full event is waitlisted until there is room (§6).
3. A closed door holds an issued invite; it is not revoked (§6).
4. After "ask for more", whether another discussion is held is decided by the decision rules (§5).
5. No invites exist yet, so there is nothing to migrate; the populated-database test still comes first.
6. Support is a **shortcut that runs alongside the path** for any lane with a process, public
   applicants included: N member supports skip the rest and admit (§2). No waiting window. It
   **replaces** nomination; an unsupported person simply follows their own lane's path. Members who
   can already see an arrival support it directly, without the link.
7. One number for interviewers and evaluators (§2).
8. Zitadel is v4.13.0 (self-hosted); a manual fallback is required for communities that can't or don't
   want the automation (§6a).
9. Account creation on admission and role revocation on leaving are both **settings**, off by default,
   shown only when SSO is configured (§6a).

**Still to confirm:** nothing blocking. Everything left is detail inside a build step, and the first
thing to run is the Zitadel spike (`scripts/zitadel-spike.mjs`), whose results may adjust §6a.
