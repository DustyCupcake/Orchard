import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community } from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { listLanes, laneRuleOf, saveCommunityLanes } from "@/lib/recruitment";
import {
  DEFAULT_DECISION_POLICY,
  decideFromReports,
  describeDecisionPolicy,
  reportsAreIn,
  validateDecisionPolicy,
  type DecisionPolicy,
} from "@/lib/recruitment/decision-policy";
import { createFixtures, resetDatabase } from "./helpers";

// docs/admission-flow.md §2, "How reports decide". The four choices and nothing
// else: no list, no JSON, no inviter marks as an input. What's tested is the
// table the settings screen promises, at the place it would break.

const policy = (over: Partial<DecisionPolicy> = {}): DecisionPolicy => ({ ...DEFAULT_DECISION_POLICY, ...over });
const reports = (yes: number, no: number, unsure = 0) => ({ yes, no, unsure });

describe("when reports admit someone", () => {
  it("'nobody says no, and at least one says yes' is the default, and unsure is fine", () => {
    const p = policy();
    expect(reportsAreIn(p, reports(1, 0, 2))).toBe(true);
    expect(reportsAreIn(p, reports(2, 0))).toBe(true);
    expect(reportsAreIn(p, reports(0, 0, 3))).toBe(false); // nobody said yes
    expect(reportsAreIn(p, reports(3, 1))).toBe(false); // somebody said no
  });

  it("'more say yes than no' lets a no through if more disagree with it", () => {
    const p = policy({ inWhen: "more_yes_than_no" });
    expect(reportsAreIn(p, reports(2, 1))).toBe(true);
    expect(reportsAreIn(p, reports(1, 1))).toBe(false);
    expect(reportsAreIn(p, reports(1, 0, 2))).toBe(true);
  });

  it("'everyone says yes' counts unsure as not yes", () => {
    const p = policy({ inWhen: "all_yes" });
    expect(reportsAreIn(p, reports(3, 0))).toBe(true);
    expect(reportsAreIn(p, reports(2, 0, 1))).toBe(false);
    expect(reportsAreIn(p, reports(0, 0))).toBe(false); // no reports is not unanimity
  });

  it("custom says both halves: at least this many yes, no more than this many no", () => {
    const p = policy({ inWhen: "custom", customMinYes: 2, customMaxNo: 1 });
    expect(reportsAreIn(p, reports(2, 1))).toBe(true);
    expect(reportsAreIn(p, reports(3, 2))).toBe(false);
    expect(reportsAreIn(p, reports(1, 0, 2))).toBe(false);
  });
});

describe("what a set of reports leads to", () => {
  it("admits when they're in, whatever else the policy says", () => {
    expect(decideFromReports(policy({ anyNoMeans: "decline" }), reports(2, 0))).toEqual({ outcome: "proceed", defaultResolution: null });
  });

  it("otherwise opens a wider discussion, and says which way it ends if nobody raises a concern", () => {
    expect(decideFromReports(policy(), reports(1, 1))).toEqual({ outcome: "wider_discussion", defaultResolution: "decline" });
    expect(decideFromReports(policy({ discussionEnds: "admit" }), reports(0, 0, 2))).toEqual({ outcome: "wider_discussion", defaultResolution: "proceed" });
  });

  it("or declines, when that is what a no means", () => {
    expect(decideFromReports(policy({ anyNoMeans: "decline" }), reports(1, 1))).toEqual({ outcome: "decline", defaultResolution: null });
  });

  it("declines outright when enough say no, before anything else is asked", () => {
    const p = policy({ inWhen: "more_yes_than_no", declineOutrightAt: 2 });
    // 3 yes and 2 no would be "in" on the main rule, but two no's decline.
    expect(decideFromReports(p, reports(3, 2))).toEqual({ outcome: "decline", defaultResolution: null });
    expect(decideFromReports(p, reports(3, 1)).outcome).toBe("proceed");
  });

  it("says what it does in one sentence generated from the same policy", () => {
    expect(describeDecisionPolicy(policy())).toBe(
      "They're in when nobody says no and at least one says yes (unsure counts toward the reports needed, but is neither). Otherwise it goes to a wider discussion; if nobody raises a concern they're declined.",
    );
    expect(describeDecisionPolicy(policy({ inWhen: "custom", customMinYes: 3, customMaxNo: 1, anyNoMeans: "decline", declineOutrightAt: 2 }))).toBe(
      "They're in when at least 3 say yes and no more than 1 say no (unsure counts toward the reports needed, but is neither). 2 no's decline them outright. Otherwise they're declined.",
    );
  });
});

describe("a policy a lane can never meet", () => {
  const lanes = [
    { name: "Application only", reportsNeeded: 1 },
    { name: "Interview", reportsNeeded: 3 },
  ];

  it("is refused with the lane named", () => {
    const problems = validateDecisionPolicy(policy({ inWhen: "custom", customMinYes: 2, customMaxNo: 0 }), lanes);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/“Application only” takes 1 report, so it can never get the 2 yes/);
    expect(validateDecisionPolicy(policy({ declineOutrightAt: 2 }), lanes)[0]).toMatch(/“Application only”.*2 no's/);
  });

  it("accepts everything the other choices say, whatever a lane takes", () => {
    for (const inWhen of ["no_no_one_yes", "more_yes_than_no", "all_yes"] as const) {
      expect(validateDecisionPolicy(policy({ inWhen }), lanes)).toEqual([]);
    }
  });
});

describe("saving the policy, and the lanes it applies to", () => {
  beforeEach(resetDatabase);

  it("refuses a custom number a lane can't reach, naming the lane, and writes nothing", async () => {
    const { community: c, alice } = await createFixtures();
    await listLanes(c.id); // the starting lanes take 2 reports each
    await expect(updateCommunity(alice, { recruitmentInWhen: "custom", recruitmentCustomMinYes: 3 })).rejects.toThrow(/takes 2 reports, so it can never get the 3 yes/);
    const [row] = await db.select().from(community).where(eq(community.id, c.id));
    expect(row.recruitmentInWhen).toBe("no_no_one_yes");
  });

  it("accepts a reachable custom rule, records it, and clears 'decline outright' with null", async () => {
    const { community: c, alice } = await createFixtures();
    await updateCommunity(alice, { recruitmentInWhen: "custom", recruitmentCustomMinYes: 2, recruitmentCustomMaxNo: 0, recruitmentDeclineOutrightAt: 2 });
    let [row] = await db.select().from(community).where(eq(community.id, c.id));
    expect(row).toMatchObject({ recruitmentInWhen: "custom", recruitmentCustomMinYes: 2, recruitmentDeclineOutrightAt: 2 });
    await updateCommunity(alice, { recruitmentDeclineOutrightAt: null });
    [row] = await db.select().from(community).where(eq(community.id, c.id));
    expect(row.recruitmentDeclineOutrightAt).toBeNull();
  });

  it("refuses a lane whose reports the policy could never decide", async () => {
    const { community: c, alice } = await createFixtures();
    await updateCommunity(alice, { recruitmentInWhen: "custom", recruitmentCustomMinYes: 2, recruitmentCustomMaxNo: 0 });
    const invited = laneRuleOf((await listLanes(c.id)).find((l) => l.kind === "invite")!);
    await expect(saveCommunityLanes(alice, [{ ...invited, reportsNeeded: 1 }])).rejects.toThrow(/takes 1 report, so it can never get the 2 yes/);
  });
});
