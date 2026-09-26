import { MODULE_DEFINITIONS } from "../modules";
import { PERMISSION_MODULE_KEYS, PERMISSION_MODULE_LABELS } from "../permissions";
import { OPENNESS_LABELS } from "../format";
import { SENSITIVE_FIELD_KEYS, SENSITIVE_FIELD_LABELS } from "../sensitive-data";
import { JOINING_LANE_KINDS, type JoinLaneKind } from "@/db/schema";
import type { AssemblyResponseType } from "./agenda";

// The Founding settings template — the answer to "making every
// community manually do that seems unnecessary".
//
// docs/spec.md's "Two tiers of setting, not one" already commits this
// community to deciding some things collectively rather than letting
// whoever currently holds Admins just set them: foundational changes
// "carry an additional expectation: an Assembly about the change should
// reach quorum ... before Admins act on it." What never existed was a
// way to actually run one. This is that — a pre-written agenda of the
// settings a Community has to decide before it can really run, seeded
// in one click so nobody has to author the list from scratch.
//
// Three deliberate constraints:
//
//   - **Advisory, exactly like any other Assembly.** Nothing here
//     writes a setting. Each item carries a `settingsMapping` naming the
//     screen and field its answer becomes, so the closed-phase read view
//     can print that pointer next to the tally and whoever holds Admins
//     makes the change by hand. That keeps the spec's firm "results are
//     always advisory, never auto-applied" rule intact while making the
//     result actually actionable.
//   - **Every option set is derived from the real enums and label
//     maps**, never retyped. If a module is added, a permission module
//     is renamed, or the openness vocabulary changes, this file's option
//     lists follow automatically instead of quietly going stale — the
//     whole failure mode of asking a community to hand-write these.
//   - **Ordinary agenda items, not a new lifecycle.** Seeding writes
//     real assemblyQuestion rows, so agenda lock, voting, tallies and
//     re-opening all behave exactly as they do for a hand-written
//     agenda. Every seeded item is an ordinary item: editable,
//     removable, and answerable free-text by anyone during the window.

export const FOUNDING_SETTINGS_TEMPLATE_KEY = "founding_settings";

export type FoundingSettingsItem = {
  /** Which group heading this item is listed under in the agenda. */
  group: string;
  text: string;
  responseType: AssemblyResponseType;
  options: string[];
  /**
   * Plain-language pointer to the setting this answer becomes, shown
   * beside the item in the agenda and beside its tally once results are
   * in. Display only — see the advisory note above.
   */
  settingsMapping: string;
};

export type FoundingSettingsGroup = { title: string; blurb: string };

export const FOUNDING_SETTINGS_TITLE = "Founding settings";
export const FOUNDING_SETTINGS_DESCRIPTION =
  "Decide together how this community runs before it starts running. " +
  "Every item below is one setting the community has to choose. " +
  "Results are advisory — once voting closes, each answer is printed " +
  "next to the screen it applies to, and whoever holds Admins makes the " +
  "change by hand. Delete anything you've already settled; add anything " +
  "this missed.";

// Lane names are the plan's own (§2.1 of docs/joining-admission-plan.md
// and the §2.9 table), not invented here — these four are what the rest
// of the app and the joining docs already call them.
const JOINING_LANE_LABELS: Record<JoinLaneKind, string> = {
  invited_knows_personally: "Invited — knows personally",
  invited_good_fit: "Invited — good-fit vouch",
  invited_neither: "Invited — neither mark",
  public_application: "Applying on my own",
};

// The board's own openness vocabulary, in its real order (openest to
// most gated), wording taken from the canonical map rather than retyped —
// this is the same list OPENNESS_LABELS exists to keep consistent across
// every surface that describes how someone gets on to a task.
const OPENNESS_VALUES = ["open", "request", "coordination_approved", "community_endorsed"] as const;

export const FOUNDING_SETTINGS_GROUPS: FoundingSettingsGroup[] = [
  {
    title: "Getting people in",
    blurb: "Who can join, who brings them in, and how much process that takes.",
  },
  {
    title: "Who holds authority",
    blurb:
      "Orchard has no permanent officer class. Access attaches to a task, so " +
      "someone has to decide which responsibilities get a task at all.",
  },
  {
    title: "Critical tasks & endorsement",
    blurb:
      "What must not lapse, how someone gets on to it, and how many of us it " +
      "takes to say yes.",
  },
  {
    title: "Which modules are on",
    blurb: "Every optional module starts off. Turning one on is a decision, not a default.",
  },
  {
    title: "How we work together",
    blurb: "The day-to-day defaults: structure, and how quickly things are expected to move.",
  },
  {
    title: "Data & privacy",
    blurb: "What we hold about each other, and who is allowed to read it.",
  },
];

export const FOUNDING_SETTINGS_ITEMS: FoundingSettingsItem[] = [
  // ── Getting people in ─────────────────────────────────────────────
  {
    group: "Getting people in",
    text: "How does this community take on new members?",
    responseType: "single_choice",
    options: [
      "Rolling — anyone can join whenever there's room",
      "Cohort — we take on a new group at a set point each cycle",
      "Fixed — membership is capped and only opens when someone leaves",
    ],
    settingsMapping: "Membership model (a structural choice — spec calls this one a migration, not a toggle)",
  },
  {
    group: "Getting people in",
    text: "Can strangers apply to join?",
    responseType: "single_choice",
    options: [
      "Yes, always — the application form is public",
      "Only while we're actively recruiting (we open and close the door deliberately)",
      "No — applications are closed; we only take people we invite",
    ],
    settingsMapping: "Settings → Recruitment → Accepting applications",
  },
  {
    group: "Getting people in",
    text: "Who is allowed to invite someone in?",
    responseType: "single_choice",
    options: [
      "Any member",
      "Only whoever holds a recruitment task",
      "Only members who have been here a while",
      "Anyone — but every invite needs a second member's support",
    ],
    settingsMapping: "Settings → Recruitment → Accepting invites, and the invitation lane rules",
  },
  {
    group: "Getting people in",
    text: "Someone a member knows personally wants to join. What should happen to them?",
    responseType: "single_choice",
    options: JOINING_LANE_KINDS.map((lane) => JOINING_LANE_LABELS[lane]),
    settingsMapping: "Settings → the four invitation lanes (verification mode, application, interview)",
  },
  {
    group: "Getting people in",
    text: "How many people must weigh in before an applicant is decided?",
    responseType: "single_choice",
    options: [
      "One person",
      "Two people",
      "Three people",
      "A majority of everyone taking part",
    ],
    settingsMapping: "Settings → Recruitment → Evaluators per applicant",
  },

  // ── Who holds authority ────────────────────────────────────────────
  {
    group: "Who holds authority",
    text: "Which of these responsibilities need someone deliberately accountable for them?",
    responseType: "multi_choice",
    options: PERMISSION_MODULE_KEYS.map((key) => PERMISSION_MODULE_LABELS[key]),
    settingsMapping:
      "Settings → Access & permissions — each one you pick needs a granting task before it works at all",
  },
  {
    group: "Who holds authority",
    text: "How should the Admin role — the task that gates the settings screen — be filled?",
    responseType: "single_choice",
    options: [
      "Chosen by endorsement: anyone eligible can put themselves forward, and enough of us have to agree",
      "Open to any member who asks",
      "Decided each time in an Assembly, and recorded by hand afterwards",
      "We don't want an Admin role — anyone can change settings",
    ],
    settingsMapping: "Settings → Access & permissions → Admin, and the openness of the task that grants it",
  },

  // ── Critical tasks & endorsement ──────────────────────────────────
  {
    group: "Critical tasks & endorsement",
    text: "What is the standing work that must not lapse here?",
    responseType: "text",
    options: [],
    settingsMapping:
      "Marking a task Critical — the board sorts them first and they escalate when they sit unclaimed",
  },
  {
    group: "Critical tasks & endorsement",
    text: "How should someone get on to a critical task?",
    responseType: "single_choice",
    options: OPENNESS_VALUES.map((v) => OPENNESS_LABELS[v]),
    settingsMapping: "The board → a task's openness (Open to claim / Ask to join / Requires approval / Chosen by endorsement)",
  },
  {
    group: "Critical tasks & endorsement",
    text: "When a task is chosen by endorsement, how many of us have to agree?",
    responseType: "single_choice",
    options: [
      "One endorsement is enough",
      "Two",
      "Three",
      "A majority of everyone taking part",
    ],
    settingsMapping: "A task's endorsement threshold",
  },
  {
    group: "Critical tasks & endorsement",
    text: "When a critical task sits unclaimed and late, who is named responsible?",
    responseType: "single_choice",
    options: [
      "A standing Backstop task per event — one named person gets told",
      "Whoever coordinates that branch",
      "Nobody — it stays open to all and we trust the board",
      "We'll decide this one per task",
    ],
    settingsMapping: "Settings → Access & permissions → Backstop",
  },

  // ── Which modules are on ───────────────────────────────────────────
  {
    group: "Which modules are on",
    text: "Which of these should this community actually use?",
    responseType: "multi_choice",
    options: MODULE_DEFINITIONS.map((m) => m.label),
    settingsMapping: "Settings → Modules — everything here starts switched off",
  },

  // ── How we work together ──────────────────────────────────────────
  {
    group: "How we work together",
    text: "Do we organise into branches, or work as one flat group?",
    responseType: "single_choice",
    options: [
      "Branches emerge — whoever shows up to coordinate a branch does it",
      "Branches are explicit — someone is named to hold each one",
    ],
    settingsMapping: "Settings → Branches, and how a branch gets a coordinator",
  },
  {
    group: "How we work together",
    text: "Do we work in distinct events with named phases, or continuously?",
    responseType: "single_choice",
    options: [
      "Events with named phases — setup, main, wind-down",
      "Events, but without a fixed phase spine",
      "Continuously — no events, no phases",
    ],
    settingsMapping: "Settings → General → Use cycles, Use phases",
  },
  {
    group: "How we work together",
    text: "How long should something be allowed to sit before we expect someone to have moved it?",
    responseType: "single_choice",
    options: ["A couple of days", "About a week", "A couple of weeks", "A month or more"],
    settingsMapping: "Settings → Coordination → when something is flagged as needing attention",
  },
  {
    group: "How we work together",
    text: "What should every call have?",
    responseType: "multi_choice",
    options: [
      "An agenda",
      "A written summary afterwards",
      "Members confirming they've read the summary",
      "None of these",
    ],
    settingsMapping: "Settings → General → call defaults",
  },

  // ── Data & privacy ────────────────────────────────────────────────
  {
    group: "Data & privacy",
    text: "Which of these do we need to hold about members?",
    responseType: "multi_choice",
    options: SENSITIVE_FIELD_KEYS.map((key) => SENSITIVE_FIELD_LABELS[key]),
    settingsMapping:
      "Settings → Profile & privacy → sensitive fields. Nothing here is switched on by default, and no field is readable without a member's active consent",
  },
  {
    group: "Data & privacy",
    text: "Who should be able to read each of those, and why?",
    responseType: "text",
    options: [],
    settingsMapping:
      "Settings → Profile & privacy → who unlocks each field (a task, a tier, or a permission module)",
  },
];

export const ASSEMBLY_TEMPLATE_KEYS = [FOUNDING_SETTINGS_TEMPLATE_KEY] as const;
export type AssemblyTemplateKey = (typeof ASSEMBLY_TEMPLATE_KEYS)[number];

// The one place a template key turns into agenda items, so the
// exhaustive switch is checked at compile time and adding a template
// key without its items (or vice versa) is a type error rather than a
// silently empty Assembly.
export function templateItemsFor(templateKey: AssemblyTemplateKey): FoundingSettingsItem[] {
  switch (templateKey) {
    case FOUNDING_SETTINGS_TEMPLATE_KEY:
      return FOUNDING_SETTINGS_ITEMS;
  }
}

// The group a seeded item belongs to, recovered from the settings
// pointer stored on the question row.
//
// This is why `settingsMapping` is the right thing to persist rather
// than the group heading itself: it's unique per template item, so a
// seeded question can be matched back to its section from the static
// definition without the DB carrying a second copy of the template's
// structure. Change a group heading here and seeded questions follow.
// The trade-off is that a `settingsMapping` string is effectively a
// stable identifier — rewrite one and previously-seeded questions stop
// matching, so treat them as written once.
const GROUP_BY_SETTINGS_MAPPING = new Map(
  FOUNDING_SETTINGS_ITEMS.map((item) => [item.settingsMapping, item.group]),
);

export function templateGroupForMapping(settingsMapping: string | null): string | null {
  if (!settingsMapping) return null;
  return GROUP_BY_SETTINGS_MAPPING.get(settingsMapping) ?? null;
}

export function assemblyTemplateTitle(templateKey: string | null): string | null {
  if (templateKey === FOUNDING_SETTINGS_TEMPLATE_KEY) return FOUNDING_SETTINGS_TITLE;
  return null;
}
