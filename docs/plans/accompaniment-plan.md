# Accompaniment, the inviter's seat at the interview, and the community's public face

**Status:** steps 1 to 5 of §8 are built (2026-10-13 and 2026-10-14). Step 5: the inviter at the interview, as company. Step 4: the three switches and consent to a person, the accompanier's view, and the accompanier as an audience for a profile question. Step 3: check-ins as milestones, the settings list, the done state and the accompanier's "time to check in". Step 2: the suggestion table with a reason per person, the dashboard prompt, and the coordination and task views. Step 1: the relation as a row, made at admission, the settings, the new member's card, the welcome text and the two emails, "ask for someone else", and the ending. Steps 6 to 8 are proposed, not built. Written 2026-10-11 after comparing the original recruitment section
(the v0.5 platform spec) with what the admission funnel built. That spec is an early draft written for
one community, so this plan keeps what it was *for* and drops what only made sense for that camp.

Marked **(decided)** where the product owner said it in conversation (the public-pages answers are of
2026-10-13); **(proposed)** is my reading and
needs a yes or a correction. Section 9 collects the questions.

---

## 1. What the original wanted, and what is there now

The v0.5 spec: every new member has a named experienced member who accompanies them from the start —
on the intro call, then through the pre-event period and the event. It is a **task** ("Accompany
[name]") with check-ins, it gives the accompanier visibility into the new member's engagement "with the
new member's awareness", and it closes after the event. The recruiter who said yes accompanies by
default. Applicants also get an information packet before the call.

What is built:

- `maybeCreateAccompanimentTask` (`decisions.ts`) makes one task, "Accompany new member", after an
  acceptance. The description points at an application id, not a person.
- It carries **one** suggested member: the referrer or inviter. Nobody who interviewed the person is
  suggested, and a person admitted with no decision (the support shortcut aside) gets nothing.
- The accompanier's page shows only an open non-response count, and only if a member was converted;
  the lookup (`getAccompaniedMemberId`) goes through the decision row and returns nothing otherwise.
- **The new member is not told.** The acceptance email, the welcome page and the dashboard never
  mention an accompanier. There is no way to consent to, or limit, what the accompanier sees.
- No check-in dates, no end. The task is `owns_a_thing` at one hour a week for ever.
- There is no information packet, and no way for a non-member to read anything the community wrote.
  The only public routes are the funnel's own (`/apply`, `/inquiry`, `/invite`, `/support`, `/pair`,
  `/admission`). The Library (`/documentation`) is members-only.

## 2. Principles

1. **The new member always knows.** Who is accompanying them, what that means, and what the
   accompanier can see. (decided)
2. **What goes beyond the ordinary is theirs to give.** The baseline an accompanier sees is what the
   role exists for, and the member is told about it. Anything more (their working-style scales, their
   contribution overview, profile answers not otherwise visible) is opt-in. (decided)
3. **Nobody is assigned.** People who met or vouched for the person are *suggested*, with the reason
   shown; any member may claim it; coordination asks someone if nobody does. (decided)
4. **No rank, no ordering of suggestions.** The list shows who and why; it does not say who is best.
   (proposed, following the original spec's "no rank between co-holders")
5. **Ignoring a suggestion costs nothing.** A suggestion is never logged as a non-response against
   anyone's engagement record (nominations are; this is deliberately not one). (proposed)
6. **A community can switch the whole thing off, and sets only what it must.** One on/off, one short
   list of check-ins with sensible defaults, one "ends after" number. Nothing else. (decided in spirit:
   "not sure how that can happen without requiring serious settings")
7. **Derived, not stored second opinions.** Who is due a check-in, who has a suggestion waiting, and
   whether an accompaniment is open are read off the rows, as everywhere else in the funnel. (proposed)

---

## 3. Accompaniment as a thing in its own right

### 3.1 A relation, not a decision's side effect (proposed)

A new `accompaniment` table:

| Column | Notes |
|---|---|
| `id`, `community_id` | |
| `member_id` | the new member. Unique while open. |
| `task_id` | the "Accompany" task |
| `arrival_id` | nullable; where it came from |
| `started_at`, `ends_on`, `ended_at` | `ends_on` is computed at creation (§3.5) |
| `shares_axes`, `shares_contribution` | the member's choices (§4); default false |
| `shared_with_member_id`, `shared_at` | whose accompaniment the choices were made for (§4.3) |

`recruitment_decision.accompaniment_task_id` stays as the idempotency marker it is today, and the
migration back-fills a row for every existing accompaniment task whose decision converted a member.
`getAccompaniedMemberId` becomes a read of this table (so it no longer returns nothing when a member
was admitted by another route).

### 3.2 Created where a member is made, not where a decision is made (proposed)

Today only the decision paths create one. It moves to the tail of `admitArrival`, the one place a
Member is made, so every route through the funnel behaves the same way, gated by the community's
setting. The roster-import door does **not** create one: those people are already known, which is why
that door skips the funnel.

The task is titled **"Accompany <name>"** once the person is a member (task titles are visible to all
members, and they now are one). A person accepted but waiting for a place at a full event is not yet a
member; the task is made with the generic title and renamed when they are admitted, as the description
is today. It carries no application id; it links to the person's profile.

### 3.3 The setting (proposed)

In Recruitment settings, one section, **Accompaniment**, shown only when some lane admits people:

- *Accompany new members* — on (default, which is what happens today) or off.
- *Who may accompany* — any member (default), or members of a chosen tier (the task is made with the
  existing tier requirement; no new eligibility machinery).
- *Check-ins* — the short list in §5.
- *Accompaniment ends* — N days after joining (default 90), or when the accompanier marks it done,
  whichever is first.

### 3.4 Suggestions, with reasons (proposed)

Today `task.suggested_member_id` holds one person. Several people can have a reason, and the reason is
the useful part. A new table replaces the column:

`task_suggestion (task_id, member_id, reason, created_at, dismissed_at)`, unique on (task, member, reason) — one row per reason, so
the inviter who also said yes is one person shown with both — where `reason` is one of:

| Reason | Shown as | From |
|---|---|---|
| `said_yes` | "Said yes after the interview" | each report with recommendation *yes* on the arrival |
| `invited` | "Invited them" | `inviterOf(arrival)` (also covers the old referrer) |
| `supported` | "Vouched for them" | each `admission_support` row |
| `proposed` | "Suggested when the task was proposed" | the existing proposal field |
| `shadowed` | "Shadowed this last time" | the existing cycle-clone carry-forward (it was always a *shadow* that was carried, not the holder; built as such, and every shadow is carried now, not only the earliest) |
| `suggested` | "Suggested" | a coordinator naming someone, and the carried-over value of an old suggestion with no known reason |

Everything that writes or reads `suggested_member_id` moves over: task proposals and activation, cycle
cloning, `tasks/crud.ts`'s narrow mutation, the task page, `coordination-dashboard.ts` and the
dashboard's suggestion list. That is about eight files, which is the real cost of this section; the
alternative (keep the column for the *first* suggestion and a table for the rest) would make two places
hold one answer, which is the mistake the funnel was redesigned to stop making, so I am not proposing it.

### 3.5 Claiming, and who steps in (proposed)

- **Any member can claim it** (subject to §3.3's tier, if set), exactly like any task. A member who
  was suggested sees it on their dashboard as *"[Name] is joining. You were suggested because you
  invited them — would you like to accompany them?"* with **I'll accompany** (claims it) and **Not me**
  (dismisses it for them only; nothing is logged, nothing is sent). A pull, in the codebase's usual
  posture, not an email.
- **Nobody has by the time the existing staleness rule fires:** the task is already an unclaimed task
  with an attention level, so it already reaches whoever holds coordination. What it needs from this
  plan is only that the coordination view lists *all* its suggestions with their reasons, and that
  "ask someone" (`nominateForTask`, the existing fitted ask) offers them first. No new escalation
  machinery. *Unchecked: whether the default staleness days are short enough for a new member who is
  waiting to hear from someone. If not, this task kind gets its own shorter threshold.*
- **If nobody holds coordination** (an open module with no granting task) it is reported on the hub,
  as the funnel already does for this case, not guessed.

### 3.6 Ending (proposed)

At `ends_on`, or when the accompanier marks the task done, the accompaniment ends: `ended_at` is set,
the shares in §4 stop, the member is thanked on their dashboard card, and the task is closed. A member
may also **ask for someone else** from their card: the task goes back to unclaimed with a note, the
accompaniment stays open, and the suggestions are shown again. Nothing is logged against anyone.

---

## 4. The new member's side: awareness, and what they choose to share

### 4.1 Awareness (decided)

- The **acceptance email** says that someone will accompany them and what that means, in two lines.
- The **first-login screen** (`/welcome`) gets the same, with the share choices of §4.2 below it.
- A **dashboard card, "Your accompanier"**, for as long as the accompaniment is open: the name and a
  link to their profile once someone holds the task; *"Someone will be named soon"* until then. When
  someone claims it, the card changes and the member gets one email saying who. The card carries
  *Ask for someone else* and *What they can see* (§4.2).
- The accompanier's task page shows, plainly, what the member has chosen to share and what they have
  not, so neither side guesses.

### 4.2 What the accompanier always sees, and what is opt-in (decided, shape proposed)

**Always** (with the member told in §4.1): their name, when they joined, which tasks they hold (already
public on the board), and the engagement summary that exists today (open non-responses). This is the
baseline the original spec described and it is what "a human notices patterns" needs.

**Opt-in**, each a switch the member sets, off until they say:

1. *My working style* — their values on the community's trait axes. Today these are read only on the
   member's own profile and in task suggestions; this is a new read, for the accompanier only.
2. *My contribution overview* — the personal contribution view they would see themselves.
3. *Profile answers I've marked as shareable with my accompanier* — see §4.4.

### 4.3 Consent is to a person (proposed)

The switches belong to the accompaniment and record *whose*. If the accompanier changes (released,
reclaimed, "ask for someone else"), the choices reset to off and the member is asked again, because
agreeing to share something with one person is not agreeing to share it with the next. They are shown
the new name when asked.

### 4.4 Profile answers: a fourth audience route (proposed)

Sensitive profile questions already say who may read them through access rules (a task, a tier, or a
permission module), and a member's agreement is recorded per answer per rule
(`profile_answer_rule_consent`). The accompanier is a **relation** ("holds the accompaniment task for
this member"), not a holder of a particular task, so it needs a fourth kind of rule:
`unlocked_by_accompaniment`, resolved at read time by "the reader holds the open accompaniment of the
person whose answer this is". A community can then say, per question, "my accompanier may see this", and
the existing consent prompt (the widening prompt, the per-answer share switch) does the asking with no
new consent table.

*I have not read the resolver (`sensitive-data.ts` and the profile-question access code) closely enough
to say this is cheap. Step 4 begins with that read; if a relational rule does not fit, the first two
switches ship alone and this waits.*

---

## 5. Check-ins as milestones

**(decided)** that check-ins are milestones on the task. **(proposed)** how they get there without
serious settings.

The community has one short list, *Check-ins*, each row a label and a number with one of two anchors:

- **N days after joining**
- **N days before the event starts** (skipped when the cycle has no `start_date`, as relative
  milestones already are)

Defaults, which a community can edit or empty: **"Say hello" — 3 days after joining**, **"How is it
going?" — 30 days after joining**, **"Before the event" — 14 days before it starts.** There is no
on-site row by default because most communities don't have one; the one that does adds it.

When the task is created, each row becomes an ordinary `task_milestone` with the absolute date
computed then. That keeps them on the task page, the calendar view and everything else that already
reads milestones. Two small changes:

- `task_milestone` gets `completed_at` / `completed_by`. A milestone has no "done" today, and a
  check-in needs one. It is useful for any milestone, and the task-pack export treats it as the
  absolute-only state it is (a pack carries relative milestones and never completion).
- A flag on the milestone saying it is a **check-in**, so the dashboard can show "due" for these and
  not for a deposit date.

**Reminders are derived, not sent:** the accompanier's dashboard lists a check-in whose date has come
and that is not done — *"Check in with Sam: Say hello (due Tuesday)"* — the same pull the funnel uses
for reports owed. If the accompanier only claims on day 10, the "Say hello" is simply due now; it is
not silently re-dated. An email nudge can follow once the pull proves too quiet; I'd rather not decide
that before seeing it used.

---

## 6. The inviter at the interview (decided in outline; mechanics proposed)

**(decided)** that the person who sent the invite can be offered a place at the interview, to make it a
nicer time for the applicant.

- **The applicant is offered it**, on their own page at the interview step, when they came through an
  invite: *"Would you like [first name] to be at your interview?"* One tap. It is their choice, not
  the inviter's and not the team's. A community setting, *Offer the inviter a place*, on by default,
  switches the offer off.
- **The inviter is asked**, as a dashboard item with the person's name and the time window, and may
  accept or decline. Declining is silent.
- **They are a companion, not an interviewer.** They do not count toward the holders a slot needs,
  they file no report, they are not on the decision, and they are not an evaluator. A holder who also
  invited the person is simply an interviewer as before.
- **Their availability is preferred, not required.** The aggregate marks slots where the companion is
  free and the booking screen shows who can't make a slot, but a slot is never disqualified because
  the companion can't come, and an inviter who never answers never holds up an interview. A required
  participant is one more person who can silently block someone's admission, and this is a courtesy.
- On a confirmed interview the companion is named in the person's page, the confirmed email and the
  `.ics`, like any attendee.

Data: `interview_companion (arrival_id, member_id, status: requested | accepted | declined)`. The
poll's aggregate reads accepted rows next to the holders. For a **shared interview** between two
paired people, each person's inviter is asked separately.

---

## 7. The community's public face

### 7.1 Where this stands

The v0.5 spec's "Public site" ("who we are, contact, get involved") was only ever realised as the
application and inquiry forms. Nothing a community writes in Orchard can be read by a non-member, and
the Library is three members-only sections: the tool's own documentation, community pages (the
open-edit wiki), and an index over task wikis.

The root page `/` is a hardcoded landing screen: the community's name and logo, sign-in and apply
buttons, and below them a database diagnostic. That diagnostic **writes a `health_check` row on every
visit** and is shown to anyone. Orchard serves **one community per deployment**
(`getOrCreateCommunity()`), so there is no question of which community a public address belongs to.

### 7.2 What was decided (2026-10-13)

1. **The community presents itself with a public page, and that page is `/`.** One published page is
   designated the front page. With none designated, today's landing shows (without the diagnostic).
2. **Not signed in:** a **sign-in button at the top** of every public page. **Signed in:** `/` goes
   straight to the dashboard, as it does today, and never shows the page.
3. **The doors are read live, not written.** When a public lane is open for an event, the page shows
   **the event and its dates**, with that lane's apply button. A door that closes disappears from the
   page by itself, so nobody has to remember to edit it.
4. **Text only, for now.** No images beyond the community's existing logo.

### 7.3 Stage one: a link in the message (proposed; ships with the interview work)

A community setting, *Before your interview, read this*: a URL and an optional one-line note. It is
shown in the interview invite email and on the person's own page at the interview step. It also covers
the v0.5 "info packet" for any community that already has a document somewhere. It does not wait for
the public pages, and becomes a picker (a public page, or a pasted URL) once they exist.

### 7.4 Stage two: pages the Library can publish (proposed)

A community page can be made public.

- **Members keep editing the live page, as now.** What the public sees is a **published revision**
  (`wiki_page.published_revision_id`, null for members-only), not the latest edit. Someone with the
  right can **publish the latest**; the page shows *"The public version is 3 edits behind"* with the
  changes. This keeps the Library open to every member while making sure no member's edit reaches the
  internet without someone deciding it should.
- **Who may publish:** a new permission module, `public_pages`, granted like the others (to a "Website"
  or "Comms" task), with admins always able. I recommend a new module over reusing `announcements`
  because an *open* module makes every member a holder, and "anyone can publish to the whole internet"
  is not a default I would ship. See §9, question 3.
- **Address:** `/p/<slug>`, the slug unique and editable, derived from the title.
- **What a public page shows:** the title, the published text, the community's name and logo, the
  sign-in button and the navigation (§7.5). No author, no edit history, no member names. Cross-links to
  other pages, tasks and branches render as plain text unless they point at another **public** page.
- **Not indexed unless asked:** `robots: noindex` by default, as the admission page already is, with a
  per-page *let search engines find this* switch. The front page is the exception in spirit: the
  community will usually want it found, so its switch is offered at the moment it is designated.
- **A warning at publish:** "Anyone on the internet can read this. Don't include anything about a
  member." The Library marks public pages with a tag in its list.
- **Formatting:** whatever the Library's page content already supports. I have not read how it renders,
  and a presenting page needs at least paragraphs, headings and links; if the renderer cannot give
  those, that is the first thing step 7 adds.

### 7.5 Stage three: the front page (proposed, on the decisions above)

- **Designation:** a Settings choice, *Front page*: one of the public pages, or none. Admins and
  `public_pages` holders can set it.
- **Fixed furniture around the page's own words**, not editable by page authors: the community's name
  and logo; the sign-in button at the top when nobody is signed in; the contact box (`/inquiry`, which
  already exists); the live doors below.
- **The live doors:** for each public lane that is open, an apply button at its own address
  (`/apply/<slug>`); for each **event** that has a public lane open for it and whose applications are
  open, the event's name, its dates (`start_date` to `end_date`, when set), and its time zone when it
  has one, with that lane's apply button. An event whose dates are not set shows without them. Nothing
  is listed about an event whose door is shut.
- **Navigation:** a short ordered list of public pages, chosen in Settings, shown at the top of every
  public page after the sign-in button. Not automatic: a page is in it because someone put it there.
- **The diagnostic goes.** The `health_check` write and its readout move to an admin-only status route
  before `/` becomes a page people share. A public page that writes to the database on every view is a
  fault whether or not anybody visits.
- **Nothing private on it, ever:** no member, task, branch or board data. The only live data are the
  open doors and the events they belong to.

---

## 8. Build order

Each step is one commit, runs the whole suite, and is checked by hand in a scratch database, as the
funnel steps were. Each starts when asked for.

1. **Accompaniment as a relation, made at admission, and the new member told.** The table and
   back-fill; creation moved into `admitArrival`; the on/off, tier and "ends after" settings; the task
   named for the person; the acceptance-email line, `/welcome` text and the "Your accompanier" card with
   *Ask for someone else*; ending. `getAccompaniedMemberId` reads the table. *Depends on nothing.*
2. **Suggestions with reasons.** `task_suggestion`, the move of every `suggested_member_id` reader,
   filling it from reports, the inviter and supporters, the "you were suggested" dashboard item, and the
   coordination view showing every reason. *Depends on 1.*
3. **Check-ins.** The settings list, milestone `completed_at` and the check-in flag, creation of the
   milestones, the derived "due" items on the accompanier's dashboard. *Depends on 1.*
4. **What the member shares.** The two switches, the reset on a change of accompanier, the accompanier's
   view of what is shared; then the profile-answer route if the resolver allows it. *Depends on 1.*
5. **The inviter at the interview.** `interview_companion`, the applicant's offer, the inviter's
   dashboard item, the preferred-availability read in the aggregate, the setting. *Independent.*
6. **The information link.** The setting, the invite email, the person's page. *Independent.*
7. **Public pages.** `published_revision_id`, the `public_pages` module, `/p/<slug>`, the Library's
   publish and behind-by views, the public page chrome (sign-in button, navigation list), the picker in
   step 6's setting, the formatting the renderer lacks. *After 6.*
8. **The front page.** The designation setting, `/` rendering the designated page, the live doors and
   events, the contact box, the diagnostic moved to an admin status route, today's landing as the
   fallback. *After 7.*

Steps 5 and 6 can go before 2 to 4 if the interview is the pressing part.

### Tests to write

The front page shows an event only while a public lane is open for it and its applications are open,
and a closed door vanishes; a signed-in member never sees it; no private data reaches `/` or `/p/…`;
the suggestions come from the right people and never twice; a suggested member dismissing logs no
non-response; the accompanier reads shares only while the accompaniment is open and the choices reset on
a change of accompanier; the baseline needs no consent and the opt-ins fail closed; a check-in is due
from its date until done; an accompaniment with the setting off creates nothing; the inviter's absence
never disqualifies a slot; a public page serves only its published revision, strips internal links and
author data, and 404s when unpublished; the migrations back-fill and drop what they say on a populated
database.

---

## 9. Decisions and what's left

1. **Reset the shares when the accompanier changes** (§4.3)? I'd say yes.
2. **Inviter as companion: preferred availability, not required** (§6), and the offer on by default?
3. **Who may publish a public page:** a new `public_pages` module (my recommendation), or the existing
   `announcements` module?
4. **Create the accompaniment in `admitArrival`, for every funnel route** (§3.2), with the roster door
   excluded? Or keep it to decisions only, as now?
5. **Replace `task.suggested_member_id` with a table** (§3.4) at the cost of about eight files, rather
   than keep two places for one answer?
6. **Default end of 90 days after joining, and the three default check-ins** (§3.3, §5): are these the
   right starting points for a community that is not yours?
7. **Can an inviter also file a report** if they hold the recruitment task? I assumed yes, as an
   interviewer; the community check already stops them raising a concern about their own invitee.

8. **An event shows on the front page whenever its public door is open**, with no per-event switch
   (§7.5)? The door being open is what puts it there, but an event's name and dates become public with
   it, and a community might want to open a door without announcing the event.

**Not verified, and each is a step's first job:** the sensitive-answer resolver (§4.4); how the
Library renders a page's text (§7.4); the staleness thresholds for an unclaimed task (§3.5); that the
milestone UI copes with a completion state; that every route into `admitArrival` has the actor and
branch an accompaniment task needs (today the decision paths are the ones that have a recruitment task
to borrow a branch from).

**Not in this plan:** an email nudge for check-ins, images in public pages, a public listing or search
of pages, the on-site check-in as a default, and any measure of whether accompaniment is "working".
