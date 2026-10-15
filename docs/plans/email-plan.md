# Emails: one way to write them, in the community's voice, in a style it sets

**Status:** proposed, not built. Written 2026-10-15, after asking how the content of an email is dealt
with while building step 6 of [`accompaniment-plan.md`](accompaniment-plan.md) (the interview's
information link). The answer was "it isn't, really", and a broader look was worth more than a
specific fix. The one defect found that was ours alone, the accompanier email ignoring a member's
"email me" setting, was fixed straight away and is not part of this plan.

Marked **(decided)** where the product owner said it in conversation; **(proposed)** is my reading and
needs a yes or a correction. Section 9 collects the questions.

> A community should be able to speak to its own people in its own words, and look like itself when it
> does. Whatever a message *must* carry, the platform makes sure it carries.

(The first half is the product owner's: letting the community write the whole email, with placeholders
for values and buttons, "seems more consistent for this tool", and a community should be able to "define
a format for HTML mails for consistent style". The second half is the constraint that makes the first
half safe, and is mine.)

---

## 1. What there is now

Twelve emails, all in `src/lib/mailer.ts`, each an array of strings written by hand. The only thing
they share is the send function: the Brevo API if a key is set, else SMTP, else a line in the console.

| Email | To | Kind of thing it is | Carries |
|---|---|---|---|
| Login link | anyone | transaction | a login credential, 15 minutes, once |
| Confirm this address | a member | transaction | a credential, a day, once |
| Task nomination | a member | asks for a reply | three single-use action links |
| Targeted message / announcement | members | a notification (respects the setting) | whatever the sender wrote |
| Backstop hard flag | a member | a notification (respects the setting) | a task link |
| Asked to vouch for someone | a member | a request | a support link |
| We have your application | a person not yet a member | transaction | their private page link, which lasts |
| You're in | the same, now a member | transaction | login route, page link |
| Someone will accompany you | a member | a notification (**did not** respect the setting; fixed) | a dashboard link |
| Choose times for your conversation | a person not yet a member | transaction | their private page link |
| Your conversation is booked | the same | transaction | the time, the page link |
| We'd like to know a little more | the same | transaction | the page link |

What that adds up to:

- **Plain text only.** Links are bare URLs. The spec promised one-click buttons; what exists is
  `Accept: <url>` on its own line.
- **A failed send is a `console.error`.** Every caller catches it and carries on; announcements use
  `Promise.allSettled`, which discards the failures. Nothing records that an email was meant to go, and
  nothing retries. For someone who isn't a member yet, the email is the only way their private link
  reaches them.
- **One sender for everyone.** `SMTP_FROM` defaults to `Orchard <no-reply@example.com>`: the product,
  not the community, and an address nobody can reply to. No email says who to contact.
- **Nothing is the community's to change** except the free text of an announcement and the rejection
  template. Every other word is a code change.
- **No test looks at wording.** The tests that touch the mailer mock it to see that a send happened.

Inconsistencies, found by reading all twelve:

- *Greeting and sign-off.* The admission emails open "Hello {name},"; the nomination, backstop,
  verification and login emails don't greet at all; none signs off. For an invitee with no application
  the name is derived from their address, so the greeting reads "Hello dana,".
- *Product or community.* The login link says "Orchard" and never names the community; the admission
  emails name the community and are sent by "Orchard".
- *Vocabulary.* The emails call it a "conversation"; the settings and the hub call it an "interview".
  The product owner's own camp called it an "intro call". "Accompany", "vouch" and "support" are one
  community's words, built in.
- *The setting says two things.* The "email me" setting reads "Email me about things that need my
  attention — a task I'm holding, someone waiting on…" on the welcome screen and "Email me targeted
  messages and announcements" on the profile. It is honoured for announcements and the backstop alert;
  not for the nomination or the vouching request.

## 2. Principles

1. **The community writes to its own people.** Its words, its sender name, its signature, and a look it
   chose. (decided)
2. **The platform guarantees what a message must carry.** A message that is the only way somebody
   reaches their private page must contain the link, whatever a community writes. (proposed)
3. **A default always exists, and the code owns it.** A community changes an email by overriding the
   default, never by writing it from nothing, so a new email kind works on the day it ships. (proposed)
4. **Defaults are data, not strings in code.** The same structure holds our wording and a community's,
   so letting a community rewrite an email is an editor on top of what exists, not a second system.
   (proposed)
5. **Content and look are separate.** What an email says is blocks; how it looks is a theme the
   community sets once. (decided)
6. **A delivery record is a queue, not a mailbox.** It remembers that something was meant to be sent and
   how it went, never what it said, because what some of them say are credentials. (proposed)
7. **No tracking.** No open or click tracking, no pixel. (proposed)

## 3. The model

### 3.1 A registry of kinds

Each kind of email is declared once:

- **an id** (`admission_received`, `interview_invited`, …) and a **class**: *transactional*, sent whatever
  the recipient's setting (the login link, the admission emails, anything that is the only way to carry
  on), or a *notification*, which respects the member's "email me" setting;
- **its variables**: name, type, and a sample value for the preview (`{{person_name}}`,
  `{{community_name}}`, `{{page_link}}`, `{{interview_time}}`);
- **what a rewrite must keep**: the placeholders that cannot be removed (the acceptance email must
  contain `{{page_link}}`), and any **named optional sections** the kind can switch on (the accompaniment
  paragraph in "you're in", the companions line in "your conversation is booked"), which can be reworded
  but not removed or renamed;
- **whether a community may rewrite it** at all (§3.4);
- **how to rebuild it from ids** (§7), so a retry doesn't need a stored body.

### 3.2 The content format

Blocks, in order: a **paragraph** (with inline *bold* and *links*), a **button** (a label and a target,
which is always a variable such as `{{page_link}}`), a **note** (quieter text: "if you didn't ask for this,
ignore it"), and an **optional section** (a named run of blocks the kind switches on). Placeholders are
`{{name}}`. Nothing else: no raw HTML from a community, no scripts, no layout of its own.

A button is one block that renders two ways: a styled link in the HTML, and `Label: url` in the text.
That is the whole of "placeholders and buttons".

Every value is escaped where it is placed. Names, task titles and a nominator's message are other
people's words, and none of them can add markup, a line break into a subject, or a link of its own.

### 3.3 Where the words come from

In order: the community's override for this kind (if it has one and it is valid), else the default. The
default is data in the repository, in the same block format. Changing a default later reaches every
community that hasn't overridden it, and an override can always be reset to the current default.

### 3.4 What a community cannot rewrite (proposed)

The **login link** and the **address confirmation**. What those say is what protects a person from a
phishing email dressed up as one, and a community has no business changing it. They still wear the theme
and carry the sender and footer. Everything else may be rewritten, subject to §3.1's required placeholders.

## 4. The community's voice

Set once, used by every email (proposed unless stated):

- **Vocabulary.** The community's own terms for the handful of things we name: the interview (*interview*,
  *intro call*, *conversation*), the accompanier (*accompanier*, *buddy*, *mentor*), a supporter (*vouch*,
  *support*), and so on, each with a default and a plural where it needs one. Written in a default as
  `{{term.interview}}`, so changing the word changes every email that says it.
  **Scope is a question (§9, Q2):** the same words appear on the screens, and a vocabulary that only the
  emails use will drift from them. I would start with emails and let the screens adopt it later.
- **Sender name** (the community, not "Orchard"), a **signature** ("Warmly, the people looking after
  joining"), and a **contact line** ("Questions? Write to joining@…"). An optional **reply-to address**.
  With none set, the sender stays a no-reply and the footer names a role to find, not an address.
- **A footer**, the same on every email: who this is from, why the recipient got it, and for a
  notification, how to change the setting in one click.

## 5. The look (decided in outline)

A **theme** the community sets once, and one HTML shell that is ours, tested, and rendered from it.
The fields (proposed): the logo and the two accent colours the community already has, a font from a short
list of safe stacks, a button shape, header text, and the footer's wording. **Not** raw HTML or CSS: mail
clients are unforgiving about layout, web fonts and dark mode, and a stray tag from a community is
indistinguishable from phishing.

Constraints the shell is built around: one column, about 600 pixels, inline styles, tables for layout;
the logo has alt text and the email reads without it, because most clients block images until asked;
colours chosen to survive a client that inverts them. **Every email is sent with a plain-text part** made
from the same blocks, for clients that want one and for deliverability.

A **preview page** (admins) renders every kind with its sample values, in the theme, in both forms, and can
send a test to the admin's own address.

## 6. Which emails respect the member's setting

The class in §3.1 decides it, and the setting's wording is made true in one place. Proposed: *transactional*
for login, address confirmation, and everything sent to a person not yet a member; *notification* for
announcements, the backstop alert, "someone will accompany you", and **the vouching request**; and the
**task nomination** kept as sent regardless, because it opens a reply window (a deadline runs, and "no
reply" releases the task), so someone who has switched email off would be penalised for not seeing it.
The setting then reads the same on both screens. (Q1.)

## 7. A delivery record, not an outbox

Three jobs that get lumped together, kept apart:

1. **Reliability.** A row says *this kind of email is owed to this person about this thing*, and a job
   sends it and retries a few times with a pause. It does **not** store the message. It stores the kind,
   the recipient, the ids the kind needs (the arrival, the member, the nomination) and a small set of
   non-secret parameters, and the message is **rebuilt from those at send time**. That is why every kind
   declares how to rebuild itself. Credential emails (the login link, address confirmation) are never
   queued or retried: their tokens expire, and asking again is the person's own act.
2. **Failure surfacing.** When an email has failed for good, whoever the email was *for the benefit of*
   hears of it, and only the fact: that it didn't arrive, not what it said. A failure of an applicant's
   email goes to the people looking after joining (on the pipeline row and the needs-action list: "the
   confirmation didn't reach them"); a member's own failure to that member on their own page; anything
   else to administrators. Access follows the task, as everywhere else. (Q4.)
3. **A content log.** Not built. A browsable log of what was sent would hold private-page links, which
   are credentials that last, readable by whoever can open the log. Outbound announcements already have
   their log, visible to their senders, and that stays as it is.

Rows are deleted after a retention period (proposed 30 days; Q5). Who may see the rows themselves: nobody,
in the interface. They are operational. Anything a person may read about them is the failure notice above.

## 8. Build order

Each step is one commit, runs the whole suite, and starts when asked for.

**E1. The registry, the blocks and the text renderer.** Move all twelve over *without changing their
wording*, proved by tests that render each with its sample values and compare to what is sent today. Then,
as a separate commit, make them consistent on purpose: one greeting and sign-off, the community's name
where the product's is now, the sender name. The preference class (§6) and the setting's one wording.
The interview invitation gets its optional *before your interview* section, fed by the community's
information link and note: **this is the whole of step 6 in the accompaniment plan, which is folded in
here and not built separately.** *Depends on nothing.*

**E2. The theme and the HTML renderer.** The shell, the theme fields in settings, the multipart send, the
preview page with a test send. *After E1.*

**E3. The community's voice.** Vocabulary, signature, contact line, reply-to, footer. *After E1; best with E2.*

**E4. The delivery record.** The queue, the retry job, the failure notices, retention. Each kind's rebuild.
*After E1.*

**E5. Rewriting an email.** The editor for one kind: blocks, placeholders from the kind's list, required
placeholders enforced on save, optional sections, reset to default, a test send, and a notice when the
default has since changed. *After E1; needs E2's preview to be worth building.*

**E6, later and only if wanted: languages.** A body per kind per language, chosen from a community's default
and a member's own. The block format is what makes this an addition, not a rewrite. Not planned here.

### Tests to write

Each kind renders to the same text as today before it is made consistent; a placeholder's value can't add
markup, a line break to a subject or a link; a rewrite missing a required placeholder is refused; the
text part and the HTML part carry the same links; a notification kind is not sent to someone who has asked
not to be emailed and a transactional one is; the delivery record never contains a body or a token; a
failed funnel email is visible to the people looking after joining and to nobody else; a retried email is
rebuilt from current state (an arrival that has since been admitted gets the admitted wording, or none);
credential emails are never queued.

## 9. Decisions and what's left

1. **Which emails are notifications and which transactions** (§6)? In particular the vouching request
   (I say notification) and the task nomination (I say keep sending it).
2. **Does the community vocabulary reach the screens too** (§4)? Emails first is cheapest, and the risk is
   the two drifting apart.
3. **What does a community-written body allow** (§3.2)? I propose paragraphs, bold, links, buttons, notes
   and the kind's optional sections, and nothing else.
4. **Who hears of a failed send** (§7): the people looking after joining for an applicant's; the member for
   their own; administrators for the rest. Is that the right split, and is a needs-action line the right way
   to tell them?
5. **Retention for the delivery record** (§7): thirty days?
6. **Reply-to** (§4): offered as an optional community address, with the footer naming a role when there is
   none. Is a no-reply sender with a named role acceptable to a community that has no shared inbox?
7. **Which fields the theme has** (§5), and whether a community may ever supply its own HTML shell. I say no:
   the shell is ours, and the theme is fields.

**Not verified, and each is a step's first job:** how any of this renders in real mail clients (E2 is
checked in several, not only a browser); that Brevo's API takes an HTML part with a text part as well as
the text-only body used now; that a remote logo survives a client that blocks images (E2); how
`SMTP_FROM`'s domain is authenticated, which is an operations matter and decides deliverability more than
anything here.

**Not in this plan:** other channels (the spec leaves Telegram a deliberate yes/no), the sign-in
provider's own emails (Zitadel sends those), attachments, open or click tracking, and a per-member
choice of language.
