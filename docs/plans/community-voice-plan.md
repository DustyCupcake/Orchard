# How the community speaks: one way to write, one look, one set of words

For emails and for public pages.

**Status:** proposed, not built. Started 2026-10-15 as an email plan, after asking how the content of an
email is dealt with while building step 6 of [`accompaniment-plan.md`](accompaniment-plan.md), and widened
on 2026-10-25 when it became clear that the public pages the accompaniment plan proposed need the same
things emails do: a way to write, a look, and the community's own words. The accompaniment plan's steps 6 to 8
(the information link, public pages, the front page) are folded in here and no longer built from there. The
one defect found that was ours alone, the accompanier email ignoring a member's "email me" setting, was fixed
straight away and is not part of this plan.

Marked **(decided)** where the product owner said it in conversation, with the date when it matters;
**(proposed)** is my reading and needs a yes or a correction. Section 10 collects what is left.

> A community should be able to speak to its own people in its own words, and look like itself when it does.
> Whatever a message *must* carry, the platform makes sure it carries.

(The first half is the product owner's: letting the community write the whole email, with placeholders for values
and buttons, "seems more consistent for this tool"; a community should be able to "define a format for HTML mails
for consistent style"; and the community "present itself with a public page". The second half is the constraint
that makes the first half safe, and is mine.)

---

## 1. What there is now

### Emails

Twelve, all in `src/lib/mailer.ts`, each an array of strings written by hand. The only thing they share is the
send function: the Brevo API if a key is set, else SMTP, else a line in the console.

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
| Someone will accompany you | a member | a notification (respects the setting) | a dashboard link |
| Choose times for your conversation | a person not yet a member | transaction | their private page link |
| Your conversation is booked | the same | transaction | the time, the page link |
| We'd like to know a little more | the same | transaction | the page link |

- **Plain text only.** Links are bare URLs. The spec promised one-click buttons; what exists is `Accept: <url>`.
- **A failed send is a `console.error`.** Every caller catches it and carries on; announcements use
  `Promise.allSettled`, which discards the failures. Nothing records that an email was meant to go, and nothing
  retries. For someone who isn't a member yet, the email is the only way their private link reaches them.
- **One sender for everyone.** `SMTP_FROM` defaults to `Orchard <no-reply@example.com>`: the product, not the
  community, and an address nobody can reply to. No email says who to contact.
- **Nothing is the community's to change** except the free text of an announcement and the rejection template.
- **No test looks at wording.** The tests that touch the mailer mock it to see that a send happened.
- *Inconsistencies.* The admission emails open "Hello {name},"; the nomination, backstop, verification and login
  emails don't greet at all; none signs off. For an invitee with no application the name is derived from their
  address, so the greeting reads "Hello dana,". The login link says "Orchard" and never names the community; the
  admission emails name the community and are sent by "Orchard". The emails call it a "conversation", the
  settings and hub call it an "interview", and the product owner's own camp called it an "intro call".
  The "email me" setting reads one way on the welcome screen and another on the profile, and is honoured for
  announcements, the backstop alert and the accompanier email, but not for the nomination or the vouching request.

### Pages a non-member can read

Almost none. The only public routes are the funnel's own (`/apply`, `/inquiry`, `/invite`, `/support`, `/pair`,
`/admission`). The root `/` is a hardcoded landing screen: the community's name and logo, sign-in and apply buttons,
and a database diagnostic that **writes a `health_check` row on every visit**. Orchard serves one community per
deployment (`getOrCreateCommunity()`), so there is no question of which community an address belongs to.

The Library (`/documentation`) is members-only, and **prints a page's text exactly as typed**, in one paragraph
style (`whitespace-pre-wrap`): no headings, no links, no formatting. The cross-linking the spec describes is not
rendered.

### The look

The community already has a logo and two accent colours (`logoUrl`, `accentPrimary`, `accentSecondary`, set by
admins under General). They drive the web theme through CSS variables. Nothing outside the web uses them.

## 2. Principles

1. **The community writes to its own people**, in its own words, from its own name, looking like itself. (decided)
2. **The platform guarantees what a message must carry.** A message that is the only way somebody reaches their
   private page contains the link, whatever a community writes. (proposed)
3. **A default always exists, and the code owns it.** A community changes a message by overriding the default, never
   by writing it from nothing, so a new kind of email works on the day it ships. (proposed)
4. **Defaults are data, not strings in code.** The same structure holds our wording and a community's, so letting a
   community rewrite an email is an editor on top of what exists, not a second system. (proposed)
5. **Content and look are separate.** What a message says is blocks; how it looks is a theme the community sets once.
   (decided)
6. **Nothing private on a public surface, ever**, and nothing the community can write can make it so: what a public
   page may mention is an allow-list. (proposed)
7. **A delivery record is a queue, not a mailbox**: it never holds what a message said, because what some of them say
   are credentials. (proposed)
8. **No tracking.** No open or click tracking, no pixel. (proposed)

---

## 3. The foundation

Four things, written once and used by both, because everything after this section is hard to change cheaply if they
are got wrong.

### 3.1 One way of writing (decided 2026-10-25: one syntax, and a parser we own)

A small authoring syntax, parsed into **blocks**. The constructs, and nothing else:

| You type | You get |
|---|---|
| a paragraph, separated by a blank line | a paragraph |
| `## Heading`, `### Subheading` | a heading (the page's own title is the only top-level heading) |
| `**bold**`, `_italic_` | emphasis |
| `[label](https://…)`, `[label](/path)`, `[label](mailto:…)`, `[label]({{variable}})` | a link |
| a link on a line of its own whose label starts `button:`, as `[button: See your page]({{page_link}})` | a button |
| lines starting `- ` | a list |
| a line starting `> ` | a quiet note ("if you didn't ask for this, ignore it") |
| `{{name}}` | a placeholder |
| `{{term.interview}}` | one of the community's own words (§3.5) |
| `{{#section name}} … {{/section}}` | an **optional section**, which a kind of email may switch on (email only, §6) |

Anything else is just text. There is no raw HTML, no scripts, no layout, and no way to write a link whose target
the platform hasn't allowed. A link's scheme must be `https`, `http`, `mailto`, a site-relative path, or a variable
whose type is a link; `javascript:` and its relatives are refused when saved, not neutralised when shown.

**A parser we own, not a library.** There are ten constructs and the thing that matters most is a guarantee: nothing a
person types, and no value a placeholder is given, can become markup. A small parser with that guarantee as its
whole job, tested with property tests (the output never contains input as markup), is safer than a general library
restricted to a subset, and has no surprises when the library changes.

**Existing Library pages are not touched.** A page records its `format`: `plain` (what every existing page is) or
`blocks`. A plain page is shown as it is today. A member can turn one into blocks, and sees what it would look like
first, so a page that happens to have a line beginning `#` or `-` never changes meaning behind anyone's back.

### 3.2 One set of renderers

The same blocks render **three ways**: React elements for the web (no `dangerouslySetInnerHTML`, ever), HTML for an
email (inline styles, tables for layout), and plain text for an email. A button is one block with three faces: a
styled link, a "bulletproof" email button, and `Label: url`. The links in the text part and the HTML part are the same
links, which is tested.

Every value placed into a block is escaped for where it is going. Names, task titles and a nominator's message are
other people's words, and none can add markup, a line break to a subject, or a link of its own.

### 3.3 One list of what a message may mention

A registry of **variables and dynamic blocks**, each with a name, a type, a sample value for previews, and a **scope**:

- **email**: the person's name, their private page link, the interview time, the accompanier's name;
- **public**: the community's name, its contact line, the **open doors** (a block that renders the public lanes that are
  open and the events they belong to, with their dates) and the **upcoming events**;
- **both**: the community's name and the vocabulary.

Publishing a page that uses an email-only variable is refused when saved. This is what makes principle 6 true: a
public page cannot ask for a private value, because the registry will not offer it, and a variable added later is
public only if someone says so on purpose.

### 3.4 One look: the theme (decided in outline)

A theme the community sets once, as **fields**, not as HTML or CSS: the logo and the two accent colours it already has,
a font from a short list of safe stacks, a button shape, the header text, the footer wording. It resolves two ways from
the same fields: **CSS variables** for the web (the app already works this way) and **inline values** for email.

Fields that can't be used get fixed, not just accepted: the button's text colour is chosen from the accent for
contrast, and a pairing that can't be read is warned about when set. Mail clients are unforgiving about layout, web
fonts and dark mode, so the email shell is ours and is tested in real clients, and a stray tag from a community is
indistinguishable from phishing, which is why it is fields.

### 3.5 The community's own words (proposed; the reach is Q1)

A short list of terms we name, each with a default: the interview (*interview*, *intro call*, *conversation*), the
accompanier (*accompanier*, *buddy*, *mentor*), a supporter (*vouch*, *support*), and so on, with a plural where it
needs one. Written in a default as `{{term.interview}}`, so changing the word changes everything that says it. A
community writing in another language simply writes the word.

**Where it applies (Q1).** The same words appear on the screens, and a vocabulary that only the new surfaces use will
drift from the rest. I would start with the places a person who isn't yet inside the product reads, because they
haven't learned our words: emails, public pages, the applicant's private page, and the apply, invite, support and pair
screens. The screens members use come later, and are a larger job.

### 3.6 One voice

Set once, used by every email and by the footer of every public page: the **sender name** (the community, not
"Orchard"), a **signature**, a **contact line**, and an optional **reply-to** address. With no reply-to the sender stays
a no-reply and the footer names a role to find, not an address. A **footer** says who a message is from, why the
recipient got it and, for a notification, how to change the setting in one click.

### 3.7 One preview

Render any message or page, in its theme, with sample values from the registry: the web form for a page, both forms
for an email, and a test send to the admin's own address. The same mechanism, so a community sees what it is about to
do before it does it.

### 3.8 Who may do what (decided 2026-10-25: separate grants)

Publishing a page, rewriting an email and setting the theme are different jobs and can be held by different people,
so they are not one module.

| | Held by |
|---|---|
| Publish a public page | a new `public_pages` grant |
| Rewrite an email's wording | a new `email_wording` grant |
| The theme, the vocabulary, the voice | administrators, as the logo and colours already are (proposed) |

Administrators can always do all three. **Neither new grant may be made open to everyone** (proposed): an open module
makes every member a holder, and "anyone can publish to the whole internet" is not something to be a setting. The
settings screen refuses it for these two, with the reason.

---

## 4. Emails

### 4.1 A registry of kinds

Each kind of email is declared once:

- **an id** (`admission_received`, `interview_invited`, …) and a **class**: *transactional*, sent whatever the
  recipient's setting (the login link, the admission emails, anything that is the only way to carry on), or a
  *notification*, which respects the member's "email me" setting;
- **its variables** from §3.3, with sample values;
- **what a rewrite must keep**: the placeholders that cannot be removed (the acceptance email must contain
  `{{page_link}}`), and any **named optional sections** the kind can switch on (the accompaniment paragraph in
  "you're in", the companions line in "your conversation is booked"), which can be reworded but not removed or renamed;
- **whether a community may rewrite it** at all: the **login link** and the **address confirmation** may not. What they
  say is what protects a person from a phishing email dressed up as one. They still wear the theme and carry the sender
  and footer;
- **how to rebuild it from ids** (§4.4), so a retry doesn't need a stored body.

### 4.2 Where the words come from

In order: the community's override for this kind (if it has one and it is valid), else the default. The default is data
in the repository, in the §3.1 syntax. Changing a default later reaches every community that hasn't overridden it, and
an override can always be reset to the current default. Rendering never fails: an override that no longer validates
(a variable removed, a required placeholder missing) is skipped for the default, and an admin is told.

### 4.3 Which emails respect the member's setting

The class decides it, and the setting's wording is made true in one place. Proposed: *transactional* for login, address
confirmation, and everything sent to a person not yet a member; *notification* for announcements, the backstop alert,
"someone will accompany you", and **the vouching request**; and the **task nomination** kept as sent regardless,
because it opens a reply window (a deadline runs, and "no reply" releases the task), so someone who has switched email
off would be penalised for not seeing it. The setting then reads the same on both screens. (Q3.)

### 4.4 A delivery record, not an outbox

Three jobs that get lumped together, kept apart:

1. **Reliability.** A row says *this kind of email is owed to this person about this thing*, and a job sends it and
   retries a few times with a pause. It does **not** store the message. It stores the kind, the recipient, the ids the
   kind needs (the arrival, the member, the nomination) and a few non-secret parameters, and the message is **rebuilt
   at send time**. Credential emails (the login link, address confirmation) are never queued or retried: their tokens
   expire, and asking again is the person's own act.
2. **Failure surfacing.** When an email has failed for good, whoever it was *for the benefit of* hears of it, and only the
   fact: that it didn't arrive, not what it said. An applicant's email failing goes to the people looking after joining
   (on the pipeline row and the needs-action list); a member's own to that member on their own page; anything else to
   administrators. Access follows the task, as everywhere else. (Q4.)
3. **A content log.** Not built. A browsable log would hold private-page links, which are credentials that last, readable
   by whoever can open it. Outbound announcements already have their log, visible to their senders, and that stays.

Rows are deleted after a retention period (proposed 30 days; Q5). In the interface nobody sees the rows themselves; what
a person may read is the failure notice above.

---

## 5. Public pages and the front page

### 5.1 What was decided (2026-10-13 and after)

1. **The community presents itself with a public page, and that page is `/`.** One published page is designated the
   front page. With none designated, today's landing shows (without the diagnostic).
2. **Not signed in:** a **sign-in button at the top** of every public page. **Signed in:** `/` goes straight to the
   dashboard, as it does today, and never shows the page.
3. **The doors are read live, not written.** When a public lane is open for an event, the page shows **the event and its
   dates**, with that lane's apply button. A door that closes disappears from the page by itself.
4. **Text only, for now.** No images beyond the community's logo.

### 5.2 Pages the Library can publish

A community page can be made public.

- **Members keep editing the live page, as now.** What the public sees is a **published revision**
  (`wiki_page.published_revision_id`, null for members-only), not the latest edit. Someone holding `public_pages`
  **publishes the latest**; the page shows *"The public version is 3 edits behind"* with the changes. The Library stays
  open to every member while no member's edit reaches the internet without someone deciding it should.
- **Address:** `/p/<slug>`, the slug unique and editable, derived from the title.
- **What a public page shows:** the title, the published text in the §3.1 syntax, the theme, the sign-in button, the
  navigation, and the §3.6 footer. No author, no edit history, no member names. Links to other pages, tasks and branches
  stay plain text unless they point at another **public** page. The page may use only the **public** variables (§3.3).
- **Not indexed unless asked:** `robots: noindex` by default, as the admission page already is, with a per-page *let search
  engines find this* switch. The front page's switch is offered at the moment it is designated, because a community will
  usually want that one found.
- **A warning at publish:** "Anyone on the internet can read this. Don't include anything about a member." The Library
  marks public pages with a tag in its list. A page can't be published while it uses a variable that isn't public.
- **Members-only pages gain the syntax too**, as a side effect: the same renderer shows them headings and links.

### 5.3 The front page

- **Designation:** a Settings choice, *Front page*: one of the public pages, or none. Held by `public_pages` and
  administrators.
- **Fixed furniture around the page's own words**, not editable by page authors: the community's name and logo; the sign-in
  button at the top when nobody is signed in; the contact box (`/inquiry`, which already exists); the live doors below,
  which are the `{{open_doors}}` block.
- **The live doors:** for each public lane that is open, an apply button at its own address (`/apply/<slug>`); for each
  **event** that has a public lane open for it and whose applications are open, the event's name, its dates (`start_date`
  to `end_date`, when set), and its time zone when it has one, with that lane's apply button. An event whose dates are not
  set shows without them. Nothing is listed about an event whose door is shut.
- **Navigation:** a short ordered list of public pages, chosen in Settings, shown at the top of every public page after the
  sign-in button. Not automatic: a page is in it because someone put it there.
- **The diagnostic goes.** The `health_check` write and its readout move to an admin-only status route before `/` becomes a
  page people share. A public page that writes to the database on every view is a fault whether or not anybody visits.
- **Nothing private on it, ever:** no member, task, branch or board data. The only live data are the open doors and the
  events they belong to.

---

## 6. Where they meet

- **The interview invitation's *before your interview* section.** The information that helps somebody going into an
  interview is a public page (§5), written and kept up to date in one place. The invitation carries a **button to it**
  (`{{info_page_link}}`) in an optional section, and the applicant's own page shows the same link. Until public pages
  exist, the section is fed by a URL and a one-line note in settings; once they do, it is a picker (a public page, or a
  pasted URL). **Linking first, including the text later (Q2):** pasting a page into an email makes the email change
  whenever the page does, and makes every email long. A link keeps one source of truth, which is the point.
- **The footer** is the same on both: who this is from and how to reach a person.
- **The preview** is the same mechanism (§3.7).
- **Vocabulary** is the same everywhere a non-member reads (§3.5).

What stays separate: where each is stored and who edits it (pages are open-edit with a published revision; email
overrides are held by one grant, with a default in code), how each is delivered (an email goes to a particular person; a
page is the same for everyone), and personalisation (a page never takes a per-person value; that is what §3.3's scopes are
for).

---

## 7. Build order

Each step is one commit, runs the whole suite, and is checked by hand in a scratch database. Each starts when asked for.

**F1. The content format.** The parser and blocks, the web and text renderers, the variables registry with scopes, the
escaping and property tests, the `format` flag on pages, and the Library's pages rendering through it (plain pages
unchanged). No new screens beyond that. *Depends on nothing.*

**F2. The look, the words and the voice.** The theme object, vocabulary and voice, their settings under one new Settings
card, resolving to CSS variables; the preview mechanism, for the web. *After F1.*

**E1. Emails onto the registry.** Move all twelve over *without changing their wording*, proved by tests that render each
with its sample values and compare to what is sent today. Then, as a separate commit, make them consistent on purpose:
one greeting and sign-off, the community's name where the product's is now, the sender name, vocabulary. The preference
classes (§4.3) and the setting's one wording. The interview invitation's optional *before your interview* section, fed
by a URL and note. *After F1 and F2.*

**P1. Public pages.** `published_revision_id`, the `public_pages` grant (refused as open), `/p/<slug>`, the public chrome
(sign-in button, navigation list, footer), the Library's publish and behind-by views, the warnings, the picker for the
interview information page. *After F1, and F2 for the chrome.*

**E2. HTML email.** The shell, the multipart send, the email preview with a test send. *After E1 and F2.*

**P2. The front page.** The designation, `/` rendering it, the live doors and events, the contact box, the diagnostic
moved to an admin status route, today's landing as the fallback. *After P1.*

**E3. The delivery record.** The queue, the retry job, the failure notices, retention, each kind's rebuild. *After E1.*

**E4. Rewriting an email.** The editor for one kind: the syntax, the kind's variables, required placeholders enforced on
save, optional sections, reset to default, a test send, a notice when the default has since changed, the `email_wording`
grant. *After E1 and E2.*

**Later, only if wanted:** a body per kind per language; including a page's text in an email; the theme as its own grant;
the vocabulary on the screens members use.

### Tests to write

The parser: no input, and no placeholder value, ever comes out as markup, a line break in a subject, or a link of its own;
an unsafe link is refused when saved; an unknown variable, or one outside the scope, is refused; a plain page renders as
it did. Renderers: the text part and the HTML part carry the same links; a button has all three faces. Emails: each kind
renders to the same text as today before it is made consistent; a rewrite missing a required placeholder is refused; an
override that no longer validates falls back to the default; a notification kind is not sent to someone who has asked
not to be emailed and a transactional one is; the delivery record never contains a body or a token; a failed funnel email
is visible to the people looking after joining and to nobody else; a retried email is rebuilt from current state;
credential emails are never queued. Pages: a public page serves only its published revision, strips internal links and
author data, and 404s when unpublished; it can't be published using an email-only variable; the front page shows an event
only while a public lane is open for it and its applications are open, and a closed door vanishes; a signed-in member never
sees it; no private data reaches `/` or `/p/…`; neither new grant can be made open. The theme: a button's text stays readable
on any accent the community picks.

---

## 8. Decisions made

1. **One syntax for pages and emails, and a parser we own** (2026-10-25).
2. **Separate grants**, not one module: publishing pages, rewriting email wording, the theme are different jobs
   (2026-10-25).
3. **Emails written from defaults the code owns, with the community's override on top** (2026-10-15, in outline).
4. **The look is fields, not raw HTML** (2026-10-15, in outline).
5. **The front page replaces `/`; sign-in button for visitors; members go straight to the dashboard; the open doors and
   their events with dates are shown live; text only for now** (2026-10-13).
6. **No content log**: a delivery record that holds no bodies (2026-10-15, in outline).

## 9. Not verified, and each is a step's first job

How any of this renders in real mail clients (E2 is checked in several, not only a browser); that Brevo's API takes an
HTML part along with the text part used now; that a remote logo survives a client that blocks images; how `SMTP_FROM`'s
domain is authenticated, which is an operations matter and decides deliverability more than anything here; whether any
existing Library page has text that would read as markup (F1 reports this before anything is switched on); how the
placeholders and blocks should be typed by someone who has never seen them, which F1's tests can't tell us and the first
editing screen will.

## 10. What's left to decide

1. **Q1: where the community's words reach** (§3.5). I propose the places a non-member reads, first.
2. **Q2: link before include** (§6): the interview invitation links to the information page; including its text is later.
3. **Q3: which emails are notifications and which transactions** (§4.3). In particular the vouching request (I say
   notification) and the task nomination (I say keep sending it).
4. **Q4: who hears of a failed send** (§4.4): the people looking after joining for an applicant's; the member for their
   own; administrators for the rest. Is that the right split, and is a needs-action line the right way to tell them?
5. **Q5: retention for the delivery record**: thirty days?
6. **Q6: reply-to** (§3.6): offered as an optional community address, with the footer naming a role when there is none. Is a
   no-reply sender with a named role acceptable to a community that has no shared inbox?
7. **Q7: the theme's fields** (§3.4), and whether a community may ever supply its own HTML shell. I say no.
8. **Q8: an event on the front page** whenever its public door is open, with no per-event switch (§5.3)? An event's name and
   dates become public with it, and a community might want to open a door without announcing the event.
9. **Q9: the theme, vocabulary and voice held by administrators** (§3.8), or as a grant of their own.

**Not in this plan:** other channels (the spec leaves Telegram a deliberate yes/no), the sign-in provider's own emails
(Zitadel sends those), attachments, images in pages, open or click tracking, a public listing or search of pages, and a
per-member choice of language.
