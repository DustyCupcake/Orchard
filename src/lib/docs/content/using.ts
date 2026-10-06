import type { DocSection } from "../types";

// "Using Orchard" — the practical register. What you can actually do,
// in the order people tend to need it. Drawn from docs/overview.md's
// behaviour sections and the member-visible mechanics in docs/spec.md
// (Task, Browse mode, Shadow slots, Task milestones, Task notes,
// Input rounds, Scheduling polls, Lifecycle, Dashboard, Member
// onboarding).
//
// The register matters here: this section says *what to do*, and the
// "Why it's like this" section is where the reasoning lives. A page
// that argues with itself halfway through a how-to is a page nobody
// can scan, which is the failure the design conventions' copy rule
// exists to prevent. Where a member genuinely needs the reasoning to
// act correctly — the cases where a control looks like it does less
// than it does — it appears as a callout, which is the one place a
// "why" belongs on a page of instructions.

export const using: DocSection = {
  key: "using",
  title: "Using Orchard",
  summary:
    "What you can do here, in the order people tend to need it. Start here if you have never claimed anything.",
  pages: [
    {
      slug: "getting-started",
      title: "Getting started",
      summary: "What happens the first time you open Orchard, and how to get to your first task.",
      blocks: [
        {
          kind: "para",
          text: "Your first visit isn't a blank board. You'll be asked a few short questions about what you're good at and how you like to work — your strengths, your languages, whether you drive, whether you'd rather work alone or with people, how much you can take on. Nothing here is a test and nothing is scored.",
        },
        {
          kind: "para",
          text: "Those answers are the only thing Orchard uses to decide what to show you, so they're worth thirty seconds of thought. You can change any of them later on your profile, and changing them changes what gets suggested.",
        },
        {
          kind: "para",
          text: "Then you'll get two or three tasks that fit, rather than the entire list of everything nobody's claimed. The goal is simple: your first session should end with you having claimed something, not just having looked around.",
        },
        {
          kind: "heading",
          text: "If you'd rather browse",
        },
        {
          kind: "para",
          text: "Some people would rather pick from everything than be handed a suggestion. That's a perfectly good way to work and Orchard doesn't push you either way — the board shows the full list of unclaimed tasks, and you can filter it by branch, by tag, or by effort.",
        },
        {
          kind: "callout",
          title: "You can be both",
          text: "Suggestions aren't a restriction. Tasks that fit you are pulled toward the top, but everything unclaimed is still there underneath. Nothing is hidden from you because of what you said about yourself.",
        },
        {
          kind: "para",
          text: "Once you've finished one task, Orchard nudges you toward the next one. That's deliberate — a lot of people will do one thing properly and then decide whether they want more, rather than committing to a pile up front.",
        },
        {
          kind: "see-also",
          slugs: ["finding-work", "your-dashboard"],
        },
      ],
    },
    {
      slug: "finding-work",
      title: "Finding work that fits you",
      summary: "Why you see a handful of tasks rather than everything, and how the list changes.",
      blocks: [
        {
          kind: "para",
          text: "Most people's problem isn't that there's nothing to do. It's that nobody can tell what's actually needed, so the same handful of people keep getting handed it. The board is built to make the work visible instead.",
        },
        {
          kind: "heading",
          text: "Your view is a few things that fit, not a wall of everything",
        },
        {
          kind: "para",
          text: "Tasks are pushed toward the people who could plausibly take them, using what you've said about yourself and what the task asks for. Tasks needing something rarer — a specific skill, a language, someone who's done this before — get pushed a little harder, precisely because fewer people will recognise them as theirs.",
        },
        {
          kind: "para",
          text: "Sorting by effort is usually the most useful filter. A task's effort is one of one-off, ongoing, or owns-a-thing — what shape the work has — and every task also carries roughly how big it is, so you can tell a three-hour job from a three-week one without opening it.",
        },
        {
          kind: "heading",
          text: "Nobody is assigned work by default",
        },
        {
          kind: "para",
          text: "You claim things. Coordinators can suggest something to you and ask, but the default direction is that you pick what you take on. A task with nobody on it sits on the board being unclaimed, visibly, until someone claims it or a coordinator does something deliberate about it.",
        },
        {
          kind: "heading",
          text: "When a task is nobody's favourite",
        },
        {
          kind: "para",
          text: "Some tasks just don't appeal to anyone. That gets dealt with out loud rather than left to rot: turned into a shared recurring shift, swapped to someone who'd rather have it, or consciously absorbed or dropped by the people running things.",
        },
        {
          kind: "para",
          text: "A task that sits too long without an owner also starts flagging itself — quietly at first, then more visibly — so the group notices before it turns into a crisis. That's automatic. It isn't an accusation, and it isn't aimed at you if you're not the one holding it.",
        },
        {
          kind: "see-also",
          slugs: ["claiming", "working-a-task"],
        },
      ],
    },
    {
      slug: "claiming",
      title: "Claiming, asking to join, and shadowing",
      summary: "The three ways to get onto a task, and what happens when two people want the same one.",
      blocks: [
        {
          kind: "heading",
          text: "Claiming",
        },
        {
          kind: "para",
          text: "Claiming a task puts your name on it and makes it yours. It stays yours until you finish it, park it, or hand it back.",
        },
        {
          kind: "callout",
          title: "If you're coordinating, claiming gets one question first",
          text: "When someone who coordinates the branch tries to claim an unclaimed or flagged task, clicking Claim asks whether there's someone better suited to it first. You can still say yes. It's a question, not a wall — and it's the last moment in the flow where that check happens.",
        },
        {
          kind: "heading",
          text: "Asking to join",
        },
        {
          kind: "para",
          text: "Some tasks are already claimed. You can still put your name forward for one — request to join — and whoever's holding it can accept or decline. A decline is fine and needs no reason, though a short one is often appreciated.",
        },
        {
          kind: "para",
          text: "Declines are visible to coordination, not as a way of tracking who gets refused, but because a task with a logged decline on it is a different situation from a task nobody's offered to help with. If you keep getting declined and it keeps stalling, that's a pattern worth someone noticing.",
        },
        {
          kind: "heading",
          text: "Shadowing",
        },
        {
          kind: "para",
          text: "You can join a task specifically to learn it. Shadowing means watching and picking it up alongside whoever's currently doing it — you don't need to already be able to do the thing, and you don't need to ask anyone's permission beyond the ordinary join request.",
        },
        {
          kind: "para",
          text: "A shadow doesn't count as a full holder. It doesn't fill a slot the task needs filled, and it doesn't count toward whatever the task requires of its holders. The point is to be ready, not to be a spare pair of hands.",
        },
        {
          kind: "para",
          text: "Shadowing is also how people usually take over. If someone's holding something well and thinking about stepping back, having shadowed it makes you the obvious next person — though never an automatic one. The task still opens up for anyone to claim.",
        },
        {
          kind: "heading",
          text: "When two people want the same task",
        },
        {
          kind: "para",
          text: "Some tasks have a short browse period before claiming opens, so people can put their hand up. If only one person does, it's theirs automatically when the window closes. If several people do and the task has more than one slot, everyone gets a slot.",
        },
        {
          kind: "para",
          text: "If two people want a task that only has one slot, you're both told plainly, and you can see each other's contact details for exactly that reason. From there the realistic options are: one of you steps back, you open a second slot together, one of you joins as a learner instead, or you split the task into two smaller ones.",
        },
        {
          kind: "callout",
          title: "Orchard doesn't pick",
          text: "There's no tiebreak and no button that decides it for you. A genuine standoff between two people who won't budge is a human problem, and if it stalls, a coordinator will offer to help you work it out.",
        },
        {
          kind: "heading",
          text: "Asking for help when a task is bigger than expected",
        },
        {
          kind: "para",
          text: "If something turns out bigger than you thought, you have three honest options, and all three are fine. Open another slot on it. Break off one specific piece as its own task — a concrete \"I need help with this part\", which is far more useful than quietly struggling. Or hand the whole thing back.",
        },
        {
          kind: "see-also",
          slugs: ["finding-work", "working-a-task", "your-dashboard"],
        },
      ],
    },
    {
      slug: "working-a-task",
      title: "Working a task",
      summary: "Dates, notes, and handing work on — everything that lives on a task while you hold it.",
      blocks: [
        {
          kind: "heading",
          text: "Dates",
        },
        {
          kind: "para",
          text: "A task can carry as many dates as the work actually has, each one named by whoever adds it. A deposit due. A delivery expected. The day a headcount has to reach the caterer. There isn't one fixed due-date field, because real work doesn't have one deadline — it has several, and they mean different things.",
        },
        {
          kind: "para",
          text: "Each date is either a real calendar day, or described relative to something else — a number of days before or after a phase starts, or a percentage of the way through one. Relative dates are recomputed every time they're read, so if the season's dates shift, everything anchored to them moves with it instead of quietly going stale.",
        },
        {
          kind: "callout",
          title: "If you're not the holder",
          text: "You can add a date to a task you don't hold. It applies immediately, but whoever's holding it gets asked to confirm it. On a task nobody has claimed yet, anyone can add one outright — there's no one to ask.",
        },
        {
          kind: "heading",
          text: "Notes, comments and links",
        },
        {
          kind: "para",
          text: "Every task has a description, and the description says what the task is — not how to do it. That's deliberate, and it stays true. Whoever claims a task is free to do it their own way rather than following someone else's checklist.",
        },
        {
          kind: "para",
          text: "Separately from the description, and clearly marked as separate, each task carries three things anyone can add to at any time:",
        },
        {
          kind: "list",
          items: [
            "A summary — one evolving note for how this actually gets done, with a history of who changed it and when. This is where someone writes down the thing they wish they'd known.",
            "Comments — a conversation, open to anyone rather than just whoever's holding the task. Someone who did this two years ago can drop a tip on a task that's just reopened.",
            "Links — the actual artefacts: the order form, the sign design, where you bought them. A label and a URL, nothing more.",
          ],
        },
        {
          kind: "callout",
          title: "Why the description and the notes are separate",
          text: "If \"how we did it last year\" lived in the description, then eventually the description would be a pile of instructions that nobody claiming the task is obliged to follow, and the goal would be buried in the middle. Keeping them apart is what makes the goal stay readable.",
        },
        {
          kind: "para",
          text: "When you finish a task, Orchard asks whether there's anything worth capturing, and drops your answer straight into the comments. It's the easiest way in and it means the knowledge lands where the next person will look.",
        },
        {
          kind: "heading",
          text: "Parking a task",
        },
        {
          kind: "para",
          text: "If you're blocked, park it rather than leaving it to rot. Parking says you're still holding it but it's waiting on something, and sets a date to come back to it. On that date you get a nudge with a few options: an update, done, not yet, or hand it back.",
        },
        {
          kind: "para",
          text: "Missing that nudge isn't held against you — the task just flags itself again after a grace period. The system is forgiving about a missed check-in; it isn't indifferent to it.",
        },
        {
          kind: "heading",
          text: "Handing something on",
        },
        {
          kind: "para",
          text: "If you're stepping back, you can say so on the task. It's a separate signal from having a shadow, because a well-documented task might not need one and an undocumented one really should. Marking yourself outgoing also prompts you to finish the summary before you go, which is the moment people are most likely to actually write it.",
        },
        {
          kind: "see-also",
          slugs: ["finding-work", "claiming", "your-dashboard"],
        },
      ],
    },
    {
      slug: "asking",
      title: "Asking the community something",
      summary: "The four different ways to ask a question, and which one you want.",
      blocks: [
        {
          kind: "para",
          text: "There are four different mechanisms for asking people things, and picking the right one is mostly about how big a deal the answer is. Using the wrong one tends to make it get ignored.",
        },
        {
          kind: "table",
          head: ["", "For", "How it works", "How fast"],
          rows: [
            [
              "Input rounds",
              "Small questions about a task",
              "Queue up, then go out together once a week. Free text or a quick pick-one.",
              "Weekly, on a rhythm",
            ],
            [
              "Assemblies",
              "Decisions the community has to make",
              "Propose, add items, read the notice period, vote. Durations are yours to set.",
              "Days to weeks, your call",
            ],
            [
              "Scheduling polls",
              "Finding a time, not asking anything",
              "Paint the windows you're free; you see the overlap, not who said what.",
              "As fast as people reply",
            ],
            [
              "Forms",
              "A bundle of fields, answered once",
              "One submission, everything required. Can't answer half of it.",
              "Once",
            ],
          ],
        },
        {
          kind: "heading",
          text: "Input rounds — small questions, on a rhythm",
        },
        {
          kind: "para",
          text: "Anyone can put a question to a task they're working on. Free text, or a quick pick-one if it's a matter of preference — breakfast, say. It doesn't ping anybody.",
        },
        {
          kind: "para",
          text: "Instead, questions wait and go out together once a week. You get one reminder, one sitting where you answer everything you care about, and that's it. The answers come back to whoever asked, and stay visible on the task for anyone else who looks.",
        },
        {
          kind: "callout",
          title: "Nothing here is faster than the weekly rhythm, on purpose",
          text: "If something is genuinely urgent, an input round is the wrong tool — it will still be sitting in the queue. Use a message, or talk to your coordinator. The round exists so the small constant questions don't turn into a stream of pings to manage.",
        },
        {
          kind: "heading",
          text: "Assemblies — real decisions",
        },
        {
          kind: "para",
          text: "When the question is a decision the community needs to make — where something goes, whether a rule should change — anyone can call an assembly. It's slower and more deliberate than an input round, and it runs in phases: people add items, there's a notice period where everyone can read the agenda, then voting opens, then it closes and results are published.",
        },
        {
          kind: "para",
          text: "Each assembly sets its own timings. Something urgent can compress those windows right down; something structural can run for weeks. The durations are part of what you're proposing, not fixed by the platform.",
        },
        {
          kind: "callout",
          title: "A result is advice, not an instruction",
          text: "The platform counts what came back and publishes it. It never applies anything on its own — not a rule change, not a new branch, not a config edit. Turning a result into an actual change is a separate, deliberate thing somebody does afterwards. If you'd rather this never applied itself, that's exactly why.",
        },
        {
          kind: "para",
          text: "There's also no automatic notification for assemblies, by design. An assembly is a page with a link. If something's genuinely time-sensitive, the word goes out the way urgent things already go out — the group chat everyone actually reads.",
        },
        {
          kind: "heading",
          text: "Scheduling polls — finding a time, not asking a question",
        },
        {
          kind: "para",
          text: "Sometimes what you need isn't an opinion, it's a time where enough people can actually meet. You open a poll, people paint the windows they're free on a grid, and once everyone's submitted you get the overlap. You never see who said what until a slot is confirmed, which is the point — people give honest windows rather than guessing around what others have already said.",
        },
        {
          kind: "para",
          text: "A poll can either require specific people to all be free, or just want the best overlap above a floor. Branch calls use the second. Interview slots use the first, where missing one person means it isn't an option at all.",
        },
        {
          kind: "para",
          text: "Once a slot is confirmed it goes on everyone's calendar, and only for the people who actually submitted availability for it.",
        },
        {
          kind: "heading",
          text: "Forms — a bundle, answered once",
        },
        {
          kind: "para",
          text: "Some things genuinely are a set of fields you fill in together, all at once, with everything required. The application is the one you'll meet. Unlike the other three, a form is submitted as a single event — you can't answer half of it.",
        },
        {
          kind: "see-also",
          slugs: ["joining", "working-a-task"],
        },
      ],
    },
    {
      slug: "your-dashboard",
      title: "Your dashboard and your load",
      summary: "What the front page shows you, and how to see whether you're carrying too much.",
      blocks: [
        {
          kind: "para",
          text: "Your dashboard isn't a list you maintain. It's computed from what's actually true right now — what you hold, what's waiting on you, what's been declined, what's overdue — so it can't drift away from reality the way a to-do list does.",
        },
        {
          kind: "heading",
          text: "The one thing on it is worth reading",
        },
        {
          kind: "para",
          text: "It tells you how much you're carrying, next to the average for people actually active this season. Three quick errands and one sprawling multi-week job can both look like \"three tasks\" if all you're counting is tasks — so tasks carry a rough size as well as a shape, and that's what gets added up.",
        },
        {
          kind: "para",
          text: "By default this is yours alone. There's a toggle on your profile if you'd rather the rest of the camp could see it too, and it stays off unless you turn it on.",
        },
        {
          kind: "heading",
          text: "The community picture",
        },
        {
          kind: "para",
          text: "Zoom out past yourself and there's an aggregate view of the whole group — no individual numbers at all, just how work is spread right now. It exists so a group can see itself, not so anyone can be ranked. Anyone looking for a place to help can see where the gaps are, which is the same thing a coordinator would see from the other side.",
        },
        {
          kind: "para",
          text: "That view also shows each branch at a glance: on track, needs attention, or struggling. If a branch's tasks are quietly piling up, it stops being visible only to whoever coordinates that branch.",
        },
        {
          kind: "heading",
          text: "The same view when you're on site",
        },
        {
          kind: "para",
          text: "Once an event starts, the platform deliberately steps back. Everything locks into a read-only reference rather than something to manage, because being at camp shouldn't mean staring at a screen. Whoever's holding the task of running that bridge acts as the conduit — checking the app so it doesn't have to be everyone, writing it up on a whiteboard, flagging gaps in person. Information still flows both ways; it just moves through a person and a marker instead of a phone.",
        },
        {
          kind: "see-also",
          slugs: ["finding-work", "claiming", "privacy-and-access"],
        },
      ],
    },
    {
      slug: "joining",
      title: "Joining and coming to an event",
      summary: "Getting in, and what changes once you're in.",
      blocks: [
        {
          kind: "heading",
          text: "Getting in",
        },
        {
          kind: "para",
          text: "There are a few ways in, and which one applies to you is decided by who you know rather than by you.",
        },
        {
          kind: "list",
          items: [
            "The ordinary route: you apply, and the people handling recruitment read it and want to talk to you. Scheduling that call doesn't mean picking from one narrow slot — everyone gives their real availability and the system finds where enough of them overlap. You get two people from camp, not one person rubber-stamping a form.",
            "An invite from someone already here: a private, one-time link, tagged with your name so they can keep track if they're inviting a few people. It's a real signal that someone knows you personally, and depending on how much the community values that, it can lighten or skip parts of the usual process.",
          ],
        },
        {
          kind: "heading",
          text: "What happens next",
        },
        {
          kind: "para",
          text: "If it's a yes, you're paired with someone experienced who accompanies you from day one. Not a formality — a real person who notices if something about how you're settling in is worth checking on, and follows up as a person rather than as an automated flag. If you came in through someone's invite, they're the obvious suggestion, since you already have some relationship to build on.",
        },
        {
          kind: "heading",
          text: "Coming to an event",
        },
        {
          kind: "para",
          text: "For each event you say whether you're coming, maybe, or not, with arrival and departure dates if you know them. That's how the community knows how many people to plan for, and it works whether or not this community recruits anyone at all.",
        },
        {
          kind: "para",
          text: "Events can also have a cap on how many people they hold — a venue limit, most often. If yours does, returning members get a window to say they're coming before it opens more widely. That window doesn't hold room open forever; once it closes, everyone's competing for what's left on the same terms.",
        },
        {
          kind: "callout",
          title: "Some of what's asked about you isn't tied to one form",
          text: "An emergency contact, your pronouns, how you're getting there — these get asked once and then remembered, rather than asked again on the application and again at onboarding. They live on your profile where you can change them any time. And if you genuinely don't know yet how you're travelling, you can say so and it'll come back around closer to the date instead of forcing a guess.",
        },
        {
          kind: "para",
          text: "How much you can take on works the same way, with one difference: that answer changes across a season, since procurement and build week don't ask the same of anybody. So the question comes back for whichever phase is coming next, rather than being asked once in April and never again.",
        },
        {
          kind: "heading",
          text: "Events, branches and the thing that isn't required",
        },
        {
          kind: "para",
          text: "A community can also make branch membership — Fruit, Wood, whatever they're called — a real thing rather than just a label, which comes with an expectation rather than only an invitation: branch calls are something you're expected to turn up to. If you can't make a particular one, someone follows up with you. Not to guilt anyone — just so nobody quietly drifts out of contact without a person noticing.",
        },
        {
          kind: "para",
          text: "This is a real setting a community chooses, not a default. Some communities have no branches at all, and plenty of people would rather nobody tracked which ones they're in.",
        },
        {
          kind: "see-also",
          slugs: ["getting-started", "asking", "privacy-and-access"],
        },
      ],
    },
  ],
};
