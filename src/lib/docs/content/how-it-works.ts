import type { DocSection } from "../types";

// "How Orchard works" — the model register. What the machinery
// actually is, so the behaviour in "Using Orchard" stops being
// arbitrary. Drawn from docs/spec.md's member-visible concepts: Task,
// Requirement, Branch, Cycle, Member + Tier, Lifecycle & attention,
// Views, Transparency & access, Community settings & Admins, and
// docs/overview.md's "The core idea".
//
// This section is the one place a concept gets defined rather than
// demonstrated. The line it holds to: name the thing, say what it does,
// say who can see it. The reasoning about *why* the concept was shaped
// that way lives in "Why it's like this".

export const howItWorks: DocSection = {
  key: "how-it-works",
  title: "How Orchard works",
  summary:
    "The ideas the rest of the app is built on. Read this if something behaved in a way you didn't expect and want to know what the rule was.",
  pages: [
    {
      slug: "work-not-roles",
      title: "Work, not roles",
      summary: "Why everything here is built around tasks rather than positions.",
      blocks: [
        {
          kind: "para",
          text: "Most ways of organising a group start from positions. You're the kitchen lead, you're on the build team, and those come with everything traditionally attached to them. Orchard starts from tasks instead.",
        },
        {
          kind: "para",
          text: "A task is a real, sized, ownable piece of work with a clear picture of what done looks like. Nobody has a permanent job title here. What you currently own is a snapshot — you were the person doing the thing in March — and it changes when the work does.",
        },
        {
          kind: "callout",
          title: "The part that actually matters",
          text: "This is what lets someone hand off just part of what they were doing. There's no unit smaller than a whole role to delegate, which means the boring parts of a job you liked have no way to leave your desk. As tasks, they're just cards on the board that someone else can see and pick up.",
        },
        {
          kind: "para",
          text: "It also flips the default direction. Instead of being handed things by whoever's in charge, you claim work that fits you. And instead of a fixed hierarchy, coordination becomes about making sure everything has a willing owner — not about telling people what to do.",
        },
        {
          kind: "heading",
          text: "Three kinds of people this is built for",
        },
        {
          kind: "list",
          items: [
            "Self-starters, who find work themselves and need to be left alone to do it.",
            "People who are willing but won't start it themselves, and need a suitable opportunity actually put in front of them.",
            "People who start small and take on more if it goes well.",
          ],
        },
        {
          kind: "para",
          text: "All three are served by the same board, which is why the suggested tasks exist and also why they're never a restriction.",
        },
        {
          kind: "see-also",
          slugs: ["why-no-instructions", "finding-work", "access-follows-the-task"],
        },
      ],
    },
    {
      slug: "tasks-and-the-board",
      title: "Tasks and the board",
      summary: "What a task carries, the states it moves through, and what the board shows.",
      blocks: [
        {
          kind: "heading",
          text: "What a task carries",
        },
        {
          kind: "list",
          items: [
            "A title and description, in plain language, aimed at a newcomer.",
            "A branch — which category of work it belongs to, chosen by the community.",
            "Tags — free-form, set by the community, no fixed vocabulary.",
            "Effort: one-off, ongoing, or owns-a-thing. That's the shape of the work.",
            "Rough size on top of that: a duration bucket for a one-off, hours-per-week for something ongoing.",
            "Capacity — how many people it needs, which can be raised later.",
            "Requirements — who or what is eligible to take it.",
            "Dates, notes, comments and links, all optional.",
          ],
        },
        {
          kind: "callout",
          title: "Effort and size are two different things",
          text: "\"Write a rejection template\" and \"plan build week in detail\" are both one-off tasks. One is an afternoon and the other is a fortnight, and counting tasks alone can't tell those apart — which is why size is recorded separately and it's size, not task count, that gets added up when someone's load is worked out.",
        },
        {
          kind: "heading",
          text: "The states a task moves through",
        },
        {
          kind: "para",
          text: "Unclaimed, claimed, waiting, done. From unclaimed you claim it. From claimed you can park it — you're still holding it but it's blocked on something — and un-park it when it's moving again. Or you finish it. Or you hand it back, which returns it to unclaimed.",
        },
        {
          kind: "para",
          text: "Done is final, and the same as closing something. That's deliberate.",
        },
        {
          kind: "heading",
          text: "Requirements",
        },
        {
          kind: "para",
          text: "A task can carry eligibility conditions — you need to be in a particular tier, speak a particular language, have completed a particular task before, or hold some community-defined flag. Each one does one of three things:",
        },
        {
          kind: "list",
          items: [
            "Required of each person — nobody can claim it without satisfying this. For anything genuinely non-negotiable, like handling money.",
            "Someone on the team must have this — nobody's claim is blocked, but the task carries a visible line saying whether it's covered, and an uncovered one eventually flags like any other gap.",
            "Helpful, not required — purely a signal, it never blocks and never flags.",
          ],
        },
        {
          kind: "para",
          text: "Those three exist because the first attempt assumed everything should just block a claim, and that's too blunt. \"This task needs a Spanish speaker somewhere on it\" is a team need, not a personal bar on every person who might help.",
        },
        {
          kind: "heading",
          text: "How a task gets flagged",
        },
        {
          kind: "para",
          text: "Attention level is computed, not set by anyone. Three things feed it: how long it's been sitting, whether anything it depends on is finished, and where the current phase is. A soft flag is a nudge that something's gone quiet; a hard one is louder; escalated means a coordinator has deliberately put it in front of everyone who coordinates anything.",
        },
        {
          kind: "para",
          text: "Nobody's name appears on a card for merely being able to touch it. Your name on a task means somebody needs to do something about that task.",
        },
        {
          kind: "heading",
          text: "What the board shows",
        },
        {
          kind: "para",
          text: "Several ways of looking at the same tasks: by status as columns, by phase, by branch, and filtered by tag. Switching between them changes nothing about the data — it's one set of tasks read through different lenses, which is why a task you saw on one view is still there on another.",
        },
        {
          kind: "see-also",
          slugs: ["finding-work", "working-a-task", "claiming", "how-cycles-work"],
        },
      ],
    },
    {
      slug: "branches-and-tiers",
      title: "Branches and tiers",
      summary: "The two kinds of grouping a community sets up for itself.",
      blocks: [
        {
          kind: "heading",
          text: "Branches",
        },
        {
          kind: "para",
          text: "A branch is a category of work — Fruit, Wood, or whatever a community actually calls them. The set is defined by the community, not by Orchard, and a community with no use for them has none.",
        },
        {
          kind: "para",
          text: "Coordinating a branch is placement rather than doing. The product of coordinating is matched tasks, not completed ones — you're making sure everything has a willing owner, not producing the work yourself.",
        },
        {
          kind: "callout",
          title: "Being in a branch is a setting, and both settings are legitimate",
          text: "A community can make branch membership explicit — you're in Wood, there's a roster, and calls are something you're expected to attend. Or it can leave it emergent, where you hold Wood tasks and that's what makes you a Wood person. Explicit membership is what turns a branch call into an expected thing rather than an open invitation, and with it comes the obligation on people who miss one. Neither is the default-correct answer; it's a real choice with a real cost either way.",
        },
        {
          kind: "heading",
          text: "Tiers",
        },
        {
          kind: "para",
          text: "A tier is a named eligibility level with a criterion the community chose. Someone might be in a tier by length of membership, by having completed certain tasks, by having been around during a particular past event, or by having taken part in several events of a given kind.",
        },
        {
          kind: "para",
          text: "Tiers are how a task says \"this needs someone who's done this before\" without hardcoding who that is. A community with completely flat membership defines no tiers at all, and everything still works.",
        },
        {
          kind: "see-also",
          slugs: ["who-does-what", "tasks-and-the-board"],
        },
      ],
    },
    {
      slug: "how-cycles-work",
      title: "How events work here",
      summary: "Events, phases, and the switcher at the top of the page — and what happens when two are open at once.",
      blocks: [
        {
          kind: "para",
          text: "Orchard calls a discrete run of production an event. A full annual build, a reunion weekend, a different event entirely — same members, same branches, different task set and different timeline. The same mechanism covers all of them, which is why nothing about a task says \"this belongs to the big one\".",
        },
        {
          kind: "para",
          text: "A community with no use for discrete runs — a standing project, a coop that just keeps going — has one open-ended event that never closes, and never sees any of the event-management screens.",
        },
        {
          kind: "heading",
          text: "Phases and dates",
        },
        {
          kind: "para",
          text: "A big event is usually split into phases — recruiting, build, strike — so tasks and dates can be described relative to where the event is rather than to fixed days. A phase can say it starts two weeks before doors open, and if the real start date moves, the phase moves with it. You can also just drag something to a new day on the calendar and the underlying relationship is recalculated, rather than your change being silently lost the next time anything upstream shifts.",
        },
        {
          kind: "para",
          text: "None of this is required. An event with no dates at all works exactly as one with them does.",
        },
        {
          kind: "heading",
          text: "Starting one",
        },
        {
          kind: "para",
          text: "One person opens the handful of genuinely critical roles for the coming event. Opening one of those implicitly means \"I'll hold this if nobody else does\", which is the honest truth of how an event starts, made visible rather than assumed. Coordination roles fill in next, a kickoff call catches anything still open, and then everything else opens to everyone.",
        },
        {
          kind: "para",
          text: "You can start from last year's board as a head start, or from a smaller board built just for this occasion, or from nothing. A lighter event needs one critical role and can skip straight to the end of that sequence.",
        },
        {
          kind: "heading",
          text: "Two open at once",
        },
        {
          kind: "para",
          text: "Nothing assumes only one event is open. A community running a full season while also standing up a reunion weekend has both genuinely open and fully usable at the same time.",
        },
        {
          kind: "callout",
          title: "The switcher never moves you silently",
          text: "Your view scope — the event you're looking at — is yours, and it only changes when you change it. Following a link that points at a different event offers to switch you and always asks first. Your own outstanding items are never filtered by it, so narrowing your view to look at one event can never hide something you still need to act on.",
        },
        {
          kind: "see-also",
          slugs: ["joining", "your-dashboard", "tasks-and-the-board"],
        },
      ],
    },
    {
      slug: "who-does-what",
      title: "Who does what",
      summary: "Coordination, Admin, and support — all of them tasks, none of them titles.",
      blocks: [
        {
          kind: "para",
          text: "Everything that grants authority here is a task on the board, claimed and released like any other. Nobody has a role they carry around and pass to their successor. That applies to coordination, to Admin, to the conflict team, to running the budget, to everything.",
        },
        {
          kind: "heading",
          text: "Coordination",
        },
        {
          kind: "para",
          text: "A coordinator is whoever currently holds a task granted that way. What the grant covers depends on where the task sits: a coordination task in a branch covers that branch across all events, one placed in an event covers that event across all branches, and one left outside both covers the whole community. A community can run all three side by side, and one person's coverage is the union of what they hold.",
        },
        {
          kind: "para",
          text: "What a coordinator actually does is offer, check in, and escalate. They suggest a person they think fits a task. They notice when something's getting heavy. They can waive a requirement for one specific claim when nobody eligible is willing, with a reason, leaving a visible flag. And they can put a task in front of every coordinator at once when they think it needs someone else.",
        },
        {
          kind: "callout",
          title: "The one thing coordinators can't quietly do",
          text: "A coordinator is explicitly not the fallback person for a task nobody wants. If one tries to claim an unclaimed or flagged task, they're asked first whether there's someone better suited. It's a nudge, not a block — you can still take it — but it exists to stop a coordinator quietly absorbing everything, whether because it's easier than placing someone else or because they haven't noticed what they're already carrying.",
        },
        {
          kind: "para",
          text: "You can always start a conversation with your coordinator about a task with one button, without having to work out in advance whether you want help, a co-worker, or just to think out loud. It's a routing mechanic, not a chat system — the conversation happens wherever the community already talks, and Orchard just makes sure the coordinator knows you asked.",
        },
        {
          kind: "heading",
          text: "Admin",
        },
        {
          kind: "para",
          text: "Admin is the task that gates the community settings screen. It's the flagship case of a task that can't simply be claimed first-come: enough of the community has to back you first. However many people clear that bar is how many Admins there are — no fixed number to hit or defend, so a small gathering naturally ends up with a couple rather than a dozen.",
        },
        {
          kind: "para",
          text: "Whether a given event re-opens the role is nothing special. It re-opens if Admin was one of the things that event's task set included. A full season including it means a fresh vote of confidence; a quiet weekend that never included it just leaves whoever holds it holding it.",
        },
        {
          kind: "callout",
          title: "Not every setting weighs the same",
          text: "Branches, tiers, cadence, which modules are on — those are ordinary and expected to shift as a community changes, so Admins edit them directly. The bigger, harder-to-reverse ones — the membership model, whether to use phases at all — carry an expectation that the wider community weighs in through an assembly first, measured against the whole membership rather than just whoever's here this season. That's a strong norm rather than something the software enforces, and it's what stops the biggest decisions about how a community works being made by two or three people who happened to be around one quiet weekend.",
        },
        {
          kind: "heading",
          text: "Support",
        },
        {
          kind: "para",
          text: "Whoever holds the support task can view the app as another member, for troubleshooting. It's logged, it's strictly read-only — nothing can be changed while you're viewing as someone else — and it's bounded in other specific ways — there are places it deliberately doesn't reach, because the safety guarantee behind them has to hold against every access path, not just the ordinary one.",
        },
        {
          kind: "see-also",
          slugs: ["access-follows-the-task", "how-cycles-work", "privacy-and-access"],
        },
      ],
    },
    {
      slug: "access-follows-the-task",
      title: "Access follows the task",
      summary: "The default is open, and authority comes from holding a specific piece of work.",
      blocks: [
        {
          kind: "callout",
          title: "The short version",
          text: "The task board, the schedule, who holds what, what's flagged, and aggregate progress are all visible to every member. Something is restricted only when there's a specific reason for it. Authority to act comes from holding the task that needs doing — not from a title, and not from being in a branch.",
        },
        {
          kind: "heading",
          text: "Why that, rather than a role",
        },
        {
          kind: "para",
          text: "Because it points at a person you can name, and because it goes away when they stop. Claim a task that needs someone's dietary information to plan the menu and that information opens up along with it. Step away from the task and so does the access. Nobody needs to be handed a standing title just to get what one piece of work actually requires.",
        },
        {
          kind: "para",
          text: "This is also why a task's permissions travel with it and are visible on the task itself, rather than being assembled from a person's job description behind the scenes.",
        },
        {
          kind: "heading",
          text: "When a community wants something opened up",
        },
        {
          kind: "para",
          text: "Access-follows-the-task has one failure mode: a community that genuinely wants everyone to be able to evaluate applications, or draw the site plan, or close the budget, has no way to say so. The workaround — invent a task and claim it — isn't a setting anyone would find, and it makes a real board carry a fact that isn't a real job.",
        },
        {
          kind: "para",
          text: "So a community can mark a permission open to everyone. It's a floor, not a replacement. Holding the task stays exactly as meaningful as it was — it still decides who is on the hook, who gets notified, whose queue something lands in — and a community can hold both at once.",
        },
        {
          kind: "callout",
          title: "Opening a permission does not open a sensitive field",
          text: "These are separate decisions and deliberately stay separate. If a community links dietary information to the kitchen permission and then opens the kitchen to everyone, that is not a decision to make everyone's medical data readable. That's a disclosure, and it has to be made on purpose.",
        },
        {
          kind: "heading",
          text: "What stays private unless you share it",
        },
        {
          kind: "para",
          text: "Another member's contribution record, financial contributions, the answers to sensitive questions, and conflict reports. Each of these is private by default and shared deliberately — not as a global setting, but per thing.",
        },
        {
          kind: "see-also",
          slugs: ["who-does-what", "privacy-and-access", "sensitive-questions"],
        },
      ],
    },
    {
      slug: "privacy-and-access",
      title: "What other people can see about you",
      summary: "Your profile, your contact details, and your numbers — who each of them is visible to, and how to change that.",
      blocks: [
        {
          kind: "para",
          text: "There's no single privacy page to configure, because one global switch couldn't do the job honestly. Different things about you are for different people, and each carries its own visibility that you set on that thing.",
        },
        {
          kind: "heading",
          text: "Contact details",
        },
        {
          kind: "para",
          text: "Every way of contacting you that you add carries its own visibility: everyone in the community, only the people you share a task or group with, or emergency contacts only. Add as many as you like — phone, a chat handle, a second email — and set each one separately.",
        },
        {
          kind: "para",
          text: "You also choose which address the community's mail actually goes to. That's separate from who can read it: a contact method you can hide might still be the one you're emailed about logistics, and being able to see and change where your mail lands is a different decision from who reads it.",
        },
        {
          kind: "callout",
          title: "Which address is verified before it can be chosen",
          text: "An address has to be proven before the community's mail can be pointed at it — otherwise the setting would be a way to aim a whole community's emails at a stranger. Proof is a link sent to the address, and it's cleared again if you edit it. An address that arrived from someone else's guess isn't proof; clicking a link you were sent is.",
        },
        {
          kind: "heading",
          text: "Your profile and your tags",
        },
        {
          kind: "para",
          text: "Your profile is yours. Strengths, languages, how you'd rather work, how much you can take on — all of it editable by you at any time, and most of it feeding what gets suggested to you. The roster shows your name and a summary, not your whole profile.",
        },
        {
          kind: "heading",
          text: "Your numbers",
        },
        {
          kind: "para",
          text: "How much you're carrying is yours alone by default, and there's a toggle on your contribution page if you'd rather the rest of the camp could see it too. It stays off until you turn it on.",
        },
        {
          kind: "para",
          text: "Where a coordinator can see you're near your limit is a coarser signal by default — enough to know not to pile on, without publishing a figure you didn't agree to. If you'd rather they saw the actual number, that's a setting on the same question where you answer it, not a hunt through a general settings page.",
        },
        {
          kind: "para",
          text: "Separately: a coordinator can always see whether you've answered for the current phase at all, whatever your visibility setting. Whether an answer exists is a different piece of information from what it says, and it's what lets someone check in with you rather than leaving you blank on a list.",
        },
        {
          kind: "callout",
          title: "Being off a board isn't the same as being anonymous",
          text: "A signal raised on a task in a community small enough that two or three people could plausibly have sent it identifies itself by arithmetic, whatever the wording says. It's the right tool for a quiet nudge. It isn't a channel for anything you'd need to be protected from being traced.",
        },
        {
          kind: "heading",
          text: "When something is wrong",
        },
        {
          kind: "para",
          text: "If you've reported a concern and someone you'd rather not handle it happens to be on the team, you can rule them out entirely — properly out, not \"denied access\" with the shape of the hole still visible. And if a team member realises they're too close to something to be neutral, they can step themselves out, or someone else on the team can step them out, before they ever see it.",
        },
        {
          kind: "see-also",
          slugs: ["sensitive-questions", "access-follows-the-task", "your-dashboard"],
        },
      ],
    },
    {
      slug: "sensitive-questions",
      title: "Sensitive questions and consent",
      summary: "How health, dietary and personal information is asked for, restricted, and given back.",
      blocks: [
        {
          kind: "para",
          text: "Some of what a community asks people to share is genuinely sensitive: a health condition, an allergy, who you love, who to call in an emergency. None of it is collected without you being asked specifically, for that one purpose.",
        },
        {
          kind: "heading",
          text: "Asked separately, on purpose",
        },
        {
          kind: "para",
          text: "Every sensitive question is asked with three things stated at the moment you answer it, above the field rather than buried in a settings screen: who can read it, whether a crisis could reach it, and whether your answer is counted in a figure published about the community. Each of those was either invisible or somewhere else entirely, and you can't meaningfully choose about sharing if you don't know who's on the other side of it.",
        },
        {
          kind: "para",
          text: "Where the community has set up more than one group who can read a question, you get one box per group rather than a single one covering everybody. That means you can accept the first and decline the second, which a single combined box doesn't let you do.",
        },
        {
          kind: "para",
          text: "Every sensitive question also offers a decline. Declining is a real answer, not a gap, and it isn't counted as though you'd said no.",
        },
        {
          kind: "heading",
          text: "Taking it back",
        },
        {
          kind: "para",
          text: "You can withdraw any answer whenever you want. When you do, whoever could see it actually loses access — not just a note saying you'd rather they hadn't. Some questions let you reduce your answer to yourself and emergency contacts only, without removing it entirely.",
        },
        {
          kind: "heading",
          text: "Widening who can read",
        },
        {
          kind: "para",
          text: "If a community later adds a group who can read a question you've already answered, that doesn't reach your existing answer. You get asked, separately, whether to extend sharing to them. No means no, and it isn't reversible against you later.",
        },
        {
          kind: "callout",
          title: "Marking a question sensitive is a one-way door",
          text: "You can mark a question sensitive when it's created. You cannot unmark it. Turning it off would make every answer given so far readable by the whole community — including answers people gave while it was restricted. So it can't be done at all, rather than being done behind a confirmation dialog. The way to change it is to archive the question and add a new one, which leaves the old answers attached to the old question.",
        },
        {
          kind: "heading",
          text: "Emergency access is the exception, and works differently",
        },
        {
          kind: "para",
          text: "If a contact method is set to emergency-only, any member can surface it when something's genuinely wrong, without asking first. The person it's about is told, every use is logged, and you can add the reason afterwards if the moment didn't allow for it. A question marked for emergency access can be revealed too, but only where the member agreed to that for their own answer, and a reason is required before anything like that is shown.",
        },
        {
          kind: "callout",
          title: "This one isn't a revocable permission, on purpose",
          text: "A safety net that could quietly stop working because a flag lapsed wouldn't be much of a safety net. So a contact method set to emergency-only doesn't depend on the same ongoing consent as everything else: choosing it is the deliberate act, and the log is the accountability. Answers are the stricter case, and only reach this path with the member's own agreement for that answer. The screen where you choose it says plainly what you're agreeing to.",
        },
        {
          kind: "see-also",
          slugs: ["access-follows-the-task", "why-sensitive-is-one-way", "privacy-and-access"],
        },
      ],
    },
    {
      slug: "the-other-pieces",
      title: "The other pieces",
      summary: "Calendar, budget, programme, site plan, shifts, kitchen, recruiting, conflict, and feedback.",
      blocks: [
        {
          kind: "para",
          text: "Everything past the core task-and-member engine is switched on or off by the community, and a community that switches one on gets the whole thing rather than a reduced version. You may not have all of these, depending on what's been enabled here.",
        },
        {
          kind: "heading",
          text: "Calendar",
        },
        {
          kind: "para",
          text: "Everything with a date in one place: phase boundaries, task milestones, branch calls, programme slots, deadlines, and any birthdays people have chosen to share. Events you create are yours alone until you share them, and sharing is a real invitation that each person accepts or declines for themselves — nobody else decides on your behalf.",
        },
        {
          kind: "heading",
          text: "Budget",
        },
        {
          kind: "para",
          text: "Anyone submits a proposal with a real cost breakdown. The owner closes proposals to voting, everyone ranks the full list, and the results show totals, cost per member, and what the top of the ranking would add up to. The owner then produces a final budget, which the ranking informs but doesn't determine — and if the final set departs from the ranked order, a reason is published explaining why.",
        },
        {
          kind: "heading",
          text: "Programme",
        },
        {
          kind: "para",
          text: "Sessions and workshops the community runs for itself. Anyone proposes one, the owner reviews and flags genuine slot conflicts, competing proposals get invited to sort it out between themselves, and the schedule publishes once conflicts are resolved.",
        },
        {
          kind: "heading",
          text: "Site plan",
        },
        {
          kind: "para",
          text: "Laying out a real place, to real-world scale — a site you import or hand-draw and calibrate, zones you name, and individual things placed inside it. Move your own tent and the change applies immediately, is flagged as awaiting review, and keeps the previous position so it can be put back. You're never blocked, and it's never quietly final either.",
        },
        {
          kind: "callout",
          title: "Moving your tent notifies the others in it",
          text: "That's visibility, not sign-off. Nobody has to approve your edit before it takes effect, but the people sharing the space are told rather than finding out by walking past it.",
        },
        {
          kind: "heading",
          text: "Shifts",
        },
        {
          kind: "para",
          text: "The recurring stuff that never finishes — cooking, cleaning, safety walks — kept deliberately separate from one-off tasks, because a shift series is a standing commitment and a task is a piece of work with an end.",
        },
        {
          kind: "heading",
          text: "Kitchen",
        },
        {
          kind: "para",
          text: "Menu planning, where each meal is a dated set of dishes, and every dish is a recipe that scales to however many people are expected. Amounts and the shopping list are worked out from the recipes rather than typed in twice. Anyone can suggest a dish; the kitchen holder adopts or declines it with a reason. Allergies reach the planner through the same access rules as everything else, never by being broadly readable.",
        },
        {
          kind: "heading",
          text: "Recruiting",
        },
        {
          kind: "para",
          text: "Where bringing people in is a real evaluated process: applications, conversation scheduling, decisions, and someone accompanying each new member. The outcome of an application is a decision your community's own rules produce, configured by you, rather than a fixed matrix baked in.",
        },
        {
          kind: "heading",
          text: "Conflict",
        },
        {
          kind: "para",
          text: "A low-friction way to say \"I need to talk to someone\" — you don't have to write an account of it first. You can rule out specific people from handling it entirely, and the exclusion is real invisibility rather than a visible permission denial. Team members can also step themselves out, or step each other out, when they're too close to it.",
        },
        {
          kind: "callout",
          title: "One honest limit",
          text: "That invisibility only holds if the exclusion happens before the person has opened the report. After they've read it, they can't be un-shown it. Worth knowing rather than assuming a stronger guarantee than exists.",
        },
        {
          kind: "heading",
          text: "Feedback",
        },
        {
          kind: "para",
          text: "After an event wraps, a survey anyone can fill in, and a standing task for actually reading the responses and following up. It's a survey, not an automatic escalation — a human decides every time what a response means.",
        },
        {
          kind: "see-also",
          slugs: ["how-cycles-work", "who-does-what", "joining"],
        },
      ],
    },
  ],
};
