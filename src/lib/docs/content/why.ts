import type { DocSection } from "../types";

// "Why it's like this" — the reasoning register, and the reason this
// section exists at all.
//
// docs/design_handoff_conventions/README.md's copy rule: UI copy
// answers *what does this control do*, never why it was built that way,
// what the design rejected, or which reading of the spec it implements.
// The reasoning goes in a code comment, next to the code, where the
// next person changing it will hit it.
//
// That rule is right, and it is being applied right now — across
// settings, tasks, and recruiting. But a code comment is only complete
// for the next person editing the code. This section is the other
// half: the same reasoning, rewritten for someone who will never open
// the source, somewhere they can choose to go.
//
// So these pages are the destination for a "why" that gets cut from a
// page. When a control stops explaining itself and starts just doing
// the thing, this is where the explanation moves to.
//
// What that means in practice, and what keeps this section from
// becoming the thing the copy rule was written against: one decision
// per page, named by the decision rather than by the feature, and
// every page answering the same three questions — what the alternative
// was, what it would have cost, and what tipped it. If a page can't
// say what the alternative was, it isn't a decision page yet, it's
// prose that wants to be somewhere else.
//
// Nothing here is read by the system and nothing here is a setting.
// It's documentation of intent, addressed to members and to whoever
// maintains this.

export const why: DocSection = {
  key: "why",
  title: "Why it's like this",
  summary:
    "Decisions that shape how Orchard behaves, and what the alternatives would have cost. The reasoning behind controls that don't explain themselves.",
  pages: [
    {
      slug: "why-the-interface-is-quiet",
      title: "Why the interface doesn't explain itself",
      summary:
        "The buttons don't say why they work the way they do — and that's on purpose. This is where that reasoning went instead.",
      blocks: [
        {
          kind: "para",
          text: "You may have noticed that most of this app doesn't tell you why it works the way it does. A setting doesn't explain what design it came from. A threshold doesn't justify its own placement. A control says what it does and stops.",
        },
        {
          kind: "para",
          text: "That's deliberate, and it was a considered reversal rather than a style choice — this app had pages carrying a great deal of explanation, and it was pulled back.",
        },
        {
          kind: "heading",
          text: "What was removed, and why",
        },
        {
          kind: "list",
          items: [
            "Design rationale. A paragraph telling you which doors are community-wide and which are per-event. You don't know per-event doors exist unless you need one, and if you do, the page that has them says so.",
            "Rejected alternatives. A note explaining that the interview stage used to either always happen or never happen. Reading a toggle, you can't act on the history of a toggle.",
            "Citations and self-justification. A sentence reassuring you that a particular number is a real choice and not a bug. Nobody was going to conclude otherwise from the number in front of them.",
          ],
        },
        {
          kind: "callout",
          title: "The reasoning is real and it didn't get deleted",
          text: "It moved. Every decision in this app is written down as a comment next to the code that makes it, explaining why it is that way — because the person most likely to break it by accident is the next person to edit it, and they won't be reading this section.",
        },
        {
          kind: "heading",
          text: "Where state and rationale are different things",
        },
        {
          kind: "para",
          text: "There's a real argument for more explanation than this: settings are read by people who didn't build the thing, and an unexplained number is a number nobody can reason about. Both are true, and the resolution is that what a setting currently is stays visible without opening anything, while why it was placed where it was does not.",
        },
        {
          kind: "para",
          text: "Someone deciding something needs to see the current value and what it does. They don't need the argument for why the control is in the second section rather than the first. So every card in Settings states what it's set to right now, and the argument lives in code and here.",
        },
        {
          kind: "callout",
          title: "The one exception",
          text: "A sentence of why stays on the page when the behaviour is counter-intuitive enough that you'd otherwise form a wrong belief about it — where a setting looks inert but isn't, or a value looks like it means the opposite of what it does. The bar is \"you'll think something false\", not \"there's a good reason\". Two lines maximum.",
        },
        {
          kind: "see-also",
          slugs: ["why-no-instructions", "why-nothing-is-applied-for-you"],
        },
      ],
    },
    {
      slug: "why-no-instructions",
      title: "Why a task doesn't come with instructions",
      summary: "Why a task description says what the job is and never how to do it.",
      blocks: [
        {
          kind: "para",
          text: "Every task description in Orchard is written as an outcome. \"Get the deposit dispute letter reviewed and sent\" is a task. A checklist of how to do that is not, and won't become one however the page is redesigned.",
        },
        {
          kind: "heading",
          text: "The reasoning",
        },
        {
          kind: "para",
          text: "Whoever claims a task is meant to be free to bring their own approach, not to follow someone else's checklist. And a checklist written by whoever did it last time is, at best, a description of what one person did once.",
        },
        {
          kind: "para",
          text: "The other half of it: putting how-to-do-it into the description eventually makes the description a contradiction. It defines the goal, and it also prescribes the method, and the two drift apart as soon as someone does it differently.",
        },
        {
          kind: "heading",
          text: "So the knowledge went next door, not in the bin",
        },
        {
          kind: "para",
          text: "How people actually did something turned out to be real, useful information, and hiding it in a separate system only guarantees it goes unused. So it lives on the task itself, in a section that is visibly not the goal: a running note anyone can improve, comments from anyone at any time, and links to the actual artefacts.",
        },
        {
          kind: "callout",
          title: "The boundary is the whole mechanism",
          text: "Notes are never folded back into the description, and the description is never edited to absorb them. If that boundary erodes, the goal-not-method principle becomes aspirational rather than real — and then every task does eventually accumulate a checklist nobody asked for.",
        },
        {
          kind: "see-also",
          slugs: ["working-a-task", "why-sharing-stays-bounded", "why-the-interface-is-quiet"],
        },
      ],
    },
    {
      slug: "why-claiming-can-ask-first",
      title: "Why claiming sometimes asks you a question first",
      summary:
        "Why a coordinator clicking Claim gets asked whether someone else would be better suited — and why it's a question rather than a wall.",
      blocks: [
        {
          kind: "para",
          text: "If you're coordinating the branch and you click Claim on an unclaimed or flagged task, you're asked whether there's someone better suited before it goes through. This isn't a rule about hierarchy. It's aimed at one specific habit.",
        },
        {
          kind: "heading",
          text: "What it's actually for",
        },
        {
          kind: "para",
          text: "Coordinators are not meant to be the fallback for a task nobody else wants. Left alone, a coordinator becomes the default answer — because it's easier than placing someone else, and because you stop noticing what you're already carrying when it's yours.",
        },
        {
          kind: "para",
          text: "Both routes end up with the same result: one person quietly accumulating work that was designed to be spread across a group. So the moment where someone is about to add to their own pile is where the question goes.",
        },
        {
          kind: "callout",
          title: "It's a question, and you can say yes",
          text: "There are three answers: really want it yourself, ask someone instead, or put it in front of the coordinators. Nothing is blocked. The real value is that the third option now actually works, which it didn't for a long time.",
        },
        {
          kind: "heading",
          text: "The two options that were quietly broken",
        },
        {
          kind: "para",
          text: "\"Ask someone instead\" used to write a name into a field that nothing in the app read back. The suggested person was never told, and the suggestion wasn't even visible to the coordinator who'd made it after a reload. It now sends a real nomination the person can accept, decline, or defer — and a decline releases the task.",
        },
        {
          kind: "para",
          text: "\"Put it in front of the coordinators\" used to raise a small private nudge that only this branch's coordinators could see. That's structurally incapable of doing the one thing the button claims: a coordinator who thinks someone else should take this needs to reach coordinators who don't cover their branch at all. It now uses the same escalation every coordinator sees, which does reach them — and is visible to the whole community, because that's a disclosure and shouldn't be dressed up as a quiet nudge.",
        },
        {
          kind: "callout",
          title: "Why the button was a wall for a while",
          text: "The check used to fire when a coordinator merely looked at a task, not when they tried to claim it. So it replaced the Claim button with a permanent banner on every unclaimed or flagged task in their scope, and the confirmation it was supposed to raise was unreachable through the interface entirely. It's triggered by the attempt now, so clicking the button is what asks.",
        },
        {
          kind: "see-also",
          slugs: ["claiming", "who-does-what", "why-nothing-is-applied-for-you"],
        },
      ],
    },
    {
      slug: "why-nothing-is-applied-for-you",
      title: "Why nothing here is ever applied for you",
      summary:
        "Why a vote, a tally, or a suggestion never changes anything on its own — and why an emergency contact is the one exception.",
      blocks: [
        {
          kind: "para",
          text: "Results come back. Nothing is applied. A community assembly closes and publishes what was said; the actual change to a rule, a branch, or a setting is a separate thing somebody does afterwards. A budget vote ranks the proposals; the person holding the budget decides what to fund and publishes a reason if they depart from the ranking.",
        },
        {
          kind: "heading",
          text: "Why",
        },
        {
          kind: "para",
          text: "Because the moment a platform starts applying results, it becomes a governance philosophy baked into the software, and every community running it inherits that philosophy whether or not they chose it. This way it's a tool you can point at whatever decision you actually have, rather than a vote-counting authority that quietly outranks however your community already decides things.",
        },
        {
          kind: "para",
          text: "There's a second reason. A tally is a summary of what people said, and a decision is a judgement about what to do. Those are different acts, and collapsing them means the record of what was decided stops being the record of why.",
        },
        {
          kind: "callout",
          title: "The one place that goes the other way",
          text: "Emergency access is the deliberate exception, and it works differently on purpose. A safety net that could quietly stop working because a flag lapsed wouldn't be much of a safety net, so anyone can surface someone's emergency-only contact in a real crisis without asking first. Both people are always told, and there's always a reason attached — even if it's added afterwards.",
        },
        {
          kind: "see-also",
          slugs: ["asking", "who-does-what", "sensitive-questions"],
        },
      ],
    },
    {
      slug: "why-sensitive-is-one-way",
      title: "Why marking a question sensitive can't be undone",
      summary:
        "Why one setting in Orchard has no off switch, no matter how many confirmations you'd want first.",
      blocks: [
        {
          kind: "para",
          text: "Almost every setting here can be changed back. One cannot: once a question is marked sensitive, there is no way to unmark it. It isn't behind a confirmation dialog. It isn't available at all.",
        },
        {
          kind: "heading",
          text: "Why not just ask twice",
        },
        {
          kind: "para",
          text: "Because turning it off would make every answer given so far readable by the entire community — including answers people gave at a time when the question was restricted to the kitchen team. At that point it isn't a setting anymore, it's a disclosure, and it happens to everybody who ever answered, not just to whoever clicks the button.",
        },
        {
          kind: "para",
          text: "No amount of \"are you sure?\" turns a disclosure into a setting. So the control doesn't exist rather than existing and warning you.",
        },
        {
          kind: "callout",
          title: "Why it isn't merely validated-and-refused",
          text: "A validation can be bypassed by any caller that doesn't go through the form. This is unrepresentable instead — the field genuinely isn't in the type at all, so there is nothing to bypass. The remedy is the one this app already has for questions generally: archive it and add it again, which leaves the old answers attached to the old question.",
        },
        {
          kind: "para",
          text: "Note the asymmetry with turning emergency access on, which does ask. Turning that off discloses nothing, so nobody's consent moves. Turning it on resets consent for everyone, so it asks. The difference isn't inconsistency — it's that one direction only ever reveals, and the other adds a reader.",
        },
        {
          kind: "see-also",
          slugs: ["sensitive-questions", "why-nothing-is-applied-for-you"],
        },
      ],
    },
    {
      slug: "why-sharing-stays-bounded",
      title: "Why people who want different things get different views",
      summary:
        "Why the roster, the board and the site plan each have several views rather than one, and why they aren't the same view for everyone.",
      blocks: [
        {
          kind: "para",
          text: "The directory is for finding people. The board is for finding work. The site plan is for placing things. The dashboard is for you. Each is a different lens on one set of data rather than a separate copy of it, which is why a task you saw on the board is still the same task on your dashboard.",
        },
        {
          kind: "heading",
          text: "Why they ended up this way",
        },
        {
          kind: "para",
          text: "Two of them had it the other way round for a while, and both were wrong for the same reason: the thing they'd absorbed was pushing the thing the page was actually for down a screen. The dashboard was carrying population charts, which pushed the actionable feed down. The community page was carrying both its own numbers and the charts, when the summary is a thing you read in a second and a page with something to do has room for one of the two, not both.",
        },
        {
          kind: "para",
          text: "The charts moved to the member directory, because an indicator is an aggregate about members, built from questions the members themselves asked and answered. The dashboard kept the numbers that are genuinely about you.",
        },
        {
          kind: "callout",
          title: "The rule underneath it",
          text: "Every number a page shows comes from the rows that page already loaded. A dashboard that says \"3 unclaimed\" above a list of four is one nobody trusts twice, and that kind of disagreement is what this shape exists to prevent.",
        },
        {
          kind: "heading",
          text: "And a number with no threshold under it",
        },
        {
          kind: "para",
          text: "Community indicators used to hide themselves below a minimum headcount, on the theory that a chart over three people discloses something. It guarded nothing: a published indicator is an aggregate of answers the whole community can already read one at a time, so a chart over three people discloses exactly what the same three people's rows in the data view already did.",
        },
        {
          kind: "para",
          text: "The floor was protecting a distinction that publishing had already made irrelevant, and it was an arbitrary number nobody had argued for doing the protecting — which is the worst combination a privacy control can have. So it went.",
        },
        {
          kind: "callout",
          title: "The case that looked like it needed one, and didn't",
          text: "\"1 of 3 declined\" in a small event does tell you one of three named people declined. But declining is a decision about a question everyone can read, not a fact about them. Someone who declined to give their pronouns isn't made identifiable by declining — they're made identifiable by answering, and answering is the thing that was never published.",
        },
        {
          kind: "see-also",
          slugs: ["your-dashboard", "access-follows-the-task"],
        },
      ],
    },
  ],
};
