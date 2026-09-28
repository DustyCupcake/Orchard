# Default profile questions

The proposed starter set for a new Community, and — since the seeding path landed — the
document the table in `src/lib/profile-questions/defaults-table.ts` is written from. Edit
either; the table is what a community actually gets, and the reasoning for why it differs
from this document is recorded in the notes at the foot.

## How to use it

- Every question is **created disabled**. Set-up walks a new community through the list and
  they tick on what they want. Nothing is asked until it's on, so an unused suggestion costs
  nothing and a community that never wants "roughly how long have you been here" simply
  doesn't have it.
- Every entry names its **scope** and whether it's **publishable** or **sensitive**, because
  those are decided at creation and then fixed. Getting one wrong means archive and re-add.
- The "declinable" column is whether the question should be created with *prefer not to
  say* **on**. It's called out per entry because it is not uniform, and the rule behind it
  isn't yet settled — see the sensitivity note at the bottom.
- Entries already in the codebase are marked **[exists]**, so this list doesn't imply more
  new work than it does.

---

## Publishable as indicators — community information

*(once-ever only; publishable on top of being public — never a third kind of question)*

Once-ever. Read by the whole community; never permission-gated. Each question in here also
carries its own decline, which is what publication actually requires — a member's way to keep
their answer on their profile and out of a chart. A restricted question is refused publication.

| # | Question | Shape | Options | Declinable | Why |
|---|---|---|---|---|---|
| 1 | **Your pronouns** **[exists as the motivating case]** | multi_choice + other | she/her, he/him, they/them, he/they, she/they | yes | The case the whole feature exists for. Countable, declinable, and the reason the escape hatch exists. |
| 2 | **Languages you speak** | multi_choice + other | (community-editable) | yes | Genuinely both — who someone *is* and what an interpreter needs. Public: the fact is about the person, and the audience that needs it (interpreters, coordinators) is a job rather than a kind of question. |
| 3 | **How long you've been part of this** | single_choice | less than a year, 1–3 years, more than 3 years | yes | Tenure shapes who a community's decisions are landing on. Low sensitivity. |
| 4 | **Age range** | single_choice | under 18, 18–24, 25–34, 35–44, 45–64, 65+ | yes | Usually asked as a band, never a date of birth. **Overlaps eligibility** — see the eligibility note below. |

**Not included, and why** — say the word if you disagree with either:

- *How did you hear about us?* Genuinely useful for outreach, but people answer it expecting
  it to be private, and the honest fix is a conversation rather than a profile field. If you
  do want it, it needs the section framing, not a silent default.
- *Anything you'd like us to know better?* Free text can't be an indicator and is the shape
  most likely to be misread as a confidential channel. Better as a conversation.

---

## Ordinary — event and task information

*(readable by **everyone** — which is the default for a public question; restricting one is a
tick at creation plus a choice of audience, and it can't be undone afterwards)*

### Once-ever — facts about you that don't change between events

| # | Question | Shape | Options | Declinable | Why |
|---|---|---|---|---|---|
| 5 | **Certifications you hold** | multi_choice + other | first aid, food hygiene, safeguarding, driving licence, other | yes | Determines what someone can be asked to do. Also a real safety input. |
| 6 | **Anything that would affect what you can take on** | text (long) | — | yes | The escape hatch for disability, caring responsibilities, faith, anything the fixed list doesn't cover. Arguably the most valuable item here. |
| 7 | **Do you have a vehicle?** | boolean | — | no | A fact, not a circumstance. Nobody minds this being known. |

### Per-event — asked fresh each time, because the answer can change

| # | Question | Shape | Options | Declinable | Why |
|---|---|---|---|---|---|
| 8 | **Do you need a bed?** **[exists — the capacity question]** | boolean | — | no | The canonical event question, already feeding the capacity signal. |
| 9 | **T-shirt size** | single_choice | XS, S, M, L, XL, XXL, or community's own | no | Sizes change, and it's a fact. |
| 10 | **Can you drive a van / carry passengers?** | boolean | — | no | Distinct from #7 and from willingness — it asks capability, not possession. |
| 11 | **Do you need a lift to or from an event?** | boolean | — | no | The reverse of #10, and a different question. |
| 12 | **Dietary needs** | multi_choice + other | vegetarian, vegan, halal, kosher, gluten-free, other | yes | Health-adjacent, so a refusal has to be possible — and a refusal here is information the kitchen needs, which is why it's a decline rather than a blank. |
| 13 | **Can you carry heavy things?** | boolean | — | no | Task matching, and nobody minds. |
| 14 | **When are you generally around?** | single_choice | weekdays, evenings, weekends, shift work, other | no | Scheduling input. |

---

## Sensitive — private facts

*(an access rule is **required**; the member is shown who can read it, and widening the
audience asks their agreement and notifies them)*

| # | Question | Shape | Options | Declinable | Why |
|---|---|---|---|---|---|
| 15 | **Allergies** | text (long) | — | yes | Kitchen coordinators genuinely need it; nobody else does. **[shipped — audience `kitchen`]** |
| 16 | **Health conditions** | text (long) | — | yes | Same audience, higher consequence. **[not shipped — no obvious default audience, and a wrong one is a disclosure]** |
| 17 | **Emergency contact** | text (long) | — | no | Can't be usefully refused during an event, and the emergency path reads it. Requiring a decline here would be theatre. **[shipped — restricted, with the audience chosen at review; skipped by the unattended path]** |
| 18 | **Home city or town** | text | — | yes | Drives travel and cost planning. A town rather than a full address, so it narrows a plan without being the start of finding someone. **[shipped — audience `event_scheduling_owner`]** |
| 19 | **Date of birth** | date | — | no | Needed for some insurance and safeguarding contexts. Precise, so high sensitivity — but a "prefer not to say" that leaves a gap in eligibility is worse than the fact being held. **[not shipped — see the notes below]** |
| 20 | **Full legal name** | text | — | no | Distinct from display name; needed where a legal record matters. **[shipped — audience `admin`]** |

The four `member` columns these used to be (`health_conditions`, `allergies`,
`emergency_contact`, `orientation`) no longer exist; see "the collapse" below.

---

## Not profile questions at all

- **Eligibility criteria** — "are you over 18?", languages required for a role, minimum
  completed tasks. These belong in the existing `requirement` table, which is task-owned and
  already evaluates all three modes. Putting them in the question system would give them a
  decline button, and a decline against an eligibility gate is a contradiction.
- **Contact methods** — email, phone, messenger. Many per member, which a question can't
  express, and they already have a three-tier visibility of their own.
- **Display name** — stays a `member` column. It's the identity anchor, not a fact about
  someone.
- **Trait axes** — "wants direction ↔ wants independence". They set values on *tasks* as well
  as people, and the fit scoring is `1 − |member − task| / range`, so the ordering of the
  scale is the information. A question has no task side and no order.

---

## The design this list landed on

Not a category taxonomy, and specifically **not** the three-category one. That version failed on
its own terms because "gated" turned out to be *access*, not a kind of data — t-shirt size isn't
sensitive and still shouldn't be readable by everyone. What replaced it kept attributes but was
still one step out: it treated publication as a separate thing from visibility, which is only true
if a question can be published without the whole Community being able to read it — and it can't,
because an indicator is an aggregate of answers everyone can already read individually. So
publication became a **capability of public questions** rather than a third kind, and `demographic`
went with it. Two visibility states, five independent attributes:

| attribute | values | notes |
|---|---|---|
| **publishable** | on / off | An admin toggle, mutable, and only on a public question. Requires once-ever scope, a countable type, and a decline. |
| **restricted** (`sensitive`) | yes / no | **Fixed at creation**, with the audience. Not editable in either direction. |
| **scope** | once-ever / per-event / per-phase | Free — and free for restricted questions too, since "medication on site" is both. |
| **access** | a set of rules | Who may read. Chosen at creation; widened later, which asks. |
| **emergency** | yes / no | Mutable. Answering it consents to emergency reads. No separate member tick. Meaningless on a question everyone can already read. |

**A restricted question is restricted *by* its audience, and the pairing is required.** There is
no third "owner-and-emergency-only" state to choose at creation: it reads as broken rather than as
private, so an admin who believed they'd narrowed something to the kitchen would have narrowed it
to something that looks like a bug. The write side refuses a restricted question with no audience
and an audience with no restriction, and `createProfileQuestion` takes both together and does the
insert → rule → flag sequence internally.

**The restricted flag is made cheap-to-abuse deliberately not.** A public question is readable by
the whole Community, and restricting it is a single tick at creation plus a choice of audience. So
under-labelling a health question doesn't save work — it publishes the data to everyone, visibly,
from the moment the first answer lands. The shortcut and the danger can't both point the same
way, which means nobody has to be trusted to make the right choice. And because the flag can't be
moved afterwards, a question filed wrongly is fixed by archiving and re-adding rather than by
flipping a switch that would retroactively publish every answer to it.

**There is no standing "may I be counted in indicators" consent.** It existed
(`member.consentsToCommunityIndicators`) and was dropped in 0081, because its justification — a
decline is a response to one question, and a question invented later has no decline for them to
have used — stopped being true once publication only reached public answers. The per-question
decline is the lever, it is required on every publishable question, and it is a *stored refusal*
counted separately rather than a gap, since silence is visible.

**Eligibility isn't a question.** "Are you over 18?" belongs in `requirement`, which is
task-owned and already evaluates all three modes. As a question it would get a decline button,
and a decline against an eligibility gate is a contradiction.

**Task-derived questions inherit the task's scope** rather than picking their own. A task
holder proposes a question, it attaches to their task, and the answer lives exactly as long as
that task does — which is what a cycles-disabled community needs, since with `cyclesEnabled`
false there is no event to scope to and the task is the only lifetime available. No fourth
scope value: a task already carries a nullable `cycleId`, and a cycle-less task inherits the
same "always applies" treatment the board gives it.

**Answering a sensitive question is consenting to emergency access — no separate tick.** The
question is marked emergency-capable by the community (A3); a member who answers has agreed to
it, and the only way to refuse is not to answer, at which point there is nothing stored and
nothing to read. This is exactly how a filled-in contact method behaves, and for the same
reason: emergency reachability is a property of the value existing, not a tier the member
opts into.

Abuse is acceptable here in a way it isn't for ordinary permissions because **emergency reads
notify, and ordinary ones don't**. Someone reading under a permission the member granted is
exercising it, so silence is correct. Someone activating emergency mode is acting against the
tier the member chose, which is the event worth a ping — and "it was obvious in the log" is a
real answer to "could this be abused", which it is not for the silent permissions.

**The share-with-audience checkbox defaults to on, for sensitive questions only.** So the
permission ladder is three levels, and the baseline is always bounded by the sensitivity
declaration:

1. non-sensitive, unrestricted — **everyone** may read; a member can only decline
2. sensitive — the **configured audience**; a member can uncheck to reduce to emergency-only
3. declining entirely — always available, and the only lever on level 1

Level 1's default is maximum exposure on purpose: that is what makes the sensitive flag
hard to misuse, because under-labelling publishes the data rather than quietly keeping it.
Level 2's default is on because the audience is already restricted by configuration, so
"on" is not the same as "public" — the uncheck is a reduction from an already-bounded
exposure.

`profile_answer.capacityVisibility` already lives on the *answer* rather than the question, for
the same reason this checkbox does: who may see this is a decision about a person, not about a
field.

**Emergency access only means anything on a restricted question** — with everyone already able
to read a public one there is no ordinary access to withhold, so the box only appears when there
is an audience. The write side refuses it otherwise, on the grounds that "answering this consents
to emergency reads" would consent to nothing and would put a read of public data in the log as
though it had been protected.

**Emergency access is mutable, deliberately, and that is not an oversight.** Switching it *off*
discloses nothing, so a Community should be able to stop advertising a standing emergency
reachability of its members' facts. The flag it can't be paired with is `sensitive`, which is
immutable — the two are not symmetric and shouldn't be: one is a decision about the Community's
own posture, the other is a decision about other people's answers that were given under a
different posture.

**Turning it *on* asks.** For a question that already has answers, that's a widening: those
people answered a question their data couldn't be pulled out of in a crisis, and the reach is now
being handed to whoever activates Emergency mode on their page. So each existing answer has its
consent reset and its owner is prompted, and the reveal waits for them. Two populations are
deliberately not asked, both because nothing widens for them: an answer that already un-ticked
the share box is emergency-only *by that choice*, and a decline holds no value to reach.
Re-answering agrees, for the same reason it does on the audience side.

**Consent to be read is to a rule, not to a list of people.** "Whoever holds the task" is
consented to as a *relationship*, so a new claimer is inside what was agreed and needs no new
conversation. A task being claimed by someone new is not a consent event, and treating it as one
would either spam members or produce a notification people learn to ignore.

**Adding a group to an existing audience *does* ask**, per answer and per rule. A rule added to
a question that already has answers cannot reach the answers that predate it; each of the
affected members is prompted to extend sharing, and the prompt is one row per *group*, so
agreeing to the kitchen team doesn't also hand over to whoever was added last week. Re-answering
the question is also agreement, since the member has just been shown the audience it is shared
with. Turning emergency access on for a question that already has answers asks too, and the
consent is per answer rather than per group because there is only one route to be in — see the
emergency note above.

**The promise has to match the mechanism.** "You'll be notified if ever someone accesses it"
cannot mean a notification per read — a kitchen coordinator checking allergies fifty times
over a weekend would be fifty notifications, and the second one trains people to ignore the
first. Log every read, notify on the *first* one, and let the member see their own access
history. The section copy has to say which of those it is.

---

## The collapse: two systems, one of which did nothing

Between this document being written and the questions being seeded, the app had **two**
sensitive-data mechanisms. They shared the access-rule table and nothing else.

- **The four fixed `member` columns** (health conditions, allergies, emergency contact,
  orientation) had a module toggle, a roster grid at `/sensitive-data`, a consent gate, and
  exactly one live reader between them — the kitchen's dietary panel, for allergies.
- **Sensitive profile questions** had a per-answer audience, indicators, emergency reveal and a
  per-answer share switch — and **no cross-member read surface at all**. The one production
  caller of the readability resolver passed the viewer as the owner, so the audience ladder
  short-circuited on every real request. `sensitive` performed no restriction anywhere. The
  starter set's own seeded "Allergies" question had no reader at all while the kitchen read the
  column beside it.

The net effect was an allergy recordable in two places and readable from one, which is the exact
failure the "NOT seeded, deliberately" note above warned about — and the warning was in the same
file as the row that broke it. Migration 0080 removed the columns, the `sensitive_data` module,
`/sensitive-data`, and the column half of the rule and consent tables. `question_id` became
`NOT NULL`, so "which of two things does this rule name" is now unrepresentable rather than
validated. There was no data to migrate: no Community held values in those columns.

What replaced the roster grid is **`/members/data`** — every question the viewer may read about
other people, with column selection, a value filter, and per-column counts and per-option
breakdowns. It is not sensitive-only on purpose: a coordinator planning an event wants the same
table either way, and a sensitive-only page would be a worse version of the one that exists.

## Where the shipped set parts company with this document

The table in `src/lib/profile-questions/defaults-table.ts` is what a new Community actually
gets. It is not this document verbatim, and the differences are deliberate.

**Nothing per-event is seeded.** The whole "For an event" group — #8 to #14 — is absent from
the table. Scope is fixed at creation, and a `per_cycle` question is skipped on every read
surface while its member has no declared cycle and no open cycle exists to fall back to. The
seed runs at signup, so it would have created seven questions that a brand-new Community
cannot see, answer, or be nagged about, and permanently so for a Community that never enables
cycles. A Community adds these itself, per event, once it has one, where the create form's
scope picker makes the decision explicitly.

**#19 Date of birth is not seeded.** #5's age band covers every use this set has for age,
and #19 collected a precise identifier with no decline offered — a real identifier, gathered
for a hypothetical insurance context, on behalf of a member who had no way to refuse it. The
"a decline that leaves an eligibility gap is worse than the fact being held" reasoning is
sound *if* something needs the fact; nothing here did, and eligibility belongs in
`requirement` per the note above.

**#18 and #20 arrived without an audience, and were therefore readable by everyone.** Both
sit under a heading that says an access rule is required, and both seeded as non-sensitive
questions — which `resolveReadableQuestions` reads as level 1, unrestricted. A restricted
group whose rows contradict its own heading is worse than no group, so both now carry a
default audience: `event_scheduling_owner` for #18, since travel and cost planning is
programme-owner work, and `admin` for #20, the narrowest audience in the set for the question
with no decline offered. The review step pre-selects these and the admin can change either.

**"Anything that would affect what you can take on" moved into the restricted group.** It
began in the capability group, whose blurb promised that none of it was anybody's business to
read, while its own reasoning described it as "the escape hatch for disability, caring, faith"
— and it seeded world-readable. Restricted, to `branch_coordination`, since they are the ones
fitting work to people.

**"How long you've been part of this" is not seeded.** Tenure is a proxy for how long someone
has been around, published as an indicator on a Community page, to answer a question about a
member who joined last week. The age band and the certifications are the membership signals
that bear on a decision.

**The access rules are picked where the questions are created, not afterwards.** A rule can
only name a question that exists, so the review step takes the audience alongside the restricted
tick — and why an admin should not have to go and hand-write a rule per restricted question
afterwards.

**#16 Health conditions and #19 Date of birth are not shipped.** Both are the same failure in
different clothes: the set would be collecting a precise medical identifier, with no decline
offered, for a hypothetical use no Community had asked for. #19's own justification — "a decline
that leaves an eligibility gap is worse than the fact being held" — is sound *if* something needs
the fact. #5's age band covers what this set actually uses age for, and eligibility belongs in
`requirement` per the note above. A community that does need either adds it, restricted, with
whichever audience it chooses.

**#17's audience is chosen, not defaulted — and that reverses an earlier decision here.**
Owner-and-emergency-only used to be the seeded state, on the reasoning that nobody routinely
needs an emergency contact and inventing an audience for it would be worse than not having one.
That reasoning is right about the audience and wrong about the consequence: "not having one" is
only available while a rule-less restricted question is accepted, and accepting it is a bad
state for an unrelated reason — a question that resolves to nobody reads as broken rather than as
private, so an admin who believed they'd narrowed something to the kitchen would have narrowed it
to something that looks like a bug. So the write side now refuses the pair, which removes the
state, which means the platform has to be asked.

**So the unattended signup path skips #17, and the review step asks.** The difference is
deliberate and it is the only one between the two entry points: on review the Admin names a
group (or unticks the question), and unattended there is nobody to ask, so the row is left out
rather than guessed at. A wrong guess here is a disclosure, not a formatting error. And it is
still not Admin by default: holding Admins is about who manages a Community's settings, and a
platform that assumed so would be making a privacy decision on the Community's behalf. A
community that wants Admins, a welfare Tier or anyone else to read it routinely names them; a
community that wants nobody can add the question later with the narrowest audience available,
which is the same act as not adding it.
