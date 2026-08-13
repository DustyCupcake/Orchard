# 🌳 Orchard — Platform Spec (v0.1)

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

| Field | Purpose |
|---|---|
| **Title + description** | Plain language. Newcomer-readable. Goal, not steps. |
| **Branch** | Which category of work (community-defined, see below). |
| **Cycle** | Optional. Which production cycle this task belongs to, if the Community uses cycles (see Cycle below). Standing tasks can have no cycle at all. |
| **Phase** | Optional. Only meaningful if the task's cycle has a phase spine. |
| **Tags** | Free-form, community-defined (replaces the old fixed strength-tag list). |
| **Effort** | One-off · ongoing · owns-a-thing. |
| **Status** | Unclaimed · Claimed · Waiting · Done. |
| **Capacity** | Number of people the task needs. Default 1. Owner can raise it later if the task turns out bigger than expected — a way to ask for help without releasing or splitting the task. |
| **Openness** | Open (anyone eligible joins without asking) · Request (default — join requests go to the owner) · Coordination-approved (new joiners need branch-coordination approval, for sensitive-access tasks). |
| **Browse period** | Optional window, set on creation, before claiming opens (see Browse mode below). |
| **Dependencies** | Other tasks that must finish first. |
| **Parent task** | Optional. Set when this task is a subtask broken off from a larger one. |
| **Next check-in date** | Owner-set, drives the Waiting nudge. |
| **Requirements** | Zero or more eligibility predicates (see Requirement below). |
| **Critical** | Boolean (was "obligatory"). Empty owner on a critical task escalates hard, not just flags. |
| **Attention level** | Computed: OK · soft-flag · hard-flag · escalated. |

Tasks are written as outcomes, not procedures — this stays true regardless of domain. "Get the deposit dispute letter reviewed and sent" is a task; a checklist of how is not.

### Proposing tasks
Anyone can propose a task with just a title and rough description — no need to know its branch, tags, or criticality up front. Two optional fields keep it moving: a **"I'd like to claim this"** checkbox (activates and assigns in one step), and an **"I'd suggest this person"** field with an optional note (surfaces a task that fits someone without assigning it unilaterally). Whoever does branch coordination fills in the missing metadata and activates it. A proposal that sits unreviewed too long flags in the coordination queue the same way an unclaimed task does.

### Multi-slot & collaborative tasks
Tasks with capacity > 1 stay open to additional claims until every slot fills. One slot can optionally be flagged as the **coordination slot** — keeping the group aligned, not a rank and not a blocker: if nobody claims it, the group self-organizes, and if the task stalls, coordination can see that on the dashboard. An existing owner can also **nominate a specific person** for an open slot — a peer-initiated fitted ask, the same mechanism coordination uses, just triggered by a collaborator instead. Coordination tasks themselves are multi-slot by default, with no rank between co-holders — a lightweight community "thumbs up" (not a vote) can help surface good fits during a browse period, but the bar to join stays low.

### Subtasks
Any task owner can break off a piece of their task as its own card. This does two things: lets someone who's claimed more than they can handle hand off a specific piece without releasing the whole task, and makes the structure of complex work visible. A subtask left unclaimed by its creator is a concrete, grabbable signal that they need help — more specific than releasing the whole task, more honest than quietly struggling. It's the structural equivalent of the "talk to my coordinator" button.

### Browse mode
High-stakes or skill-specific tasks can get a browse period on creation — a window before claiming opens where the task is visible and people express interest, without turning it into an election.

- **One person interested** → auto-claims when the window closes. No action required — this makes expressing interest a real commitment, which discourages speculative interest-collecting.
- **Multiple people, multi-slot task** → everyone auto-claims a slot, up to capacity.
- **Multiple people, single-slot task** → a short resolution window opens. Both parties are notified and can see each other's profile and contact details for exactly this purpose — have a conversation and figure it out. One retracts (no acknowledgment needed), or both agree to open a second slot, or if the window lapses with no movement, branch coordination facilitates. The platform never picks a winner, and a genuine impasse between two people who won't budge is a human problem, not a case worth engineering a system resolution for.

### Task openness
Set on creation, adjustable by the owner: **Open** (anyone eligible joins freely), **Request** (default — join requests go to the owner to accept or decline), or **Coordination-approved** (new joiners need branch-coordination sign-off, for tasks with sensitive-access implications).

### Branch
A category of work. In the reference implementation these were Seed / Fruit / Blossom / Wood. A Community defines its own set at setup — a housing coop might use Finance / Maintenance / Governance / Community; a software project might use Backend / Design / Docs / Ops. Branch coordination is placement, not doing: the coordinator's product is *matched tasks*, not completed ones.

**Membership is a real fork, not a settled default — this was flagged as an open question in the original spec and stayed open too long.** A Community chooses, at setup: **emergent** (a member is a Fruit person because they hold Fruit tasks — no formal joining, no roster), or **explicit** (members choose or are assigned a branch on joining, creating a real roster). Explicit membership is what makes a branch call an *expected* thing to attend rather than just an open invitation, and it's the one that carries real design weight:

- **Branch calls are Scheduling polls** (see Scheduling polls) — maximize-attendance-above-a-threshold, not must-overlap-everyone, since a branch call shouldn't fail to happen just because one member can't make it. With explicit membership, the poll's natural audience is the branch roster rather than an ad hoc target list.
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

### Member + Tier
A Member belongs to exactly one Community. **Tier** replaces the old hardcoded "experienced Peach" boolean. A Tier is a named eligibility level with a *criterion* the Community chooses at setup:

- **Manual** — leads designate members into the tier by hand.
- **Tenure-based** — member for ≥ N days/months.
- **Completion-based** — has completed task(s) tagged X, or completed ≥ N tasks total.
- **Cohort-based** — was active during a past cycle (this is what "experienced Peach" actually was — a special case of completion-based, not a universal default).

A Community can define as many tiers as it wants, or none — a group with fully flat membership just skips this.

### Requirement
An eligibility predicate attached to a task, filtering the claimable pool. Generalized from the old fixed strings (`experienced peach · speaks [language] · has completed [task] · any member`) into a typed predicate:

| Type | Example |
|---|---|
| `tier` | Requires membership in Tier "Experienced" |
| `language` | Requires a language tag on the member profile |
| `completed_task` | Requires having completed a specific prior task |
| `custom` | Free-form flag defined by the Community (e.g. "has kitchen certification") |

The same typed-predicate mechanism gates cycle initiation, not just task claims — see Cycle above.

### Task Pack
A portable, importable bundle of tasks — the answer to "most tasks are specific to the community, but some starting point helps." A pack is content, not structure: it doesn't define branches or tiers, it targets branch *names* that get matched (or manually remapped) into whatever branches the importing Community has. A pack has:

- Manifest: name, description, source, version, tags (domain: event-production, renovation, coop-governance, etc.)
- A list of tasks, each with the fields above minus Community-specific IDs (owner, actual dates).

Packs are symmetric — a Community can export its own board (or a subset of it, or a whole past Cycle) as a pack at any time. This is the same mechanism for "give next year's coordinator a head start," "share this with a sister community," "clone last cycle into a new one," and "seed a brand-new install with a sensible starting board." No separate feature needed for each.

---

## ⚙️ Configuration model (what an install defines)

This is the layer that used to be implicit (baked into "we are a camp at a burn") and now has to be explicit, set once at Community creation:

| Setting | Options |
|---|---|
| **Membership model** | Cohort/wave-based · rolling/continuous · fixed roster |
| **Tiers** | Zero or more, each with a criterion (manual / tenure / completion / cohort) |
| **Branches** | Community-named, at least one |
| **Branch membership** | Emergent (no roster, no expected attendance) or explicit (real roster, branch calls carry expected attendance and follow-up — see Branches) |
| **Cycles** | On or off. Off = one permanent default Cycle, no cycle-management UI surfaced. On = the Community can run multiple named cycles over time (a full season, a mini-cycle for a one-off event, etc.) |
| **Cycle initiation** | Only relevant if cycles are on. Which Tier (if any) may start a new cycle — defaults to no restriction if the Community has no tiers |
| **Phase spine** | Defined per-cycle if cycles are on, or once on the default cycle if cycles are off. On (named phases in order) or off, either way |
| **Physical/on-site mode** | Only offered if phases are on and the Community expects a discrete gathering. Governs shift-lock / read-only-reference / resync behavior. |
| **Input round cadence** | How often queued questions batch and go out for answering — weekly by default, configurable per Community (see Input rounds) |
| **Optional modules** | Recruitment · sensitive-data module · shifts/rota · budget & voting · event scheduling · spatial planning · conflict management · assemblies — each off by default, each real backend surface when on |

Branches and tiers should stay editable after launch — communities will add one. Membership model and phase-spine-on/off should be locked behind a real confirmation, since changing either after task/member data exists is a migration, not a settings toggle.

---

## 🗂️ Data model

This is the concrete shape to build against. Field names are suggestions, not gospel — the goal is to pin down entities and relationships so backend work can start.

**Community**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| name | string | |
| membership_model | enum(cohort, rolling, fixed) | community-wide membership model |
| branch_membership_model | enum(emergent, explicit) | see Branches — explicit unlocks rosters, expected attendance, and follow-up tasks for calls |
| cycles_enabled | boolean | false = one permanent default Cycle, no cycle UI |
| cycle_initiation_tier_id | uuid → Tier, nullable | null = any member may start a cycle |
| phases_enabled | boolean | |
| onsite_mode_enabled | boolean | requires phases_enabled |
| conflict_team_task_id | uuid → Task, nullable | points at the standing critical task whose current TaskAssignment holders make up the conflict team; only relevant if the conflict-management module is on |
| input_round_interval_days | int | default 7 — cadence for Input rounds (see Input rounds) |
| modules_enabled | string[] | e.g. `["sensitive_data","shifts","budget","events","recruitment","conflict_management","assemblies"]` |

**Branch**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| community_id | uuid → Community | |
| name | string | |
| description | string | |

**BranchMembership** (only meaningful if `branch_membership_model = explicit`)
| Field | Type | Notes |
|---|---|---|
| branch_id | uuid → Branch | |
| member_id | uuid → Member | |
| joined_at | timestamp | |

**Attendance** (attached to a SchedulingPoll once a slot is confirmed — see Scheduling polls)
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| poll_id | uuid → SchedulingPoll | |
| member_id | uuid → Member | |
| attended | boolean | |
| recorded_by | uuid → Member | |
| recorded_at | timestamp | |

**Cycle**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| community_id | uuid → Community | |
| name | string | e.g. "2027 Season," "Spring Reunion 2027" |
| status | enum(draft, round_0, round_1, round_2, active, archived) | drives which kickoff round is currently open |
| started_by | uuid → Member | becomes fallback holder of Round 0 tasks by opening them |
| started_at | timestamp | |
| source_type | enum(blank, pack) | "clone previous cycle" is a pack generated from that cycle at creation time — same code path as importing a saved pack |
| source_pack_id | uuid → TaskPack, nullable | |

**Phase**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| cycle_id | uuid → Cycle | belongs to a cycle, not the Community directly, since cycles can have different phase spines |
| name | string | |
| order | int | sequence position |

**Tier**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| community_id | uuid → Community | |
| name | string | |
| criterion_type | enum(manual, tenure, completion, cohort) | cohort = was active during a specific past Cycle |
| criterion_config | json | e.g. `{"min_days": 180}` or `{"cycle_id": "..."}` |

**Member**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| community_id | uuid → Community | |
| name | string | |
| tags | string[] | languages, skills, free-form |
| tier_ids | uuid[] | computed or manually assigned depending on tier criterion_type |
| joined_at | timestamp | |

**Task**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| community_id | uuid → Community | |
| branch_id | uuid → Branch | |
| cycle_id | uuid → Cycle, nullable | null for standing tasks not tied to any cycle |
| phase_id | uuid → Phase, nullable | null if the cycle has no phase spine |
| parent_task_id | uuid → Task, nullable | set when this is a subtask |
| cloned_from_task_id | uuid → Task, nullable | set when this task instance was created by cloning a previous cycle; lets the UI link back to that task's comment history |
| title | string | |
| description | text | |
| tags | string[] | |
| effort | enum(one_off, ongoing, owns_a_thing) | |
| status | enum(unclaimed, claimed, waiting, done) | |
| capacity | int | default 1 |
| openness | enum(open, request, coordination_approved) | default request |
| browse_period_end | timestamp, nullable | null = no browse period on this task |
| critical | boolean | |
| next_checkin_at | timestamp, nullable | |
| waiting_note | string, nullable | |
| created_by | uuid → Member | for proposals |
| suggested_member_id | uuid → Member, nullable | "I'd suggest this person" from the proposal form |
| attention_level | enum(ok, soft, hard, escalated) | computed, not stored authoritatively (or stored + recomputed by a job) |

**TaskComment**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| task_id | uuid → Task | |
| member_id | uuid → Member | |
| body | text | |
| created_at | timestamp | |

**Question / QuestionResponse** (shared atomic unit — batched via InputRound for task questions, or via Assembly for community-wide votes)
| Field | Type | Notes |
|---|---|---|
| question.id | uuid | |
| question.task_id | uuid → Task, nullable | set for an ordinary task-linked question |
| question.assembly_id | uuid → Assembly, nullable | set for an assembly agenda item — exactly one of task_id/assembly_id is set |
| question.asked_by | uuid → Member | |
| question.body | text | |
| question.response_type | enum(free_text, single_choice, multi_choice) | |
| question.options | json array, nullable | choices, if not free_text |
| question.deadline | timestamp, nullable | task-linked questions only — point past which an answer stops being useful |
| question.high_priority | boolean | task-linked questions only — affects sort order within a round, never a bypass of the cadence |
| question.round_id | uuid → InputRound, nullable | task-linked questions only, once batched |
| question.status | enum(queued, batched, answered) | assembly items just follow the Assembly's own status instead |
| question.created_at | timestamp | |
| response.id | uuid | |
| response.question_id | uuid → Question | |
| response.member_id | uuid → Member | |
| response.value | json | free text or selected option(s) |
| response.submitted_at | timestamp | |

**InputRound**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| community_id | uuid → Community | |
| cutoff_at | timestamp | new questions stop joining this round after this point |
| opens_at | timestamp | community-wide "round is open" notification fires here |
| closes_at | timestamp | answering window ends |
| status | enum(collecting, open, closed) | |

**Assembly** (ad hoc, proposer-initiated — see Assemblies)
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| community_id | uuid → Community | |
| proposed_by | uuid → Member | any member — same open-access principle as everything else |
| title | string | |
| agenda_closes_at | timestamp | end of the window where items can be added |
| voting_opens_at | timestamp | end of the notice period |
| voting_closes_at | timestamp | |
| status | enum(agenda_open, notice, voting, closed) | |
| created_at | timestamp | |

**SchedulingPoll / AvailabilityEntry** (see Scheduling polls)
| Field | Type | Notes |
|---|---|---|
| poll.id | uuid | |
| poll.community_id | uuid → Community | |
| poll.organized_by | uuid → Member | |
| poll.title | string | |
| poll.linked_task_id | uuid → Task, nullable | optional context, for display/grouping only |
| poll.linked_branch_id | uuid → Branch, nullable | optional context, for display/grouping only |
| poll.required_participant_ids | uuid[], nullable | if set, only slots where all of these are free count (recruitment case) |
| poll.minimum_attendance | int, nullable | floor for the maximize-attendance case, ignored if required_participant_ids is set |
| poll.status | enum(collecting, confirmed, cancelled) | |
| poll.confirmed_slot | timestamp, nullable | |
| poll.created_at | timestamp | |
| entry.id | uuid | |
| entry.poll_id | uuid → SchedulingPoll | |
| entry.member_id | uuid → Member | |
| entry.available_slots | json array | submitted windows |
| entry.submitted_at | timestamp | |
| entry.updated_at | timestamp | resubmittable as availability changes |

**TaskWikiRevision**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| task_id | uuid → Task | |
| content | text | |
| edited_by | uuid → Member | |
| edited_at | timestamp | current summary = most recent revision per task; no separate "current" field needed |

**TaskResource**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| task_id | uuid → Task | |
| added_by | uuid → Member | |
| label | string | e.g. "Order form we used," "Sign design (print at 5x7)" |
| url | string | points at wherever the file/page already lives — no native file storage in v1 |
| tag | string, nullable | free-form, e.g. "purchase link," "template," "design asset" |
| created_at | timestamp | |

**TaskAssignment** (join table — replaces a single `owner_id` now that capacity can exceed 1)
| Field | Type | Notes |
|---|---|---|
| task_id | uuid → Task | |
| member_id | uuid → Member | |
| is_coordination_slot | boolean | flags one slot as the coordination function within a multi-slot task |
| claimed_at | timestamp | |

**BrowseInterest** (join table, used during a task's browse period)
| Field | Type | Notes |
|---|---|---|
| task_id | uuid → Task | |
| member_id | uuid → Member | |
| expressed_at | timestamp | |
| reached_out | boolean | the "I've reached out" signal, single-slot contested case |

**TaskDependency** (join table)
| Field | Type | Notes |
|---|---|---|
| task_id | uuid → Task | |
| depends_on_task_id | uuid → Task | |

**Requirement**
| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| task_id | uuid → Task | |
| type | enum(tier, language, completed_task, custom) | |
| value | json | e.g. `{"tier_id": "..."}` or `{"language": "nl"}` |

**Form / FormResponse** (shared primitive, not module-gated — see Forms)
| Field | Type | Notes |
|---|---|---|
| form.id | uuid | |
| form.community_id | uuid → Community | |
| form.purpose | string | e.g. `recruitment_application`, `feedback`, `custom` |
| form.fields | json array | each field shaped like a Question — `{label, response_type, options, required}` — reusing the same type vocabulary rather than inventing a second one |
| form.anonymous_allowed | boolean | |
| response.id | uuid | |
| response.form_id | uuid → Form | |
| response.member_id | uuid → Member, nullable | null if submitted anonymously |
| response.cycle_id | uuid → Cycle, nullable | for cycle-scoped uses like post-cycle feedback |
| response.data | json | one bundled submission across all fields at once — not individual QuestionResponse rows, since a Form's fields are validated and submitted together (required fields block submission), where Questions are always independently optional to answer |
| response.submitted_at | timestamp | |

**TaskPack / TaskPackItem**
| Field | Type | Notes |
|---|---|---|
| pack.id | uuid | |
| pack.name, description, source, version, domain_tags | | manifest fields |
| item.pack_id | uuid → TaskPack | |
| item.branch_name_hint | string | matched or remapped against real branches on import |
| item.title, description, tags, effort, critical, capacity, openness, requirements | | same shape as Task, minus Community/Cycle-specific fields |
| item.wiki_summary_seed | text, nullable | carried from the source task's current wiki revision; pre-populates the new task's wiki on import |
| item.resources | json array, nullable | `[{label, url, tag}]` carried wholesale from the source task's resource list on import |

This is deliberately close to a straight relational schema — it maps onto Postgres tables with minimal translation, which matters for the [build order](#-build-order) below.

**Module entities** (only relevant if the corresponding module is enabled — grouped here rather than interleaved above, since they're opt-in surface, not core):

*Recruitment*
| Entity | Key fields | Notes |
|---|---|---|
| RecruitmentSubscription | member_id, active, consecutive_no_availability_count | auto-lapses per configured threshold |
| Evaluation | id, form_response_id (→ FormResponse), evaluator_id (→ Member), recommendation, notes | one row per evaluator, against the application FormResponse |
| Objection | id, form_response_id (→ FormResponse), raised_by (→ Member), note, visible_to (evaluators only) | anonymous to wider community |

*Budget*
| Entity | Key fields | Notes |
|---|---|---|
| FixedCost | id, community_id, label, amount | entered before proposals open |
| BudgetProposal | id, community_id, title, cost_breakdown (json), branch_id, submitted_by | |
| Vote | proposal_id, member_id, rank, willing_to_contribute | ranked-choice ballot row |
| Contribution | member_id, amount, recorded_at | post-confirmation |

*Event scheduling*
| Entity | Key fields | Notes |
|---|---|---|
| EventProposal | id, community_id, host_name, title, description, duration_minutes, space_needs, preferred_slots (json), submitted_by (nullable if external) | external submissions allowed if the public-link option is on |
| ScheduledEvent | id, proposal_id, confirmed_slot, space | published once locked |
| ExportProfile | id, community_id, name, constraints (json: char caps, duration multiples, field limits) | shown to hosts at proposal time |

*Spatial planning*
| Entity | Key fields | Notes |
|---|---|---|
| Plot | id, community_id, name, base_image_url (nullable), base_vector (nullable), scale_calibration (json) | |
| Zone | id, plot_id, name, category, polygon (json points), color | |
| Placement | id, plot_id, zone_id (nullable), shape_type, geometry (json), label, category, owner_member_id (nullable), linked_task_id (nullable) | |
| SpacePreference | member_id, sleep_arrangement (enum), vehicle_dimensions (json, nullable), group_with (uuid[], nullable), accessibility_notes | member-profile extension, only present if module enabled |

*Member contact & privacy* (core, not optional — every Community needs some version of this)
| Entity | Key fields | Notes |
|---|---|---|
| ContactMethod | id, member_id, type (email, phone, telegram, etc.), value, visibility (enum: everyone, task_or_group_mates, emergency_only) | member controls visibility per method |
| EmergencyAccessLog | id, activated_by (→ Member), target_member_id (→ Member), explanation (nullable, can be added after the fact), activated_at | both parties notified on activation |

*Conflict management* (optional module)
| Entity | Key fields | Notes |
|---|---|---|
| ConflictReport | id, community_id, reported_by (→ Member), description (nullable — a report can start as just a signal, no detail required), claimed_by (→ Member, nullable), status (enum: open, acknowledged, in_conversation, resolved), acknowledged_at (nullable), originated_from_form_response_id (→ FormResponse, nullable), created_at | |
| ConflictReportRecusal | id, report_id (→ ConflictReport), excluded_member_id (→ Member), initiated_by (→ Member — the reporter, the excluded member themselves, or a peer), created_at | append-only; current exclusion set = all rows for a report. Visibility = current `conflict_team_task_id` holders minus everyone in this list, and the exclusion must be genuinely invisible to the excluded member, not just access-denied |

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
- **Bulk task selection** — tasks can be grouped into clusters (e.g. "all pre-launch Ops tasks"). A member can select a whole cluster and deselect individual items before confirming, which reduces friction for highly committed members while keeping granular control available.
- **Self-assign confirmation check** — when anyone with placement authority tries to self-assign a flagged or unclaimed task: *"Are you sure there isn't someone with just the skills for this?"* with three options — really want it myself, suggest a person (tag-matches surfaced), or flag for the group. Nothing gets quietly self-assigned past a real gap.
- **Escalation** — unplaceable tasks surface in a shared "needs an owner" view visible to all coordinators, with cross-branch placement encouraged. Taking a task is always a visible, deliberate act, never a silent default.
- **Genuinely unloved tasks** — three explicit options, never a silent default: rotate it (it becomes a recurring shift), pay or swap for it, or leads consciously absorb or cut it.
- **Request to join** — a claimed task shows a "Request to join" button for any member. It notifies the current owner, who can accept, decline, or ignore, optionally with a short reason ("already have someone in mind," "prefer to work solo," "further along than it looks" — not required, but useful context). Declined requests stay visible to branch coordination: a stalling task with a logged decline is a different situation than a stalling task nobody's offered to help with, and a pattern of declines followed by falling behind is now something coordination can actually see and act on.
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
- **Two ways to resolve it, because the two real use cases genuinely need different logic:**
  - **Must-overlap-specific-people** — a fixed list of required participants; only slots where all of them are free count at all. This is recruitment's intro call (applicant plus both evaluators) — a slot missing one of them isn't a worse option, it's not an option.
  - **Maximize attendance above a threshold** — nobody's individually required, but the organizer can set a floor ("don't confirm below 4 people") so a slot doesn't lock in with barely anyone able to make it. This is the branch-call and task-related-call case: open to whoever's relevant, resolved by best overlap rather than requiring specific names.
- **No roster required, but one can exist.** Branches don't have to be membership lists — see the fork under Branches — so by default a scheduling poll just gets announced the same way anything else gets targeted (a branch-scoped or task-scoped message, same mechanism as Notifications & communications), open to whoever receives that notice or finds the poll. If a Community has chosen explicit branch membership, a branch call's natural audience is that roster instead, and attendance can be tracked against it (see Branches) rather than only inferred from who submitted availability.
- **Attendance, when it's tracked, is recorded after the fact by whoever ran the call** — a simple mark against the expected audience, not something the platform infers automatically. It's what a follow-up task (see Branches) has something real to work from.
- **Once resolved, calendar invites go out to everyone who submitted availability for the confirmed slot** — not to everyone who was invited to the poll, just the people who showed up and are actually free then.

**Where this sits relative to everything else that collects input from people**, since there are now several related mechanisms and it's worth being clear about which does what: **Questions** are the atomic "ask one thing, get an answer" unit, batched either through an **Input round** (recurring, task-linked, low-stakes) or an **Assembly** (ad hoc, community-scoped, phased, higher-stakes). **Forms** bundle several fields into one required, all-at-once submission — applications, surveys. **Scheduling polls** aren't asking anything at all in that sense — the output isn't an answer or a tally, it's a confirmed time. Four mechanisms, four different jobs, sharing vocabulary where it genuinely overlaps (Form fields and Questions use the same response-type shape) and staying separate where the underlying behavior actually differs.

---

## 👁️ Views

Same "one database, many lenses" principle: group by status → kanban; sort by phase/deadline → schedule (only if phases enabled); group by branch → coordinator coverage; filter by tags → "what fits me." None of this is domain-specific.

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

---

## 📋 Optional modules

Everything past the core task/member/branch engine and coordination mechanics is opt-in per Community, since each one is real backend surface (extra tables, extra access rules, sometimes extra compliance burden). These were compressed too far in the first draft of this doc — the mechanisms below are real, previously-designed detail, generalized rather than dropped. A community turns a module on or off; it doesn't get a lesser version of the mechanism if it turns one on.

### Recruitment
Handles bringing new members in where that's a distinct, evaluated process rather than an open door.

- **Application intake** — a Form (see **Forms**, below) with purpose `recruitment_application`. On submission, everyone subscribed to recruitment notifications is alerted with a link.
- **Recruitment-mode subscription** — a standing opt-in (not a task claim) any qualifying member can activate, enabling their availability tool and application alerts. Auto-lapses after N consecutive applications with no availability given, with a warm one-tap resubscribe prompt rather than a penalty notice.
- **Conversation scheduling** — a Scheduling poll (see **Scheduling polls**, below) with the applicant and both evaluators as required participants, so a confirmed slot only counts if all three can make it.
- **Evaluation + decision logic** — however many evaluators the community assigns (two, in the reference case) fill an evaluation form and give a recommendation. The mapping from recommendation combinations to outcomes (proceed / open to wider discussion / decline) is community-configured, not hardcoded — Peach Please's specific matrix becomes one configuration of this, not the only shape it can take.
- **Wider discussion window** — for borderline outcomes, a time-boxed window opens where subscribed members can raise an anonymous-to-the-community (but visible-to-the-evaluators) objection. No objection by the deadline → the recommendation is auto-followed. An objection → the evaluators lead a conversation before any decision.
- **Accompaniment** — an ongoing task type, not a side process: "Accompany [new member]," created on acceptance, owned by a senior/eligible member, closing at a defined point after onboarding. The accompanier gets explicit (member-aware) visibility into the new member's engagement record, so a human notices patterns before the system has to flag them.
- **Rejection templates** — a written starting point for the hardest message in the flow, so declining isn't done from a blank page.

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
New module. Handles physical layout planning for a venue or site — generalized from barrio/camp layout, but not specific to camping: a housing coop planning room and furniture layout, or any community planning a physical space, fits the same shape.

- **Plot** — the base area being planned. Either an imported base (raster image like a satellite photo or site plan, or a vector/GeoJSON import) with a scale calibration (mark two points, enter the real-world distance between them, everything else scales off that), or a boundary drawn from scratch if no import exists.
- **Zones** — named regions within the plot (camping area, kitchen, parking, shared/chill space, quiet zone) — polygons with a name, category, and color, purely organizational.
- **Placements** — individual shapes drawn within the plot: rectangle, circle, polygon, or line, each with real-world dimensions (not just pixel size — "3m × 2m" draws to scale against the plot's calibration), position, rotation, a category (tent, vehicle, structure, furniture, generic), and optional links to a Member (whose tent this is) or a Task (the structure this task is building).
- **Space preferences** — a small member-profile extension, only relevant when this module is on: sleep/space arrangement (solo tent, shared tent, solo vehicle, shared vehicle, other), vehicle dimensions if relevant, an optional "prefer to be placed near" list of other members, and any accessibility notes. This feeds the layout conversation — it informs sizing and grouping, it doesn't auto-place anyone. Placement stays a manual, collaborative act; the preference data just means the person drawing the layout isn't guessing.
- **Collaborative drawing tool** — the actual editing surface. Technically this is the heaviest module to build (closer to a lightweight collaborative floorplan/CAD tool than to a form), so it's worth scoping deliberately rather than folding into a generic "modules" build slice:
  - Base layer: SVG-based editor (fits the browser-native, scale-friendly, already-used-elsewhere-in-this-project mold better than canvas + a heavier library).
  - Draw primitives with real-world dimension input, snapping, and rotation.
  - Multi-editor support can start as single-editor-at-a-time with save/reload rather than live real-time collaboration — real-time multiplayer editing is a meaningfully bigger lift and shouldn't be assumed as a v1 requirement without deciding so on purpose (see Open questions).
  - Layer/zone visibility toggles, labeling, export to image for sharing outside the platform.

### Conflict management
Promoted out of `[Later]` — the case for treating this as a human problem outside the platform's scope stops holding up once the whole point of the platform is to stop institutional knowledge and unnoticed strain from depending on one person's after-the-fact check-in calls to surface at all. It's still optional per Community (a very small, very high-trust group may genuinely not need a formal process), but it earns the same design weight as Recruitment or Budget rather than a thin, deferred afterthought.

- **The conflict team is just a task, reusing what already exists.** A critical, multi-slot coordination task like any other ("Conflict team," capacity > 1, no rank between co-holders) — it doesn't need its own membership concept. The Community stores a pointer to which task that is (`conflict_team_task_id`), and whoever currently holds it, per the ordinary TaskAssignment mechanism, is the team. Kept critical for the same reason backstop tasks are: an empty conflict team is a real structural gap, not a minor one. Deliberately independent from whoever holds the community's other critical/backstop tasks by default — the same person shouldn't usually hold both.
- **Reporting starts as a low-friction signal, not a form.** The same shape as "talk to my coordinator": one action, no categorization or detail required up front. A report can be created with nothing but "I'd like to talk to someone" — the description field is optional, not a gate. Detail can come later, in the actual conversation, once the person's talking to someone they trust rather than typing into a box.
- **Recusal, from three directions, not just the reporter.** The reporter can exclude specific current team members at the moment of reporting — the original case, someone directly involved. But a team member can also recuse *themselves* on realizing a conflict of interest the reporter had no way to flag, and one team member can recuse *another*, for the same reason — a close relationship (a partner, most obviously) can bias someone just as much as direct involvement, and the person carrying that bias doesn't always recognize or volunteer it themselves. All three routes land in the same place: a growing exclusion list per report, not a single reporter-only setting.
  - This has to be genuine invisibility, not access-denial: an excluded team member's view of the queue should look exactly as if the report didn't exist — no visible gap, no "you've been excluded" notice, no count that doesn't add up. A recusal that lets someone infer they were the reason for it isn't actually safe.
  - One honest limit: this only achieves full invisibility if the recusal happens *before* the person has opened the report. Self- or peer-recusal after someone's already seen the details can still remove them from further handling, but it can't un-show them what they've already read — worth naming as a real limit rather than implying the guarantee is absolute regardless of timing.
  - Automating recusal isn't really tractable — the platform can't know most relationships. One narrow exception worth having in mind rather than building now: a member could optionally, privately declare a primary partner on their own profile, which could power a soft *"you may want to consider recusing"* prompt if that partner turns out to be connected to a report — a nudge, never an automatic block, since the data will always be incomplete and sometimes just not disclosed.
- **Flow** — flag → acknowledged within a set window (24h in the reference case, community-configurable) → whichever eligible team member takes it becomes the point of contact → conversation offered → resolution noted. Visible only to the reporter and whoever's handling it, unless the reporter chooses to escalate further.

Post-cycle feedback doesn't need its own module — it's just a Form (see **Forms**, below) used for a survey after a cycle wraps, reviewed by an ongoing "review responses" task. The one thing worth keeping from treating it separately: the hand-off from a feedback response to an actual conflict report should stay explicit and human-mediated, never automatic — a reviewer reaches out to the person first, and only with their buy-in does it become a real ConflictReport, which can then keep a quiet pointer back to the response it grew out of.

### Forms
A shared mechanism, not a module a Community turns on independently — it's infrastructure other modules lean on, the same way Requirement is. A **Form** is a community-defined set of fields with a stated purpose; a **FormResponse** is one submission, optionally anonymous. Recruitment's application intake is a Form; a post-cycle feedback survey is a Form. The mechanism doesn't care which — what differs between uses is only which task reviews the responses and what happens next.

**Are Forms made of Questions?** Partly, and it's worth being precise about which part. A Form's fields use the exact same shape a Question does — free text or closed-choice, with the same options structure — so there's no second type vocabulary to maintain. What keeps a Form its own container rather than literally a set of Question rows: a Form's fields are submitted *together, once, as a single validated event* — required fields block the whole submission until they're filled in. A Question, wherever it lives (an Input round, an Assembly), is always independently optional to answer — nobody's blocked from responding to the parts they care about. That's a real behavioral difference, not just an organizational one, so the two stay related but separate.

Not everything with fields becomes a Form, either: Event proposals stay their own dedicated entity rather than folding in here, because the platform actually reasons about specific fields on a proposal (slot conflicts, duration) — a Form's fields are opaque to the platform, read only by whoever's reviewing. That's the test for whether something belongs in Forms or needs its own shape: does the platform need to act on the specific fields, or does a human just need to read them?

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

Core (always on): task board, member profiles, branches, tiers, requirements-based matching, task proposals, basic notifications, coordination mechanics, input rounds, scheduling polls, contribution tracking, task notes (wiki + comments + resources), forms (shared primitive).
Optional (per Community): recruitment, budget, event scheduling, spatial planning, sensitive-data, conflict management, assemblies, shifts/rota.

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
| View | Who | What |
|---|---|---|
| Default | Everyone | Their tasks, suggested tasks, their group, pending nudges |
| Explore | Everyone | Full unclaimed task list, schedule, community-wide progress |
| Coordination view | Task-earned | Branch coverage, engagement records, escalation pool, fitted-ask tools |

**Private by default, explicit opt-in to share:** another member's engagement/contribution record, financial contributions, sensitive-data-module fields, conflict reports (reporter + non-recused conflict team only).

---

## 📈 Contribution tracking

Participation happens in different forms across the life of a cycle — planning, build, live operation, wind-down, or whatever categories fit the Community's own work — and these aren't equivalent, so they shouldn't collapse into one number. Each member sees their own picture broken down by Community-defined contribution category (computed from completed task assignments and shift completions tagged with that category, not a separately-entered number), alongside the **community average per category** — never other individuals' numbers, just the aggregate. This lets someone calibrate where they stand without anyone telling them what to do about it.

The framing stays personal and non-punitive throughout: someone who contributed heavily in planning and lightly during the live phase can see that reflected honestly rather than flattened into a single score, and arrival/departure or engagement dates are shown as context so someone's contribution is judged relative to their actual time in the cycle, not against a flat baseline. This is the foundation for a fairness conversation if one ever needs to happen — data-informed rather than a vague, hard-to-challenge impression that someone isn't pulling their weight.

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
- Task packs as a portable, shareable mechanism (import/export beyond the one clone-previous-cycle path already in scope) — general pack library, cross-community sharing, wiki/resource carry-forward on clone.
- All optional modules (recruitment, sensitive data, shifts, budget, events, spatial planning, conflict management, assemblies) — now specified in full, but none required to prove the core loop.
- Automated matching/suggestion (strength-tag → task fitting) — coordinators do this by reading the board, as in the original Phase 1 plan.
- Coordination mechanics beyond the bare lifecycle — one-click action emails, bulk task selection, request-to-join, talk-to-my-coordinator, self-assign confirmation check, escalation views, subtasks, task openness settings. Real, fully-designed, second slice.
- Input rounds, Assemblies, and Scheduling polls — the shared Question/QuestionResponse schema is cheap, but the scheduling/phase/overlap logic around all three containers is real infrastructure, not a UI nicety, so all three are deferred as a unit rather than half-built.
- Notifications & communications module, transparency/tiered-views (v1 can be single-view, everything visible to all members, until access-follows-task actually needs enforcing), contribution tracking.
- Forms as a built mechanism — not needed until the first module that uses it (Recruitment, most likely) gets built; the schema is ready whenever that happens.
- On-site/on-playa mode.

This scope is deliberately close to what Phase 2 ("Orchard MVP") already described — the difference is that branches/tiers/phases are now Community-configured instead of hardcoded, and cycles exist as the real container Peach Please's own production timeline needs.

---

## 🏗️ Suggested architecture

**Decided: single-tenant.** One deployment per Community, self-hosted. This is being built to actually use, not offered as a service — multi-tenancy would mean building auth scoping, tenant isolation, and (eventually) billing for hypothetical future users, at real cost, with no current payoff. The `Community` entity in the schema above stays, but in practice it's just a single config row per deployment (branches, tiers, phases, enabled modules) — there's no tenant-scoping logic to build. If this ever needs to serve multiple communities from one deployment later, the boundary already exists in the schema to grow into; nothing below needs to be built defensively toward that now.

Given your existing production experience (Next.js/Nginx/PM2/Let's Encrypt deployments, plus Postgres familiarity from the Humans app work):

- **Frontend/backend:** Next.js (App Router), API routes or a thin tRPC layer for type-safe client↔server calls.
- **Database:** Postgres, with an ORM (Prisma or Drizzle) mapping close to the schema above.
- **Auth:** Email magic-link to start — no password storage, low complexity, fine for a trusted-community tool. **Decided: needs to be provider-pluggable from day one**, not magic-link-only baked in — Nextcloud SSO and id.thep.it both need to slot in later without a rewrite. Use an auth library that treats magic-link as one provider among several (Auth.js/NextAuth, or Lucia with an OIDC plugin) rather than hand-rolled email-token logic. Both Nextcloud and id.thep.it most likely expose standard OAuth2/OIDC — worth confirming the exact endpoints before wiring the second provider up, but no architectural surprise expected.
- **Hosting:** Same pattern as existing deployments (Nginx + PM2 + Let's Encrypt) if self-hosting per Community; or a single managed deployment if the multi-tenant fork above goes that direction.

---

## 🛠️ Build order

Concrete enough to start coding against:

1. **Schema + migrations** — Community, Branch, Cycle, Phase, Tier, Member, Task, TaskComment, TaskWikiRevision, TaskResource, TaskAssignment, TaskDependency, Requirement.
2. **Task CRUD + lifecycle API** — the state machine, with transitions as explicit endpoints (claim/release/park/resume/finish) rather than a generic PATCH, so business rules (e.g. can't finish a task with open dependencies, can't claim past capacity) live server-side.
3. **Kanban board UI** — group by status, filter by branch, minimal styling.
4. **Member auth + minimal profile** — name, tags, tier membership (manual assignment only at this stage). Auth built on a provider-pluggable library with magic-link as the only enabled provider initially, so Nextcloud/id.thep.it SSO can be added later without touching this layer again.
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
- Modules enabled: recruitment, sensitive-data, shifts, budget, events, spatial planning, conflict management, assemblies. Forms in active use: recruitment application, post-cycle feedback survey.
- On-site mode: enabled.

Everything currently in the original spec's Modules, Onboarding & engagement flow, and Privacy & data sections is real, valuable design work — it doesn't get discarded, it becomes **Peach Please's own configuration plus its first task pack**, once the generic engine above exists to configure. Its task *content* isn't pre-loaded from a finished pack, though — it gets entered directly as the tool comes into real use, growing alongside the tool itself rather than ahead of it.

### Other target communities

Peach Please is first and gets the deepest integration (all modules enabled). Beyond that, the near-term targets are:

- **Lusthaven** — a second real Community to configure once the core engine exists.
- **Elsewhere as a whole, and potentially other barrios individually** — each barrio would be its own self-hosted, single-tenant Community rather than one shared deployment, consistent with the single-tenant decision above.

Worth noting: at least a couple of other barrio leads are independently building their own tools for the same general problem, apparently with a different underlying philosophy. That's not a reason to chase compatibility or convergence with what they're building — Orchard is being built to solve this for Peach Please and your own barrio, and other barrios adopting it is a nice-to-have, not a design requirement. Worth a light-touch conversation with those leads at some point mainly so Elsewhere doesn't end up needing three incompatible tools for the same job, but that's a coordination question, not something to design around now.

---

## ❓ Open questions

1. **Confirm the actual SSO protocol** Nextcloud and id.thep.it expose before wiring up the second/third auth provider. Not blocking for v1 (magic-link only), but worth checking ahead of that specific step rather than assuming OIDC and finding out otherwise mid-build.
2. **Whether/when to loop in the other barrio leads** building parallel tools — purely a timing and relationship question, not a design one.
3. **Spatial planning: real-time collaboration or single-editor-with-save for v1?** Live multiplayer editing (several people placing tents at once) is a meaningfully bigger technical lift than a save/reload model. Worth deciding on purpose rather than defaulting into it partway through building the editor.
4. **Spatial planning: does the plot need real-world geo-siting** (actual GPS coordinates / map tile background), or is an imported image with local scale calibration enough? Geo-siting matters if the plot needs to align with an actual property survey or GPS-marked boundary; it's extra complexity if the plot is really just "this image, this scale."
5. **Cycle initiation eligibility, default setting** — is "no restriction" the right default when a Community has no tiers defined yet (e.g. a brand-new install before anyone's earned "Experienced"), or should the very first cycle need an explicit one-time exception?
6. **Round 0/1/2 as an enforced sequence vs. a convention** — deferred to second slice either way, but worth deciding then whether the platform ever *blocks* Round 2 from opening early, or just displays the recommended order and trusts coordination to follow it.
7. **Task resources: links-only holds up, or does native file storage end up needed?** The bet is that pointing at Nextcloud/Drive/wherever covers real use. Worth revisiting if it turns out something genuinely has nowhere else to live — but not worth building storage infrastructure against a hypothetical now.
8. **Does Conflict management belong closer to MVP than the rest of the optional-module tier?** It's still listed as deferred alongside Recruitment/Budget/Events for now, but it has real design weight (exclusion filtering, acknowledgment SLAs) rather than Task notes' near-zero cost — so it's worth a deliberate call rather than defaulting to "same tier as everything else optional" just because it was drawn that way on the page.
9. **Is weekly the right default cadence, or does it need to be chosen more deliberately per Community from the start** — a fast-moving build week might genuinely want a shorter cycle than a quiet planning month. The setting exists either way; the question is just whether "weekly" is a safe enough default to ship with or whether the settings screen should force a conscious choice.
10. **Is the optional partner-declaration idea (for recusal nudges) worth building at all**, given it only ever covers a fraction of the relationships that could bias someone, and a false sense of "the system would catch it" might be worse than no automation at all? Leaning toward: skip it, lean entirely on people recusing themselves and each other — but worth a deliberate call rather than an accidental omission.

---

*Living document. Spun out of the Peach Please platform spec (v0.3 → v0.5) to separate the generic engine from the specific implementation.*
