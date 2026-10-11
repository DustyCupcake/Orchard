# Admission flow — one funnel, decided per lane

**Status:** proposed, not built. Written after an audit found that the front half of recruitment
(doors, lanes, nomination, consensus) and the back half (evaluation, interview, decision) are two
machines joined only where an invite is sent to `/apply`. This document replaces the *flow* parts of
[`joining-admission-plan.md`](joining-admission-plan.md). That plan's decisions about lanes, the
overrule threshold, shielding the objector and the mediation grant (J1–J12) still stand; what changes
is how the pieces connect.

The decisions below were made with the product owner (2026-10-06 and after) and are marked **(decided)**.
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
| **Application** | The form for where they are applying: the event's form if the application is for an event, otherwise the community's (§2a). | Submitted. |
| **Interview** | A call between the person and the evaluators, scheduled with the existing blind-availability poll. | The agreed slot has passed (or an evaluator marks it held). |
| **Evaluation** | Each evaluator files a recommendation and notes, seeing the application and what happened in the interview. | The community's evaluator count is reached (where there was an interview, the interviewers are the evaluators). |
| **Decision** | The community's rules turn recommendations into *proceed*, *decline* or *wider discussion*. | A rule matches. |
| **Admission** | The one function that creates the Member. | Done — see §6. |

**The interview comes before the decision (decided).** It is a step with the same standing as the
application, not something scheduled beside a decision that has already admitted the person.

**The recruitment holders are the process, and they offer their own availability (decided).** Anyone
who holds the recruitment task is part of the process; nobody is assigned. A holder offers
availability as an ordinary grid of slots, but not tied to one person:

- **Standing availability** — a rolling window over the next few weeks, filled in and edited whenever
  the holder likes. Every incoming interview is matched against it. This is what the existing
  recruitment-mode subscription grows into: today it is an on/off alert flag and the availability is
  re-painted onto every poll. The re-painting goes — the holder fills one grid and it is read, not
  copied.
- **Per application** — after reading an application and wanting to meet that person, a holder adds
  availability on that arrival's own poll.

**Nothing is copied at match time, and confirmation is the lock.** A poll reads availability as it
stands at the moment a slot is confirmed, which is where qualification is already re-checked. So a
holder who was away when the poll was created can come back, fill in their week and rescue it, instead
of being locked out of a poll that then has to be cancelled and rebuilt.

**A slot qualifies when the person overlaps *and* at least N holders offered that same slot**, N being
the lane's reports-needed number below — one number for both. That is a conjunction, not the either/or
the two existing poll modes force today (`must_overlap` is "all of these people", `max_attendance` is
"any N of anyone"), so it is a small extension to the poll rather than a choice between the two.

**Confirmation is a person, not a job.** No scheduled job picks a slot: a holder is pointed at the
poll and chooses one of the qualifying slots. That is deliberate twice over — two qualifying slots are
a human judgement about which time actually suits, and it keeps the platform from deciding for people.
It is also how "nothing waits for ever" reaches the interview: a poll with qualifying slots that nobody
has confirmed is a named item on the needs-action list, the same shape as the reports problem below.
**Any** holder may confirm, not only the poll's organizer — `confirmSlot` is organizer-only today and
that check changes.

**The interviewers are whoever offered the confirmed slot**, read back off the entries at confirmation
(`getConfirmedAttendees`). Deriving them that way is what lets the required set stay open: the plan
never freezes a list of names in order to know afterwards who they were.

**A report is the unit, with or without an interview (decided).** A *report* is one holder's
recommendation — yes, no or unsure — and notes. Each **lane** sets how many reports it needs — one number on the lane, since an application-only lane
and an interview lane are different jobs — and the evaluation step ends when that many are in. Who may file them differs only in what the
lane contains:

| Lane has | Who files reports | Counted until |
|---|---|---|
| an interview | the interviewers (the holders who took part in the call) | N interviewers have reported |
| an application, no interview | **any** recruitment holder who reads it (no scheduling at all) | N holders have reported |
| both | the interviewers; the application is what they read first | N interviewers have reported |

The number is stored on the lane, and it is fixed for each person when they arrive, like the rest of
their path. On the lane card it reads "Interviewers needed" when the lane has an interview and "Reports
needed" when it doesn't, and it is not shown at all when the lane has nothing to evaluate.

**The count is per arrival, never per event.** Where two people share one interview (below) the
interviewers file one account of the call but a separate set of recommendations for each of them — you
may well recommend one and not the other, and a single joint recommendation would decide two people at
once. Each arrival therefore needs its own N. Stated because the obvious implementation credits one
filed report toward both arrivals and resolves them both early.

So with interviews off, nothing is scheduled and nobody is assigned: holders see the application waiting
("2 of 3 reports"), open it, and report. Everything after — the decision, a wider discussion, admission —
is identical. A holder reports once and can change their report until the decision is made. If the
community needs more reports than there are holders, the settings screen and the recruitment view say
so, instead of an application waiting for ever on a number nobody can reach.

**The process belongs to the recruitment holders unless a wider discussion is called for** (decided).
Wider discussion is the one place the decision leaves the holders and goes to the community (§5).

### How reports decide (decided in outline)

**How many reports** a lane needs is set on the lane (above). **How those reports decide** is one
policy for the whole community. Today the community writes an **ordered list of rules** ("at least 2 said proceed → in; …; the last rule
must catch everything"), which can only say "at least N said X". It has no "no more than", so the
natural wish — *at least one yes and no no's; unsure is fine* — has to be faked by ordering rules cleverly.
That is the complexity, and it is more than a community should have to understand. Replaced by a small
fixed form, no lists and no JSON:

| Setting | Choices | Default |
|---|---|---|
| **They're in when** | *nobody says no, and at least one says yes* · *more say yes than no* · *everyone says yes* · *custom: at least [ ] yes and no more than [ ] no* | nobody says no, at least one yes |
| **Any no, or no yes at all, means** | *opening a wider discussion* · *declining* | wider discussion |
| **…and if the discussion ends with no concern** *(only if wider discussion)* | *admit them* · *decline them* | decline |
| **Decline outright when** *(optional)* | at least [ ] say no | off |

Unsure counts toward the reports needed but is neither yes nor no, which is what makes "neutral is fine"
work. The decision is made when the reports needed are in and then frozen, as today. Every lane and event
uses the same policy; the lane decides *whether* there is anything to evaluate and *how many* reports
it takes, not how they are weighed. (A per-lane policy is a small addition if a real community needs
one; it is deliberately not built first, because four lanes times a policy form is where settings get
hard to hold in your head.) A policy that can never be met by a lane — a custom "at least 3 yes" for a
lane that needs only 2 reports, or "everyone says yes" with nobody able to report — is refused when
saved, with the lane named.

Two things this deliberately gives up, which I'd like you to confirm:
- **Arbitrary ordered rules.** The four choices above cover the cases anyone has described; a community
  that needs something stranger is better served by a human decision after a wider discussion.
- **The inviter's marks as rule conditions.** An invite's "knows personally / good fit" marks can no
  longer count as extra input to the decision. They already pick the lane (so they already change the
  path), and a member's vouch is now shown to the evaluators, so counting them again inside the rules
  was a second way to say the same thing.

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

### The support shortcut (decided; built in step 3)

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
- **Asking, not waiting — one poke, in both places.** The existing poke survives: someone names members
  who also know the person and each gets a message carrying the support link. It is one function with
  two callers, and it is best-effort — a member with no address on file, or an unconfigured mailer,
  must never fail the thing it was sent alongside, and the asker always gets the link back to hand over
  by hand. It happens **at invite creation** (the inviter names people, as today) **and on the arrival**
  (the person, or a holder looking at it, asks again later). Which is what makes the shortcut work for
  a public applicant as well as an invitee. Three things it must not do, now that the waiting model is
  gone: imply a deadline, block anything, or count toward N on its own — only a recorded support counts.
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

### Pairing and a shared interview (decided, restating J9)

Pairing is **fact only**: two people apply together, or one names the other, and the platform decides
nothing from it. A pair may **opt into one shared interview** — never automatically, and only once both
sides have an application and the lane asks for an interview. Accepting it points the second arrival at
the first's poll and adds them to its required participants, so both have to submit availability and the
slot has to suit all of them.

Two things this section needs to say because the current code does not:

- **One account of the call, two sets of recommendations.** The interview is shared; the recommendation
  is per person. Each interviewer files one for each arrival, and each arrival counts its own N (above).
- **The opt-in is checked on the write.** Today the offer is listed only to recruitment holders, but
  answering it is not gated — any member who reaches the action can accept or decline on any pair. The
  check moves into the function that records the answer.

This is the one place "one arrival, one path" needs a caveat: two arrivals, one poll.

---

## 2a. Lanes are defined by what we know about the arrival (decided)

The four fixed lanes of the earlier plan (J1) were four answers to "how did this person arrive?" that most
communities don't all need, and that some need to split more finely. So a community defines **only the
lanes it needs** — but a lane is still defined by facts the system already has, never by something an
inviter or applicant chooses from a menu:

- **An invite lane** matches on what the *inviter declared* with the two checkboxes they already tick —
  *I know them personally* (both ticked counts as this), *I think they'd fit*, or neither. A lane lists
  which of those three it handles. A community might have just two: **knows them personally**, and
  **every other invite** (the general case). Or one lane for all invites. Or all three kept separate.
- **A public lane** matches on **the link the person arrived by**. A community can run several, because
  each is a different starting point with its own link and its own process. The first is served at
  `/apply`; the others at `/apply/<name>`. A community with no public lane is invite-only.
- **Together they must cover everything** (in each context where they are open, see events below).
  Each of the three declarations belongs to exactly one invite lane, so no invite is ever left with nowhere to go; the panel enforces it (a declaration already used
  by another lane is shown as taken).
- **The inviter is always asked the two questions (decided),** even where the community's lanes don't use
  the answer to choose a path: how well the inviter knows someone is information the evaluators want. It
  is recorded on the invite and shown to the evaluators with the lane. Lanes use it only to the extent
  they distinguish it.
- **The rest of a lane is as before:** a name and a sentence, the process (an application, an
  interview), the check (none, or a community check), reports needed (§2) and the support shortcut
  (§2). The *form* is not part of a lane: it belongs to where the person is applying (below).
- **Who may use a lane (proposed).** Since an inviter's declaration picks the lane, "I know them
  personally" is the easy tick. A lane can optionally be limited to holders of a tier or task, defaulting
  to any member.
- **Lanes are archived, not deleted.** People in the funnel keep the path they entered on (paths are
  fixed at entry). An invite already issued under an archived lane is held rather than revoked.
- **Starting point.** A new community begins with *Invited* (all declarations) and *Open application*,
  and can split or add lanes from presets or from blank. An existing community's four lanes are carried
  over as they are.

### Events and lanes (proposed, following the product owner's suggestion)

Lanes are **community-wide, and an event never overrides one**. What an event (or the community in
general) decides is smaller:

| For each *context* — the community in general, or one event | Choice |
|---|---|
| **Which lanes are open there** | an event defaults to "the same as the community's" and can instead pick its own set; the community's general set can be *none*, for a community whose recruitment is entirely event-by-event |
| **Which application form applies** | the event's form, applied to **every** lane's application in that event — public applicants and invitees alike — else the community's form |

- **Invites for an event** use the community's lanes, matched on the inviter's declaration as usual, and
  ask the event's form wherever the lane requires an application. If the matching lane is closed for that
  event, the invite is refused with a plain sentence ("this event takes invitations only from people who
  know the person personally"); the inviter is still asked the declaration question first.
- **A different process for one event** is a different lane, opened only there. A lane is cheap and costs
  nothing while closed, so the rare "stricter interview for the big event" case needs no per-field
  override. The rule that each declaration belongs to one invite lane is therefore checked **per
  context**, among the lanes open there, not across every lane the community has defined.
- **Public addresses.** An event's application page lists the public lanes open for it (or goes straight
  to the only one), carrying the event's form; the community's general page does the same for its own.
- **What goes:** the per-event override rows and their field-by-field inheritance, the "untick to
  inherit" delete, and the "changed for this event" bookkeeping. **What stays on the event:** its period,
  its capacity and the interviews pause switch.
- **Doors become derived (a possible simplification, to confirm).** "Applications open" is then simply
  "a public lane is open", and "invites open" is "an invite lane is open", so the two toggles disappear
  from the event and the community. Period and capacity are unchanged.
- **Not in the first build:** a form per lane. Forms stay at the two places they already live (the
  community and the event). A community that needs two different general applications can have it later
  by letting a lane carry its own form, with the event's form still winning in an event. The roadmap's
  "baseline plus event-specific extras" is likewise a later form feature.
- **Reports needed is per lane,** so an event that wants a different number opens a different lane;
  how reports decide stays one community-wide policy.

---

## 3. Settings: what is offered, and what is hidden

**Cards and a panel (decided).** The lanes appear as a short list of cards. Each shows a name, a one-line
generated sentence, and an **Edit** button; **Add lane** (with the presets) sits above them. Edit opens
a panel that runs top to bottom — *name and who it's for*, *how they arrive*, *what they go through*
(application, interview), *checks and shortcuts*, *reports needed*, *who may use it* — and a
question appears only once the earlier answers make it meaningful. At the bottom is a live preview: the
same sentence the card shows, e.g. "Invited by a member who knows them. Application, then an interview
with 2 interviewers, then decided. 3 supports skip the rest." That sentence is generated by the function
that decides the person's path, so the screen cannot describe something the system does not do.

The panel draws its choices from the table above, and the consequence sentence under every
lane is generated from the same function that decides the person's path — so the screen cannot
describe a path the code doesn't follow (today it does: the "Community-checked" preset promises an
application and an interview that a consensus invitee never meets).

| If the lane's verification is… | …then |
|---|---|
| **community check** | Application and interview are not offered. The check *is* the process (decided: "mostly one or the other"). The body can still ask for more — see §5. |
| **none** | Application and interview are offered. Both off means "admitted immediately", stated plainly. If either is on, the lane also shows **reports needed** and can add a **support shortcut** (a number of supports); with both off there is nothing to evaluate or skip, so neither is offered. |

Whole sections follow from the lanes:

- **Evaluation** (the decision form above and the interview door; reports needed lives on each lane) is shown only when at
  least one lane — open in that context — has an application or an interview on. Otherwise the section says
  there is nothing to evaluate. A community with no lane that evaluates is never asked to configure how
  reports decide. The wider-discussion choices inside it appear only if "any no" is set to open one.
- **Community-check window, mediation grant, overrule threshold** appear only when a lane uses a
  community check or the decision form is set to open a wider discussion.
- **Support-shortcut settings** appear only when a lane turns the shortcut on.
- **Doors** are always shown; the *interviews* door only when some lane has an interview.

A configuration that can't produce a person's path is refused when saved, with a sentence saying why,
not left to fail at redemption.

---

## 4. The arrival record

One row per person in the funnel (`admission`), replacing the overlapping state spread over the invite
(`redeemedAt`/`revokedAt`/`consensusState`), the nomination (`state`) and the decision (`resolution`).

- **Identity before membership:** email and name as given, the lane (by id, with the lane's path copied
  onto the arrival), how they arrived (invite and/or application), the event they are joining.
- **The path, fixed at entry (decided in principle):** `requiredSteps` — which of verification
  (and which kind), application, interview and evaluation apply, plus the reports needed and the
  support-shortcut count in force at that moment.
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
  every arrival; any member means any member — a recruitment subscription is not required — except the
  person's inviter). A standing concern holds the arrival and goes to the mediation body.
- **"The objector is shielded" means all of it (J7), enumerated because nobody should read this section
  as licence to drop the rest:** the objector's identity is hidden from the evaluators, from the person
  objected to and from the inviter; the objector can **recuse** anyone from even the body's view; and
  the objector can **consent for one named person** to be told, and withdraw that consent later. Both
  shield tables and all four of those actions survive the merge, and they apply identically to a check
  that opened at entry and one opened after evaluation.
- **The mediation body keeps its shape as well (J8).** It is a grant of its own, community-shaped rather
  than event-shaped — an objection to one event's invite is mediated by the same people who mediate one
  on an untagged application, and scoping it per event would fragment it into exactly the per-event
  veto-by-inaction the redesign exists to end. It is grantable to any task or tasks the community
  chooses (recruitment's, the conflict team's, a third), is multi-cardinality (a body that can be
  overruled against has to be a body, not a pair of hands), and is held by nobody by default. **Never
  scoped per event** — even though §2a gives each context its own set of open lanes.
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

**Doors (built in step 2).**
- Every door is checked where it matters: creating an invite, **redeeming** it, submitting an
  application, scheduling an interview. Today redemption checks none.
- Doors govern *entering*. A closed door stops new entries and says so; a person already in the funnel
  continues. An issued invite is not revoked when a door closes — redeeming it is refused with a
  message, and it works once the door reopens (or expires).
- A closed interviews door holds arrivals at the interview step; it never skips it.

**Capacity (built in step 2).** Capacity is checked at **admission**, which is the moment someone takes a
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

**Spike results (2026-10-07; `scripts/zitadel-spike.mjs` against the real tenant, Zitadel v4.13.0).**
It created a throwaway user, granted the project role, read it back, revoked it and deleted the user; a
follow-up search confirmed nothing was left behind. What worked, and so what the build will use:

| Need | Call that worked | Notes |
|---|---|---|
| Create the person | `POST /v2/users/new` with `{organizationId, username, human:{profile, email:{email, isVerified:false}}}` | No password needed. Returns the user `id`. |
| Invite, without emailing anyone | `POST /v2/users/{id}/invite_code` with `{returnCode:{}}` | The code comes back to us. The real flow will use `sendCode` so Zitadel emails it; that still needs testing with a real address (yours), not a stranger's. |
| Grant the role | **`POST /zitadel.authorization.v2.AuthorizationService/CreateAuthorization`** with `{userId, projectId, organizationId, roleKeys}` | Returns `{id}`. |
| Read it back | management `POST /management/v1/users/grants/_search` with a `userIdQuery` | |
| Revoke it | **`POST /zitadel.authorization.v2.AuthorizationService/DeleteAuthorization`** with `{id}` | |
| Remove the person | `DELETE /v2/users/{id}` | |

- **The REST-style `/v2/authorizations…` paths I guessed return 404 on this version** (create, search and
  delete alike). Only the RPC-style `/zitadel.authorization.v2.AuthorizationService/…` paths exist, so the
  build uses those. The deprecated management grant call was never needed.
- **The manager roles you assigned to the service user were enough** for create, grant and revoke.
  (I did not see which roles those were; the intended narrow pair is Org User Manager + Org User
  Permission Editor, and if that is what you chose, least privilege is confirmed.)
- Not tested, and still to do in the build: a user who **already exists** in Zitadel (search by email,
  then add the role only), the `sendCode` invite email and its link template, and what the
  `urn:zitadel:iam:org:project:roles` claim looks like. The last one needs no testing here: your members
  already sign in through this exact claim, which is the real-world confirmation the code's comment
  said it lacked.

---

## 7. What goes away

- `community_invite.consensus_state`, the nomination `state`, `recruitment_decision.resolution` as the
  funnel's only memory — superseded by the arrival's facts.
- The fixed four-value lane enum (`joining_lane_kind`). Lanes are rows (§2a) defined by which declarations
  or which public link they match, and an invite and an arrival store their lane's id. The inviter's two
  checkboxes stay: they are the declaration a lane matches on.
- The per-event lane **override rows** and their inheritance (if event-bound lanes are accepted, §2a).
- The community-wide `recruitmentEvaluatorCount`, moved onto each lane as its reports-needed number
  (every existing lane takes the current value, so nothing changes until someone edits one).
- The ordered **decision-rules list**, its JSON-shaped storage (`recruitmentDecisionRules`) and the
  rules editor, replaced by the small form above (a handful of typed columns). Nothing is configured in
  any existing community, so there is nothing to convert.
- The nomination **waiting** model: the `awaiting` / `skipped` / `lapsed` states, the lapse job, the
  skip button, and the `recruitmentNominationWindowHours` setting. Support is now a shortcut, not a wait.
- The **auto-lapsing subscription**, deliberately (decided 2026-10-08). A subscription that lapses after
  N no-shows flips `active` off with nothing said to the member, so three no-shows quietly cancels a
  setting that member chose on purpose — and with standing availability (§2) the whole mechanism is
  moot anyway, since anyone who has filled in a grid keeps offering it. So `consecutiveNoAvailabilityCount`,
  `recruitmentSubscriptionLapseThreshold`, its scheduled job, its settings field and the "about to lapse"
  warning on the applications page all go, and **the person owns the setting**. Nudging a holder who has
  no availability covering a confirmed interview is a pull-notification on the needs-action list, subject
  to their own notification preferences, not a counter against them.
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

1. **Foundations.** The **lane table** (community-defined lanes, replacing the four-value enum; the
   existing four carried over, an invite and an arrival pointing at a lane id), the arrival table, `requiredSteps`, the derived stage function (pure, with tests
   for every row of §2), the private link and status page, the *received* and *accepted* emails, and the
   single admission function. A **populated-database migration test** first, because this migrates
   live rows (the 0083 lesson). Existing flows start writing arrivals; nothing else changes yet.
2. **Doors and capacity everywhere**, including redemption, the `/apply` "not accepting" copy, and
   the cycle-bound invite that currently lands on a refusal.
3. **Support shortcut and community check.** Support that actually short-circuits the path (and never
   past a standing concern), for public applicants as well as invitees; inviter excluded; vouches
   visible to evaluators. Community check without creating a member early.
4. **The funnel order** (built in step 4, in two pieces: reports and the decision form, then the interview). Application → interview → evaluation → decision, lanes driving every step
   (including interview-only and application-less lanes). Standing availability as a rolling grid the
   holder edits themselves, matched against incoming interviews rather than re-painted; the poll
   qualifying when the person overlaps **and** at least N holders offered that slot; confirmation by a
   holder rather than a job, and any holder rather than only the organizer; the interview link emailed;
   the interviewers derived from the confirmed slot; their reports, reports from any holder where there
   is no interview, the small decision form in place of the rules list (a data migration of the empty
   rules, and the editor removed), and the pipeline's call stages becoming real.
5. **One community check**, one way to raise a concern, mediation outcomes applied by the funnel, *ask
   for more*. *(Built. One `community_check` row per window, `kind` entry or evaluation, with the
   concern and shield tables keyed on it; one `/community-check` page for any member; one function
   that decides a window from its concerns and the clock; "ask for more" offered on an entry window,
   with an application form on the person's own page. The old `objection*` tables and the invite's
   consensus columns are migrated and dropped; the manual "resolve the window" action is gone.)*
6. **Settings.** The lane cards and panel (§2a, §3) with the compatibility rules of §3, public lanes
   with their own addresses, sections that appear only when
   relevant, and consequence sentences generated from the path function.
7. **Sign-in provider (§6a).** First a spike against the real Zitadel tenant with a throwaway user, then
   the provisioning step inside admission, the link by `sub`, the safe claim by verified email, the
   administrators' to-do and retry, and revocation on leaving.
8. **Pairing and clean-up.** The apply-together link on the person's own page, the manual-link route
   for holders, one report of the call and two recommendation sets for a shared interview, dead code
   removed, and **`docs/spec.md` amended in step with the code** — this plan rewrites the Recruitment
   section of the spec wholesale (the four lanes, nomination, the poll's participants, the marks as
   decision input, and the pipeline view's scope note), and `CONTRIBUTING.md` makes the spec the
   current state of the system, so it moves with the code and not after it. The in-app documentation,
   `README.md`'s feature list and `CHANGELOG.md` come in line at the same time.

Three defects are fixed in step 1 rather than separately, because the code they live in is being
replaced: the unchecked shared-interview answer (the offer is listed only to holders, but answering it
is not gated), the lost mediation outcome, and the organizer-only `confirmSlot` — which, with
confirmation now open to any holder (§2), is the authorization that lets a poll with qualifying slots
be confirmed by anyone who can act on it.

**No new scheduled job is added anywhere in this plan.** Confirmation is a person, the nomination lapse
goes, and the subscription lapse goes; the remaining jobs (consensus and wider-discussion windows) are
the ones §5 keeps.

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
7. One number for interviewers and evaluators, **set per lane** (so an event that wants a different
   number opens a different lane), because an application-only lane and an interview lane need
   different numbers; how reports decide stays one community-wide policy (§2).
8. Zitadel is v4.13.0 (self-hosted); a manual fallback is required for communities that can't or don't
   want the automation (§6a).
9. Account creation on admission and role revocation on leaving are both **settings**, off by default,
   shown only when SSO is configured (§6a).
10. With no interview, any recruitment holder who reads the application files a report, and the same
    "reports needed" number applies (§2). Reports are counted the same way in every lane.
11. **Lanes are community-defined but still matched on what we know** (§2a): an invite lane lists which
    inviter declarations it handles, a public lane is the link someone arrived by, and together they cover
    everything. A community has only the lanes it needs and can make them more specific. Shown as cards
    with an Edit panel and a live preview (§3). Lanes are archived, not deleted.

**Decided (2026-10-08):**
12. Availability is a **rolling grid the holder edits themselves**, matched against incoming interviews
    and read at confirmation rather than copied onto a poll. No recurring weekly schedule, and nothing
    scoped to a period or carried into the next one (§2).
13. A slot qualifies when **the person overlaps and at least N holders offered that slot** — a
    conjunction, added to the poll rather than chosen between its existing two modes. Confirmation is
    **a person, not a job**: a holder is pointed at the poll and picks a qualifying slot, any holder may
    do it, and the interviewers are whoever offered the confirmed slot (§2).
14. The **subscription never auto-lapses.** The person owns the setting; being nudged about missing
    availability is a pull-notification under their own preferences, not a counter against them (§7).
15. A **shared interview** is one account of the call and two sets of recommendations, and each arrival
    counts its own N toward reports needed (§2).
16. The **poke stays**, in both places — at invite creation and on the arrival — as one function, never
    implying a deadline and never counting toward N by itself (§2).


**Still to confirm:**
1. Events and lanes (§2a): each context chooses which lanes are open and which form applies, and lanes
   are never overridden per event; and whether the two door toggles become "a lane is open".
2. Who may use a lane (§2a): an optional limit to holders of a tier or task, defaulting to any member.
3. A new community's starting lanes (*Invited* and *Open application*); first public lane at `/apply`.
