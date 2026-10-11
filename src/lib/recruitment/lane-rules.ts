import type { AdmissionVerification } from "@/db/schema";

// Everything about an admission lane that is pure: the shape of a lane's
// rule, which route it takes a person down, what it says in a sentence, and
// the rules a set of lanes has to satisfy. No runtime import from the db, so
// the settings panel's client component can use the same definitions the
// server resolves with (the import above is type-only on purpose — pulling
// `@/db` in for its values would drag the database client into the browser
// bundle). The db half is admission-lanes.ts, which resolves rows into these.
//
// docs/admission-flow.md §2a: a lane is defined by what the system already
// knows about an arrival, never by something a person picks from a menu. An
// invite lane says which inviter declarations it handles; a public lane is
// the link someone arrived by.

/** The three mutually exclusive things an inviter declares (§2a). Ticking
 *  both boxes counts as knowing them personally. */
export type InviterDeclaration = "knows_personally" | "good_fit_only" | "neither";

export function declarationFromMarks(marks: {
  inviterKnowsPersonally: boolean;
  inviterThinksGoodFit: boolean;
}): InviterDeclaration {
  if (marks.inviterKnowsPersonally) return "knows_personally";
  if (marks.inviterThinksGoodFit) return "good_fit_only";
  return "neither";
}

export const DECLARATION_LABELS: Record<InviterDeclaration, string> = {
  knows_personally: "knows them personally",
  good_fit_only: "thinks they'd be a good fit",
  neither: "made no mark either way",
};

/** The editable shape of a lane — what the settings panel reads and writes. */
export type AdmissionLaneRule = {
  id?: string;
  name: string;
  kind: "invite" | "public";
  handlesKnowsPersonally: boolean;
  handlesGoodFitOnly: boolean;
  handlesNeither: boolean;
  /** Public lanes: the part of the address after /apply/. Null = the lane
   *  served at /apply itself. */
  publicSlug: string | null;
  applicationRequired: boolean;
  interviewRequired: boolean;
  verification: AdmissionVerification;
  reportsNeeded: number | null;
  supportShortcutCount: number | null;
  /** Open at the community's general door. Events choose theirs separately. */
  openInCommunity: boolean;
};

/** How an arrival on a lane gets through.
 *  - direct:  nothing to wait for; admitted the moment they arrive.
 *  - check:   announced to the community; admitted if nobody holds a concern.
 *  - process: an application and/or an interview, then a decision. */
export type LaneRoute = "direct" | "check" | "process";

export function laneRoute(rule: Pick<AdmissionLaneRule, "verification" | "applicationRequired" | "interviewRequired">): LaneRoute {
  if (rule.verification === "community_check") return "check";
  if (!rule.applicationRequired && !rule.interviewRequired) return "direct";
  return "process";
}

/** An issued invite on a direct lane holds a place in a capped event until
 *  it is redeemed, revoked or expires. Nothing else holds one: a check or a
 *  process has not committed the room yet. */
export function laneHoldsCapacity(rule: Pick<AdmissionLaneRule, "verification" | "applicationRequired" | "interviewRequired">): boolean {
  return laneRoute(rule) === "direct";
}

export function laneHandles(rule: Pick<AdmissionLaneRule, "kind" | "handlesKnowsPersonally" | "handlesGoodFitOnly" | "handlesNeither">, declaration: InviterDeclaration): boolean {
  if (rule.kind !== "invite") return false;
  switch (declaration) {
    case "knows_personally":
      return rule.handlesKnowsPersonally;
    case "good_fit_only":
      return rule.handlesGoodFitOnly;
    case "neither":
      return rule.handlesNeither;
  }
}

export function laneAddress(rule: Pick<AdmissionLaneRule, "publicSlug">): string {
  return rule.publicSlug ? `/apply/${rule.publicSlug}` : "/apply";
}

export const DEFAULT_REPORTS_NEEDED = 2;

/**
 * Make a rule consistent with the compatibility rules of §3, so the panel
 * and the server can never disagree about what a combination means.
 *
 *  - A community check *is* the process: no application, no interview.
 *  - Reports needed exists only where there is something to report on, and
 *    is then at least one. Null rather than 0 where there isn't.
 *  - The support shortcut exists only where there is something to skip.
 *  - An invite lane has no address; a public lane handles no declaration.
 */
export function normalizeLaneRule(rule: AdmissionLaneRule): AdmissionLaneRule {
  const next = { ...rule, name: rule.name.trim() };
  if (next.verification === "community_check") {
    next.applicationRequired = false;
    next.interviewRequired = false;
  }
  const hasProcess = next.applicationRequired || next.interviewRequired;
  next.reportsNeeded = hasProcess ? Math.max(1, Math.round(next.reportsNeeded ?? DEFAULT_REPORTS_NEEDED)) : null;
  next.supportShortcutCount =
    hasProcess && next.supportShortcutCount != null && next.supportShortcutCount > 0
      ? Math.round(next.supportShortcutCount)
      : null;
  if (next.kind === "invite") {
    next.publicSlug = null;
  } else {
    next.handlesKnowsPersonally = false;
    next.handlesGoodFitOnly = false;
    next.handlesNeither = false;
    const slug = (next.publicSlug ?? "").trim().toLowerCase();
    next.publicSlug = slug === "" ? null : slug;
  }
  return next;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(["api", "new", "thanks"]);

/**
 * What is wrong with a community's lane set, as sentences. An empty list
 * means every person who can arrive has somewhere to go and no two lanes
 * claim the same arrival. §3: a configuration that can't produce a person's
 * path is refused when saved, with a sentence saying why.
 *
 * `lanes` are the non-archived lanes. `contexts` names the sets of lanes that
 * are open together — the community's general door, and each event with its
 * own set — because "each declaration belongs to one invite lane" is checked
 * *among the lanes open in a context*, not across everything defined.
 */
export function validateLanes(
  lanes: AdmissionLaneRule[],
  contexts: { label: string; laneIndexes: number[] }[] = [
    { label: "the community", laneIndexes: lanes.map((_, i) => i).filter((i) => lanes[i].openInCommunity) },
  ],
): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  lanes.forEach((lane) => {
    const label = lane.name.trim() || "A lane";
    if (!lane.name.trim()) problems.push("Every lane needs a name.");
    else if (names.has(lane.name.trim().toLowerCase())) problems.push(`Two lanes are called “${lane.name.trim()}”.`);
    names.add(lane.name.trim().toLowerCase());

    if (lane.kind === "invite") {
      if (!lane.handlesKnowsPersonally && !lane.handlesGoodFitOnly && !lane.handlesNeither) {
        problems.push(`${label} is an invite lane but handles no kind of invite.`);
      }
    } else {
      if (lane.publicSlug && (!SLUG.test(lane.publicSlug) || RESERVED_SLUGS.has(lane.publicSlug))) {
        problems.push(`${label}'s address “${lane.publicSlug}” isn't usable — use lower-case letters, numbers and hyphens.`);
      }
      // The application is how someone who arrives by a link tells us who
      // they are: it is where their name and email come from, and without it
      // there is nobody to admit.
      if (!lane.applicationRequired) {
        problems.push(`${label} is a public lane, so it has to ask for an application — that's how someone who finds the link tells you who they are.`);
      }
    }
    if (lane.verification === "community_check" && (lane.applicationRequired || lane.interviewRequired)) {
      problems.push(`${label} has a community check, which is the whole process — it can't also have an application or an interview.`);
    }
    if (laneRoute(lane) === "process" && (lane.reportsNeeded ?? 0) < 1) {
      problems.push(`${label} has something to evaluate but needs no reports.`);
    }
  });

  const slugs = new Map<string, string>();
  for (const lane of lanes) {
    if (lane.kind !== "public") continue;
    const key = lane.publicSlug ?? "";
    const other = slugs.get(key);
    if (other) {
      problems.push(
        key
          ? `${lane.name.trim() || "A lane"} and ${other} are both served at /apply/${key}.`
          : `${lane.name.trim() || "A lane"} and ${other} are both served at /apply — give one of them its own address.`,
      );
    } else {
      slugs.set(key, lane.name.trim() || "a lane");
    }
  }

  for (const context of contexts) {
    const open = context.laneIndexes.map((i) => lanes[i]).filter(Boolean);
    const invite = open.filter((l) => l.kind === "invite");
    // A context with no invite lane at all is simply invite-free. Once it has
    // one, an invite must never be left with nowhere to go.
    if (invite.length === 0) continue;
    for (const declaration of ["knows_personally", "good_fit_only", "neither"] as const) {
      const handling = invite.filter((l) => laneHandles(l, declaration));
      if (handling.length === 0) {
        problems.push(`In ${context.label}, an invite from someone who ${DECLARATION_LABELS[declaration]} has no lane to go to.`);
      } else if (handling.length > 1) {
        problems.push(
          `In ${context.label}, an invite from someone who ${DECLARATION_LABELS[declaration]} would match both ${handling
            .map((l) => `“${l.name.trim()}”`)
            .join(" and ")}.`,
        );
      }
    }
  }
  // Several lanes can break the same rule in the same words ("Every lane needs
  // a name"); saying it once is enough.
  return [...new Set(problems)];
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What a person goes through on a lane, in words addressed to nobody in
 * particular — the part that is true whoever is reading. The applicant's page
 * and the inviter's form show this; the settings card prepends who it is for.
 */
export function describeLanePath(rule: AdmissionLaneRule): string {
  const route = laneRoute(rule);
  if (route === "direct") return "Admitted immediately.";
  if (route === "check") {
    return "Announced to the community; admitted if nobody raises a concern, and held for mediation if someone does.";
  }
  const steps = [rule.applicationRequired && "an application", rule.interviewRequired && "an interview"].filter(Boolean) as string[];
  const reports = rule.reportsNeeded ?? DEFAULT_REPORTS_NEEDED;
  const parts = [`${steps.join(", then ").replace(/^./, (c) => c.toUpperCase())}, then ${reports} report${reports === 1 ? "" : "s"} to decide.`];
  if (rule.supportShortcutCount) {
    const n = rule.supportShortcutCount;
    parts.push(`Support from ${n} member${n === 1 ? "" : "s"} skips the rest.`);
  }
  return parts.join(" ");
}

/**
 * The sentence a lane's card shows, generated from the same functions that
 * decide a person's path, so the screen cannot describe something the system
 * does not do (§3): who it is for, then what they go through.
 */
/**
 * What the lanes in play mean for the rest of the settings screen (docs/admission-flow.md
 * §3): a section that configures something no lane uses is not shown, so a community is
 * never asked how reports decide when nothing is reported on, or how long a check runs when
 * nothing is checked.
 *
 * "In play" is a lane open anywhere — at the community's door or in any event that has
 * chosen it — because a setting that only an event's lane needs is still a setting that
 * community needs to find. Pure, like everything that reads a lane's path, so the screen
 * and the server cannot disagree about what a configuration involves.
 */
export type LaneRelevance = {
  anyLane: boolean;
  /** Some lane asks for an application: the form, and the public /apply page, mean something. */
  anyApplication: boolean;
  /** Some lane asks for an interview: the interviews door and interviewers' availability do. */
  anyInterview: boolean;
  /** Some lane has something to evaluate: how reports decide, and declines, do. */
  evaluates: boolean;
  /** Some lane announces arrivals to the community. */
  anyCheck: boolean;
  /** Some lane turns the support shortcut on. */
  anyShortcut: boolean;
};

export function laneRelevance(
  lanes: Pick<AdmissionLaneRule, "id" | "applicationRequired" | "interviewRequired" | "verification" | "supportShortcutCount" | "openInCommunity">[],
  /** Ids of the lanes some event has opened. */
  openInEvents: Iterable<string> = [],
): LaneRelevance {
  const inEvents = new Set(openInEvents);
  const inPlay = lanes.filter((l) => l.openInCommunity || (l.id !== undefined && inEvents.has(l.id)));
  const process = inPlay.filter((l) => laneRoute(l) === "process");
  return {
    anyLane: inPlay.length > 0,
    anyApplication: inPlay.some((l) => l.applicationRequired),
    anyInterview: inPlay.some((l) => l.interviewRequired),
    evaluates: process.length > 0,
    anyCheck: inPlay.some((l) => l.verification === "community_check"),
    anyShortcut: process.some((l) => (l.supportShortcutCount ?? 0) > 0),
  };
}

export function describeLaneConsequence(rule: AdmissionLaneRule): string {
  const who =
    rule.kind === "public"
      ? `Applies at ${laneAddress(rule)}.`
      : (() => {
          const handled = (["knows_personally", "good_fit_only", "neither"] as const).filter((d) => laneHandles(rule, d));
          if (handled.length === 3) return "Invited by any member.";
          if (handled.length === 0) return "Invited — but no kind of invite is assigned to this lane yet.";
          return `Invited by a member who ${joinWords(handled.map((d) => DECLARATION_LABELS[d]))}.`;
        })();
  return `${who} ${describeLanePath(rule)}`;
}

export function createEmptyLane(kind: "invite" | "public" = "invite"): AdmissionLaneRule {
  return normalizeLaneRule({
    name: "",
    kind,
    handlesKnowsPersonally: false,
    handlesGoodFitOnly: false,
    handlesNeither: false,
    publicSlug: null,
    applicationRequired: true,
    interviewRequired: true,
    verification: "none",
    reportsNeeded: DEFAULT_REPORTS_NEEDED,
    supportShortcutCount: null,
    openInCommunity: true,
  });
}

/** What a new community starts with (§2a): one lane for every invite, and an
 *  open application. The same constants seed existing rows' defaults. */
export function startingLanes(): AdmissionLaneRule[] {
  return [
    normalizeLaneRule({
      ...createEmptyLane("invite"),
      name: "Invited",
      handlesKnowsPersonally: true,
      handlesGoodFitOnly: true,
      handlesNeither: true,
    }),
    normalizeLaneRule({ ...createEmptyLane("public"), name: "Open application" }),
  ];
}

export type LanePreset = { key: string; label: string; blurb: string; lanes: AdmissionLaneRule[] };

function lane(partial: Partial<AdmissionLaneRule> & Pick<AdmissionLaneRule, "name" | "kind">): AdmissionLaneRule {
  return normalizeLaneRule({ ...createEmptyLane(partial.kind), ...partial });
}

/** Starting points, not modes: choosing one fills the lane list, and every
 *  lane stays editable afterwards. */
export const LANE_PRESETS: LanePreset[] = [
  {
    key: "simple",
    label: "Invited, and an open application",
    blurb: "Anyone a member invites goes through an application and interviews; anyone may apply.",
    lanes: startingLanes(),
  },
  {
    key: "trust",
    label: "People we know come straight in",
    blurb: "A member who knows someone personally can bring them straight in. Every other invite and every application is evaluated.",
    lanes: [
      lane({
        name: "Knows them personally",
        kind: "invite",
        handlesKnowsPersonally: true,
        applicationRequired: false,
        interviewRequired: false,
      }),
      lane({
        name: "Every other invite",
        kind: "invite",
        handlesGoodFitOnly: true,
        handlesNeither: true,
      }),
      lane({ name: "Open application", kind: "public" }),
    ],
  },
  {
    key: "check",
    label: "Announce and let people speak up",
    blurb: "Invitees are announced to the community instead of interviewed. Anyone can raise a concern; none is dropped on a timer. Applications are still evaluated.",
    lanes: [
      lane({
        name: "Invited",
        kind: "invite",
        handlesKnowsPersonally: true,
        handlesGoodFitOnly: true,
        handlesNeither: true,
        verification: "community_check",
      }),
      lane({ name: "Open application", kind: "public" }),
    ],
  },
  {
    key: "invite-only",
    label: "Invite only",
    blurb: "No public application. Every invite is evaluated.",
    lanes: [
      lane({
        name: "Invited",
        kind: "invite",
        handlesKnowsPersonally: true,
        handlesGoodFitOnly: true,
        handlesNeither: true,
      }),
    ],
  },
];
