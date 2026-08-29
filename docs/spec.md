# 🌳 Orchard — Platform Spec (v0.4)

*A general-purpose engine for task-based, distributed-effort coordination. Not tied to any one project. Peach Please is the reference implementation this was extracted from — see [Relationship to Peach Please](#-relationship-to-peach-please) at the end.*

*This document is meant to move toward buildable work. Where a decision genuinely needs to be made before code gets written, it's called out explicitly rather than left implicit.*

---

## 🌱 Why this exists

Any group of people building something together through voluntary, distributed effort hits the same handful of problems, regardless of what they're building:

- Willing people don't know what needs doing, or don't self-select into it.
- The person coordinating ends up doing more chasing than the work itself would take.
- Nothing is visible until it's a crisis — a task quietly stalls and nobody notices until the deadline.
- Institutional knowledge lives in one or two people's heads and evaporates when they step back.

Orchard is **work-based, not role-based.** The atomic unit is the *task*, not the *position*. Roles exist only as a description of the tasks a person currently owns — a snapshot, never a fixed job.

It serves three participation types:

- **Self-starters** — find work themselves. Get out of their way.
- **Latent energy** — willing but won't self-initiate. They need a fitted opportunity handed to them.
- **Growth** — start small, take on more if it goes well.

This holds for a burn camp. It also holds for a housing cooperative, a community renovation project, a mutual aid network, or a small distributed team building something with no physical event at all. What changes between those isn't the mechanism — it's the *shape* of the community running it. Orchard's job is to make that shape configurable rather than assumed.

---

## 🍑 Core concepts

### Community

One deployed instance of Orchard, configured for one group. Everything below — branches, tiers, phases, tasks — belongs to a Community. This is a first-class entity from the start, even in a single-community deployment, so the hosting model (see [Architecture](#-suggested-architecture)) doesn't have to be decided before the data model is.

### Task

The atomic unit of work. Same shape as before, generalized, now including mechanisms that were designed in the Peach Please spec but compressed out of the first draft of this document:

| Field                   | Purpose                                                                                                                                                                                              |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Title + description** | Plain language. Newcomer-readable. Goal, not steps.                                                                                                                                                  |
| **Branch**              | Which category of work (community-defined, see below).                                                                                                                                               |
| **Cycle**               | Optional. Which production cycle this task belongs to, if the Community uses cycles (see Cycle below). Standing tasks can have no cycle at all.                                                      |
| **Phase**               | Optional. Only meaningful if the task's cycle has a phase spine.                                                                                                                                     |
| **Tags**                | Free-form, community-defined (replaces the old fixed strength-tag list).                                                                                                                             |
| **Effort**              | One-off · ongoing · owns-a-thing.                                                                                                                                                                    |
| **Effort magnitude**    | Duration bucket (One-off) or hours/week (Ongoing, Owns-a-thing) — how much, not just what shape. See **Effort magnitude**, below.                                                                    |
| **Status**              | Unclaimed · Claimed · Waiting · Done.                                                                                                                                                                |
| **Capacity**            | Number of people the task needs. Default 1. Owner can raise it later if the task turns out bigger than expected — a way to ask for help without releasing or splitting the task.                     |
| **Openness**            | Open (anyone eligible joins without asking) · Request (default — join requests go to the owner) · Coordination-approved (new joiners need branch-coordination approval, for sensitive-access tasks). |
| **Browse period**       | Optional window, set on creation, before claiming opens (see Browse mode below).                                                                                                                     |
| **Dependencies**        | Other tasks that must finish first.                                                                                                                                                                  |
| **Parent task**         | Optional. Set when this task is a subtask broken off from a larger one.                                                                                                                              |
| **Next check-in date**  | Owner-set, drives the Waiting nudge.                                                                                                                                                                 |
| **Requirements**        | Zero or more eligibility predicates (see Requirement below).                                                                                                                                         |
| **Critical**            | Boolean (was "obligatory"). Empty owner on a critical task escalates hard, not just flags.                                                                                                           |
| **Attention level**     | Computed: OK · soft-flag · hard-flag · escalated.                                                                                                                                                    |

Tasks are written as outcomes, not procedures — this stays true regardless of domain. "Get the deposit dispute letter reviewed and sent" is a task; a checklist of how is not.

### Proposing tasks

Anyone can propose a task with just a title and rough description — no need to know its branch, tags, or criticality up front. Two optional fields keep it moving: a **"I'd like to claim this"** checkbox (activates and assigns in one step), and an **"I'd suggest this person"** field with an optional note (surfaces a task that fits someone without assigning it unilaterally). Whoever does branch coordination fills in the missing metadata and activates it. A proposal that sits unreviewed too long flags in the coordination queue the same way an unclaimed task does.

### Effort magnitude

Effort (One-off · Ongoing · Owns-a-thing) describes a task's *shape*, not its *size* — "write a rejection template" and "plan build week in detail" are both One-off, but one's an afternoon and the other's a multi-week effort. Task count alone can't tell someone's real load apart from someone else's, and neither can Effort on its own. Effort magnitude adds the missing size, in whichever unit actually fits the shape:

- **One-off tasks** get a duration bucket, set by whoever's creating or claiming the task: **under an hour · a few hours · half a day · multi-day.** A bucket rather than free-form hours or an abstract 1–10 scale, for the same reason Effort itself is a small fixed enum — it stays comparable across the whole board without needing a shared mental rubric for what a "6" means.
- **Ongoing and Owns-a-thing tasks** get an hours/week estimate instead, because they don't have a natural total — they run for as long as the role does. This is the number that composes into a load view: you can sum weekly hours across everything someone currently holds, you can't sum a pile of duration buckets.
- If a task's load genuinely isn't flat across the cycle (an Owns-a-thing role that's light in Recruiting and heavy in Build), the owner can set a different hours/week per phase instead of one flat number. Optional — a flat number is the default and is fine for most tasks.

Same precedent as Capacity (people needed): owner-estimated, revisable at any time, never a platform-computed guess.

**How this feeds weekly load.** A currently Claimed (not yet Done) task counts its Effort magnitude fully toward the current week's load: Ongoing/Owns-a-thing at their hours/week rate for as long as they're held, One-off as a flat one-time addition of its duration bucket for each week it's Claimed, rather than spread across a longer window. The moment a task is marked Done, it drops out of current load and becomes historical instead — counted in **Contribution tracking** (below) against the week it was actually marked Done, not the week it was claimed or started.

### Multi-slot & collaborative tasks

Tasks with capacity > 1 stay open to additional claims until every slot fills. One slot can optionally be flagged as the **coordination slot** — keeping the group aligned, not a rank and not a blocker: if nobody claims it, the group self-organizes, and if the task stalls, coordination can see that on the dashboard. An existing owner can also **nominate a specific person** for an open slot — a peer-initiated fitted ask, the same mechanism coordination uses, just triggered by a collaborator instead. Coordination tasks themselves are multi-slot by default, with no rank between co-holders — a lightweight community "thumbs up" (not a vote) can help surface good fits during a browse period, but the bar to join stays low.

A task can also carry a different kind of extra slot — a **shadow** — aimed at building competence rather than sharing this cycle's load. See Shadow slots & succession, below.

### Subtasks

Any task owner can break off a piece of their task as its own card. This does two things: lets someone who's claimed more than they can handle hand off a specific piece without releasing the whole task, and makes the structure of complex work visible. A subtask left unclaimed by its creator is a concrete, grabbable signal that they need help — more specific than releasing the whole task, more honest than quietly struggling. It's the structural equivalent of the "talk to my coordinator" button.

### Shadow slots & succession

A task can carry, in addition to its ordinary slots, a **shadow** slot — someone joining specifically to learn how the task is done, not to carry equal weight this time. A shadow claim is exempt from the task's `individual_gate` Requirements by design (that exemption is what makes it shadowing rather than just an easier version of the real thing), doesn't count toward the task's capacity, and doesn't get relied on to cover a `group_coverage` need — the point is building toward being able to do those things, not already doing them.

Two related but genuinely separate signals, worth keeping apart rather than bundling into one flag:

- **Shadowing** — someone learning alongside the current holder(s), useful any time a task benefits from redundancy or a second set of eyes, whether or not anyone's leaving.
- **Outgoing** — an owner declaring they don't intend to hold this task again next cycle. This can happen with or without a shadow in place — a well-documented task might not need one; a task with no documentation at all really should have one before the owner leaves.

An owner can set either, both, or neither. Setting **outgoing** triggers the same kind of nudge as the existing "anything worth capturing?" Done-prompt (see Task notes), but earlier and more pointed — a direct prompt to actually finish the task's wiki summary before handing it off, since this is peak motivation to write it down and the platform's whole bet on task notes depends on that actually happening rather than staying aspirational.

**Carrying forward.** When a task with a filled shadow slot gets cloned into the next cycle (see Cycle), the new task's `suggested_member_id` is pre-filled with the shadow — reusing the exact field the task-proposal flow already has for "I'd suggest this person," not a new mechanism. It's a suggestion, not an assignment: the new task still opens through the ordinary claim process, the shadow just doesn't have to be the one to remember to raise their hand first. This only applies to the "clone from the immediately previous cycle" path, since a shadow's relevance doesn't travel into a generic, cross-community Task Pack. Spatial planning's own Placements get an analogous, independently-scoped carry-forward option on the same path — see **Cloning across cycles**, under Spatial planning.

**Resolving eligibility over time.** A `completed_task` Requirement is satisfied by having held *or* shadowed the referenced task — the platform doesn't distinguish which, since both represent having actually seen it done. Whether someone needs a full hold or a shadow to move on to something else is a judgment call left to whichever later Requirement actually specifies it, not something this mechanism tries to adjudicate on its own.

### Browse mode

High-stakes or skill-specific tasks can get a browse period on creation — a window before claiming opens where the task is visible and people express interest, without turning it into an election.

- **One person interested** → auto-claims when the window closes. No action required — this makes expressing interest a real commitment, which discourages speculative interest-collecting.
- **Multiple people, multi-slot task** → everyone auto-claims a slot, up to capacity.
- **Multiple people, single-slot task** → a short resolution window opens. Both parties are notified and can see each other's profile and contact details for exactly this purpose — have a conversation and figure it out. The options on the table: one retracts (no acknowledgment needed), both agree to open a second slot, one proposes the other join as a **shadow** instead of a co-equal claim (see Shadow slots & succession), both agree to **split** the task into two subtasks instead of contesting one, or — if the window lapses with no movement — branch coordination facilitates. If one party has already held or shadowed this task before and the other hasn't, that history is shown as a factor to weigh, not an automatic tiebreak. The platform never picks a winner, and a genuine impasse between two people who won't budge is a human problem, not a case worth engineering a system resolution for.

### Task openness

Set on creation, adjustable by the owner: **Open** (anyone eligible joins freely), **Request** (default — join requests go to the owner to accept or decline), **Coordination-approved** (new joiners need branch-coordination sign-off, for tasks with sensitive-access implications), or **Community-endorsed** (claiming requires gathering a threshold number of endorsements from other members before the claim confirms — see Endorsement-gated tasks, below).

### Endorsement-gated tasks

Some tasks carry enough trust or consequence that a personal eligibility check (Requirement) isn't really the question — the community itself should have a say in who takes them on, not just whether they're qualified on paper. **Community-endorsed** openness is built for exactly this, and it's meant to generalize beyond the one case that motivated it (see Community settings & Admins, below) to any task a Community decides deserves the same treatment.

- **How it works.** During a task's browse period, expressing interest doesn't create an ordinary claim — it creates a **candidacy**. Other members can add their endorsement to a candidacy at any point while the window's open. A candidacy that clears the task's endorsement threshold before the window closes converts into a real claim; one that doesn't, doesn't — the same honest "real gap, not a silent failure" treatment any other unfilled critical task already gets.
- **Uncapped by default.** Unlike an ordinary task, capacity for a Community-endorsed task defaults to unlimited — everyone whose candidacy clears the threshold gets a slot. This isn't a workaround, it's the point: the size of the resulting group is *computed* from how many people the community is actually willing to back, the same "computed from real state, not a fixed target" principle the Dashboard already uses, rather than an arbitrary seat count the platform would otherwise have to defend or backfill. A Community that genuinely wants a hard cap can still set one — but that reopens the ordinary multi-candidate contest problem Browse mode's single-slot resolution already exists for, so it's a deliberate, explicit choice, not the default.
- **Threshold is per-task**, set the same way a browse period already is — a fixed number, or (for a task tied to a cycle-relative population, like Admins below) a share of some reference group. Communities will want to tune this by feel; it's not something worth hardcoding here.
- **Not the same lever as a Requirement.** A `tier` Requirement checks whether someone's personally eligible to even try; Community-endorsement checks whether enough of the community actually wants them holding it once they have. The two compose normally — a task can require Tier "Experienced" *and* be Community-endorsed, same as any Requirement stacks with any openness setting.

### Branch

A category of work. In the reference implementation these were Seed / Fruit / Blossom / Wood. A Community defines its own set at setup — a housing coop might use Finance / Maintenance / Governance / Community; a software project might use Backend / Design / Docs / Ops. Branch coordination is placement, not doing: the coordinator's product is *matched tasks*, not completed ones.

**Membership is a real fork, not a settled default — this was flagged as an open question in the original spec and stayed open too long.** A Community chooses, at setup: **emergent** (a member is a Fruit person because they hold Fruit tasks — no formal joining, no roster), or **explicit** (members choose or are assigned a branch on joining, creating a real roster). Explicit membership is what makes a branch call an *expected* thing to attend rather than just an open invitation, and it's the one that carries real design weight:

- **Branch calls are Scheduling polls** (see Scheduling polls) — maximize-attendance-above-a-threshold, not must-overlap-everyone, since a branch call shouldn't fail to happen just because one member can't make it. With explicit membership, the poll's natural audience is the branch roster rather than an ad hoc target list. A Branch can also set its own defaults for whether its calls start with an open agenda, an expected summary, and read-confirmation — see Call agenda & summary under Scheduling polls — so a recurring branch call doesn't need reconfiguring from zero each time.
- **Facilitation and follow-up are their own tasks, not assumed coordinator work** — scheduling the call, running it, and following up with anyone who missed it are discrete, ownable tasks. The follow-up is one task per call ("follow up with absentees from [date]'s Wood call"), not one per absent person — the owner works through the list as the actual content of the task, and it's a suggested action after the fact, not something that silently creates and assigns itself.
- **Attendance is recorded, not assumed** — after a call, whoever ran it marks who actually showed up against the roster. That's what a follow-up task has to work from.
- **Non-response gets the same treatment before the call even happens.** A branch member who hasn't submitted availability for a poll gets a nudge; if that goes nowhere, "follow up with members who haven't given availability for [call]" becomes its own task too — separate from the post-call absentee follow-up, since not responding to a poll and not showing up to a confirmed call are different situations worth different handling.

Emergent membership skips all of this by design — no roster means no expected attendance, which is the right choice for a community where branch identity really is just "the kind of tasks you tend to do." Peach Please's own original design leaned hard toward explicit, given how much of the above was already built out around it.

### Cycle (optional)

A discrete run of production, generalized from what the reference implementation calls a "season" — the word doesn't travel well, since the same community might run a full annual cycle, a lighter mini-cycle for a reunion weekend or a fundraiser, or a one-off cycle for attending a different event entirely, all with the same members and branches but a different task set and timeline. Phases belong to a Cycle, not directly to the Community, since different cycles can genuinely need different phase spines — a fundraiser doesn't need a Build phase the way a full event does.

A Community that has no use for discrete production runs — an ongoing coop, a standing project — simply runs one open-ended default Cycle that never closes, and never sees any of the cycle-management UI below. Turning cycles on is what unlocks it.

**Starting a cycle:**

- **Who can start one** — Community-configured, typically gated by a Tier (e.g. only "Experienced" members can initiate) rather than open to anyone. This reuses the same Requirement mechanism tasks already use for claim eligibility, applied to a different action.
- **Sourcing the task set** — the initiator chooses: clone the most recent prior cycle's task set, import a different Task Pack (a lighter one for a mini-cycle, say), or start blank and curate as they go. Cloning a previous cycle is, under the hood, the same mechanism as importing a pack — the prior cycle's board is exported as an implicit pack and imported into the new one. No separate feature needed for each.
- **Kickoff sequence** — a three-round opening, restated in full below since it's real, load-bearing design, not just a nice-to-have:
  1. **Round 0 — the critical coordination tasks** (community-tagged, e.g. `backstop`). The initiator opens these for browse, which implicitly registers their own interest — they become the fallback holder if nobody else claims. This makes the bootstrap explicit and honest: someone has to start the engine.
  2. **Round 1 — all coordination and critical tasks.** Once Round 0 fills, the rest of coordination and critical tasks open for browse. Whoever holds the critical coordination role organizes a kickoff call to fill anything still unresolved — the safety net. An unfilled critical task even after this call triggers a hard, cycle-wide warning; a cycle shouldn't properly start with a real gap in it.
  3. **Round 2 — everything else.** After the kickoff call, the remaining tasks in the cycle open for general browse.

This scales down cleanly for a light cycle — a reunion weekend might have one Round 0 task and skip straight to Round 2 — without needing a different mechanism, just a smaller task set.

**Participation & capacity.** Each Cycle can optionally define a `capacity` — a cap on how many members it can hold — with **Participation** (per cycle, per member: coming / maybe / not-coming, arrival date, departure date, a note) as the record of who's actually planning to be there. This is core, not gated behind Recruitment — even a community that never recruits new members wants to know how many people are actually coming, for its own planning, and it's what Contribution tracking's arrival/departure context already assumes exists.

Where this meets Recruitment (only relevant if that module is on): a Cycle can define a **returning-priority window** — a period at the start of a cycle, before general recruitment opens, where existing members declare their Participation against the cycle's capacity first. Once that window closes, recruitment opens against whatever capacity remains (see Recruitment) — but a returning member who hasn't declared yet doesn't lose the ability to, they're just now competing for the same shrinking pool of room as new applicants, first-come rather than reserved. If capacity fills before the window even closes, that's visible the same way any other gap or limit here is — not a special case, just room hitting zero early.

**Cycle type (optional).** A Community can optionally group its Cycles into named types — Season, Reunion, Workday, whatever distinction actually matters to them. This exists mainly so a Tier criterion can count occurrences of one *kind* of cycle without a completely different kind of gathering padding the number (see Member + Tier, below) — and it's a deliberately separate question from whether a given cycle resets Admins, which turns out not to need a type at all (see Community settings & Admins). A Cycle's type is just a label plus, optionally, a suggested Task Pack to start from — a nudge, never an enforced structure, consistent with how Task Pack already works everywhere else. A Community that never bothers with it just leaves every Cycle untyped, and nothing about it changes.

### Member + Tier

A Member belongs to exactly one Community. **Tier** replaces the old hardcoded "experienced Peach" boolean. A Tier is a named eligibility level with a *criterion* the Community chooses at setup:

- **Manual** — leads designate members into the tier by hand.
- **Tenure-based** — member for ≥ N days/months.
- **Completion-based** — has completed task(s) tagged X, or completed ≥ N tasks total.
- **Cohort-based** — was active during a past cycle (this is what "experienced Peach" actually was — a special case of completion-based, not a universal default).
- **Cycle-type-count-based** — had Participation `coming` in at least N Cycles of a given Cycle type (see Cycle type, above). Distinct from Cohort-based, which ties to one specific named Cycle ("were you here for the founding season") — this counts occurrences of a *kind* of cycle over time ("has this member done at least two Seasons") without a lighter Reunion or Workday cycle counting toward that number.

A Community can define as many tiers as it wants, or none — a group with fully flat membership just skips this.

### Authentication

Provider-pluggable per Community, not one fixed method — a Community with no SSO of its own gets the magic-link flow as a complete, first-class path, not a consolation fallback.

- **Magic-link (default, always available).** Enter an email, get a one-time login link — no password, no external dependency. This is the only provider live in the MVP build slice (see Build order), and it stays the right answer for any Community that doesn't run its own identity system.
- **OIDC, confirmed for Peach Please.** Peach Please runs Zitadel as its identity provider, which settles what was previously an open question about which SSO protocol to build against — it's OIDC, not something bespoke. Two things matter about how this actually works, beyond just "SSO is on":
  - **Account creation is role-gated, not automatic on a successful login.** Zitadel is shared infrastructure across more than Orchard (Nextcloud, mail, and whatever else sits behind The Pit's IdP), so a valid login on its own doesn't prove someone should have an Orchard account. Provisioning only fires when the token carries a role scoped to Orchard's own project in Zitadel — no role, no account, even for someone who's a legitimate org member elsewhere.
  - **Identity is keyed on the OIDC `sub` claim, never on email.** `sub` is the durable link between a Zitadel identity and an Orchard Member; once it's set, a login always resolves to the same Member no matter what email comes back in the token. On every SSO login, if the IdP's email differs from what Orchard has on file, Orchard updates its own copy to match — email is free to drift upstream (someone changes it in Zitadel), the identity link doesn't.

### Requirement

An eligibility predicate attached to a task. Generalized from the old fixed strings (`experienced peach · speaks [language] · has completed [task] · any member`) into a typed predicate:

| Type             | Example                                                                    |
|------------------|-----------------------------------------------------------------------------|
| `tier`           | Requires membership in Tier "Experienced"                                  |
| `language`       | Requires a language tag on the member profile                              |
| `completed_task` | Requires having completed a specific prior task — held *or* shadowed both count (see Shadow slots & succession) |
| `custom`         | Free-form flag defined by the Community (e.g. "has kitchen certification") |

Each Requirement also carries a **mode**, deciding what it actually does. An earlier draft of this doc assumed every requirement should simply block ineligible claimants, which turned out to be too blunt for real cases like "this task needs a Spanish speaker somewhere in the group" (a team-coverage need, not a personal bar on every claimant) or "would be nice to have someone who's done this before" (a preference, not a bar at all):

- **`individual_gate`** (the original behavior, and the default) — you must personally satisfy it to claim any slot on the task. Right for anything genuinely non-negotiable — handling money, sensitive data, anything that can't safely be done by someone who doesn't meet the bar.
- **`group_coverage`** — nobody's claim is blocked by it. It's a standing line on the task's status ("Spanish speaker: covered / not yet covered"), computed live by checking whether *any* current holder satisfies it — no separate bookkeeping of who's covering what, derived the same way remaining capacity already is. If the task fills to capacity with the line still unmet, that's a gap the existing attention-level machinery picks up (soft or hard flag, per the Community's own thresholds), the same as any other stalled or under-resourced task — not a new escalation path.
- **`soft_priority`** — never blocks a claim, never flags a gap. Purely a surfacing signal.

**All three modes feed how a task gets surfaced to members — `soft_priority` is just the one where surfacing is the *only* effect.** The other two layer a surfacing boost on top of their gate/flag behavior, and the boost works differently for each: an `individual_gate` requirement should pull a task upward for people who pass it, more aggressively the narrower the eligible pool is, since those are exactly the tasks hardest to staff and easiest for the few eligible people to miss — while for someone who doesn't pass it, the task still shows in Explore (open-by-default transparency doesn't change), it just isn't pushed as a personal match. A `group_coverage` requirement's boost is dynamic rather than fixed: it only pulls on people who'd satisfy the *currently unmet* line, and stops pulling on them the moment someone else covers it — the live need is what's being surfaced for, not the tag itself.

The same typed-predicate mechanism gates cycle initiation, not just task claims — see Cycle above. Cycle-initiation eligibility stays `individual_gate` only; group-coverage and soft-priority don't have an obvious meaning for a single initiating member.

**Waiving an `individual_gate` requirement.** Sometimes the eligible pool exists on paper but nobody in it is willing to step up right now, and the honest choice is between the task not getting done and someone doing it anyway. See **Coordination mechanics**, below, for how that's handled as a deliberate, visible act rather than a silent bypass.

### Task Pack

A portable, importable bundle of tasks — the answer to "most tasks are specific to the community, but some starting point helps." A pack is content, not structure, with one deliberate exception: it doesn't define Branches or Tiers — those are Community-level, standing structure that outlives any one cycle, so a pack only ever targets branch *names*, matched (or manually remapped) into whatever branches the importing Community has. Phase is different in kind. Phase is Cycle-scoped, recreated fresh per cycle rather than persisting like Branch does, so when a pack creates a brand-new cycle there's usually nothing pre-existing to match a phase hint against at all — the pack has to actually define the spine, not just reference it. A pack has:

- Manifest: name, description, source, version, tags (domain: event-production, renovation, coop-governance, etc.)
- An ordered list of phase definitions (`PackPhase`: name, order, an optional suggested relative duration) — the spine the pack's own tasks are rooted in, timeless like the rest of the pack's content (no absolute dates; those are set per-cycle, see Phase in the data model).
- A list of tasks, each with the fields above minus Community-specific IDs (owner, actual dates), each referencing its phase directly by a pack-local key (`phase_ref` → the matching `PackPhase.order`) rather than by name — since the pack owns and defines its own phase list, there's no ambiguity to resolve the way there is for Branch.

Packs are symmetric — a Community can export its own board (or a subset of it, or a whole past Cycle) as a pack at any time. This is the same mechanism for "give next year's coordinator a head start," "share this with a sister community," "clone last cycle into a new one," and "seed a brand-new install with a sensible starting board." No separate feature needed for each.

**Import, two paths.** Creating a *new* cycle from a pack (the common case, including clone-previous-cycle) applies the pack's `PackPhase` list directly as that cycle's Phase rows, in order, dates left blank — each task's `phase_ref` then resolves with certainty to the Phase it points at, no matching involved. Importing a pack's tasks into a cycle that *already has* its own phase spine (built by hand, then a starter task set imported into it after) is the one case where a real boundary exists between the pack's phase content and something it didn't create — there, `PackPhase.name` is matched-or-remapped against the destination's existing Phase names, the same way branch names already are. See **Pack import review**, below, for how a human confirms both kinds of matching before anything commits.

### Pack import review

Not previously specified in any concrete form — "matched or remapped against real branches on import" described the *what*, not the screen behind it. One generic review screen covers both name-matching cases (branch, always; phase, only in the secondary merge-into-existing-cycle case above), reconciling the pack's names against what the destination already has:

- **Grouped by distinct hint value, not by task.** A pack import with 45 tasks across 4 branches shows 4 rows, not 45 — each row resolved once, applied to every item carrying that hint.
- **Each row starts pre-filled with a suggestion:** an exact (case-insensitive) name match against the destination's existing branches/phases if one exists; "create new," pre-populated with the pack's own name, if it doesn't. Fuzzy/near-match suggestion (catching "Wood" vs "Woods") is a reasonable stretch, not a first-cut requirement — exact-match is simple and covers the common case.
- **Every row is editable**, regardless of the suggestion: remap to any other existing branch/phase via dropdown, or override to "create new" even where a match was found (a community might want two branches named similarly, not a merge). For phase specifically, "leave unassigned" is also a valid resolution, since `Task.phase_id` is nullable.
- **Branch rows get a third option: decline.** Not every "no match" should become a new branch — sometimes nobody wants one, whether or not the importer could create one. Since `Task.branch_id` is required, declining can't just drop the row — it hands off to a second screen.
- **Screen two: reassign the now-branchless tasks — only appears if anything was declined.** A flat, per-task list (not grouped by hint, unlike screen one) of every task whose branch hint was declined, shown with its original hint for context, each needing a real existing branch picked before the import can commit. Deliberately task-level rather than hint-level: without a substitute branch to auto-apply, there's no single sensible default for a whole group — some declined "Wood" tasks might genuinely belong in Fruit, others in Blossom, a real per-task call. Bulk-select-and-assign is still available for the common case where a whole batch really does belong together (reusing the board's existing bulk task selection), with per-task override for the rest.
- **Nothing is created until the whole flow is confirmed** — a staging/preview step across both screens, not an apply-then-revert one: unlike Spatial planning's Placement review, nothing here is live before the import, so there's no urgency forcing an apply-immediately shape.
- **No new access surface needed** for the screen itself — it's just a step inside cycle creation (or pack import), gated by whoever's already allowed to start a cycle.

**"Create new branch" needs its own check.** Cycle-initiation eligibility and Admins are two separate gates — starting a cycle only requires clearing cycle-initiation eligibility (an ordinary Tier check), while Branch is an "ordinary setting" edited by whoever holds Admins this cycle, a Community-endorsed task with its own threshold on top of any Tier. Nothing says the two overlap, so the review screen can't assume whoever's importing is allowed to create standing Community structure. Only "create new branch" is affected — remapping to an existing branch, or leaving a phase unassigned, references what's already there and needs no check. Phase doesn't have this problem: a phase spine belongs entirely to the Cycle being created, which the initiator is already authorized to create.

Rather than a new gate-check flow, this reuses the pattern Spatial planning already committed to for the same underlying shape — act immediately, stay provisional until someone with actual standing reviews it: if the importer holds Admins, "create new branch" resolves immediately on confirm, same as today. If they don't, the branch is still created on confirm — tasks attach to it right away, the import doesn't block waiting on anyone — but with a new `status` field on Branch (`confirmed | pending`, mirroring Placement's own `confirmed`/`pending`), created `pending`. It surfaces in the Admins review queue the same way a pending Placement does; confirming locks it in, rejecting means re-pointing whatever tasks landed on it to a real branch instead — the one place this doesn't perfectly mirror Placement, since a rejected new branch has no prior confirmed state to revert to the way a moved Placement does.

---

## ⚙️ Configuration model (what an install defines)

This is the layer that used to be implicit (baked into "we are a camp at a burn") and now has to be explicit, set once at Community creation:

| Setting                   | Options                                                                                                                                                                                               |
|---------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Membership model**      | Cohort/wave-based · rolling/continuous · fixed roster                                                                                                                                                 |
| **Tiers**                 | Zero or more, each with a criterion (manual / tenure / completion / cohort)                                                                                                                           |
| **Branches**              | Community-named, at least one                                                                                                                                                                         |
| **Branch membership**     | Emergent (no roster, no expected attendance) or explicit (real roster, branch calls carry expected attendance and follow-up — see Branches)                                                          |
| **Cycles**                | On or off. Off = one permanent default Cycle, no cycle-management UI surfaced. On = the Community can run multiple named cycles over time (a full season, a mini-cycle for a one-off event, etc.)   |
| **Cycle initiation**      | Only relevant if cycles are on. Which Tier (if any) may start a new cycle — defaults to no restriction if the Community has no tiers                                                                 |
| **Phase spine**           | Defined per-cycle if cycles are on, or once on the default cycle if cycles are off. On (named phases in order) or off, either way                                                                    |
| **Physical/on-site mode** | Only offered if phases are on and the Community expects a discrete gathering. Governs shift-lock / read-only-reference / resync behavior.                                                            |
| **Input round cadence**   | How often queued questions batch and go out for answering — weekly by default, configurable per Community (see Input rounds)                                                                         |
| **Optional modules**      | Recruitment · sensitive-data module · shifts/rota · budget & voting · event scheduling · spatial planning · conflict management · assemblies · documentation — real backend surface when on, each independently movable through the off/testing/on rollout states below. All default **off** except Documentation, which defaults **on** (see Documentation, below, for why). |

Branches and tiers should stay editable after launch — communities will add one. Membership model and phase-spine-on/off should be locked behind a real confirmation, since changing either after task/member data exists is a migration, not a settings toggle.

### Module rollout: off / testing / on

Turning on a new optional module doesn't have to mean flipping it live to the whole Community all at once, but it also shouldn't default to needing a leadership tier to gatekeep it — that's the trap CampTool's officer-only "preview" state falls into, and it's specifically the kind of assumption Orchard is trying not to bake in. Each module carries one of three states:

- **Off** — not visible, not usable.
- **Testing** — visible to everyone by default, just clearly labeled ("New — this is still being shaped, tell us what's broken"). This is the horizontal default: the whole Community tries it, feedback comes back through ordinary channels (a task comment, an Input round question), and nothing about who gets to see it first depends on rank.
- **On** — fully live, no banner.

A Community that genuinely wants a smaller group to shake a module out before wider exposure can still do that — but it's an explicit choice, not the default, and it's built on the same Tier mechanism everything else here already uses rather than a hardcoded "officers" concept: testing can optionally be scoped to any Tier the Community defines (an existing one, or a new one created just for this, e.g. "Playtesters"). The gate is whatever the Community decided "trusted with new things" means for itself, not a rank the platform assumes exists.

*Data model note:* a small `ModuleState` row per Community per module key (`state: off|testing|on`, `testing_tier_id: uuid → Tier, nullable`) covers this without needing a change to the `modules_enabled` list itself.

---

## 🔑 Community settings & Admins

Distinct from a member's own profile settings (contact preferences, tags, notification prefs — always self-service, no gate at all), **community settings** are the Configuration model above: branches, tiers, cycle/phase structure, module states, cadence defaults, and anything else that shapes how the whole Community runs. Access to that screen can't default to a hardcoded admin concept any more than anything else here does — that would quietly reintroduce the permanent-officer-class pattern the CampTool comparison flagged as specifically the thing to avoid. It has to be built from the same primitives as everywhere else.

### Admins

**Admins** is the task that gates the community settings screen — a real task on the board, held and released the same way any other task is, not a rank or a title. It's the flagship use of **Community-endorsed** openness (see Endorsement-gated tasks, above): during a cycle's early kickoff rounds, alongside Round 0/1's other critical coordination tasks, anyone eligible can express interest in becoming an Admin, and their candidacy needs to clear an endorsement threshold from the wider membership before it confirms.

A few things make this specific instance of the mechanic work the way it needs to:

- **Uncapped, by default.** However many candidates clear the bar, that's how many Admins the Community has this cycle — no fixed council size to defend, no artificial scarcity forcing a contest between two people the community would happily trust equally. A light, five-person reunion cycle naturally ends up with fewer Admins than a full season, sized to who's actually active and trusted that cycle rather than to a number set once and left alone.
- **Resets whenever a cycle's task set actually includes it — nothing more special than that.** There's no separate flag deciding whether a given cycle "counts" for Admins; it's just whichever cycles happen to include an Admins task in their pack, the same as any other critical task. A cycle built by cloning the previous one, or from a pack that carries Admins forward, gets a fresh instance and opens fresh candidacy in Round 0/1 — endorsements don't carry over, so someone who held it last cycle starts from zero and has to clear the threshold again, the same live vote of confidence anyone else faces. A lighter cycle assembled from a pack that never included Admins in the first place simply doesn't touch it — there's no new instance to contest, so whoever holds the most recent existing one keeps holding it, undisturbed. This composes cleanly with Cycle type (see Cycle, above) without needing to reference it directly: a Community can keep Admins in its Season pack and out of its Reunion pack, so a reunion weekend never forces a pointless re-election, without a rule anywhere that has to say so explicitly.
- **Runs on the same Requirement mechanism as everything else.** A Community can (and probably should) stack a `tier` Requirement on top of the endorsement gate — e.g. Tier "Experienced" — so the pool of people who can even attempt a candidacy is bounded by ordinary Requirement logic; the endorsement gate then decides who the community actually wants from within that pool.

### Two tiers of setting, not one

Not every setting an Admin can touch carries the same weight, and treating them identically is exactly where the risk shows up: a cycle's worth of Admins is a legitimate stand-in for "who runs this cycle," but it's not automatically a legitimate stand-in for "what the whole standing Community wants" — especially in a thin cycle where Admins might be two or three people out of a much larger year-round membership.

- **Ordinary settings** — branches, tiers, cadence, module rollout states, most of the Configuration model — are edited directly by whoever holds Admins this cycle. These are already expected to change casually (see Configuration model, above: "branches and tiers should stay editable after launch"), and scaling that access to the cycle's actual size is the right behavior here, not a risk to guard against.
- **Foundational settings** — membership model, phase-spine on/off, and anything else the Community treats as a real migration rather than a toggle (see Configuration model) — carry an additional expectation: **an Assembly about the change should reach quorum measured against the whole registered membership roster, not just this cycle's active population, before Admins act on it.** This is a norm, not a platform-enforced gate — consistent with Assemblies always being advisory, never auto-applied (see Assemblies, above), the same rule that keeps a vote anywhere else in this document from being mistaken for an authority overriding the Community's own judgment. Admins can technically still run the process (propose the Assembly, host the discussion, tally it, execute the result) the same as they'd administer anything else on the board — the quorum expectation is about who has to weigh in for the result to actually mean what it claims, not about who's allowed to do the administrative work.
- **What "quorum" means here, concretely:** the Assembly's tally is measured against the total Member roster (everyone the Community has ever accepted, active this cycle or not), not against Participation for the current cycle. A foundational Assembly is exactly the "slow, deliberate structural question" case Assemblies were already built to accommodate at a different speed than an urgent one-off (see Assemblies, above) — expect these to run longer and need real, deliberate outreach beyond a passive link, since reaching roster-wide participation from a quiet season takes actual effort, not just time.

**Left genuinely open:** where the exact quorum bar sits (a fixed count, a share of the roster, something else), what a Community does if an Admin group ever did act despite an Assembly visibly failing to reach it, and which Admins instance is operative during the stretch between a new cycle opening and its own Admins candidacy actually resolving. Nothing here forces a resolution — the same honest limit Assemblies already admit to everywhere else in this document.

---

## 🗂️ Data model

This is the concrete shape to build against. Field names are suggestions, not gospel — the goal is to pin down entities and relationships so backend work can start.

**Community**

| Field                     | Type                         | Notes                                                                                                                                                      |
|---------------------------|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| id                        | uuid                         |                                                                                                                                                            |
| name                      | string                       |                                                                                                                                                            |
| membership_model          | enum(cohort, rolling, fixed) | community-wide membership model                                                                                                                            |
| branch_membership_model   | enum(emergent, explicit)     | see Branches — explicit unlocks rosters, expected attendance, and follow-up tasks for calls                                                                |
| cycles_enabled            | boolean                      | false = one permanent default Cycle, no cycle UI                                                                                                          |
| cycle_initiation_tier_id  | uuid → Tier, nullable        | null = any member may start a cycle                                                                                                                        |
| phases_enabled            | boolean                      |                                                                                                                                                            |
| onsite_mode_enabled       | boolean                      | requires phases_enabled                                                                                                                                    |
| conflict_team_task_id     | uuid → Task, nullable        | points at the standing critical task whose current TaskAssignment holders make up the conflict team; only relevant if the conflict-management module is on |
| input_round_interval_days | int                          | default 7 — cadence for Input rounds (see Input rounds)                                                                                                    |
| default_call_has_agenda   | boolean                      | fallback default for any call not covered by a Branch-level default — see Call agenda & summary                                                            |
| default_call_needs_summary | boolean                     | fallback default, as above                                                                                                                                  |
| default_call_require_read | boolean                      | fallback default, as above                                                                                                                                  |
| modules_enabled           | string\[\]                   | e.g. `["sensitive_data","shifts","budget","events","recruitment","conflict_management","assemblies","spatial_planning","documentation"]`                                   |

**ModuleState**

| Field           | Type                        | Notes                                                            |
|-----------------|-----------------------------|-------------------------------------------------------------------|
| community_id    | uuid → Community            |                                                                    |
| module_key      | string                      | matches an entry in `modules_enabled`                              |
| state           | enum(off, testing, on)     | see Module rollout above                                          |
| testing_tier_id | uuid → Tier, nullable       | null = testing is visible to everyone, just labeled               |

**Branch**

| Field                        | Type                | Notes                                                                 |
|------------------------------|---------------------|--------------------------------------------------------------------------|
| id                           | uuid                |                                                                        |
| community_id                 | uuid → Community    |                                                                        |
| name                         | string              |                                                                        |
| description                  | string              |                                                                        |
| status                       | enum(confirmed, pending) | default `confirmed`; `pending` when created via pack import by someone who doesn't hold Admins — see Pack import review |
| default_call_has_agenda      | boolean, nullable   | null = inherit the Community default — see Call agenda & summary       |
| default_call_needs_summary   | boolean, nullable   | null = inherit the Community default                                   |
| default_call_require_read    | boolean, nullable   | null = inherit the Community default                                   |

**BranchMembership** (only meaningful if `branch_membership_model = explicit`)

| Field     | Type          | Notes |
|-----------|---------------|-------|
| branch_id | uuid → Branch |       |
| member_id | uuid → Member |       |
| joined_at | timestamp     |       |

**Attendance** (attached to a SchedulingPoll once a slot is confirmed — see Scheduling polls)

| Field       | Type                  | Notes |
|-------------|-----------------------|-------|
| id          | uuid                  |       |
| poll_id     | uuid → SchedulingPoll |       |
| member_id   | uuid → Member         |       |
| attended    | boolean               |       |
| recorded_by | uuid → Member         |       |
| recorded_at | timestamp             |       |

**Cycle**

| Field          | Type                                                     | Notes                                                                                                                  |
|----------------|-------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| id             | uuid                                                     |                                                                                                                        |
| community_id   | uuid → Community                                         |                                                                                                                        |
| name           | string                                                   | e.g. "2027 Season," "Spring Reunion 2027"                                                                              |
| status         | enum(draft, round_0, round_1, round_2, active, archived) | drives which kickoff round is currently open                                                                           |
| started_by     | uuid → Member                                            | becomes fallback holder of Round 0 tasks by opening them                                                               |
| started_at     | timestamp                                                |                                                                                                                        |
| source_type    | enum(blank, pack)                                        | "clone previous cycle" is a pack generated from that cycle at creation time — same code path as importing a saved pack |
| source_pack_id | uuid → TaskPack, nullable                                |                                                                                                                        |
| capacity                   | int, nullable                             | cap on confirmed Participation for this cycle — null = unlimited                                                      |
| returning_window_closes_at | timestamp, nullable                       | only relevant if Recruitment is on — see Participation & capacity                                                      |
| cycle_type_id               | uuid → CycleType, nullable                | optional — see Cycle type, above                                                                                      |

**CycleType** (optional — see Cycle type, above)

| Field           | Type                       | Notes                                                                    |
|-----------------|----------------------------|-----------------------------------------------------------------------------|
| id              | uuid                       |                                                                           |
| community_id    | uuid → Community           |                                                                           |
| name            | string                     | e.g. "Season," "Reunion," "Workday"                                       |
| default_pack_id | uuid → TaskPack, nullable  | suggested starting pack for a Cycle of this type — a nudge, not enforced  |

**Participation**

| Field          | Type                                      | Notes                          |
|----------------|--------------------------------------------|-----------------------------------|
| id             | uuid                                      |                                |
| cycle_id       | uuid → Cycle                              |                                |
| member_id      | uuid → Member                             |                                |
| status         | enum(unknown, coming, maybe, not_coming)  | default `unknown`               |
| arrival_date   | date, nullable                            |                                |
| departure_date | date, nullable                            |                                |
| note           | string, nullable                          |                                |
| updated_at     | timestamp                                 | resubmittable as plans change   |

**Phase**

| Field      | Type          | Notes                                                                                        |
|------------|---------------|-------------------------------------------------------------------------------------------------|
| id         | uuid          |                                                                                              |
| cycle_id   | uuid → Cycle  | belongs to a cycle, not the Community directly, since cycles can have different phase spines |
| name       | string        |                                                                                              |
| order      | int           | sequence position                                                                            |
| start_date | date, nullable | set at cycle-scheduling time, never carried in a Pack — a Phase instance is always cycle-specific; both dates optional, same "optional, not enforced" pattern as the rest of this spec |
| end_date   | date, nullable | optional; a gap between phases is real (e.g. a lull between Procurement and Build) rather than always contiguous |

**Tier**

| Field            | Type                                     | Notes                                             |
|------------------|-------------------------------------------|-----------------------------------------------------|
| id               | uuid                                     |                                                   |
| community_id     | uuid → Community                         |                                                   |
| name             | string                                   |                                                   |
| criterion_type   | enum(manual, tenure, completion, cohort, cycle_type_count) | cohort = was active during a specific past Cycle; cycle_type_count = was active in ≥ N Cycles of a given CycleType |
| criterion_config | json                                     | e.g. `{"min_days": 180}`, `{"cycle_id": "..."}`, or `{"cycle_type_id": "...", "min_count": 2}` |

**Member**

| Field        | Type             | Notes                                                          |
|--------------|------------------|-------------------------------------------------------------------|
| id           | uuid             |                                                                |
| community_id | uuid → Community |                                                                |
| name         | string           |                                                                |
| tags         | string\[\]       | languages, skills, free-form                                   |
| tier_ids     | uuid\[\]         | computed or manually assigned depending on tier criterion_type |
| joined_at    | timestamp        |                                                                |
| referred_by_member_id | uuid → Member, nullable | set on invite-link redemption (see Recruitment: Invite links); powers the Accompaniment default suggestion |
| joined_via_invite_id  | uuid → CommunityInvite, nullable | which specific link was redeemed, if any                                                            |

**MemberIdentity** (see Authentication)

| Field            | Type                     | Notes                                                                                    |
|------------------|--------------------------|-----------------------------------------------------------------------------------------------|
| id               | uuid                     |                                                                                           |
| member_id        | uuid → Member            |                                                                                           |
| provider         | enum(magic_link, oidc)   |                                                                                           |
| provider_subject | string, nullable         | the OIDC `sub` claim — stable even if the upstream email changes; null for magic_link      |
| login_email      | string                   | synced from the IdP on every login for oidc; the address a magic link is sent to for magic_link |
| created_at       | timestamp                |                                                                                           |

**Task**

| Field               | Type                                       | Notes                                                                                                                     |
|---------------------|-----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| id                  | uuid                                       |                                                                                                                           |
| community_id        | uuid → Community                           |                                                                                                                           |
| branch_id           | uuid → Branch                              |                                                                                                                           |
| cycle_id            | uuid → Cycle, nullable                     | null for standing tasks not tied to any cycle                                                                             |
| phase_id            | uuid → Phase, nullable                     | null if the cycle has no phase spine                                                                                      |
| parent_task_id      | uuid → Task, nullable                      | set when this is a subtask                                                                                                |
| cloned_from_task_id | uuid → Task, nullable                      | set when this task instance was created by cloning a previous cycle; lets the UI link back to that task's comment history |
| title               | string                                     |                                                                                                                           |
| description         | text                                       |                                                                                                                           |
| tags                | string\[\]                                 |                                                                                                                           |
| effort              | enum(one_off, ongoing, owns_a_thing)       |                                                                                                                           |
| effort_magnitude    | json                                        | duration bucket for `one_off` (`under_hour · few_hours · half_day · multi_day`), hours/week for `ongoing`/`owns_a_thing` — either a flat number or a per-phase map (`{phase_id: hours}`) — see Effort magnitude |
| status              | enum(unclaimed, claimed, waiting, done)    |                                                                                                                           |
| capacity            | int, nullable                              | default 1; null = uncapped, the default for `community_endorsed` openness (see Endorsement-gated tasks)                   |
| openness            | enum(open, request, coordination_approved, community_endorsed) | default request                                                                                      |
| endorsement_threshold | int, nullable                            | only set when `openness = community_endorsed` — number of endorsements a candidacy needs to confirm (see Endorsement-gated tasks) |
| browse_period_end   | timestamp, nullable                        | null = no browse period on this task                                                                                      |
| critical            | boolean                                    |                                                                                                                           |
| next_checkin_at     | timestamp, nullable                        |                                                                                                                           |
| waiting_note        | string, nullable                           |                                                                                                                           |
| created_by          | uuid → Member                              | for proposals                                                                                                             |
| suggested_member_id | uuid → Member, nullable                    | "I'd suggest this person" from the proposal form, or pre-filled from a shadow on cycle-clone (see Shadow slots & succession) |
| source_poll_id      | uuid → SchedulingPoll, nullable            | set when this task was auto-created for a call (see Call agenda & summary under Scheduling polls)                          |
| source_poll_role    | enum(facilitate, summarize), nullable      | which of the two auto-created call tasks this is, when `source_poll_id` is set                                            |
| attention_level     | enum(ok, soft, hard, escalated)            | computed, not stored authoritatively (or stored + recomputed by a job)                                                    |

**TaskComment**

| Field      | Type          | Notes |
|------------|---------------|-------|
| id         | uuid          |       |
| task_id    | uuid → Task   |       |
| member_id  | uuid → Member |       |
| body       | text          |       |
| created_at | timestamp     |       |

**Question / QuestionResponse** (shared atomic unit — batched via InputRound for task questions, or via Assembly for community-wide votes)

| Field                  | Type                                         | Notes                                                                                         |
|------------------------|--------------------------------------------------|---------------------------------------------------------------------------------------------------|
| question.id            | uuid                                         |                                                                                               |
| question.task_id       | uuid → Task, nullable                        | set for an ordinary task-linked question                                                      |
| question.assembly_id   | uuid → Assembly, nullable                    | set for an assembly agenda item — exactly one of task_id/assembly_id is set                   |
| question.asked_by      | uuid → Member                                |                                                                                               |
| question.body          | text                                         |                                                                                               |
| question.response_type | enum(free_text, single_choice, multi_choice) |                                                                                               |
| question.options       | json array, nullable                         | choices, if not free_text                                                                     |
| question.deadline      | timestamp, nullable                          | task-linked questions only — point past which an answer stops being useful                    |
| question.high_priority | boolean                                      | task-linked questions only — affects sort order within a round, never a bypass of the cadence |
| question.round_id      | uuid → InputRound, nullable                  | task-linked questions only, once batched                                                      |
| question.status        | enum(queued, batched, answered)              | assembly items just follow the Assembly's own status instead                                  |
| question.created_at    | timestamp                                    |                                                                                               |
| response.id            | uuid                                         |                                                                                               |
| response.question_id   | uuid → Question                              |                                                                                               |
| response.member_id     | uuid → Member                                |                                                                                               |
| response.value         | json                                         | free text or selected option(s)                                                               |
| response.submitted_at  | timestamp                                    |                                                                                               |

**InputRound**

| Field        | Type                           | Notes                                                  |
|--------------|--------------------------------|------------------------------------------------------------|
| id           | uuid                           |                                                        |
| community_id | uuid → Community               |                                                        |
| cutoff_at    | timestamp                      | new questions stop joining this round after this point |
| opens_at     | timestamp                      | community-wide "round is open" notification fires here |
| closes_at    | timestamp                      | answering window ends                                  |
| status       | enum(collecting, open, closed) |                                                        |

**Assembly** (ad hoc, proposer-initiated — see Assemblies)

| Field            | Type                                      | Notes                                                      |
|------------------|---------------------------------------------|----------------------------------------------------------------|
| id               | uuid                                      |                                                            |
| community_id     | uuid → Community                          |                                                            |
| proposed_by      | uuid → Member                             | any member — same open-access principle as everything else |
| title            | string                                    |                                                            |
| agenda_closes_at | timestamp                                 | end of the window where items can be added                 |
| voting_opens_at  | timestamp                                 | end of the notice period                                   |
| voting_closes_at | timestamp                                 |                                                            |
| status           | enum(agenda_open, notice, voting, closed) |                                                            |
| quorum_basis     | enum(none, total_membership)              | default `none` — see Community settings & Admins: a foundational-settings Assembly is expected to set this to `total_membership` |
| quorum_threshold | int, nullable                             | count or share of `quorum_basis` expected to respond before the result carries the weight the norm assumes; only meaningful when `quorum_basis ≠ none`. Informational only — displayed alongside the tally, never enforced (see Assemblies: results are always advisory) |
| created_at       | timestamp                                 |                                                            |

**SchedulingPoll / AvailabilityEntry** (see Scheduling polls)

| Field                         | Type                                   | Notes                                                                              |
|-------------------------------|-------------------------------------------|--------------------------------------------------------------------------------------|
| poll.id                       | uuid                                   |                                                                                    |
| poll.community_id             | uuid → Community                       |                                                                                    |
| poll.organized_by             | uuid → Member                          |                                                                                    |
| poll.title                    | string                                 |                                                                                    |
| poll.linked_task_id           | uuid → Task, nullable                  | optional context, for display/grouping only                                        |
| poll.linked_branch_id         | uuid → Branch, nullable                | optional context, for display/grouping only                                        |
| poll.required_participant_ids | uuid\[\], nullable                     | if set, only slots where all of these are free count (recruitment case)            |
| poll.minimum_attendance       | int, nullable                          | floor for the maximize-attendance case, ignored if required_participant_ids is set |
| poll.status                   | enum(collecting, confirmed, cancelled) |                                                                                    |
| poll.confirmed_slot           | timestamp, nullable                    |                                                                                    |
| poll.created_at               | timestamp                              |                                                                                    |
| entry.id                      | uuid                                   |                                                                                    |
| entry.poll_id                 | uuid → SchedulingPoll                  |                                                                                    |
| entry.member_id               | uuid → Member                          |                                                                                    |
| entry.available_slots         | json array                             | submitted windows                                                                  |
| entry.submitted_at            | timestamp                              |                                                                                    |
| entry.updated_at              | timestamp                              | resubmittable as availability changes                                              |

**CallAgendaItem** (optional, per SchedulingPoll — see Call agenda & summary under Scheduling polls)

| Field      | Type                   | Notes |
|------------|------------------------|-------|
| id         | uuid                   |       |
| poll_id    | uuid → SchedulingPoll  |       |
| added_by   | uuid → Member          |       |
| text       | text                   |       |
| created_at | timestamp              |       |

**CallSummary / CallSummaryRead** (optional, per SchedulingPoll)

| Field                | Type                     | Notes                                                              |
|----------------------|--------------------------|-----------------------------------------------------------------------|
| summary.id           | uuid                     |                                                                    |
| summary.poll_id      | uuid → SchedulingPoll    |                                                                    |
| summary.body         | text                     | same notes/markup convention as Task notes and Documentation       |
| summary.require_read | boolean                  | set at scheduling time — decides whether read-tracking is used at all |
| summary.published_at | timestamp, nullable      | null = still a draft                                                |
| read.summary_id      | uuid → CallSummary       |                                                                    |
| read.member_id       | uuid → Member            |                                                                    |
| read.read_at         | timestamp                |                                                                    |

**TaskWikiRevision**

| Field     | Type          | Notes                                                                               |
|-----------|---------------|-------------------------------------------------------------------------------------|
| id        | uuid          |                                                                                     |
| task_id   | uuid → Task   |                                                                                     |
| content   | text          |                                                                                     |
| edited_by | uuid → Member |                                                                                     |
| edited_at | timestamp     | current summary = most recent revision per task; no separate "current" field needed |

**TaskResource**

| Field      | Type             | Notes                                                                         |
|------------|------------------|-------------------------------------------------------------------------------|
| id         | uuid             |                                                                               |
| task_id    | uuid → Task      |                                                                               |
| added_by   | uuid → Member    |                                                                               |
| label      | string           | e.g. "Order form we used," "Sign design (print at 5x7)"                       |
| url        | string           | points at wherever the file/page already lives — no native file storage in v1 |
| tag        | string, nullable | free-form, e.g. "purchase link," "template," "design asset"                   |
| created_at | timestamp        |                                                                               |

**TaskAssignment** (join table — replaces a single `owner_id` now that capacity can exceed 1)

| Field                | Type                    | Notes                                                                |
|----------------------|-------------------------|------------------------------------------------------------------------|
| task_id              | uuid → Task             |                                                                      |
| member_id            | uuid → Member           |                                                                      |
| is_coordination_slot | boolean                 | flags one slot as the coordination function within a multi-slot task |
| is_shadow            | boolean                 | learning slot — exempt from `individual_gate` Requirements, doesn't count toward capacity or `group_coverage` (see Shadow slots & succession) |
| is_outgoing          | boolean                 | this holder doesn't intend to hold the task again next cycle — triggers a documentation nudge (see Shadow slots & succession) |
| gate_waived_by       | uuid → Member, nullable | set when branch coordination waived an `individual_gate` Requirement for this specific claim (see Coordination mechanics) |
| gate_waived_reason   | string, nullable        | required alongside `gate_waived_by`                                  |
| claimed_at           | timestamp               |                                                                      |

**BrowseInterest** (join table, used during a task's browse period)

| Field        | Type          | Notes                                                     |
|--------------|---------------|-------------------------------------------------------------|
| id           | uuid          | referenced by Endorsement when this task is `community_endorsed` |
| task_id      | uuid → Task   |                                                           |
| member_id    | uuid → Member |                                                           |
| expressed_at | timestamp     |                                                           |
| reached_out  | boolean       | the "I've reached out" signal, single-slot contested case |
| status       | enum(open, confirmed, failed), nullable | only meaningful for `community_endorsed` tasks — a row here is that member's candidacy; confirmed once Endorsement count clears the task's `endorsement_threshold` before the browse window closes |

**Endorsement** (join table, only created against a `BrowseInterest` row on a `community_endorsed` task)

| Field              | Type                  | Notes |
|--------------------|-----------------------|-------|
| id                 | uuid                  |       |
| browse_interest_id | uuid → BrowseInterest | the candidacy being endorsed |
| endorsed_by        | uuid → Member         |       |
| created_at         | timestamp             |       |

**TaskDependency** (join table)

| Field              | Type        | Notes |
|--------------------|-------------|-------|
| task_id            | uuid → Task |       |
| depends_on_task_id | uuid → Task |       |

**Requirement**

| Field   | Type                                                  | Notes                                             |
|---------|----------------------------------------------------------|-----------------------------------------------------|
| id      | uuid                                                  |                                                   |
| task_id | uuid → Task                                           |                                                   |
| type    | enum(tier, language, completed_task, custom)          |                                                   |
| mode    | enum(individual_gate, group_coverage, soft_priority)  | default `individual_gate` — see Requirement above  |
| value   | json                                                  | e.g. `{"tier_id": "..."}` or `{"language": "nl"}` |

**Form / FormResponse** (shared primitive, not module-gated — see Forms)

| Field                  | Type                    | Notes                                                                                                                                                                                                                                               |
|------------------------|----------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| form.id                | uuid                    |                                                                                                                                                                                                                                                     |
| form.community_id      | uuid → Community        |                                                                                                                                                                                                                                                     |
| form.purpose           | string                  | e.g. `recruitment_application`, `feedback`, `custom`                                                                                                                                                                                                |
| form.fields            | json array              | each field shaped like a Question — `{label, response_type, options, required}` — reusing the same type vocabulary rather than inventing a second one                                                                                               |
| form.anonymous_allowed | boolean                 |                                                                                                                                                                                                                                                     |
| response.id            | uuid                    |                                                                                                                                                                                                                                                     |
| response.form_id       | uuid → Form             |                                                                                                                                                                                                                                                     |
| response.member_id     | uuid → Member, nullable | null if submitted anonymously                                                                                                                                                                                                                       |
| response.cycle_id      | uuid → Cycle, nullable  | for cycle-scoped uses like post-cycle feedback                                                                                                                                                                                                      |
| response.data          | json                    | one bundled submission across all fields at once — not individual QuestionResponse rows, since a Form's fields are validated and submitted together (required fields block submission), where Questions are always independently optional to answer |
| response.submitted_at  | timestamp               |                                                                                                                                                                                                                                                     |

**ProfileQuestion / ProfileAnswer** (shared primitive, not module-gated — see Profile questions)

| Field                     | Type                             | Notes                                                                                                   |
|---------------------------|-----------------------------------|-----------------------------------------------------------------------------------------------------------|
| question.id               | uuid                             |                                                                                                           |
| question.community_id     | uuid → Community                |                                                                                                           |
| question.label            | string                           |                                                                                                           |
| question.response_type    | enum(text, single_choice, multi_choice) | same vocabulary as Form fields / Questions elsewhere                                              |
| question.options          | json array, nullable             | for choice types                                                                                          |
| question.scope            | enum(once_ever, per_cycle, phase) | once_ever answers aren't tied to a cycle; per_cycle answers are asked again each cycle; `phase` behaves like `per_cycle` but is additionally scoped to one phase within it — see Profile questions |
| question.phase_name_hint  | string, nullable                 | set only when `scope = phase`. Matched against the current cycle's Phase names — same "matched or remapped on import" pattern TaskPack already uses for `branch_name_hint`; a cycle with no phase by that name just doesn't surface the question, not a special case |
| question.audience         | json                              | which member population this applies to (e.g. all, prospective, returning)                                |
| question.surfaces         | json array                       | which flows can trigger it — e.g. `["application", "onboarding"]`                                        |
| question.required         | boolean                          |                                                                                                           |
| question.archived_at      | timestamp, nullable              | retiring a question keeps its past answers intact                                                        |
| answer.id                 | uuid                             |                                                                                                           |
| answer.question_id        | uuid → ProfileQuestion            |                                                                                                           |
| answer.member_id          | uuid → Member                    |                                                                                                           |
| answer.status             | enum(answered, deferred)         | `deferred` = "I don't know yet," satisfies a required question without a fabricated value                |
| answer.value              | json, nullable                   | present when status = answered                                                                            |
| answer.cycle_id           | uuid → Cycle, nullable            | set for both `per_cycle` and `phase` questions — a once_ever answer is just *the* current answer, not tied to a cycle. Which phase a `phase`-scoped answer belongs to is resolved through the question's `phase_name_hint`, not stored redundantly here |

**TaskPack / TaskPackItem / PackPhase**

| Field                                                                             | Type                 | Notes                                                                                             |
|-------------------------------------------------------------------------------------|-------------------------|-----------------------------------------------------------------------------------------------------|
| pack.id                                                                           | uuid                 |                                                                                                   |
| pack.name, description, source, version, domain_tags                              |                      | manifest fields                                                                                   |
| phase.pack_id                                                                     | uuid → TaskPack      |                                                                                                   |
| phase.name                                                                        | string               |                                                                                                   |
| phase.order                                                                       | int                  | sequence position; also doubles as this phase's local reference key within the pack, so no separate id scheme is needed |
| phase.suggested_duration_days                                                     | int, nullable         | rough relative timeline only — no absolute dates in a pack (see Task Pack, above)                  |
| item.pack_id                                                                      | uuid → TaskPack      |                                                                                                   |
| item.branch_name_hint                                                             | string               | matched or remapped against real branches on import                                               |
| item.phase_ref                                                                    | int, nullable         | direct reference to a `PackPhase.order` within the *same* pack — resolved with certainty, not matched (see Task Pack, above) |
| item.title, description, tags, effort, effort_magnitude, critical, capacity, openness, requirements |          | same shape as Task, minus Community/Cycle-specific fields                                         |
| item.wiki_summary_seed                                                            | text, nullable       | carried from the source task's current wiki revision; pre-populates the new task's wiki on import |
| item.resources                                                                    | json array, nullable | `[{label, url, tag}]` carried wholesale from the source task's resource list on import            |

This is deliberately close to a straight relational schema — it maps onto Postgres tables with minimal translation, which matters for the [build order](#-build-order) below.

**Module entities** (only relevant if the corresponding module is enabled — grouped here rather than interleaved above, since they're opt-in surface, not core):

*Recruitment*

| Entity                  | Key fields                                                                                      | Notes                                                       |
|-------------------------|-----------------------------------------------------------------------------------------------------|-------------------------------------------------------------|
| RecruitmentSubscription | member_id, active, consecutive_no_availability_count                                            | auto-lapses per configured threshold                        |
| Evaluation              | id, form_response_id (→ FormResponse), evaluator_id (→ Member), recommendation, notes           | one row per evaluator, against the application FormResponse |
| Objection               | id, form_response_id (→ FormResponse), raised_by (→ Member), note, visible_to (evaluators only) | anonymous to wider community                                |
| CommunityInvite         | id, community_id, created_by (→ Member), token, label (nullable), inviter_thinks_good_fit (boolean), inviter_knows_personally (boolean), expires_at (nullable), revoked_at (nullable), redeemed_at (nullable), redeemed_by_member_id (→ Member, nullable), created_at | always single-use — `redeemed_at` set = spent; see Invite links |
| Inquiry                 | id, community_id, message, contact_info, submitted_at, claimed_by (→ Member, nullable), claimed_at (nullable), resolved_at (nullable) | see A public inquiry inbox, not a CRM                        |

*Budget*

| Entity         | Key fields                                                              | Notes                         |
|----------------|-----------------------------------------------------------------------------|--------------------------------|
| FixedCost      | id, community_id, label, amount                                         | entered before proposals open |
| BudgetProposal | id, community_id, title, cost_breakdown (json), branch_id, submitted_by |                               |
| Vote           | proposal_id, member_id, rank, willing_to_contribute                     | ranked-choice ballot row      |
| Contribution   | member_id, amount, recorded_at                                          | post-confirmation             |

*Event scheduling*

| Entity         | Key fields                                                                                                                                  | Notes                                                        |
|----------------|-----------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| EventProposal  | id, community_id, host_name, title, description, duration_minutes, space_needs, preferred_slots (json), submitted_by (nullable if external) | external submissions allowed if the public-link option is on |
| ScheduledEvent | id, proposal_id, confirmed_slot, space                                                                                                      | published once locked                                        |
| ExportProfile  | id, community_id, name, constraints (json: char caps, duration multiples, field limits)                                                     | shown to hosts at proposal time                              |

*Spatial planning*

| Entity          | Key fields                                                                                                                           | Notes                                                    |
|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| Plot             | id, community_id, cycle_id, name, base_image_url (nullable), base_vector (nullable), scale_calibration (json — may pair each calibration point with a real GPS coordinate instead of, or alongside, a plain distance, see Spatial planning below) | one per Cycle — see **Cloning across cycles**, under Spatial planning, for how a new Cycle gets a starting Plot rather than inheriting the previous one automatically |
| Zone             | id, plot_id, name, category, polygon (json points), color                                                                            |                                                          |
| Placement        | id, plot_id, zone_id (nullable), shape_type, geometry (json), label, category, linked_task_id (nullable), status (enum: confirmed, pending), pending_by_member_id (nullable), pending_prev_geometry (json, nullable) | Members are linked via PlacementMember below, not a single owner field — a shared tent/vehicle is one Placement with several linked Members; `status`/`pending_*` power the propose→approve/revert workflow, which covers a Task-linked Placement (edited by whoever holds `linked_task_id`) the same way it covers a Member-linked one — see Spatial planning below |
| PlacementTemplate | id, community_id, name, shape_type, geometry (json), category                                                                       | reusable shape saved from a Placement, or one of a few seeded defaults; starting a new Placement from one copies its fields once — no live link back |
| PlacementMember  | placement_id, member_id, status (enum: invited, confirmed), invited_by (→ Member), invited_at, responded_at (nullable)               | join table — see Shared placements: invite → accept, below. A solo Placement is just one row here, `confirmed` from creation |
| SpacePreference  | member_id, sleep_arrangement (enum), vehicle_dimensions (json, nullable), group_with (uuid\[\], nullable), sharing_with (uuid\[\], nullable), accessibility_notes | member-profile extension, only present if module enabled. `group_with` = "prefer to be placed near" (proximity only); `sharing_with` = who they expect to actually share a tent/vehicle with — both informational, but `sharing_with` also pre-fills invite suggestions on a shared Placement (see Shared placements, below) |

*Member contact & privacy* (core, not optional — every Community needs some version of this)

| Entity             | Key fields                                                                                                                  | Notes                                 |
|--------------------|------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------|
| ContactMethod      | id, member_id, type (email, phone, telegram, etc.), value, visibility (enum: everyone, task_or_group_mates, emergency_only) | member controls visibility per method |
| EmergencyAccessLog | id, activated_by (→ Member), target_member_id (→ Member), explanation (nullable, can be added after the fact), activated_at | both parties notified on activation   |

*Documentation*

| Entity           | Key fields                                                                                                    | Notes                                                                                          |
|------------------|-----------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| WikiPage         | id, community_id, title, branch_id (nullable), tags, status (enum: published, question_pending), duplicate_of_page_id (→ WikiPage, nullable), created_by, created_at | freestanding, not tied to a Task — see Documentation                                            |
| WikiPageRevision | id, page_id (→ WikiPage), content, edited_by, edited_at                                                        | mirrors TaskWikiRevision — current = latest revision, no separate "current" field needed         |

*Conflict management* (optional module)

| Entity                | Key fields                                                                                                                                                                                                                                                                                                                     | Notes                                                                                                                                                                                                                                      |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ConflictReport        | id, community_id, reported_by (→ Member), description (nullable — a report can start as just a signal, no detail required), claimed_by (→ Member, nullable), status (enum: open, acknowledged, in_conversation, resolved), acknowledged_at (nullable), originated_from_form_response_id (→ FormResponse, nullable), created_at |                                                                                                                                                                                                                                            |
| ConflictReportRecusal | id, report_id (→ ConflictReport), excluded_member_id (→ Member), initiated_by (→ Member — the reporter, the excluded member themselves, or a peer), created_at                                                                                                                                                                 | append-only; current exclusion set = all rows for a report. Visibility = current `conflict_team_task_id` holders minus everyone in this list, and the exclusion must be genuinely invisible to the excluded member, not just access-denied |

---

## 🔄 Lifecycle & attention (unchanged mechanics, generalized)

The lifecycle and trigger logic from the original design carries over unmodified — it was never camp-specific:

```
Unclaimed ──claim──► Claimed ──park──► Waiting ──resume──► Claimed ──finish──► Done
     ▲                   │                  │                                    │
     └──────release──────┴──────────────────┘                                  (archived)
```

Attention level is computed from three simultaneous triggers: phase-based (only if phases enabled), staleness-based (days unclaimed/inactive, thresholds configurable per Community), and dependency-based (predecessor completion unlocks dependents). A `critical` task with no owner past its deadline (or, with phases off, past some staleness threshold) escalates hard rather than soft-flagging.

**Owner-set nudges** — when a task moves to Waiting, the owner sets a next check-in date and a short "waiting on…" note. On that date, the owner gets a nudge with four options: update progress (resets the clock), mark done, re-snooze with a reason, or release. Ignoring the nudge past a grace period re-flags the task — the system is forgiving of a missed check-in, not indifferent to it.

### Coordination mechanics (core, not a module)

These aren't optional — they're how branch coordination actually functions day to day, and none of them are domain-specific. They were fully designed in the original spec and are worth restating in full rather than compressed away, even though they land in the second build slice rather than the bare MVP (see [MVP scope](#-mvp-scope)):

- **Talk to my coordinator** — any task owner can trigger a conversation with their branch coordinator via one button, no categorization required up front. It notifies the coordinator ("[Member] would like to talk about [task]") and the actual conversation happens through whatever channel the community already uses — this is a routing mechanic, not a chat system.
- **Coordinator-initiated check-in** — the same low-friction channel works the other way: a coordinator can propose a co-owner they see as a fit, or just check in if a task looks like it's getting heavy, without waiting to be asked.
- **Capacity-aware fitted asks** — the Coordination view's fitted-ask tools (see Transparency & access) surface a member's current load when a coordinator's looking for someone for a task, computed as declared availability (the phase-scoped Availability Profile questions — see Profile questions) minus current Effort magnitude across everything they hold. Exact hours only show for members who've set their `capacity_visibility` to `open` (see Profile questions — the setting lives with the Availability question itself, not in a general settings page); everyone else shows as a coarse flag — *has room · about right · over* — same "signal without exposing a number nobody agreed to publish" pattern as the anonymous task signal, below. Surfacing capacity as a manual sort/filter dimension in the Coordination view is simple, live infrastructure that doesn't wait on anything else. Using it to automatically weight or default-rank who gets suggested is different — that's real matching automation, and it merges into (and inherits the deferred status of) the already-deferred automated matching/suggestion (tag → task fitting) below, rather than becoming a second, parallel deferred item.
- **Availability non-response** — the Coordination view also surfaces *who hasn't declared at all* for the current phase, not just what people who did declare said (see Profile questions — Availability and its own visibility setting). This is visible regardless of `capacity_visibility`, since whether an answer exists is a different piece of information than what it says — the same distinction Scheduling polls already draw for a branch member who hasn't submitted availability for a call (see Branch, above). Nudged automatically first, the same as anywhere else here; if that goes nowhere, "follow up with members who haven't declared availability for [phase]" becomes its own task — the exact pattern already used for Scheduling-poll non-response, applied to the same underlying problem: a real gap should turn into a real conversation, not sit silently as a blank field nobody's looking at.
- **Bulk task selection** — tasks can be grouped into clusters (e.g. "all pre-launch Ops tasks"). A member can select a whole cluster and deselect individual items before confirming, which reduces friction for highly committed members while keeping granular control available.
- **Self-assign confirmation check** — when anyone with placement authority tries to self-assign a flagged or unclaimed task: *"Are you sure there isn't someone with just the skills for this?"* with three options — really want it myself, suggest a person (tag-matches surfaced), or flag for the group. Nothing gets quietly self-assigned past a real gap.
- **Escalation** — unplaceable tasks surface in a shared "needs an owner" view visible to all coordinators, with cross-branch placement encouraged. Taking a task is always a visible, deliberate act, never a silent default.
- **Genuinely unloved tasks** — three explicit options, never a silent default: rotate it (it becomes a recurring shift), pay or swap for it, or leads consciously absorb or cut it.
- **Anonymous task signal** — a lightweight, closed-choice-only flag, available on any task at any point in the process, not gated behind a survey window: *looks stalled / owner might need help / something feels off / worth a coordinator look*. No free-text field by default, and that's deliberate rather than a limitation — in a small community, a couple of sentences of prose is often enough to work out who wrote it, and a signal that can be traced back defeats its own purpose. It lands with the task owner or coordinator as a quiet nudge to look, not a case anyone's obligated to formally respond to. Worth naming the honest limit rather than overselling it: anonymity is only as real as the number of people who could plausibly have sent it, so a flag on a task two or three people can see isn't actually anonymous no matter how it's worded. This is a different tool than Conflict management's reporting flow, which is deliberately *not* anonymous, since someone eventually has to know who to talk to — this is for the smaller, more frequent case of noticing something's off without wanting to start a conversation from it.
- **Request to join** — a claimed task shows a "Request to join" button for any member. It notifies the current owner, who can accept, decline, or ignore, optionally with a short reason ("already have someone in mind," "prefer to work solo," "further along than it looks" — not required, but useful context). Declined requests stay visible to branch coordination: a stalling task with a logged decline is a different situation than a stalling task nobody's offered to help with, and a pattern of declines followed by falling behind is now something coordination can actually see and act on.
- **Waiving a requirement, deliberately.** Whoever holds branch coordination for the task (or the task's own coordination slot, if it has one) can waive an `individual_gate` Requirement (see Requirement) for one specific claim, when nobody who meets it is willing to step up. Scoped to that one claim, not a permanent change to the task — the bar stays real everywhere else. Requires a short reason ("nobody Tier-eligible was willing, waiving for now") and leaves a standing, visible flag on the task afterward, the same open-by-default treatment as everything else here — never a quiet exception buried in a log. This is a different thing from shadowing, which bypasses `individual_gate` automatically by design (see Shadow slots & succession) — the waiver is for the higher-stakes case of a full, unsupervised claim outside the normal bar, which is exactly the case that needs a human decision and a visible trail.
- **One-click action emails** — nudges should be actionable without opening the platform at all. A nudge email carries the question and the answers as buttons — *"Any update on [task]?" [ Done ] [ Still on it ] [ I need help ] [ Hand it back ]* — context-aware to the task's current status, with snooze options as presets (3 days / 7 days / 14 days), never a free-entry field. One tap resolves it, no login required. This is what keeps coordination overhead from outgrowing the work itself.

### Input rounds (core, not a module)

Everything above assumes the task owner has real authority over how their task gets done — that's a deliberate, load-bearing principle, not an oversight. But unqualified owner authority and community voice can pull against each other, and the platform needs an answer for that tension rather than silently picking a side.

The first pass at this used an open-ended comment thread per task, and it was wrong for the actual shape of the need. The common case isn't "the community should weigh in on how this task gets done" in the abstract — it's much smaller and much more frequent than that: whoever's planning breakfast ordering needs to know what people actually want to eat. That's not a debate to open, it's a question to ask, and a thread that only surfaces if someone goes looking for it is a bad fit for either the constant-small-questions case or the occasional-real-disagreement case — too easy to miss, too easy to either flood people with pings or get buried entirely.

**The redesign is a recurring batch, not a standing thread:**

- **Anyone can pose a question, tied to a specific task, at any time.** No categorization or approval needed — same open-access principle as everything else here. A question can be free text or a quick closed-choice poll (the breakfast case: "pancakes / oatmeal / eggs / no preference" answers in seconds, and most task-specific questions are this shape far more often than they're open debates). Each question can optionally carry a deadline — the point past which an answer stops being useful — and an optional priority flag for "I can't move forward without this."
- **Questions queue rather than notify immediately.** Posing one doesn't ping anyone. It just sits, waiting for the next round.
- **On a fixed community-wide cadence — weekly by default, configurable per Community — everything queued gets bundled into one round.** A reminder goes out a day ahead ("get your questions in"), then at the cutoff every open question bundles into that week's round, sorted by proximity to its own deadline and then by priority. Everyone gets one notification that the round is open, answers what they can in a single sitting during the answering window, and it closes.
- **Results go back to whoever asked**, and stay visible on the task itself for anyone else — same default-open transparency as everything else, just not an active notification to the whole community for every single answered question.
- **No formal "closing rationale" requirement this time**, unlike the first draft of this mechanism (which borrowed Budget's published-rationale pattern). If the asker is the task owner, which is the common case, the answers just directly inform what they were already deciding — there's no separate audience to report back to. If someone other than the owner asked, it's on them to bring the results to the owner's attention; the platform doesn't force a formal response step for something this lightweight. If a real, contested decision does surface through this — which does happen, it's just the less common case — a normal task comment or wiki update is enough to record what got decided and why, without a bespoke field for it.
- **The honest trade-off, and a deliberate boundary, not a gap:** batching means nothing here gets answered faster than the cadence allows, even something genuinely urgent — and that's intentional. Input rounds are deliberately scoped to task-execution questions — organizational weight, the accumulating small stuff people can answer on their own schedule. A one-on-one urgent need still goes through "talk to my coordinator." A genuinely time-sensitive *community-wide* decision — a barrio's placement on the larger event map, say — isn't actually a task-execution question at all, and gets its own mechanism built for that shape rather than being squeezed into this one: see **Assemblies**, below. A round with nothing queued in it just doesn't fire; there's no obligation to manufacture a weekly ping out of nothing.

### Scheduling polls (core, not a module)

A different problem from everything above — not "what does the community think," but "when can enough of the right people actually meet." This was described inline under Recruitment's intro calls in earlier drafts, with a note that it'd be reused elsewhere, but never actually built as its own thing. It needs to be: branch calls and calls among people working on related tasks are exactly the same shape of problem, not a special case of recruitment.

- **Blind submission.** Whoever's organizing opens a poll; members submit their own availability without seeing anyone else's first, so they give honest windows rather than anchoring to what's already shown. The organizer (or anyone checking in on it) only sees the aggregate overlap, not individual raw submissions, until a slot is confirmed.
- **Availability input is a drag-select grid, not a typed-in range.** Members paint the windows they're free directly on a day-by-time grid — click-and-drag on desktop, touch-and-drag on mobile, the same interaction LettuceMeet and its predecessors popularized — rather than entering time ranges by hand. This is a UI decision, not a schema one: painted windows land in `entry.available_slots` the same as any other submitted window, and a member can reopen the grid to adjust their own entry, which `entry.updated_at` already anticipates. Timezones render per viewer rather than in whatever zone the organizer happened to set the poll up in. Worth building in rather than linking out to an external tool for the same reason Resources stayed links-only for files but not for this: the required-participant/threshold resolution logic is Orchard-specific and has to exist regardless, so the aggregate, the confirmation, and the calendar invites all need to live in one place rather than round-tripping through a site that doesn't know about any of that. The one thing this doesn't get for free from the reference tool: LettuceMeet's grid fills in live as people submit, which is the opposite of blind submission — see [Open questions](#-open-questions) below.
- **Two ways to resolve it, because the two real use cases genuinely need different logic:**
  - **Must-overlap-specific-people** — a fixed list of required participants; only slots where all of them are free count at all. This is recruitment's intro call (applicant plus both evaluators) — a slot missing one of them isn't a worse option, it's not an option.
  - **Maximize attendance above a threshold** — nobody's individually required, but the organizer can set a floor ("don't confirm below 4 people") so a slot doesn't lock in with barely anyone able to make it. This is the branch-call and task-related-call case: open to whoever's relevant, resolved by best overlap rather than requiring specific names.
- **No roster required, but one can exist.** Branches don't have to be membership lists — see the fork under Branches — so by default a scheduling poll just gets announced the same way anything else gets targeted (a branch-scoped or task-scoped message, same mechanism as Notifications & communications), open to whoever receives that notice or finds the poll. If a Community has chosen explicit branch membership, a branch call's natural audience is that roster instead, and attendance can be tracked against it (see Branches) rather than only inferred from who submitted availability.
- **Attendance, when it's tracked, is recorded after the fact by whoever ran the call** — a simple mark against the expected audience, not something the platform infers automatically. It's what a follow-up task (see Branches) has something real to work from.
- **Once resolved, calendar invites go out to everyone who submitted availability for the confirmed slot** — not to everyone who was invited to the poll, just the people who showed up and are actually free then.

**Call agenda & summary (optional per poll).** Any Scheduling poll — a branch call, a whole-community social call, anything — can optionally carry an open agenda and an expected summary, independently of each other and independently of what kind of call it is:

- **Agenda** — anyone in the call's audience can add an item beforehand (`CallAgendaItem`: poll, added-by, text), same low-friction, no-approval posting as Input round questions or an Assembly's agenda phase. Genuinely useful for operational calls specifically, since a visible agenda is what keeps a working session from drifting — not just a nicety for open discussion.
- **Facilitation and summary are auto-created tasks, not a manual step.** Scheduling a poll spins up two tasks right away — "Facilitate [date]'s call" and "Take notes & publish the summary for [date]'s call" — each taggable back to the poll it came from (`Task.source_poll_id` plus a role flag distinguishing the two). The organizer can self-claim or nominate someone for either immediately, or leave both open for the ordinary claim process to fill.
- **Summary + read-confirmation.** The notes/summary task's output is a `CallSummary` (poll, body, `published_at` — null until actually published), using the same notes/markup convention as everything else here. A `require_read` flag, set at scheduling time, decides whether the platform tracks who's actually seen it (`CallSummaryRead`: summary, member, read-at) and surfaces it as an unread item on the Dashboard for the call's audience until they have. This is a different kind of tracking than an Input round's per-question responses, which are always optional — a summary's read-confirmation is a plain acknowledgment expected of a defined audience, not an opt-in response — so it gets its own small mechanism rather than forcing a shared one, though it's shaped generically enough (a member and a timestamp against one artifact) to extend to something like Announcements later if a second real need for it shows up.

**Defaults live per Branch, with a Community-level fallback** — not a single Community-wide default, since a branch's own operational calls and an occasional whole-community social call can legitimately want different starting points (an operational call likely still wants its agenda on, just for a different reason — staying on track rather than staying open). Each Branch can set its own defaults for whether a new call there starts with the agenda on, a summary expected, and read-confirmation required; a branch that hasn't set its own inherits the Community default, which also covers any call not tied to a branch at all. Scheduling a new call pre-fills all three from whichever default applies, and the organizer can still override any of them for that one instance — the point is skipping the reconfigure-from-zero on a recurring call, not locking every call at a branch into one fixed shape.

**Where this sits relative to everything else that collects input from people**, since there are now several related mechanisms and it's worth being clear about which does what: **Questions** are the atomic "ask one thing, get an answer" unit, batched either through an **Input round** (recurring, task-linked, low-stakes) or an **Assembly** (ad hoc, community-scoped, phased, higher-stakes). **Forms** bundle several fields into one required, all-at-once submission — applications, surveys. **Scheduling polls** aren't asking anything at all in that sense — the output isn't an answer or a tally, it's a confirmed time. Four mechanisms, four different jobs, sharing vocabulary where it genuinely overlaps (Form fields and Questions use the same response-type shape) and staying separate where the underlying behavior actually differs.

---

## 👁️ Views

Same "one database, many lenses" principle: group by status → kanban; sort by phase/deadline → schedule (only if phases enabled); group by branch → coordinator coverage; filter by tags → "what fits me." None of this is domain-specific.

"What fits me" also folds in Requirement-driven surfacing (see Requirement): narrow-`individual_gate` tasks and currently-unmet `group_coverage` needs get pulled toward the members who could actually take them, on top of the plain tag match.

---

## 📝 Task notes: wiki, comments & resources

The task description stays goal-oriented — that principle doesn't change, and it's important enough to the whole project that it's worth protecting deliberately rather than letting it erode. But how people actually did a thing is real, useful information, and pretending otherwise just pushes it into side channels where it's harder to find, not less needed. The fix isn't a separate documentation system to go dig through — it's making optional, clearly-labeled notes visible right on the task itself, without ever touching the description field that defines the goal.

Three kinds of content, deliberately kept distinct rather than merged into one stream, because they behave differently and answer different questions:

- **Wiki summary** — one evolving block per task, editable by any member, not just the owner or someone with a special role. It carries a lightweight revision history (every edit is a new timestamped revision, "current" is just the latest one) so changes are visible and easy to walk back, rather than silent overwrites. This is where good advice gets synthesized once a pattern shows up across a few comments — the community's accumulated "if you're doing this, here's what's worked," written by whoever notices it's worth writing down.
- **Comments** — a simple timestamped thread, open to anyone, not just whoever currently owns or just finished the task. Someone who did this two cycles ago can drop a tip on a task that's just reopened; someone can add a note mid-task without waiting to finish it. The "anything worth capturing?" one-click prompt on marking a task Done drops straight into this thread as one comment — it's not a separate flow, just the easiest on-ramp into it.
- **Resources** — a short list of labeled links: "order form we used," "the sign design, printed at 5x7," "where we bought these from." Answers a different question than the other two — not "what worked" or "here's a tip," but "here's the actual thing, go use it directly." Each entry is just a label and a URL, addable and editable by anyone, no approval step. A tag (e.g. "purchase link," "template," "design asset") is optional and free-form, community-defined like everything else tagged in this system — no fixed category list to fight against.

  Deliberately **links, not native file storage**, at least for v1: a resource points at wherever the file already lives — the Community's own Nextcloud or Drive, a supplier's product page, a public template — rather than Orchard building its own upload/storage layer. Given the self-hosting instinct already established for auth and data, this keeps storage ownership where it already sits rather than duplicating it, and it's a meaningfully smaller build than adding real file storage (limits, backups, virus scanning) for what's fundamentally a pointer. If in practice something genuinely has no other home, native upload is a clean thing to add later without disturbing this schema — worth watching for whether that friction actually shows up rather than building for it preemptively.

**Placement matters as much as the mechanism.** All three live directly on the task detail view, in a section that's clearly separate from the goal statement — visually distinct enough that nobody mistakes "here's how Alex did it last time" for "here's what you're required to do," but not buried behind a toggle, a mode switch, or a different part of the app. The task's own description never gets edited to absorb this content; that boundary is what actually keeps the goal-not-method principle real rather than aspirational.

**Carrying forward across cycles.** When a task is cloned into a new cycle (or a pack is imported), the wiki summary and the resource list both come along as the new task's starting point — the wiki as a seed the new owner can keep editing, resources copied wholesale since a working link or a print-ready file is just as useful next time with nothing to re-synthesize. Individual comments don't carry forward automatically: a comment from three cycles ago about a since-changed situation isn't obviously still true, and dragging the whole history forward every time would eventually bury the wiki summary it's meant to feed. They stay attached to the task instance they were written on, one click away via a link back to the task it was cloned from. Nothing is lost — a fresh task just doesn't open already cluttered. *(This resolves what was previously an open question on whether documentation carries forward automatically — the wiki and resources do, the comment history doesn't, and that split does the actual work.)*

No special access model needed beyond ordinary task-board visibility — none of this is sensitive by nature, so it inherits whatever visibility the task already has rather than needing its own permission layer.

**For knowledge that doesn't belong to any single task** — general reference material, platform how-to, FAQs, camp lore or policy — see the **Documentation** module, below, which also surfaces an aggregated, browsable index of every task's own wiki content for anyone who'd rather browse by branch or topic than dig into individual task cards.

---

## 📋 Optional modules

Everything past the core task/member/branch engine and coordination mechanics is opt-in per Community, since each one is real backend surface (extra tables, extra access rules, sometimes extra compliance burden). These were compressed too far in the first draft of this doc — the mechanisms below are real, previously-designed detail, generalized rather than dropped. A community turns a module on or off (or through the testing state above); it doesn't get a lesser version of the mechanism if it turns one on.

### Recruitment

Handles bringing new members in where that's a distinct, evaluated process rather than an open door.

- **Application intake** — a Form (see **Forms**, below) with purpose `recruitment_application`. On submission, everyone subscribed to recruitment notifications is alerted with a link.
- **Invite links — a second, private joining path.** Any member can generate a shareable join link (`CommunityInvite`), always single-use — no multi-use variant for anyone, since an indefinitely-shared link is a real access-control risk the same way CampTool found out the hard way. Creating one takes an optional `label` (so someone generating several links for several different people can tell them apart and see who's used which) and two independent checkboxes: **"I think this person is a good fit"** and **"I personally know this person."** Redeeming the link records `referred_by_member_id` on the new Member automatically — a real, private edge, not something the public application page has to ask about (a searchable list of member names on a public-facing form is its own privacy problem, so this stays off the public form entirely).
- **The checkboxes feed the same decision logic Evaluation already uses, rather than a separate skip-flag system.** They're a pre-existing, informal recommendation from someone who already has a relationship with the applicant, and the Community's own recommendation-to-outcome mapping (see Evaluation + decision logic, below) decides what that's worth — skipping Evaluation entirely, reducing it to one evaluator instead of two, or changing nothing at all. That keeps the actual decision logic in one configurable place rather than growing a second bespoke system next to it.
- **A public inquiry inbox, not a CRM.** The public-facing page also carries a simple "message us" box — no application structure, just a question or an expression of interest. It lands as an `Inquiry` (message, contact info, timestamp) in a queue visible to anyone holding a recruitment-facing task, who can claim one to answer personally — same low-stakes claiming as everything else here, mainly so two people don't unknowingly cold-message the same interested person. This deliberately stops short of a full CRM (ongoing interaction history, merging duplicate threads when several members have separately talked to the same person) — real, heavier machinery CampTool actually built, worth revisiting if overlapping informal contact turns out to be common enough to need it, but more than the problem currently calls for.
- **Recruitment-mode subscription** — a standing opt-in (not a task claim) any qualifying member can activate, enabling their availability tool and application alerts. Auto-lapses after N consecutive applications with no availability given, with a warm one-tap resubscribe prompt rather than a penalty notice.
- **Conversation scheduling** — a Scheduling poll (see **Scheduling polls**, below) with the applicant and both evaluators as required participants, so a confirmed slot only counts if all three can make it.
- **Evaluation + decision logic** — however many evaluators the community assigns (two, in the reference case) fill an evaluation form and give a recommendation. The mapping from recommendation combinations to outcomes (proceed / open to wider discussion / decline) is community-configured, not hardcoded — Peach Please's specific matrix becomes one configuration of this, not the only shape it can take. When the applicant came through an invite link, its good-fit/personally-know checkboxes (see Invite links, above) are additional inputs into this same mapping, not a separate decision path.
- **Wider discussion window** — for borderline outcomes, a time-boxed window opens where subscribed members can raise an anonymous-to-the-community (but visible-to-the-evaluators) objection. No objection by the deadline → the recommendation is auto-followed. An objection → the evaluators lead a conversation before any decision.
- **Accompaniment** — an ongoing task type, not a side process: "Accompany [new member]," created on acceptance, owned by a senior/eligible member, closing at a defined point after onboarding. The accompanier gets explicit (member-aware) visibility into the new member's engagement record, so a human notices patterns before the system has to flag them. When the new member has a `referred_by_member_id` (see Invite links, above), that's the natural default suggestion for who accompanies them — it's easier to accompany someone you already have some relationship with, the same reasoning behind carrying a shadow forward as a task's suggested next claimant.
- **Rejection templates** — a written starting point for the hardest message in the flow, so declining isn't done from a blank page.

#### Recruitment pipeline view & computed status

Each candidate's status in the pipeline is a **computed read-out of state that already exists elsewhere in the system, never a separately-maintained field someone has to remember to update.** An application's status derives from whatever's actually happened to its FormResponse and the things linked to it: *applied* (FormResponse submitted, nothing else yet) → *evaluation in progress* (some but not all Evaluations filed) → *call pending* (evaluations in, the intro Scheduling poll hasn't confirmed a slot yet) → *call scheduled* (poll confirmed) → *decision pending* (call happened, no outcome recorded) → *accepted* / *declined* / *waitlisted* → *accompaniment assigned* (the "Accompany [new member]" task has a claimant). Nothing here is a new field to keep in sync by hand — it's read off the Form/Evaluation/SchedulingPoll/Task state that the rest of Recruitment already produces.

This status feed is what makes a **Recruitment pipeline view** possible: a list of everyone currently in flight, their computed stage, and how long they've sat there — the same "list of people and where they are" instinct as a task board, just applied to candidates instead of tasks. Whoever holds a recruitment-facing task sees this list; it's not a community-wide view, since a rejected or in-progress candidate's status isn't the kind of thing that needs default-open visibility the way a task does.

Alongside each candidate's status, the same view also shows the Cycle's remaining capacity (see Participation & capacity under Cycle) and a composition breakdown of who's already confirmed — by Tier, Branch, or whatever tags the Community tracks. That's informational context for keeping the group balanced, not a scoring formula the platform applies on anyone's behalf — what "balanced" actually means for a given community is a human judgment call, same as everywhere else Orchard deliberately stops short of deciding for people.

The pipeline view is also where the "needs action" signal lives, surfaced on the dashboard (see **Dashboard**, below) for anyone holding a recruitment task: candidates with evaluations filed but no call scheduled yet, or a call that happened with no decision logged, show up as concrete action items rather than something a recruiter has to remember to check for. This is the same principle CampTool's onboarding-auto-derivation idea points at, applied one level up: not just "is this member's own onboarding done," but "is this candidate stuck waiting on us."

**Scope note — this status feed only covers the evaluated-admission path**, deliberately. Two related things stay separate rather than folding in: (a) a member's own **onboarding/task status** once accepted (do they have tasks, have they completed onboarding steps) is a different lens on a different population, covered under Member onboarding and the Dashboard below; (b) anything that's genuinely task-scoped rather than recruitment-scoped — whether someone's ticket is purchased, whether their tent has been placed on the Plot — is real status too, but it belongs to whoever holds *that* task (the Spatial planning holder cares whether a placement is confirmed; a member checks their own ticket status themselves), not to the recruitment pipeline. Recruitment shouldn't grow into a general-purpose "everything about this person" dashboard; each task-holder's view surfaces the state that's actually relevant to the task they hold, per **Access follows the task** (see Transparency & access).

### Budget

Handles collective financial decisions where the community pools and allocates money.

- **Fixed costs** — entered by the budget task owner before proposals open: the non-negotiable floor (infrastructure, contingency, any locked commitments).
- **Proposals** — any member submits an itemized proposal (cost breakdown, description, which branch/phase it relates to) before a submission deadline, closed before voting opens.
- **Ranked-choice voting** — the voting view shows each proposal's total and itemized cost, cost-per-member, a running total if everything above a given rank were funded, and a "how much would you contribute this year?" question feeding contribution planning.
- **Confirmation** — the budget owner takes the ranked results, fixed costs, contribution signals, and current financial picture, and produces a final budget. Ranked choice sets priorities, not a binding yes/no per item — the final call is human, with a published rationale for any deviation from the ranked order.
- **Contributions** — the sliding-scale ask happens with real numbers once the budget is confirmed, against what members already signaled they'd give.

### Event scheduling

Handles a community's own internal programme — sessions, activities, workshops, whatever the community runs for itself or its guests.

- **Proposals** — any member submits a proposal (host, title, description, duration, space needs, preferred slots). The form can optionally be opened to non-members via a public link, for communities that take outside contributions.
- **Scheduling flow** — the task owner reviews proposals and flags slot conflicts. Where proposals compete for the same slot, the system notifies the relevant hosts and invites them to resolve it directly — compromise, swap, or combine — with the scheduler facilitating but not arbitrating by default.
- **Publication** — once conflicts resolve, proposals lock and the schedule publishes, readable by all members.
- **Export profiles** — a community can define an export target (character caps, duration multiples, field limits, whatever a downstream platform requires) that's visible to hosts *during* proposal entry, not discovered as a rejection afterward. This generalizes the original spec's one-off "Elsewhere export" into something any community with a similar downstream constraint can configure for itself.

### Spatial planning

Handles physical layout planning for a venue or site — generalized from barrio/camp layout, but not specific to camping: a housing coop planning room and furniture layout, or any community planning a physical space, fits the same shape. Deliberately **not** tied to any one venue's real-world geometry: there's no built-in address system or automatic geometry calculation for a specific event (the reference research into CampTool's Black Rock City radial-lot math was a useful look at how deep that kind of thing can go, but it's the wrong shape for a general engine) — a Plot's shape and size always comes from what the Community actually provides for its own site, either an imported image/vector or hand-drawn, calibrated to real-world scale. That's a deliberate trade against automatic per-event geometry: less turnkey for a Black-Rock-City-specific deployment, far more broadly usable everywhere else.

- **Plot** — the base area being planned, scoped to one Cycle (see **Cloning across cycles**, below, for how a new Cycle gets its starting Plot rather than inheriting the previous one automatically). Either an imported base (raster image like a satellite photo or site plan, or a vector/GeoJSON import) with a scale calibration (mark two points, enter the real-world distance between them, everything else scales off that), or a boundary drawn from scratch if no import exists.
  - **Geo-anchoring (optional).** Either calibration point can also carry a real GPS coordinate instead of, or alongside, the plain real-world distance — two georeferenced points are enough to compute a similarity transform (translate, rotate, uniform scale) between the Plot's local coordinate space and real-world WGS84 coordinates. Entirely opt-in: a Plot with no geo-anchor behaves exactly as before, pure local scale with no map dependency. It exists for one reason — data exchange with whoever coordinates the physical site at a larger scale (importing a boundary they hand over as a real geo object, exporting a Placement's real coordinates so an external crew, the power grid say, knows exactly where to connect a distro node) — not for rendering an actual map. This is a different thing from the automatic per-event geometry already ruled out above (CampTool's radial-lot math): that was the platform inventing your layout from an address system; this is an already hand-drawn or imported Plot optionally anchoring itself to real coordinates after the fact.
- **Zones** — named regions within the plot (camping area, kitchen, parking, shared/chill space, quiet zone) — polygons with a name, category, and color, purely organizational.
- **Placements** — individual shapes drawn within the plot: rectangle, circle, polygon, or line, each with real-world dimensions (not just pixel size — "3m × 2m" draws to scale against the plot's calibration), position, rotation, a label, and a category (tent, vehicle, structure, furniture, generic) — a Placement's rendered color follows its category rather than a separately stored color field, unlike Zone, which carries its own explicit color as an organizational overlay. Optional links to one or more Members (whose tent/van this is — see Shared placements, below, for the shared case) or a Task (the structure this task is building — see Multi-user placement, below, for how a Task-linked Placement gets the same self-service editing rights a Member-linked one does).
  - **Shape inventory.** Any Placement can be saved into the Community's reusable shape library — geometry, category, and label, decoupled from the Placement it was saved from — and a new Placement can start from a saved entry instead of a blank draw, still freely resized/rotated afterward. A handful of common defaults (a standard 2-person tent, a van) seed the library; it otherwise grows from whatever people actually draw and save, the same "start with the hardcoded common cases" posture Forms already takes rather than a full catalog-management screen from day one.
- **Space preferences** — a small member-profile extension, only relevant when this module is on: sleep/space arrangement (solo tent, shared tent, solo vehicle, shared vehicle, other), vehicle dimensions if relevant, an optional "prefer to be placed near" list of other members, an optional "sharing this space with" list — who they expect to actually occupy the same tent/vehicle with, a different question from just wanting to be nearby — and any accessibility notes. This feeds the layout conversation — it informs sizing and grouping, it doesn't auto-place anyone, and it doesn't by itself grant anyone rights over anything. Placement stays a manual, collaborative act; the preference data just means the person drawing the layout isn't guessing. (See **Shared placements: invite → accept**, below, for where a stated intent to share actually turns into a structural fact — a preference alone never does.)
- **Collaborative drawing tool** — the actual editing surface. Technically this is the heaviest module to build (closer to a lightweight collaborative floorplan/CAD tool than to a form), so it's worth scoping deliberately rather than folding into a generic "modules" build slice:
  - Base layer: SVG-based editor (fits the browser-native, scale-friendly, already-used-elsewhere-in-this-project mold better than canvas + a heavier library).
  - Draw primitives with real-world dimension input: drag an existing vertex to move it, click the midpoint of an edge to insert a new one there, select a vertex and delete it to remove one — plus a live area label at the shape's center and a live length label on each edge, both recomputed continuously while dragging, not just shown after a save. Rotation is a drag handle that appears on a selected shape, not a typed angle. No snap-to-boundary/grid tooling for v1 — worth adding later if the tool's actual use surfaces a real need for it, not guessed at now.
  - Layer/zone visibility toggles, labeling.
  - **Export**, offered as a choice of scope (one Placement, one Zone, or the whole Plot) and format: an image (for sharing outside the platform, unchanged from before) or a GeoJSON object (real WGS84 coordinates when the Plot has a geo-anchor set, local coordinates otherwise) — the same shape a Plot's geo-anchored import already accepts, so the two are one mechanism used in both directions rather than a separate export-specific format.

#### Cloning across cycles

Plot, Zone, and Placement all belong to one Cycle — a Community running recurring gatherings genuinely re-plans its site each time (a barrio's shape, a coop's room layout, rarely comes out identical twice), so nothing here defaults to persisting forever across every Cycle a Community ever runs. A new Cycle's spatial plan starts empty unless someone deliberately clones one in — never automatic, matching how a Placement's own edits never silently apply either (see Multi-user placement, below).

Two distinct paths, because they can honestly offer different guarantees:

- **Cloning as part of cloning the whole Cycle** (see Cycle, and Task Pack, above) — when the Cycle itself is being cloned from a previous one, an explicit prompt asks whether to also clone its spatial plan. Answering yes makes it a real full clone: Tasks are already being recreated in the same operation (each new Task's `cloned_from_task_id` pointing at its source, per Task Pack's existing carry-forward mechanic), so a cloned Placement's Task link is remapped onto the new Task instance rather than dropped — the link stays meaningful because both ends of it were cloned together. Member links never carry over regardless — who's actually attending isn't knowable yet at clone time, the same reasoning Space preferences already leans on. This option only exists on the immediately-previous-cycle clone path, the same restriction Shadow slots' `suggested_member_id` carry-forward already established (see Shadow slots & succession) — a generic, cross-community Task Pack import never drags along someone else's physical site layout.
- **Cloning the spatial plan on its own**, independent of Cycle creation (picking a starting layout after the fact, or from a Cycle other than the immediately previous one) — geometry, Zone assignment, category, and label copy over; both Member and Task links are dropped, since there's no guaranteed-matching Task or Member set on the other end to remap them onto. The picker offers the most recent past Cycles first; once Cycle type exists (see Cycle type, above), the default option becomes the most recent Cycle *of the same type*, with other past Cycles still available beneath it as a fallback — no schema change either time, just a smarter query over Plot/Zone/Placement rows that already exist.

#### Multi-user placement: propose → pending → approve/revert

This answers what was previously Open question #3 (real-time collaboration vs. single-editor-with-save) — the answer turns out to be neither, for the specific case that actually needs multi-user access most: **a member adjusting their own stuff, not several people drawing on the shared canvas at once.**

- **Any confirmed Member linked to a Placement — or, for a Placement linked to a Task instead of a Member, whoever currently holds that Task — can move, resize, or rotate it at any time**, without needing anyone's permission first — one confirmed co-owner (or one holder of the linked Task) acting is enough; nobody else linked to it has to sign off before the change takes effect. The change applies immediately (so it never feels blocked), but the Placement is flagged `pending` rather than `confirmed`, and its previous geometry is kept (`pending_prev_geometry`) so it can be cleanly restored.
- **Every Member linked to the Placement — confirmed or still-invited — gets notified when it moves**, regardless of which of them made the change; for a Task-linked Placement, every current holder of that Task gets the same notification. This is visibility, not a sign-off: nobody has to approve a co-occupant's (or co-holder's) edit before it applies, the same assume-good-faith, surface-it-rather-than-gate-it pattern the rest of Orchard already leans on (a coordinator proposing a co-owner, a peer nominating someone for an open slot). It just means nobody discovers their tent — or their team's structure — moved by walking the site — they get the chance to raise it through the ordinary task-comment/coordinator channel if something's actually wrong, without that being required of anyone.
- **Whoever holds a Spatial planning task reviews pending changes** — approve (locks the new geometry in as `confirmed`) or revert (restores `pending_prev_geometry`, notifies whoever made the change why, if they leave a note). This is deliberately **not** an officer-only gate: it's the ordinary task-claim mechanism already used everywhere else in Orchard. Whoever has claimed the "lay out the Plot" task (or any task tagged for it, if there are several co-holders) can review — there's no separate hardcoded role for it, and a Community with several people sharing that task shares the review load the same way any multi-slot task's holders would.
- **This sidesteps the real-time-multiplayer question entirely for the common case**, since two members are never simultaneously fighting over the same live cursor — a Placement is edited by exactly one person at a time, whether it has one confirmed Member (or Task holder) or several, until it's reviewed. The heavier real-time-collaboration question (several people freely editing shared, un-owned Placements like Zones or communal structures at once) is still real but much smaller in practice, and can stay single-editor-with-save-and-reload for v1 (unowned Placements and Zones are edited directly by the Spatial-planning task holder, no propose/approve step needed since there's no other owner to protect against). This also isn't a live-multiplayer surface even for the owned case above — a save becomes visible to everyone else on their next reload, not through any live broadcast channel; that's a deliberate, adequate fit for how this actually gets used (someone saves a change, then says so on a call), not a gap to fill later.
- **Three tiers of editing rights on a Placement, not two.** A Member-linked Placement is edited by its confirmed Member(s). A Task-linked Placement with no Member is edited by whoever holds that Task — the kitchen crew adjusting their own structure, or whoever's planning the showers, without needing the Spatial-planning task holder for routine tweaks. A Placement with neither link — communal structures, shared infrastructure with no specific owner — skips the pending state entirely and stays directly edited by whoever holds the Spatial-planning task, the same as every Zone regardless of any link. This deliberately doesn't extend to a Task or Branch claiming a whole Zone's editing rights — a bigger question (a sub-group self-service-owning a broad shared area the way a Placement now lets an individual Task own one shape) that's worth setting aside for now and revisiting only if it turns out to matter in practice.
- This same propose→pending→approve/revert shape is generic enough that it's worth keeping in mind for other places a member might want to adjust something they own without needing to route through a request first — it isn't spatial-planning-specific machinery, just applied here first because this is where the need showed up.

#### Shared placements: invite → accept

A tent or vehicle two or more people actually occupy together is one Placement, not several overlapping ones — but linking several Members to it means several people gain real editing rights over it, and that's a structural fact, not an informational one. Space preferences' "sharing this space with" field can't be what grants that on its own — a preference is one person's stated hope, not confirmation from the other side. The line between the two is an explicit invite and accept, the same shape Orchard already uses whenever one person's stated intent shouldn't unilaterally bind another (a peer nominating someone for an open task slot, a coordinator proposing a co-owner):

- **Creating a shared Placement starts with one person** — a member placing their own tent, or the Spatial-planning task holder laying it out on someone's behalf — same as any other Placement. That person names who else should be linked; their own "sharing this space with" answer, and anyone else's preference that names them back, pre-fill the suggestion, but don't have to be the only source — the creator can add or drop names freely.
- **Named co-occupants are linked as `invited`, not `confirmed`.** An invited Member shows up on the Placement, so it's visible who it's expected to include, but doesn't gain move/resize/rotate rights until they act on it. Until then, the Placement behaves exactly as a single-owner one does today — only its creator (or, if unowned, the task holder) can edit it.
- **Accepting promotes an invited Member to confirmed**, at which point they're a full co-owner under the propose → pending → approve/revert flow above — able to move the shared Placement themselves from then on, and notified the same as any other linked Member whenever it changes. **Declining** just drops them from the Placement — wrong tent, plans changed, no explanation required.
- **Invites and responses are notified**, the same as anything else here that expects a person to act — an invited Member is told they've been named on a Placement and asked to confirm or decline; nobody is silently made a co-owner of something they haven't agreed to, and nobody who invited someone is left wondering whether it landed.

### Conflict management

Promoted out of `[Later]` — the case for treating this as a human problem outside the platform's scope stops holding up once the whole point of the platform is to stop institutional knowledge and unnoticed strain from depending on one person's after-the-fact check-in calls to surface at all. It's still optional per Community (a very small, very high-trust group may genuinely not need a formal process), but it earns the same design weight as Recruitment or Budget rather than a thin, deferred afterthought.

- **The conflict team is just a task, reusing what already exists.** A critical, multi-slot coordination task like any other ("Conflict team," capacity > 1, no rank between co-holders) — it doesn't need its own membership concept. The Community stores a pointer to which task that is (`conflict_team_task_id`), and whoever currently holds it, per the ordinary TaskAssignment mechanism, is the team. Kept critical for the same reason backstop tasks are: an empty conflict team is a real structural gap, not a minor one. Deliberately independent from whoever holds the community's other critical/backstop tasks by default — the same person shouldn't usually hold both.
- **Reporting starts as a low-friction signal, not a form.** The same shape as "talk to my coordinator": one action, no categorization or detail required up front. A report can be created with nothing but "I'd like to talk to someone" — the description field is optional, not a gate. Detail can come later, in the actual conversation, once the person's talking to someone they trust rather than typing into a box.
- **Recusal, from three directions, not just the reporter.** The reporter can exclude specific current team members at the moment of reporting — the original case, someone directly involved. But a team member can also recuse *themselves* on realizing a conflict of interest the reporter had no way to flag, and one team member can recuse *another*, for the same reason — a close relationship (a partner, most obviously) can bias someone just as much as direct involvement, and the person carrying that bias doesn't always recognize or volunteer it themselves. All three routes land in the same place: a growing exclusion list per report, not a single reporter-only setting.
  - This has to be genuine invisibility, not access-denial: an excluded team member's view of the queue should look exactly as if the report didn't exist — no visible gap, no "you've been excluded" notice, no count that doesn't add up. A recusal that lets someone infer they were the reason for it isn't actually safe.
  - One honest limit: this only achieves full invisibility if the recusal happens *before* the person has opened the report. Self- or peer-recusal after someone's already seen the details can still remove them from further handling, but it can't un-show them what they've already read — worth naming as a real limit rather than implying the guarantee is absolute regardless of timing.
  - Automating recusal isn't really tractable — the platform can't know most relationships. A narrow version was floated — a member optionally, privately declaring a primary partner, powering a soft *"you may want to consider recusing"* prompt if that partner turns out connected to a report — and it's a deliberate no: it would only ever cover a fraction of the relationships that could bias someone, and a false sense of "the system would catch it" is worse than no automation at all. Recusal stays entirely on people recusing themselves and each other, per the three routes above.
  - **This is also the one place View-as (see Transparency & access) explicitly does not reach.** A Support-task holder can view as anyone else in the system for ordinary troubleshooting, but viewing as a conflict-team member never bypasses that member's own recusal filtering, and Support never renders the unfiltered conflict queue for debugging purposes either — a real bug in the filtering logic needs a code-level fix, not a live view-as session, precisely because the invisibility guarantee has to hold against every access path, not just the ordinary one.
- **Flow** — flag → acknowledged within a set window (24h in the reference case, community-configurable) → whichever eligible team member takes it becomes the point of contact → conversation offered → resolution noted. Visible only to the reporter and whoever's handling it, unless the reporter chooses to escalate further.

Post-cycle feedback doesn't need its own module — it's just a Form (see **Forms**, below) used for a survey after a cycle wraps, reviewed by an ongoing "review responses" task. The one thing worth keeping from treating it separately: the hand-off from a feedback response to an actual conflict report should stay explicit and human-mediated, never automatic — a reviewer reaches out to the person first, and only with their buy-in does it become a real ConflictReport, which can then keep a quiet pointer back to the response it grew out of.

### Profile questions

A shared mechanism, not a module — the answer to standing facts about a person that shouldn't be pinned to whichever flow happened to ask first. A regular Form (see **Forms**, below) is right for a genuinely one-off, all-at-once bundle like a post-cycle feedback survey. It's the wrong shape for things like an emergency contact, pronouns, or "how are you arriving" — facts that get asked at one moment (an application, an onboarding step) but conceptually belong to the person, not to that moment, and that a rigid form bundle makes awkward in three specific ways: no notion of *when* a question should even be asked (an application form and a closer-to-the-event logistics form differ only by when they're sent, which today means maintaining two separate forms by hand); no way for some fields to stop being asked once they're known while others in the same bundle keep needing a fresh answer every cycle; and no way for the same question to show up in more than one context without duplicating its definition.

- **ProfileQuestion** — the definition: label, response type (same shape as everywhere else — free text, single/multi-choice), a `scope` of `once_ever`, `per_cycle`, or `phase`, which audiences it applies to, which surfaces can trigger it (application, onboarding, wherever), whether it's required, and an `archived_at` so a retired question's past answers survive.
- **ProfileAnswer** — member, question, a `status` of `answered` or `deferred` ("I don't know yet" — satisfies a required question without forcing a guessed or fabricated value), a value (present when answered), and a `cycle_id` that's set for both `per_cycle` and `phase` questions — a once-ever answer isn't tied to any cycle, it's just *the* current answer.
- **Where it lives.** A once-ever answer sits on the member's own profile the same way their tags or contact methods do — visible and editable by them at any time, not something they have to hunt down a form to correct. "Once-ever" only means the platform doesn't proactively re-ask it by default; it was never meant to mean locked, since the facts these questions capture — an emergency contact, pronouns — do sometimes change.
- **Surfacing.** Whenever a flow like the application or onboarding would normally present its questions, it also pulls in any ProfileQuestion tagged for that surface that this member doesn't yet have a real answer to — no answer at all, or a `deferred` one. This is what makes skipping the application (an invite-vouched applicant, say) a non-event rather than a gap someone has to remember to backfill: the same still-unanswered questions just surface the next time a relevant surface — onboarding — checks what's outstanding, with no flow needing to know it was skipped anywhere else. A `deferred` per-cycle question also shows directly on the Dashboard as its own outstanding item, since the real trigger for asking it again is usually just time passing (closer to the event) rather than a second formal flow starting.

**A third scope: `phase`.** Some per-cycle facts aren't knowable all at once — a member might know their Recruiting-phase bandwidth right away and have no idea about Build until something else (PTO, a schedule) resolves. `scope = phase` behaves exactly like `per_cycle` (still one ProfileQuestion, still answered/deferred with the same mechanism, unchanged) but is additionally scoped to one phase — a community defines one standing question per phase name it actually needs a check-in for (e.g. "Availability — Recruiting," "Availability — Build"), each a real, separate ProfileQuestion row, resolved via `phase_name_hint` matched against the current cycle's Phase names — the same "matched or remapped on import" pattern TaskPack already uses for `branch_name_hint`, rather than a new mechanism. A cycle with no phase by that name just doesn't surface the question, not a special case. Resurfacing for a deferred `phase` question works the same way a `per_cycle` one already resurfaces "closer to the event," just measured against the matched phase's own `start_date` (see Phase, in the data model) instead of the whole cycle.

**Availability and its own visibility setting.** The canonical use of `phase` scope is a standing "Availability" question per phase, feeding the Coordination view's capacity-aware fitted asks (see Coordination mechanics, above) — declared bandwidth compared against a member's current Effort magnitude load. Consistent with how each contact method already carries its own visibility setting rather than a single privacy page gathering them all, the `capacity_visibility` setting (enum `flag_only` default, or `open`) lives right where a member answers an Availability question, governing whether the Coordination view shows their exact numbers to coordinators or just the coarse flag.

**Who hasn't answered is a separate, always-visible signal.** `capacity_visibility` governs the *value* of an Availability answer — it was never meant to hide the plainer fact of whether one exists yet. A member with no real answer for the current phase (no ProfileAnswer row at all, or a `deferred` one — both mean "no usable number from them yet," and neither needs a new field to distinguish for this purpose) shows up on the Coordination view's non-response list regardless of their `capacity_visibility` setting, the same way a poll's non-respondents are already visible before anyone sees a submitted slot (see Scheduling polls). This is what lets coordination have an actual conversation about a real gap instead of it sitting unnoticed as a blank field — see Coordination mechanics: Availability non-response, below.

### Forms

A shared mechanism, not a module a Community turns on independently — it's infrastructure other modules lean on, the same way Requirement is. A **Form** is a community-defined set of fields with a stated purpose; a **FormResponse** is one submission, optionally anonymous. Recruitment's application intake is a Form; a post-cycle feedback survey is a Form. The mechanism doesn't care which — what differs between uses is only which task reviews the responses and what happens next.

**Are Forms made of Questions?** Partly, and it's worth being precise about which part. A Form's fields use the exact same shape a Question does — free text or closed-choice, with the same options structure — so there's no second type vocabulary to maintain. What keeps a Form its own container rather than literally a set of Question rows: a Form's fields are submitted *together, once, as a single validated event* — required fields block the whole submission until they're filled in. A Question, wherever it lives (an Input round, an Assembly), is always independently optional to answer — nobody's blocked from responding to the parts they care about. That's a real behavioral difference, not just an organizational one, so the two stay related but separate.

Not everything with fields becomes a Form, either: Event proposals stay their own dedicated entity rather than folding in here, because the platform actually reasons about specific fields on a proposal (slot conflicts, duration) — a Form's fields are opaque to the platform, read only by whoever's reviewing. That's the test for whether something belongs in Forms or needs its own shape: does the platform need to act on the specific fields, or does a human just need to read them?

### Documentation

**Defaults on**, unlike every other module in this section — the founding problem this whole platform exists to solve includes institutional knowledge evaporating when someone steps back, and this module is a direct answer to that, on the same footing as Task notes rather than a nice-to-have a community has to remember to turn on. A community can still switch it off if it genuinely wants everything task-scoped, same as any other module.

Handles knowledge that doesn't have a natural home on any single task: general reference material, "how this platform works," camp policy or lore, and FAQs — plus a browsable index over knowledge that *does* live on tasks already.

- **WikiPage** — freestanding pages, open to edit by any member, with the same shape as a task's wiki summary: a lightweight revision history where "current" is just the latest edit. Each page can optionally carry a `branch_id` purely for filing (null = general — plenty of what belongs here, like platform how-to, isn't about any one branch). Pages share the same cross-linking convention as TaskWikiRevision content, so an author doesn't have to learn two markup systems depending on which kind of wiki block they're in — a page can link to another page, a Task, or a Branch.
- **FAQ, without a separate schema.** A page can start as just a question, no answer yet — same low-friction, no-categorization-required posting as everything else here (talk-to-my-coordinator, conflict reporting). It sits flagged `question_pending` until someone fills in a real body, at which point it's an ordinary published page — one entity across its whole life, not a submissions table that graduates into an article.
- **Resolving as a duplicate.** Sometimes the honest answer is "this already exists" — resolving a pending question doesn't have to mean writing content at all. Pointing it at an existing page (`duplicate_of_page_id`) counts as resolving it: the question stays findable, but drops out of the main browse index as its own entry and instead shows up on the canonical page as "also asked as…" — useful curation signal in its own right, since a question that keeps getting re-asked and redirected to the same page usually means that page isn't titled or tagged well enough for people to find on their own.
- **The index over task wikis is a view, not new storage** — for every Task, its current wiki revision, grouped however's useful (by branch to start; by tag or by cycle are cheap to add once the browse UI exists), the same "one database, many lenses" principle everything else here already leans on. This is what lets someone browse "how do we do things around here" without drilling into individual task cards, without duplicating any content that already lives on a task.

### Assemblies

Handles the gap Input rounds deliberately doesn't cover: community-wide decisions, not task-execution questions — everything from a genuinely urgent one-off ("where is the barrio going on the map") to slower, more deliberate structural questions (should a Tier's criteria change, should a new Branch exist). Reuses the same **Question**/**QuestionResponse** shape Input rounds already uses — a question, answered free-text or closed-choice — inside a different container, because the lifecycle here is genuinely different, not just the content.

- **Propose → agenda → notice → vote → close.** Any member can propose an Assembly, same open-access principle as everywhere else — no gatekeeping on who's allowed to call for one. Once proposed, a configurable window lets anyone add items to it (the agenda-building phase), then a configurable notice period where the agenda is locked and visible but voting hasn't opened yet, then a configurable voting window, then it closes and results are tallied and published.
- **Every duration is set per Assembly, not fixed per Community.** A fast, urgent placement decision and a slow, deliberate structural question are the same mechanism run at different speeds — the proposer (or whoever the Community delegates that judgment to) picks durations that fit what's being decided, down to compressing agenda and notice to nearly nothing for something genuinely time-sensitive.
- **Results are always advisory, never auto-applied.** The platform tallies and publishes what came back. Turning that into an actual change — a Tier's criteria, a Branch, anything in the Configuration model — stays a deliberate, separate human action. This is the one firm rule that keeps Assemblies from quietly becoming a specific governance philosophy baked into the platform: it's a tool a community can point at whatever decision it wants, not a vote-counting authority that overrides however that community actually governs itself.
- **No built-in urgent notification, on purpose.** An Assembly is just a page with a link, the same as anything else here. Getting the word out fast for something time-sensitive is a human pasting that link into whatever channel the community already uses for urgent things — the same boundary Input rounds draws, applied consistently rather than as a one-off exception.
- **Budget keeps its own voting mechanism**, rather than folding into this — ranked-choice against itemized costs and running totals is a genuinely different computation than a simple tally, the same reasoning that keeps Event proposals out of Forms.

### Sensitive data

Health, allergies, orientation, emergency contacts. GDPR Art. 9 handling if enabled. Off by default. Field-level access is purpose-bound rather than role-bound — a Community defines which task or tier unlocks which field (e.g. only whoever holds the catering coordination task sees allergy data; only the designated safety contact sees health conditions), consistent with the "access follows the task" principle below.

### Shifts / rota

Recurring, never-"done" work distinct from tasks. Relevant to physical events and standing operational duties; irrelevant to, say, a software project.

---

Core (always on): task board, member profiles, branches, tiers, requirements-based matching, task proposals, basic notifications, coordination mechanics, input rounds, scheduling polls, contribution tracking, task notes (wiki + comments + resources), forms (shared primitive), profile questions (shared primitive).
Optional (per Community, off by default except where noted): recruitment, budget, event scheduling, spatial planning, sensitive-data, conflict management, assemblies, shifts/rota, **documentation (on by default)**.

*Stretch, not scoped here:* letting communities define Form fields through a UI rather than config — MVP forms are hardcoded per use (application, feedback, etc.), a real no-code field builder comes later.

---

## 🌟 Member onboarding & first session

Separate from Recruitment's application/evaluation flow (getting someone in) — this is what a newly-accepted member actually experiences the first time they open the platform, and it's not domain-specific:

1. **Bite-size tutorial** — how the platform works, in a handful of cards, not a manual.
2. **Strengths + participation preferences** — the member defines their own tags and availability; this is the matching input, not something assigned to them.
3. **Suggested fitted tasks** — 2–3 matched tasks surfaced immediately, so the first session isn't a blank board.
4. **Search/filter** — an escape hatch for self-starters who'd rather browse than be handed something.
5. **Related tasks** — finishing one task surfaces a nudge toward the next. This is the growth engine for the "start small, take on more" participation type.

The goal, regardless of domain: a new member's first session should end with at least one task claimed, not just toured.

### Member contact preferences & emergency access

Each contact method a member adds (email, phone, chat handle, whatever the Community uses) carries its own visibility setting, member-controlled: **everyone in the community**, **people I share a task or group with**, or **emergency only**.

**Emergency mode** lets any member surface another member's emergency-only contact info when needed. Both the person activating it and the person whose info is accessed get notified. The activator provides an explanation — can be added after the fact rather than blocking the moment — and every activation is logged.

---

## 🧭 Dashboard

A member's home view, generalized from the season-aware onboarding idea explored in the CampTool comparison: **what shows up here is computed from a member's actual current state — the tasks they hold, the tasks they coordinate, where they are in recruitment if relevant — never a separately-maintained to-do list that can drift from reality.** The same underlying principle as the Recruitment pipeline's computed status, applied to the member's whole view rather than just one module:

- **Someone with active or ongoing tasks** sees what's next on them — Waiting nudges due, upcoming check-ins, pending join requests on tasks they own, Spatial-planning or other module reviews awaiting their approval if they hold that kind of task.
- **Someone holding a recruitment-facing task** sees new applicants needing evaluation, plus anyone stuck in the pipeline waiting on a call or a decision (see Recruitment pipeline view, above) — the "needs action" list a recruiter would otherwise have to remember to go check for.
- **Someone with no active claimed tasks** sees their own onboarding progress if incomplete, plus suggested/fitted tasks (see Member onboarding, above) — never an empty screen.
- **Anyone** can see task suggestions surface here even with active work, not just when idle — finishing something is exactly when a nudge toward the next fitted task is most useful (see "Related tasks" under onboarding).
- **Anyone invited to share a Placement** sees that invite awaiting their accept/decline, and anyone linked to a Placement that moves sees that too — regardless of what tasks they hold, since sharing a tent doesn't require holding anything else on the board (see Shared placements under Spatial planning).

This isn't a new subsystem — it's a view that reads from the state other mechanics already produce (TaskAssignment, the Recruitment pipeline's computed status, onboarding progress, pending Spatial-planning approvals) and surfaces whatever's currently relevant to the specific person looking at it. What's relevant differs by what someone holds, consistent with **Access follows the task**: a recruiter's action items aren't a member's, and a Spatial-planning holder's pending-approvals queue isn't visible to someone who doesn't hold that task.

### Community snapshot

Separate from the personalized feed above, the Dashboard also carries a small, always-visible panel about the cycle as a whole — aggregate, anonymized, never broken out by individual: active member count (Participation `coming`), composition by whatever the Community tracks (Tier/experience distribution, pronouns, Branch spread), and the community-average contribution figures from **Contribution tracking**, below. This is the concrete content behind what **Transparency & access** already calls "aggregate community progress," visible to all members by default the same as the rest of that view. Individual numbers stay out of this panel entirely, including for members who've opted their own contribution picture visible — that's a Contribution-tracking-page thing, not a leaderboard on the Dashboard.

**Branch health.** The same panel carries a per-branch rollup of task attention levels — the concrete answer to "is coordination actually happening here," computed entirely from state the lifecycle mechanics already produce (see **Lifecycle & attention**), nothing separately tracked. Two tiers of the same underlying data, the same "signal without exposing a number nobody agreed to publish" split already used for capacity visibility:

- **Everyone** sees a coarse status per branch — *on track · attention needed · struggling* — derived from the branch's mix of OK/soft-flag/hard-flag/escalated tasks. This is what makes the panel useful as a "where's help needed" signal for anyone looking for a fit, not just a coordination-monitoring tool.
- **Coordination-view holders** (see **Transparency & access**) see the actual flag counts behind that status, for every branch, not just their own — soft-flagged, hard-flagged, escalated, broken out. A coordinator whose own branch is struggling sees exactly what's stuck; a coordinator elsewhere sees the same thing about every other branch, which is what surfaces a branch where flags are piling up without anyone visibly acting on them, without needing a mechanism that watches coordinators directly.

This stays a read of existing Task attention-level state, same as the rest of this panel — no new tracked field, no coordinator-specific scoring. It doesn't replace the Coordination view's own branch-coverage tooling (that's the place to actually work a branch's flags); this is the ambient, always-visible version that makes a quietly struggling branch legible to the rest of the community before someone has to go looking.

---

## 📱 Interface: mobile & web

None of this is settled UI — no screens are actually designed yet — but it's the frame the mechanics above should hang on, and the two surfaces genuinely need different things rather than one layout awkwardly serving both.

- **Mobile is the default, day-to-day surface.** The Dashboard above, claiming or releasing a task, checking a notification, answering an Input round — all of this is exactly the kind of low-effort, frequent-touch interaction a phone already handles well, and it's where most members will actually live.
- **Web carries the heavier tools.** Spatial planning's collaborative floorplan/CAD-style drawing surface, a Budget ledger, the Coordination view (branch coverage, engagement records, escalation pool) — these need screen real estate and precision a phone can't give them without a real fight. There's no priority in cramming these onto a small screen; a member who needs them reaches for a laptop, the same way they already would for any comparably heavy tool.
- **A module switcher is the top-level navigation.** Whatever's enabled for the Community (Task board, Dashboard, and whichever optional modules are on or in testing) lives behind one consistent menu, not scattered nav — consistent with modules already being an explicit, Community-configured list (`modules_enabled`) rather than something hardcoded per deployment.
- **A profile icon opens a member's own space** — their profile (tags, contact methods and their per-method visibility, availability) and personal settings (notification preferences, display options). This is always self-service, never gated by anything, the same way a once-ever Profile answer already lives "right on the member's own profile... visible and editable by them at any time" (see Profile questions, above). It's deliberately separate from community settings, which sits behind Admins (see Community settings & Admins, below) — a member's own profile icon should never double as a door into Community-wide configuration.

---

## 🔔 Notifications & communications

### Task assignment notification

When a coordinator hands someone a task directly (rather than the person claiming it themselves), they get: *"[Coordinator] thinks this is a fit for you: [task]. A yes, no, or not-now are all fine — reply within [N days]."* A reminder goes out partway through the window; no response by the deadline auto-releases the task back to Unclaimed, notifies the coordinator, and logs the non-response.

### Response tracking

Non-responses log against a member's engagement record, visible to coordination: one is just noted, a couple becomes a soft flag suggesting a different approach, three or more surfaces as a pattern worth a human conversation — never an automatic sanction. The pattern resets once the person responds and re-engages.

### Outbound communications

Three tiers, increasingly gated:

- **Direct asks** — coordinator to individual, covered above.
- **Targeted messages** — scoped to a branch, group, arrival window, or task ownership. Anyone with the relevant coordination access can send. The most useful tier and the least likely to feel like noise.
- **Community-wide announcements** — the most restricted. One clean gating pattern: sending an announcement is itself a task on the board (tagged appropriately), and whoever holds that task can send. All outbound messages get logged either way.

Delivery respects each member's stated contact preference. Any bridge to an external chat platform (the reference implementation considered Telegram) should be a deliberate, opt-in decision per Community, not a default — it blurs the line between the platform's structured record and informal conversation if it's just switched on.

---

## 👁️ Transparency & access

**Default: open.** The task board, schedule, owners, flags, and aggregate community progress are visible to all members unless a specific field has a reason to be restricted.

**Access follows the task, not the role.** Claiming a task that needs a sensitive field unlocks that field for the claimant — not membership in a branch, not a title. Stop working the task, lose the access. This is the same principle the Sensitive-data module above applies at the field level.

**Tiered views**, generalized from three levels that hold up across domains:

| View              | Who         | What                                                                                    |
|--------------------|-------------|--------------------------------------------------------------------------------------------|
| Default           | Everyone    | Their tasks, suggested tasks, their group, pending nudges              |
| Explore           | Everyone    | Full unclaimed task list, schedule, community-wide progress            |
| Coordination view | Task-earned | Branch coverage, engagement records, escalation pool, fitted-ask tools, capacity signal   |

**Private by default, explicit opt-in to share:** another member's engagement/contribution record, financial contributions, sensitive-data-module fields, conflict reports (reporter + non-recused conflict team only).

### View-as (support)

Troubleshooting "why can't this member see X" or "what does the board actually look like from here" doesn't require anyone to *act* as another member — only to see what they see. **View-as** is a capability unlocked the same way any other sensitive capability here is: by holding a **Support** task (claimable like any other — no special standing role attached to it, consistent with access-follows-the-task rather than access-follows-rank). Whoever holds it can switch their own view to render exactly as a chosen member would see the platform. It's a strict read-only render — never an ability to take actions on that member's behalf (claim a task, submit a form, cast a vote) while viewing as them, only to look. Every activation is logged, the same as Emergency access above.

**Exception: Conflict management.** View-as never overrides a conflict-team recusal or the invisibility guarantee it depends on. A Support-task holder viewing as a conflict-team member sees exactly the filtered queue that member sees — including any recusal that's supposed to be invisible to them — never the unfiltered version, even for debugging. If the guarantee is "this looks exactly as if the report doesn't exist" for the excluded member, that has to hold no matter which access path someone takes to look through their eyes, or the guarantee isn't real. A genuine bug in that filtering logic needs a code-level review, not a live view-as session.

---

## 📈 Contribution tracking

Participation happens in different forms across the life of a cycle — planning, build, live operation, wind-down, or whatever categories fit the Community's own work — and these aren't equivalent, so they shouldn't collapse into one number. Each member sees their own picture broken down by Community-defined contribution category, computed from three things rather than one: **completed** task assignments and shift completions (what they've actually done, attributed to the week/period a task was actually marked Done, not when it was claimed or started), **active** task assignments (what they're currently carrying, using each task's Effort magnitude), and **future signed-up** tasks (Browse-period claims and later-phase tasks already assigned to them but not yet started). Nothing here is separately entered — it's read off Task/TaskAssignment state that already exists, the same "don't keep a second number in sync by hand" principle as everywhere else in this spec.

Alongside their own picture, a member sees the **average per category across the cycle's currently active members** (Participation status `coming`, not the whole all-time community roster — someone who left two cycles ago shouldn't quietly drag the baseline down) — never other individuals' numbers by default. A member can optionally **toggle their own contribution picture visible to the rest of the community** — off by default, consistent with the rest of this spec's private-by-default, explicit-opt-in pattern (see **Transparency & access**). Turning it on shares the same breakdown they see themselves, nothing more granular.

The framing stays personal and non-punitive throughout: someone who contributed heavily in planning and lightly during the live phase can see that reflected honestly rather than flattened into a single score, and arrival/departure or engagement dates (see Participation & capacity under Cycle) are shown as context so someone's contribution is judged relative to their actual time in the cycle, not against a flat baseline. This is the foundation for a fairness conversation if one ever needs to happen — data-informed rather than a vague, hard-to-challenge impression that someone isn't pulling their weight.

---

## 🎯 MVP scope

The smallest version worth building — usable by Peach Please *and* at least one differently-shaped community, to prove the generalization actually holds.

**One scope change from the first draft of this document:** Cycle is now in MVP, not deferred. Peach Please can't really use the tool without it — "how does this year's work start" is foundational, not a nice-to-have, and the structural pieces (the entity, phases-per-cycle, cloning a task set) are cheap relative to the orchestration around them. What stays deferred is the *automated* three-round kickoff choreography and browse mode's contested-slot resolution flow — real, designed, valuable, but a human can run "round 0/1/2" by eye against a manually-managed cycle for the first real use, the same way a human currently reads the board for matching.

**In scope:**

- Community, Branch, Cycle, Phase (optional, per-cycle), Tier, Member, Task, TaskAssignment, TaskDependency, Requirement — full CRUD.
- Task lifecycle transitions (claim/release/park/resume/finish) with the state diagram above, including multi-slot capacity via TaskAssignment.
- Kanban board (by status) and branch-coverage view.
- Requirement-based filtering of the claimable pool, including cycle-initiation eligibility.
- Task proposal flow (title + description only; branch/tags/requirements filled in during review).
- Starting a cycle: create it, choose blank or clone-from-previous, define its phases if used. No automated round sequencing yet — coordination manages Round 0/1/2 manually against the task list.
- **Task notes: wiki summary + comment thread + resource links**, visible on the task detail view. This is cheap (three small tables, no complex logic) and goes directly to the goal-not-method principle the whole project is built on, so it's worth having from the start rather than treating it as polish. The one-click Done-prompt integration and the wiki/resource carry-forward-on-clone behavior can still wait for the second slice — the schema and a plain "add a comment / edit the wiki / add a resource link" UI are enough to start.
- A settings screen (doesn't need to be a polished wizard yet) for defining branches, tiers, and cycle/phase structure at Community creation.
- Manual attention-level computation via a scheduled job (staleness + phase + dependency triggers).

**Explicitly deferred:**

- Automated cycle kickoff sequencing (Round 0/1/2 as an enforced flow rather than a manual process) and Browse mode's contested-slot resolution UI.
- Task packs as a portable, shareable mechanism (import/export beyond the one clone-previous-cycle path already in scope) — general pack library, cross-community sharing, wiki/resource carry-forward on clone. The pack's phase-spine content (PackPhase, `item.phase_ref`) and the Pack import review screen touch the MVP-listed clone-previous-cycle path itself, not just this deferred general-library work — **left genuinely open whether that piece lands in the same MVP slice or ships as a fast-follow immediately after**, rather than assumed either way.
- All optional modules (recruitment, sensitive data, shifts, budget, events, spatial planning, conflict management, assemblies) — now specified in full, but none required to prove the core loop.
- Automated matching/suggestion (strength-tag → task fitting) — coordinators do this by reading the board, as in the original Phase 1 plan. Capacity-weighted automatic ranking (see Coordination mechanics: Capacity-aware fitted asks) merges into this same deferral; capacity as a manual sort/filter dimension does not and ships independently.
- Coordination mechanics beyond the bare lifecycle — one-click action emails, bulk task selection, request-to-join, anonymous task signal, talk-to-my-coordinator, self-assign confirmation check, escalation views, subtasks, task openness settings, requirement waiving, shadow slots & succession. Real, fully-designed, second slice.
- Requirement modes beyond the default `individual_gate` (`group_coverage`, `soft_priority`) and the surfacing/ranking logic they drive. MVP's Requirement filtering stays single-mode — block or don't, matching today's behavior — but the `mode` field is cheap to add to the schema now so it doesn't need revisiting later.
- Input rounds, Assemblies, and Scheduling polls — the shared Question/QuestionResponse schema is cheap, but the scheduling/phase/overlap logic around all three containers is real infrastructure, not a UI nicety, so all three are deferred as a unit rather than half-built.
- Community-endorsed openness (candidacy + Endorsement), and the Admins task / Community settings & Admins section built on it — falls out of the same "task openness settings" and Assembly deferrals just above, so there's no separate MVP path for it: v1's settings screen (see below) is just directly editable, with no gate beyond whoever's running the install. (This also means the Admin-gating check on Pack import review's "create new branch" has nothing to gate against yet in MVP — every importer can create a branch outright until Admins actually exists.)
- Notifications & communications module, transparency/tiered-views (v1 can be single-view, everything visible to all members, until access-follows-task actually needs enforcing), contribution tracking, Participation & capacity (including the returning-priority window) — real and specified, but tied mainly to Recruitment and Contribution tracking, both already deferred.
- Cycle type and the `cycle_type_count` Tier criterion — cheap on their own (a label, an optional suggested pack, one more criterion enum value), but `cycle_type_count` reads off Participation, which is itself deferred just above, so there's nothing to compute against yet either way.
- Forms as a built mechanism — not needed until the first module that uses it (Recruitment, most likely) gets built; the schema is ready whenever that happens.
- Profile questions (ProfileQuestion/ProfileAnswer) — real and specified, but the surfaces that would actually populate it (Recruitment's application, an onboarding flow) are themselves deferred; the schema is ready whenever those exist.
- On-site/on-playa mode.
- The Dashboard, Module rollout states (testing), and View-as/Support — each reads off or gates modules/mechanics that are themselves deferred (Recruitment's pipeline status, the module system having more than one real optional module live, a Support task type), so there's nothing to build here until those exist. The design is set now so the underlying schema (ModuleState, Placement's pending fields) doesn't need revisiting later.

This scope is deliberately close to what Phase 2 ("Orchard MVP") already described — the difference is that branches/tiers/phases are now Community-configured instead of hardcoded, and cycles exist as the real container Peach Please's own production timeline needs.

---

## 🏗️ Suggested architecture

**Decided: single-tenant.** One deployment per Community, self-hosted. This is being built to actually use, not offered as a service — multi-tenancy would mean building auth scoping, tenant isolation, and (eventually) billing for hypothetical future users, at real cost, with no current payoff. The `Community` entity in the schema above stays, but in practice it's just a single config row per deployment (branches, tiers, phases, enabled modules) — there's no tenant-scoping logic to build. If this ever needs to serve multiple communities from one deployment later, the boundary already exists in the schema to grow into; nothing below needs to be built defensively toward that now.

Given your existing production experience (Next.js/Nginx/PM2/Let's Encrypt deployments, plus Postgres familiarity from the Humans app work):

- **Frontend/backend:** Next.js (App Router), API routes or a thin tRPC layer for type-safe client↔server calls.
- **Database:** Postgres, with an ORM (Prisma or Drizzle) mapping close to the schema above.
- **Auth:** Email magic-link to start — no password storage, low complexity, fine for a trusted-community tool. **Decided: needs to be provider-pluggable from day one**, not magic-link-only baked in — Nextcloud SSO and id.thep.it both need to slot in later without a rewrite. Use an auth library that treats magic-link as one provider among several (Auth.js/NextAuth, or Lucia with an OIDC plugin) rather than hand-rolled email-token logic. Both Nextcloud and id.thep.it most likely expose standard OAuth2/OIDC — worth confirming the exact endpoints before wiring the second provider up, but no architectural surprise expected.
- **Hosting:** Same pattern as existing deployments (Nginx + PM2 + Let's Encrypt) if self-hosting per Community; or a single managed deployment if the multi-tenant fork above goes that direction.

### Backups: full state, not just the database

A backup is only real if a restore from it actually gets the Community back to where it was — so the export has to cover everything that isn't reproducible from the database alone, not just a Postgres dump. Concretely: the DB snapshot, plus anything stored outside it (exported Plot images, any file that ever ends up in native storage if that gets added later per the Task notes discussion above), bundled together with a manifest describing what's in the archive and what, if anything, is missing or known-inconsistent. A "backup" that quietly omits a whole category of state — leaving someone to discover that only at restore time — is worse than an honest partial export that says so upfront. This should be a real requirement checked at build time (does the export cover everything the app can currently store), not an assumption that holds until the day something new gets added to the schema and nobody remembers to add it to the backup path too.

---

## 🛠️ Build order

Concrete enough to start coding against:

 1. **Schema + migrations** — Community, Branch, Cycle, Phase, Tier, Member, Task, TaskComment, TaskWikiRevision, TaskResource, TaskAssignment, TaskDependency, Requirement.
 2. **Task CRUD + lifecycle API** — the state machine, with transitions as explicit endpoints (claim/release/park/resume/finish) rather than a generic PATCH, so business rules (e.g. can't finish a task with open dependencies, can't claim past capacity) live server-side.
 3. **Kanban board UI** — group by status, filter by branch, minimal styling.
 4. **Member auth + minimal profile** — name, tags, tier membership (manual assignment only at this stage). Auth built on a provider-pluggable library with magic-link as the only enabled provider initially, so Zitadel OIDC can be wired in later (role-gated provisioning, `sub`-keyed identity — see Authentication) without touching this layer again.
 5. **Requirement filtering** — claimable-pool filtering based on member tags/tiers vs. task requirements, reused for cycle-initiation eligibility.
 6. **Cycle creation** — blank or clone-from-previous-cycle (the pack-export/import code path, scoped narrowly at first to just this one use), with per-cycle phases.
 7. **Task proposal flow** — low-friction create form, review/activate step for coordinators.
 8. **Task detail view: notes section** — comment thread, editable wiki block, and resource link list, visually separated from the goal/description area.
 9. **Settings screen** — define branches, tiers, cycle/phase structure per Community (a form is enough; it doesn't need wizard polish yet).
10. **Attention-level job** — scheduled recomputation of staleness/phase/dependency flags.

Everything else in the full spec (automated kickoff sequencing, browse mode, modules, notifications, matching automation) builds on top of this once the core loop is proven with real use.

---

## 🍑 Relationship to Peach Please

Peach Please becomes the first *configured* Community on this engine, not a special case in the code:

- Membership model: cohort (new members join in association with a cycle's Round 1 kickoff call).
- Cycles: on. A full annual season is one Cycle; a reunion weekend, a fundraising party, or attending a different burn are all lighter mini-cycles with the same members and branches but their own task set and (often much shorter) phase spine.
- Tiers: "Experienced" = cohort-based (active during a past Cycle). This tier also gates who can start a new one.
- Branches: Seed / Fruit / Blossom / Wood. **Branch membership: leans explicit** — the original spec's own design depth (per-call follow-up tasks, availability non-response tracking) points that direction, but it's a real setting to confirm on setup, not something this doc should decide on Peach Please's behalf.
- Phases (per full-season cycle): Recruiting → Procurement → Build → On-playa → Teardown. A mini-cycle would define a lighter spine, or none at all.
- Modules enabled: recruitment, sensitive-data, shifts, budget, events, spatial planning, conflict management, assemblies, documentation (on by default). Forms in active use: recruitment application, post-cycle feedback survey.
- On-site mode: enabled.

Everything currently in the original spec's Modules, Onboarding & engagement flow, and Privacy & data sections is real, valuable design work — it doesn't get discarded, it becomes **Peach Please's own configuration plus its first task pack**, once the generic engine above exists to configure. Its task *content* isn't pre-loaded from a finished pack, though — it gets entered directly as the tool comes into real use, growing alongside the tool itself rather than ahead of it.

### Other target communities

Peach Please is first and gets the deepest integration (all modules enabled). Beyond that, the near-term targets are:

- **Lusthaven** — a second real Community to configure once the core engine exists.
- **Elsewhere as a whole, and potentially other barrios individually** — each barrio would be its own self-hosted, single-tenant Community rather than one shared deployment, consistent with the single-tenant decision above.

Worth noting: at least a couple of other barrio leads are independently building their own tools for the same general problem, apparently with a different underlying philosophy. That's not a reason to chase compatibility or convergence with what they're building — Orchard is being built to solve this for Peach Please and your own barrio, and other barrios adopting it is a nice-to-have, not a design requirement. Worth a light-touch conversation with those leads at some point mainly so Elsewhere doesn't end up needing three incompatible tools for the same job, but that's a coordination question, not something to design around now.

---

## ❓ Open questions

 1. ~~**Confirm the actual SSO protocol** Nextcloud and id.thep.it expose before wiring up the second/third auth provider.~~ **Resolved:** Peach Please runs Zitadel, which is OIDC — see Authentication above. Not blocking for v1 either way (magic-link only), but the second-provider step now has a confirmed target rather than an assumption to verify.
 2. **Whether/when to loop in the other barrio leads** building parallel tools — purely a timing and relationship question, not a design one.
 3. ~~**Spatial planning: real-time collaboration or single-editor-with-save for v1?**~~ **Resolved:** owned Placements use propose→pending→approve/revert (no real-time conflict possible, since exactly one member edits a given Placement at a time, whether it has one confirmed Member or several — see Shared placements); unowned Placements/Zones stay single-editor-with-save, reviewed directly by whoever holds the Spatial-planning task. See Spatial planning above.
 4. **Spatial planning: does the plot need real-world geo-siting** (actual GPS coordinates / map tile background), or is an imported image with local scale calibration enough? Geo-siting matters if the plot needs to align with an actual property survey or GPS-marked boundary; it's extra complexity if the plot is really just "this image, this scale." (Confirmed direction: no automatic per-event geometry calculation regardless — see Spatial planning above. This question is now narrower: just image-plus-calibration vs. geo-siting, not whether to compute geometry.)
 5. **Cycle initiation eligibility, default setting** — is "no restriction" the right default when a Community has no tiers defined yet (e.g. a brand-new install before anyone's earned "Experienced"), or should the very first cycle need an explicit one-time exception?
 6. **Scheduling polls: keep the aggregate hidden until confirmation, or let it fill in live as people submit?** The drag-select grid is the natural UI for entering availability, but the reference tools it's modeled on (LettuceMeet, When2meet) get part of their appeal from the grid filling in live as others submit — which is the opposite of the blind-submission principle Scheduling polls already commits to, specifically to avoid anchoring. Adopting the grid interaction doesn't require adopting that part of it too, but it's worth deciding on purpose rather than letting a UI choice quietly reopen a decision the rest of the spec already made.
 8. **Round 0/1/2 as an enforced sequence vs. a convention** — deferred to second slice either way, but worth deciding then whether the platform ever *blocks* Round 2 from opening early, or just displays the recommended order and trusts coordination to follow it.
 9. **Task resources: links-only holds up, or does native file storage end up needed?** The bet is that pointing at Nextcloud/Drive/wherever covers real use. Worth revisiting if it turns out something genuinely has nowhere else to live — but not worth building storage infrastructure against a hypothetical now.
10. **Does Conflict management belong closer to MVP than the rest of the optional-module tier?** It's still listed as deferred alongside Recruitment/Budget/Events for now, but it has real design weight (exclusion filtering, acknowledgment SLAs) rather than Task notes' near-zero cost — so it's worth a deliberate call rather than defaulting to "same tier as everything else optional" just because it was drawn that way on the page.
11. **Is weekly the right default cadence, or does it need to be chosen more deliberately per Community from the start** — a fast-moving build week might genuinely want a shorter cycle than a quiet planning month. The setting exists either way; the question is just whether "weekly" is a safe enough default to ship with or whether the settings screen should force a conscious choice.
12. ~~**Is the optional partner-declaration idea (for recusal nudges) worth building at all?**~~ **Resolved: no** — see Conflict management above. It would only ever cover a fraction of the relationships that could bias someone, and a false sense of "the system would catch it" is worse than no automation at all; recusal stays entirely on people recusing themselves and each other.
13. **Does waiving an `individual_gate` Requirement need any extra safeguard for the highest-stakes cases** (sensitive-data access, money) — a second coordinator's sign-off, say — or is one coordinator's visible, logged, per-claim waiver enough given it's already deliberate and non-silent? Leaning toward: the same single-coordinator process for everything, since a two-person requirement just for the waiver adds friction exactly where the point was to unblock a stuck task — but worth a deliberate call given what's potentially being waived.
14. **Does the Task Pack phase-spine work (PackPhase, `item.phase_ref`, the Pack import review screen) land in the same MVP slice as clone-previous-cycle, or ship as a fast-follow right after?** It touches an already-in-scope build-order item (see Build order and MVP scope, above), not just the deferred general-pack-library work, so it's worth a deliberate call rather than assuming either answer.

---

*Living document. Spun out of the Peach Please platform spec (v0.3 → v0.5) to separate the generic engine from the specific implementation.*
