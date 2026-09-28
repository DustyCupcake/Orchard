import type { JoinLaneKind, JoiningVerificationMode } from "@/db/schema";

// Everything about a lane that is *pure* — the shape of the rule, what
// it means, what it says — lives here with no runtime import from the
// db, so the same definitions can be rendered by a client component (the
// live consequence sentence in the settings panel, the inviter's mark
// labels) and by the server-side resolvers. The import above is
// type-only on purpose: pulling `@/db/schema` in for its values would
// drag drizzle-orm into the browser bundle, the same trap
// StarterQuestionPicker.tsx documents when it takes permission labels as
// props instead of importing them. The db-touching half is
// joining-lanes.ts, which re-exports this module's types so `@/lib/
// recruitment`'s flat barrel stays the only import path callers need.

// The one shape a lane rule can take. Duplicated from
// src/db/schema/joining-lane.ts's own declaration on purpose (the schema
// file cannot import a lib file without turning the db layer into a
// dependant of the application layer) — the two are kept honest by
// `resolveLaneRuleRow` in joining-lanes.ts, which is the only place a
// stored row is turned into one of these, and which type-checks the
// assignment.
export type JoiningLaneRule = {
  verificationMode: JoiningVerificationMode;
  supportCount: number;
  applicationRequired: boolean;
  interviewRequired: boolean;
  applyInsteadAvailable: boolean;
};

// §2.9 — the default configuration reproduces today's behavior: knows-
// personally = today's `direct` (basic, no process); vouches and
// neither = today's `referral` (basic, full process); public = today's
// `/apply`. Nomination/consensus are opt-in upgrades (§2.9: "nothing
// changes until it does").
export const JOINING_LANE_DEFAULTS: Record<JoinLaneKind, JoiningLaneRule> = {
  invited_knows_personally: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: false,
    interviewRequired: false,
    applyInsteadAvailable: true,
  },
  invited_good_fit: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: true,
    interviewRequired: true,
    applyInsteadAvailable: true,
  },
  invited_neither: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: true,
    interviewRequired: true,
    applyInsteadAvailable: true,
  },
  public_application: {
    verificationMode: "basic",
    supportCount: 1,
    applicationRequired: true,
    interviewRequired: true,
    applyInsteadAvailable: true,
  },
};

// The lanes in the order the plan wants them read (§5.1: "trust-ordered
// lane cards (knows-personally → vouches → neither → public)"). Read off
// the defaults record rather than declared again, so the trust order and
// the default rules cannot get out of step with each other.
export const JOINING_LANE_ORDER: readonly JoinLaneKind[] = Object.keys(
  JOINING_LANE_DEFAULTS,
) as JoinLaneKind[];

export const JOINING_LANE_COPY: Record<
  JoinLaneKind,
  { title: string; who: string; assertion: string }
> = {
  invited_knows_personally: {
    title: "Invited — knows personally",
    who: "A member invites someone and marks that they personally know them.",
    assertion: "A real, personal relationship, asserted by one member.",
  },
  invited_good_fit: {
    title: "Invited — vouches (good fit)",
    who: "A member invites someone and marks that they think they'd fit.",
    assertion:
      "Not a personal relationship — a judgement that this person would be good for the community.",
  },
  invited_neither: {
    title: "Invited — neither mark",
    who: "A member invites someone without marking anything about them.",
    assertion: "An invite with no recommendation attached to it.",
  },
  public_application: {
    title: "Public application",
    who: "Someone applies on their own, with no invite behind them.",
    assertion: "Their own account of themselves, and nobody vouching for it.",
  },
};

// How an arrival on a lane actually gets through. `direct` and `process`
// are the two that existed before the redesign (and are what
// laneRedemptionKind, the capacity-hold rule, and the existing
// invite→/apply redirect all speak); `nomination` and `check` are the
// two new time-boxed windows, which are also "not direct" for every
// purpose that has to ask.
export type JoiningRedemptionPath = "direct" | "process" | "nomination" | "check";

// §2.2/§2.3 — a lane admits straight away only on the very light path:
// basic verification with no application form and no interview. Any
// other configuration routes through the evaluated application funnel.
export function laneRedemptionKind(rule: JoiningLaneRule): "direct" | "process" {
  return rule.verificationMode === "basic" && !rule.applicationRequired && !rule.interviewRequired
    ? "direct"
    : "process";
}

// The fuller answer, for the surfaces that have to render what is about
// to happen to a person. Order matters: the verification mode is
// checked before the process, because a nomination or a consensus
// window is what the person is *waiting* on, and a lane that also asks
// for an application still waits for the window first (§2.5: the
// window falls through to "the lane's process path", not past it).
export function redemptionPathForRule(rule: JoiningLaneRule): JoiningRedemptionPath {
  if (rule.verificationMode === "nomination") return "nomination";
  if (rule.verificationMode === "consensus") return "check";
  return laneRedemptionKind(rule);
}

// Where an arrival goes *after* its verification window closes, whichever
// way it closed. §2.2 says a second's support "converts it to the light
// path" and J6 says a lapse or a skip "falls through to the lane's
// process path" — and both of those are statements about the lane's
// *process*, not about its mode. A nomination lane with no application
// and no interview therefore admits straight away once its window is
// settled, on exactly the same footing as a basic one; only a lane that
// actually asks for a form or an interview sends the person to the
// application.
//
// This has to be its own function precisely because laneRedemptionKind
// can't answer it: that one asks "is this a direct lane?", and for a
// nomination lane the honest answer is "no, not until the window
// closes" — which is a question about *now*, not about the
// destination. Reusing it here would make every settled nomination lane
// route to the application, including the ones that asked for no
// application.
export function settledPathForRule(rule: JoiningLaneRule): "direct" | "process" {
  return rule.applicationRequired || rule.interviewRequired ? "process" : "direct";
}

// Whether this path hands over a Member at all. Used by the capacity-hold
// rule in joining.ts: only a `direct` invite has a slot to hold, because
// only `direct` has a moment where the person is *about* to become a
// member with nothing left to wait for. A nomination is waiting on
// people, a consensus window is waiting on the community, and a process
// lane is waiting on evaluators — none of those have reserved a place
// yet, and pretending otherwise would let a community fill its room with
// invitations it has not yet committed to.
export function pathHoldsCapacity(path: JoiningRedemptionPath): boolean {
  return path === "direct";
}

// The consequence sentence (§5.1: "make every rule legible in the UI as
// a consequence sentence rather than abstract cells"). Written from the
// newcomer's point of view and in the second person, because the person
// configuring it is imagining the person arriving — and because "they"
// would be ambiguous in a card whose whole job is to say *which* lane
// this rule governs. One sentence serves the invite lanes and the public
// lane alike: the newcomer is the subject in every case, and the
// difference between the lanes is who is waiting on whom, which is
// exactly what the sentence says.
export function describeLaneConsequence(rule: JoiningLaneRule): string {
  const process = [
    rule.applicationRequired ? "fill in the application" : null,
    rule.interviewRequired ? "have an interview" : null,
  ].filter(Boolean);

  const processClause =
    process.length === 0
      ? "join with nothing else in the way"
      : `${process.join(", then ")} and join`;

  if (rule.verificationMode === "nomination") {
    const count = Math.max(1, rule.supportCount);
    const people = count === 1 ? "one other member" : `${count} other members`;
    return `They wait until ${people} support ${count === 1 ? "them" : "them"}, then ${processClause}. If nobody does in time, they still ${processClause} — it never turns them away.`;
  }
  if (rule.verificationMode === "consensus") {
    return `They agree to a community-check window first: their arrival is announced and any member can raise a concern. With no concern, ${processClause}. With one, it is mediated and the objection stands unless the mediation body overrules it.`;
  }
  if (process.length === 0) {
    return "They join straight away — no application, no interview, nothing to wait for.";
  }
  return `They ${processClause}. Nobody can object to the arrival itself; only the evaluators decide.`;
}

// The one-line summary a card shows above its controls — the shape of
// the rule before the detail, so a reader can scan four cards and see
// which two are strict without parsing any of them.
export function summarizeLaneRule(rule: JoiningLaneRule): string {
  const mode: Record<JoiningVerificationMode, string> = {
    basic: "one member's word is enough",
    nomination: `needs ${Math.max(1, rule.supportCount)} more member${Math.max(1, rule.supportCount) === 1 ? "" : "s"}`,
    consensus: "announced to the community before admission",
  };
  const process = [
    rule.applicationRequired ? "application" : null,
    rule.interviewRequired ? "interview" : null,
  ].filter(Boolean);
  return `${mode[rule.verificationMode]}${process.length ? `, plus an ${process.join(" and a ")}` : ""}`;
}

// §5.1 — the preset select. Each preset fills all four lanes at once and
// stays editable per card afterwards, so this is a starting point rather
// than a mode: nothing here is a hidden state, and a community that
// picks "Vouched" and then relaxes the public lane has a configuration
// the settings panel can describe in full.
export type JoiningLanePreset = {
  key: string;
  label: string;
  blurb: string;
  rules: Record<JoinLaneKind, JoiningLaneRule>;
};

const processOn: Omit<JoiningLaneRule, "verificationMode"> = {
  supportCount: 1,
  applicationRequired: true,
  interviewRequired: true,
  applyInsteadAvailable: true,
};
const processOff: Omit<JoiningLaneRule, "verificationMode"> = {
  supportCount: 1,
  applicationRequired: false,
  interviewRequired: false,
  applyInsteadAvailable: true,
};

// §2.9's table *is* the "Welcoming" preset, verbatim — the migration's
// seeded rows and JOINING_LANE_DEFAULTS are the same numbers, so a
// community that touches nothing and a community that picks this preset
// land in byte-identical configuration. That is deliberate: the preset
// is what the defaults look like when you can see them.
export const JOINING_LANE_PRESETS: readonly JoiningLanePreset[] = [
  {
    key: "welcoming",
    label: "Welcoming",
    blurb:
      "What Orchard does out of the box: someone you personally know joins straight away, everyone else gets the application and an interview.",
    rules: {
      invited_knows_personally: { verificationMode: "basic", ...processOff },
      invited_good_fit: { verificationMode: "basic", ...processOn },
      invited_neither: { verificationMode: "basic", ...processOn },
      public_application: { verificationMode: "basic", ...processOn },
    },
  },
  {
    key: "vouched",
    label: "Vouched",
    blurb:
      "Every invite needs a second member to back it up. Nobody is ever turned away for want of a second — the invitee can skip ahead to the application instead.",
    rules: {
      invited_knows_personally: { verificationMode: "nomination", ...processOff },
      invited_good_fit: { verificationMode: "nomination", ...processOn },
      invited_neither: { verificationMode: "nomination", ...processOn },
      public_application: { verificationMode: "nomination", ...processOn },
    },
  },
  {
    key: "community_checked",
    label: "Community-checked",
    blurb:
      "Every arrival is announced to the community for a check window first, and anyone can raise a concern. Concerns are mediated, never dropped on a timer.",
    rules: {
      invited_knows_personally: { verificationMode: "consensus", ...processOff },
      invited_good_fit: { verificationMode: "consensus", ...processOn },
      invited_neither: { verificationMode: "consensus", ...processOn },
      public_application: { verificationMode: "consensus", ...processOn },
    },
  },
  {
    key: "fully_screened",
    label: "Fully screened",
    blurb:
      "Invites need a second member's backing; open applications are announced to the community. Everyone fills in the form and has an interview.",
    rules: {
      invited_knows_personally: { verificationMode: "nomination", ...processOff },
      invited_good_fit: { verificationMode: "nomination", ...processOn },
      invited_neither: { verificationMode: "nomination", ...processOn },
      public_application: { verificationMode: "consensus", ...processOn },
    },
  },
];

export function joiningLanePreset(key: string): JoiningLanePreset | undefined {
  return JOINING_LANE_PRESETS.find((p) => p.key === key);
}

// §2.1/J4 — the inviter's declaration fixes the lane at send time; both
// marks count as knows-personally (the stronger signal).
export function joiningLaneForInvite(invite: {
  inviterThinksGoodFit: boolean;
  inviterKnowsPersonally: boolean;
}): JoinLaneKind {
  if (invite.inviterKnowsPersonally) return "invited_knows_personally";
  if (invite.inviterThinksGoodFit) return "invited_good_fit";
  return "invited_neither";
}
