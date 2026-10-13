// docs/plans/admission-flow.md §2, "How reports decide". How MANY reports a lane
// needs is set on the lane; how those reports decide is this, one small policy
// for the whole community. It replaces the ordered list of "at least N said X"
// rules, which could only say "at least" — it had no "no more than", so the
// natural wish (at least one yes and no no's, unsure is fine) had to be faked by
// ordering rules cleverly. Pure and import-free so the settings screen's client
// component and the server read the same definition.
//
// A *report* is one holder's recommendation: yes (stored as `proceed`), no
// (`decline`) or unsure, plus notes. Unsure counts toward the reports needed but
// is neither yes nor no, which is what makes "neutral is fine" work.

export const IN_WHEN = ["no_no_one_yes", "more_yes_than_no", "all_yes", "custom"] as const;
export type InWhen = (typeof IN_WHEN)[number];

export const ANY_NO_MEANS = ["wider_discussion", "decline"] as const;
export type AnyNoMeans = (typeof ANY_NO_MEANS)[number];

export const DISCUSSION_ENDS = ["admit", "decline"] as const;
export type DiscussionEnds = (typeof DISCUSSION_ENDS)[number];

export type DecisionPolicy = {
  inWhen: InWhen;
  /** Only for `custom`: at least this many yes… */
  customMinYes: number;
  /** …and no more than this many no. */
  customMaxNo: number;
  /** What a report set that isn't "in" leads to. */
  anyNoMeans: AnyNoMeans;
  /** Only with a wider discussion: how it resolves when nobody raises a concern. */
  discussionEnds: DiscussionEnds;
  /** Optional: this many no's decline outright, before anything else is asked. */
  declineOutrightAt: number | null;
};

export const DEFAULT_DECISION_POLICY: DecisionPolicy = {
  inWhen: "no_no_one_yes",
  customMinYes: 1,
  customMaxNo: 0,
  anyNoMeans: "wider_discussion",
  discussionEnds: "decline",
  declineOutrightAt: null,
};

export type ReportCounts = { yes: number; no: number; unsure: number };
export type PolicyOutcome = {
  outcome: "proceed" | "wider_discussion" | "decline";
  /** For a wider discussion: which way it resolves if nobody raises a concern. */
  defaultResolution: "proceed" | "decline" | null;
};

/** Are these reports "in"? The one place the four choices are defined. */
export function reportsAreIn(policy: DecisionPolicy, counts: ReportCounts): boolean {
  const total = counts.yes + counts.no + counts.unsure;
  switch (policy.inWhen) {
    case "no_no_one_yes":
      return counts.no === 0 && counts.yes >= 1;
    case "more_yes_than_no":
      return counts.yes > counts.no;
    case "all_yes":
      return total > 0 && counts.yes === total;
    case "custom":
      return counts.yes >= policy.customMinYes && counts.no <= policy.customMaxNo;
  }
}

/** Turn a full set of reports into an outcome. Called only once the lane's reports are all in. */
export function decideFromReports(policy: DecisionPolicy, counts: ReportCounts): PolicyOutcome {
  if (policy.declineOutrightAt !== null && counts.no >= policy.declineOutrightAt) {
    return { outcome: "decline", defaultResolution: null };
  }
  if (reportsAreIn(policy, counts)) return { outcome: "proceed", defaultResolution: null };
  if (policy.anyNoMeans === "decline") return { outcome: "decline", defaultResolution: null };
  return { outcome: "wider_discussion", defaultResolution: policy.discussionEnds === "admit" ? "proceed" : "decline" };
}

const inWhenSentence = (p: DecisionPolicy): string => {
  switch (p.inWhen) {
    case "no_no_one_yes":
      return "They're in when nobody says no and at least one says yes";
    case "more_yes_than_no":
      return "They're in when more say yes than no";
    case "all_yes":
      return "They're in when everyone says yes";
    case "custom":
      return `They're in when at least ${p.customMinYes} say yes and no more than ${p.customMaxNo} say no`;
  }
};

/** The one sentence the settings screen shows, so it can't describe a rule the code doesn't apply. */
export function describeDecisionPolicy(p: DecisionPolicy): string {
  const parts = [`${inWhenSentence(p)} (unsure counts toward the reports needed, but is neither).`];
  if (p.declineOutrightAt !== null) {
    parts.push(`${p.declineOutrightAt} no${p.declineOutrightAt === 1 ? "" : "'s"} decline them outright.`);
  }
  parts.push(
    p.anyNoMeans === "decline"
      ? "Otherwise they're declined."
      : `Otherwise it goes to a wider discussion; if nobody raises a concern they're ${p.discussionEnds === "admit" ? "admitted" : "declined"}.`,
  );
  return parts.join(" ");
}

/**
 * What is wrong with a policy given the lanes that will use it, as sentences. A
 * policy a lane can never meet is refused when saved, with the lane named,
 * rather than leaving applications waiting for ever on a number nobody can reach.
 * `lanes` are the lanes with something to evaluate.
 */
export function validateDecisionPolicy(policy: DecisionPolicy, lanes: { name: string; reportsNeeded: number }[]): string[] {
  const problems: string[] = [];
  if (policy.inWhen === "custom") {
    if (policy.customMinYes < 0 || policy.customMaxNo < 0) problems.push("The numbers in a custom rule can't be negative.");
    for (const lane of lanes) {
      if (policy.customMinYes > lane.reportsNeeded) {
        problems.push(
          `“${lane.name}” takes ${lane.reportsNeeded} report${lane.reportsNeeded === 1 ? "" : "s"}, so it can never get the ${policy.customMinYes} yes your rule asks for.`,
        );
      }
    }
  }
  if (policy.declineOutrightAt !== null) {
    if (policy.declineOutrightAt < 1) problems.push("Declining outright needs at least one no.");
    for (const lane of lanes) {
      if (policy.declineOutrightAt > lane.reportsNeeded) {
        problems.push(
          `“${lane.name}” takes ${lane.reportsNeeded} report${lane.reportsNeeded === 1 ? "" : "s"}, so it can never get the ${policy.declineOutrightAt} no's that would decline outright.`,
        );
      }
    }
  }
  return [...new Set(problems)];
}
