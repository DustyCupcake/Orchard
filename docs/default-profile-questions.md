# Default profile questions

A proposed starter set for a new Community. Nothing here is built — this is a review
document. Edit the tables, strike entries you don't want, and the agreed set becomes the
seeding path for community set-up.

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

*(once-ever only; consented at the section, never per question)*

Once-ever. Read by the whole community; never permission-gated. A member's section consent
box covers every answer they give here, and each question also carries its own decline.

| # | Question | Shape | Options | Declinable | Why |
|---|---|---|---|---|---|
| 1 | **Your pronouns** **[exists as the motivating case]** | multi_choice + other | she/her, he/him, they/them, he/they, she/they | yes | The case the whole feature exists for. Countable, declinable, and the reason the escape hatch exists. |
| 2 | **Languages you speak** | multi_choice + other | (community-editable) | yes | Genuinely both — who someone *is* and what an interpreter needs. Filed as demographics because the fact is about the person, not the event. |
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

*(readable by whoever holds a linked task; readable by **everyone** if there is no link and it isn't sensitive)*

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
| 15 | **Allergies** **[exists — a `member` column today]** | text (long) | — | yes | Kitchen coordinators genuinely need it; nobody else does. |
| 16 | **Health conditions** **[exists — a `member` column today]** | text (long) | — | yes | Same audience, higher consequence. |
| 17 | **Emergency contact** **[exists — a `member` column today]** | text (long) | — | no | Can't be usefully refused during an event, and the emergency path reads it. Requiring a decline here would be theatre. |
| 18 | **Home city or town** | text | — | yes | Drives travel and cost planning. |
| 19 | **Date of birth** | date | — | no | Needed for some insurance and safeguarding contexts. Precise, so high sensitivity — but a "prefer not to say" that leaves a gap in eligibility is worse than the fact being held. |
| 20 | **Full legal name** | text | — | no | Distinct from display name; needed where a legal record matters. |

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

Not a category taxonomy. A profile question has a few independent attributes, and the failure
of the three-category version is that "gated" turned out to be *access*, not a kind of data —
t-shirt size isn't sensitive and still shouldn't be readable by everyone. Merging collapses it
to:

| attribute | values | notes |
|---|---|---|
| **publishable** | on / off | An admin toggle on one question. Requires once-ever scope. |
| **sensitive** | yes / no | Drives the obligations below. |
| **scope** | once-ever / per-event / per-phase | Free — and free for sensitive questions too, since "medication on site" is both. |
| **access** | a set of rules | Orthogonal. Who may read. |
| **emergency** | yes / no | Answering it consents to emergency reads. No separate member tick. Meaningless on a question everyone can already read. |

**Consent is granted once, at the section — never per question.** A member ticks "answers in
this section may appear in community indicators", and that covers every answer they give
there, including to questions added later. Because a question can only *enter* the section at
creation, the consent always predates the answer, so there's never a reason to ask again.
Widening an audience is the one event that re-opens the question, and only for sensitive
questions.

**The sensitive flag is made cheap-to-abuse deliberately not.** A non-sensitive question
defaults to readable by the whole community, and restricting it at all requires marking it
sensitive and configuring rules. So under-labelling a health question doesn't save work — it
publishes the data to everyone, visibly. The shortcut and the danger can't both point the same
way, which means nobody has to be trusted to tick the right box.

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

**Emergency access only means anything on a question that isn't already public** — so the
condition is "has any audience other than everyone", not "is sensitive". A non-sensitive
task-linked question (t-shirt size, can-you-drive) is restricted too, and genuinely needs it:
a last-minute gate coordinator really does want a shirt size in an emergency.

**The emergency box appears only when there is a restricted audience to opt into.** With
everyone already able to read it, there is no ordinary access to withhold.

**Consent is to a rule, not to a list of people.** "Whoever holds the task" is consented to as
a *relationship*, so a new claimer is inside what was agreed and needs no new conversation.
Only edits to the rule re-open it: adding a task link, changing an access rule, turning on
emergency access. A task being claimed by someone new is not a consent event, and treating it
as one would either spam members or produce a notification people learn to ignore.

**The promise has to match the mechanism.** "You'll be notified if ever someone accesses it"
cannot mean a notification per read — a kitchen coordinator checking allergies fifty times
over a weekend would be fifty notifications, and the second one trains people to ignore the
first. Log every read, notify on the *first* one, and let the member see their own access
history. The section copy has to say which of those it is.
