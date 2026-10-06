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
// asserted to still exist by tests/orchard-docs.test.ts. That catches
// a note whose source entry has been renamed or deleted, and — via
// the same test — a CHANGELOG entry that grew a fresh "Unreleased:"
// heading and was never summarised here.

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
    source: "Unreleased: a form can't ask a sensitive question, the last Admins grant is a way out and not a trap, REST writes respect View-as, and the docs stop describing things that don't exist",
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
    source: "Unreleased: a first-login screen, and the name a member is actually called",
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
    source: "Unreleased: an audit's three real faults — event admission rules, the overrule threshold, a migration that only worked on empty databases — and the suite runs in CI",
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
    source: "Unreleased: the ⋯ overflow menu is unusable on a phone",
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
    source: 'Unreleased: the Library gets a documentation section, and the "why" moves out of the interface',
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
    source: "Unreleased: the Coordination view becomes a dashboard, and the self-assign check stops being a wall",
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
    source: "Unreleased: a member is told who is reading, and gets to choose which of them",
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
    source: "Unreleased: who joins, how, and what the community decides — plus a settings screen you can read",
  },
  {
    date: "2026-09-29",
    title: "A dropdown that saves and stays saved",
    summary: "A bug that could make a successful save look like it had been rejected.",
    points: [
      "On 24 pages, a saved dropdown would revert to its previous value on screen immediately after saving. The save had worked; the display just hadn't updated.",
      "If something you changed in Settings appeared not to stick, this is why. Nothing you did was wrong.",
    ],
    source: "Unreleased: a saved dropdown no longer reverts on screen — 23 more sites, and the diagnosis the first commit didn't carry",
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
    source: "Unreleased: a question's audience moves onto the question, and the Access rules section goes",
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
    source: "Unreleased: an event's admission rules are stated to the whole community, and a community rule says which events it won't reach",
  },
  {
    date: "2026-09-28",
    title: "The events page is a list of events",
    summary: "One page listing what's coming, instead of one event's settings repeated per open event.",
    points: [
      "Managing an event is now a page you choose from a list, rather than a page that was showing a whole event's settings at once for every open event.",
      "Which event you're looking at is chosen from the same switcher used everywhere else, rather than being implicit in the page.",
    ],
    source: "Unreleased: the events page becomes an index of events, and stops stacking a whole event's settings per open event",
  },
  {
    date: "2026-09-28",
    title: "One control instead of two",
    summary: "The \"Other\" option on a choice field is now a single thing rather than a row and a box that looked unrelated.",
    points: [
      "Picking \"Other\" and then typing into a separate box underneath read as two unrelated controls, and it wasn't obvious that the text only counted if the row above was ticked.",
      "It's now a marker next to the text field, and typing in the field ticks it — so un-ticking it afterwards is a real decision rather than a no-op.",
    ],
    source: 'Unreleased: "Other" is one control, not two stacked ones',
  },
];
