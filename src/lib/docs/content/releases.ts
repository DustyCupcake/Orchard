// Curated release notes — member-facing, newest first.
//
// Deliberately not generated from CHANGELOG.md. That file is the build
// record: it names migrations, function names, test counts and the
// reasoning behind individual commits, which is exactly right for
// whoever maintains this and exactly wrong for a member opening the
// app on a phone. The two serve different readers and drift apart on
// purpose — which only works if the ownership is explicit, so the
// pointer at the top of CHANGELOG.md and in docs/roadmap.md's
// maintenance note both name this file. A notable user-facing change
// should add a line here, the same way it adds an entry there.
//
// `source` is the CHANGELOG heading this note came from, and is
// asserted to still exist by tests/orchard-docs.test.ts, so a note
// whose source entry has been renamed or deleted fails the suite
// instead of quietly outliving what it summarises. What it does not
// catch is an entry that was never summarised here at all; whether a
// change is one a member would notice is a judgement, and adding the
// line is part of finishing the change.

export type ReleaseNote = {
  date: string;
  title: string;
  summary: string;
  points: string[];
  // The CHANGELOG `##` heading this was written from.
  source: string;
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    date: "2026-10-12",
    title: "Joining: people arriving together, and a tidier back end",
    summary: "If you're applying with someone you can now say so from your own page, and the old intro-call machinery is gone.",
    points: [
      "On your own page, \"Applying with someone?\" makes a link for the person you're applying with. When they use it, you're asked whether it's who you meant. If both of you are waiting for an interview, the people looking after joining can offer you one interview between you — you each still get your own recommendation.",
      "The team can also link two people they know are coming together, from the Recruitment page; one of the two confirms it on their own page.",
      "Your recruitment subscription is yours alone now: it no longer switches itself off after a few interviews you didn't offer times for.",
      "The old intro-call link is retired — the interview is arranged from the person's own page before anyone decides.",
    ],
    source: "the clean-up: the legacy intro call, the lapsing subscription and the old columns are gone",
  },
  {
    date: "2026-10-12",
    title: "Signing in with your community's account system",
    summary: "If your community signs in through its own provider (Zitadel), being admitted can now set that account up for you — and signing in no longer makes a second copy of you.",
    points: [
      "An administrator can turn on creating a sign-in account when someone is admitted: the provider emails them to set up how they sign in, and Orchard gives them the role. If the provider is down, they're admitted anyway and an administrator sees what's left, with a button to try again.",
      "Signing in at the provider no longer creates a duplicate member when you already have one. If you were admitted here and the provider has confirmed your email, you're connected automatically. Otherwise an administrator is asked to connect you — you're told so when you try.",
      "Optionally, only people admitted here can join through the provider, and leaving takes the role back.",
      "Administrators can remove an empty member — a duplicate or a test account — as long as nothing is attached to them. If something is, it tells you exactly what.",
    ],
    source: "the sign-in provider: admitted means they can sign in, and a sign-in is never a duplicate",
  },
  {
    date: "2026-10-12",
    title: "Settings: only what your lanes need",
    summary: "The recruitment settings stop asking about things none of your lanes uses.",
    points: [
      "If none of your lanes asks for an application or an interview, the application and evaluation settings are replaced by one line saying so — and come back the moment you add a lane that needs them.",
      "The application form, the interviewers' availability threshold and the interviews door only appear when a lane asks for an application or an interview.",
      "The Community check settings — how long a window stays open, who settles a concern, and what it takes to overrule one — only appear when a lane announces arrivals to the community or your decision rules can open a wider discussion.",
      "A conversation-only lane now works end to end: the people who took part in the call report on the person, and a decision follows, without an application to read.",
    ],
    source: "the recruitment settings show only what the lanes in play need",
  },
  {
    date: "2026-10-12",
    title: "Joining: one community check, and one way to raise a concern",
    summary: "When the community has a say in someone's arrival, it's the same window and the same page whichever way they came.",
    points: [
      "Anyone in the community can raise a concern about an arrival that is open to one — from the new Community check page, under Recruitment. You don't need to be subscribed to anything. The only person who can't is whoever invited them.",
      "A concern holds their arrival until the mediation team has talked it through. A clock never ends it, nobody is refused by a timer, and nothing admits someone over a concern that stands.",
      "Who raised it stays hidden from the person, from whoever invited them and from the people who read their application. You can withdraw your concern at any time.",
      "The mediation team can now also ask for more: an application, and a conversation if they want one. The person is emailed what's being asked (never why), fills in the application on their own page, and then goes through the ordinary steps — read, interviewed, decided.",
      "The recruitment holders no longer have a button to close a wider discussion. It ends by itself when nobody has raised a concern by the deadline, or when the mediation team has settled the ones that were raised.",
      "If something goes wrong while an outcome is being applied, the next look at the window finishes it, rather than the outcome being lost.",
    ],
    source: "one community check, one way to raise a concern, and the body can ask for more",
  },
  {
    date: "2026-10-12",
    title: "Joining: the conversation comes before the decision",
    summary: "People who are interviewed are interviewed first, and the decision is made from the reports of the people who met them.",
    points: [
      "A lane with an interview now sets one up as the person arrives, on their own page — they paint when they're free, and nobody sees anyone else's times until one is booked.",
      "Recruitment holders offer their own times once, under Recruitment → Your interview availability: a grid for the next two weeks that counts for every interview automatically. A time is only offered for booking when the person and enough of you offered the same one.",
      "A holder books it — any holder, not only whoever started the poll — and the person is emailed the time. The people who offered that time are the ones on the call, and they write the reports afterwards.",
      "Without an interview, any holder who reads an application can report on it, as before.",
      "How reports decide is four choices in settings instead of a list of rules; how many reports a lane needs is on the lane.",
      "While conversations are paused, people wait at that step rather than skipping it, and the recruitment page says who is waiting on whom.",
    ],
    source: "the interview comes before the decision, and the holders offer their own times",
  },
  {
    date: "2026-10-11",
    title: "Joining: members' word can skip the rest",
    summary: "A lane can say that a few members vouching for someone is enough, and nobody has to wait for it.",
    points: [
      "Under Settings → Recruitment, a lane with an application or an interview can add \"let members' support skip the rest\" and a number. When that many members have said they know the person — or think they'd fit — the rest of the process is skipped and they're admitted.",
      "It never makes anyone wait. The person goes through the lane as normal, and if nobody vouches, nothing changes. It replaces the old \"one more member's word\" option, which did make people wait.",
      "Everyone going through an application or interview gets a link to send to members who know them, on their own page. A member who opens it says how they know the person, once. The person who invited them can't be counted again.",
      "People reading an application see who has vouched for them, and can add their own word from the applications list without needing the link. You can also ask members by name to look — they each get their own email, and no deadline.",
      "It never skips past a concern someone has raised. That is always settled by the mediation team first.",
    ],
    source: "the support shortcut: members' word skips the rest, alongside the path and never past a concern",
  },
  {
    date: "2026-10-10",
    title: "Joining: a full event waits instead of turning people away",
    summary: "An invitation now respects the same doors as an application, and someone approved for an event that has filled up waits for room.",
    points: [
      "Opening an invitation link used to check no door. It now says so, in a sentence, when invites are closed, an event's joining period is over or the event is full — and the link is kept, so it works again when the door reopens.",
      "A closed interviews door no longer turns anyone away at the entrance. People wait at the interview step until interviews reopen.",
      "If someone is approved for an event that has since filled up, they're told they're in as soon as there's room, and they become a member then. Room appearing — a higher capacity, someone no longer coming, an invitation revoked — admits whoever waited longest.",
      "On an event's page, whoever can run the event sees who is waiting and can admit someone anyway.",
    ],
    source: "doors checked everywhere somebody enters, and a place in an event taken at admission with a waitlist",
  },
  {
    date: "2026-10-09",
    title: "Joining: lanes you define, and a page for the person joining",
    summary: "A community now defines only the ways of arriving that it needs, and everyone who is on their way in has a private page showing where they are.",
    points: [
      "Settings → Recruitment has lanes instead of four fixed rules. An invite lane takes invitations from members who said they know the person, think they'd fit, or neither; a public lane has its own application address. Each says in a sentence what it does, and a set that would leave some invitation with nowhere to go can't be saved.",
      "An event chooses which lanes it opens (on its own page) instead of changing a lane's rules, so a different process for one event is a different lane. An invitation the event has no lane for is refused when it's sent, and says why.",
      "Nobody is a member until they're admitted. Someone who applies, or is invited into a community check or an interview, gets a private page and an email with its link, showing where they are in plain words and letting them stop at any time. Being accepted emails them again.",
      "An application form needs a question marked as the applicant's name and one as their email, or it can't take applications. An address that is already a member, or already in the process, is told so before anything is stored.",
      "Nominations (one more member's word) are gone from lanes for now; the support shortcut that replaces them is coming.",
    ],
    source: "the admission funnel's foundations, finished: one source of lanes, one admission function, a page for the person",
  },
  {
    date: "2026-10-08",
    title: "Tasks that need approval are approved by coordination",
    summary: "On a task marked \"requires approval\", the first person to claim it now needs approval too, and coordination decides.",
    points: [
      "Before, the first person to claim an unclaimed \"requires approval\" task simply got it, and could then approve everyone after them. Now a request goes to that task's coordination first.",
      "Coordination can approve a request without holding the task, so a request no longer gets stuck when everyone holding the task has left.",
      "If nobody coordinates that part of the community yet, nothing changes: the task is claimed directly and a current holder approves.",
      "Someone shadowing a task can no longer approve or decline requests to join it, and nobody can approve their own request.",
    ],
    source: "a `coordination_approved` task is approved by its coordination, including for the first claim",
  },
  {
    date: "2026-10-06",
    title: "A tier is something you ask for",
    summary: "You can no longer tick a tier onto your own profile. Someone who can vouch for it confirms.",
    points: [
      "Tiers can unlock things — who can read a sensitive answer, who can start an event — so a tier you added to yourself would have been a way to give yourself access.",
      "On your profile, the Tiers section now has an \"Ask to join\" button for each tier. Asking gives you nothing until an Admin, or someone already in that tier, confirms.",
      "People who can confirm see the request on their dashboard, with Confirm and Decline buttons. If a request isn't confirmed, your profile says so and you can ask again.",
      "You can leave a tier whenever you like, and the tiers you already hold are unchanged.",
      "Opening Admins or View-as to every member now asks for a confirmation that can't be skipped.",
    ],
    source: "a manual tier is asked for and confirmed, and opening Admins or View-as needs a confirmation the server checks",
  },
  {
    date: "2026-10-06",
    title: "Sensitive questions are only asked once you've joined",
    summary: "An application can't ask a sensitive question any more, and the documentation is clearer about what's built.",
    points: [
      "A sensitive question can't be put on an application form. It's asked when you first join, where you're shown who can read your answer before you give it.",
      "If the community ever removes its last Admins task, settings open to every member again rather than locking everyone out — and removing the last one asks you to confirm first.",
      "Opening conflict reports to every member now tells you how many existing reports that would show people, and asks you to confirm.",
      "While someone is viewing as another member, nothing can be changed — including by routes that previously let it through.",
      "Pages in the documentation that described things not built yet now say so, with a \"Planned — not built yet\" label.",
    ],
    source: "a form can't ask a sensitive question, the last Admins grant is a way out and not a trap, REST writes respect View-as, and the docs stop describing things that don't exist",
  },
  {
    date: "2026-10-06",
    title: "Your first login asks what you'd like to be called",
    summary: "The roster was a list of email prefixes. Now each person is asked, once.",
    points: [
      "The first time you log in you land on a short welcome screen instead of the dashboard. It asks what to call you — pre-filled with what we guessed, so fixing \"t.doe\" into \"Toby\" is one edit.",
      "It also shows each of your contact methods, including the email you signed in with, and who can see each one, so you decide that rather than finding it out later. You can add another way to reach you, and the languages you speak.",
      "Nothing on it is required except a name, and \"Skip for now\" is always there. It never comes back on its own, and all of it stays editable on your profile.",
      "Signing in with a login link now also confirms that address as yours, so the profile no longer offers to \"send me a confirmation\" for an address you just proved.",
      "Redeeming an invite with an address you already use for signing in now takes you to your existing account instead of making a second one.",
    ],
    source: "a first-login screen, and the name a member is actually called",
  },
  {
    date: "2026-10-06",
    title: "Overruling a concern now takes the people who hold the role",
    summary: "The exception to \"a concern stands\" was one person's click. It's now the whole threshold.",
    points: [
      "If mediation can't clear a concern, it stands and the person doesn't join. The one exception is an overrule — and it now needs the number of the mediation body your community set, not just one of them.",
      "Each person on the body adds their own support and their own reason. Until enough have, the concern stands and the queue shows who has supported it so far.",
      "The permanent record names everyone who supported an overrule and what they said.",
      "Changing an event's own admission rules is now limited to whoever can start an event; it was open to any member who knew how to ask.",
    ],
    source: "an audit's three real faults — event admission rules, the overrule threshold, a migration that only worked on empty databases — and the suite runs in CI",
  },
  {
    date: "2026-09-29",
    title: "The three-dot menu works on your phone",
    summary: "The actions were there the whole time. They were just off the side of the screen.",
    points: [
      "Tapping the three dots on a task, the board or a member list now shows you all the actions, instead of opening an empty-looking menu.",
      "A menu that doesn't fit above or below its button now opens the other way, or scrolls, rather than running off the bottom of the screen.",
      "The menu keeps up with the page when you scroll, and with your phone when you turn it.",
    ],
    source: "the ⋯ overflow menu is unusable on a phone",
  },
  {
    date: "2026-09-29",
    title: "The Library explains Orchard now",
    summary: "How the tool works, how to use it, and why it behaves the way it does.",
    points: [
      "The Library has a new section for documentation about Orchard itself: how to use it, how it's built, and the reasoning behind the settings and controls that don't explain themselves.",
      "There's a 'What's new' list alongside it, describing what changed in terms of what it means for you rather than what changed in the code.",
      "It's read-only. None of it can be edited or deleted from inside the app, and it's the same on every installation.",
    ],
    source: 'the Library gets a documentation section, and the "why" moves out of the interface',
  },
  {
    date: "2026-09-29",
    title: "The coordination view is a dashboard now, and Claim is a button again",
    summary:
      "A page of numbers you can act on, and one question that had quietly become a wall.",
    points: [
      "The coordination view was two flat lists that weren't about any one task. It's now a set of panels, each answering a single question a coordinator opens it to ask: what's unclaimed in my scope, what's waiting on me, what needs an owner, what's flagged, what nobody's answered.",
      "Claiming an unclaimed or flagged task as a coordinator asks you first whether there's someone better suited. That question used to appear the moment you looked at a task rather than when you tried to claim it, which turned it into a permanent banner on every task in your scope.",
      "\"Ask someone instead\" now sends a real nomination. It used to write a name to a field nothing in the app read back, so the person was never told and the coordinator didn't see it again after a reload.",
      "\"Put it in front of the coordinators\" now reaches every coordinator, not just the ones covering your branch — which is the whole point of the button. It's visible to the whole community too, because that's a disclosure and shouldn't look like a private nudge.",
      "If a coordinator suggests someone for a task, that suggestion now survives the task actually being created, which is the moment someone could act on it.",
    ],
    source: "the Coordination view becomes a dashboard, and the self-assign check stops being a wall",
  },
  {
    date: "2026-09-29",
    title: "You're told who is reading a sensitive answer, and can say yes to some of them",
    summary: "Consent is asked per group, and unticking a box now takes something away.",
    points: [
      "Answering a sensitive question now states who can read it, whether a crisis could reach it, and whether your answer counts in a published community figure — above the field, not on a settings page somewhere.",
      "If more than one group can read a question, you get a box per group. You can accept the kitchen team and decline next year's welfare team, which one combined box didn't let you do.",
      "Un-ticking a box now removes that group's access rather than doing nothing. Previously the control could only ever add, so there was no way to narrow sharing once you'd agreed to something.",
    ],
    source: "a member is told who is reading, and gets to choose which of them",
  },
  {
    date: "2026-09-29",
    title: "Settings that say what they're set to",
    summary: "A long list of checkboxes is now a list of statements you can read.",
    points: [
      "Every settings card now states the current value of what it controls, without opening anything.",
      "A full editable form per question was the right editing surface and the wrong listing surface — with twenty questions the page was twenty forms, and the only way to find one was to read past all of them.",
      "Every member can read the settings now. Only Admins can change them.",
      "Changes to community settings leave a record of what actually moved.",
    ],
    source: "who joins, how, and what the community decides — plus a settings screen you can read",
  },
  {
    date: "2026-09-29",
    title: "A dropdown that saves and stays saved",
    summary: "A bug that could make a successful save look like it had been rejected.",
    points: [
      "On 24 pages, a saved dropdown would revert to its previous value on screen immediately after saving. The save had worked; the display just hadn't updated.",
      "If something you changed in Settings appeared not to stick, this is why. Nothing you did was wrong.",
    ],
    source: "a saved dropdown no longer reverts on screen — 23 more sites, and the diagnosis the first commit didn't carry",
  },
  {
    date: "2026-09-28",
    title: "A question's audience lives on the question",
    summary: "Who may read a sensitive question is now one thing, on that question, rather than a separate screen.",
    points: [
      "The separate \"Access rules\" settings section is gone. Restricting a sensitive question is now done on the question itself, in one step, instead of creating the question and then going to find the rules.",
      "Marking a question sensitive is now a one-way door. Turning it off would make every answer given so far readable by everyone, including answers people gave while it was restricted — so it can't be done at all rather than being done behind a warning.",
      "A group added to a question's audience after you've answered can't reach your existing answer. You're asked separately, and a no is a no.",
    ],
    source: "a question's audience moves onto the question, and the Access rules section goes",
  },
  {
    date: "2026-09-28",
    title: "Joining, and what the community decided about it",
    summary: "How someone gets in is now stated to the whole community rather than decided quietly.",
    points: [
      "Each way into the community — a personal invite, a vouch, an unmarked invite, a public application — now states its own rule, and those rules are visible to everyone rather than only to whoever handles applications.",
      "A community can now say a particular event isn't open to outside applicants at all, which is the case that didn't have anywhere to be configured.",
      "Someone raising a concern about an arrival can't be waved through. It holds the admission until the point is talked through, and over-ruling it takes a decision the platform won't make for you.",
    ],
    source: "an event's admission rules are stated to the whole community, and a community rule says which events it won't reach",
  },
  {
    date: "2026-09-28",
    title: "The events page is a list of events",
    summary: "One page listing what's coming, instead of one event's settings repeated per open event.",
    points: [
      "Managing an event is now a page you choose from a list, rather than a page that was showing a whole event's settings at once for every open event.",
      "Which event you're looking at is chosen from the same switcher used everywhere else, rather than being implicit in the page.",
    ],
    source: "the events page becomes an index of events, and stops stacking a whole event's settings per open event",
  },
  {
    date: "2026-09-28",
    title: "One control instead of two",
    summary: "The \"Other\" option on a choice field is now a single thing rather than a row and a box that looked unrelated.",
    points: [
      "Picking \"Other\" and then typing into a separate box underneath read as two unrelated controls, and it wasn't obvious that the text only counted if the row above was ticked.",
      "It's now a marker next to the text field, and typing in the field ticks it — so un-ticking it afterwards is a real decision rather than a no-op.",
    ],
    source: '"Other" is one control, not two stacked ones',
  },
];
