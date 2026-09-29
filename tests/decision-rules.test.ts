import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { updateCommunity } from "@/lib/settings";
import { requireValidDecisionRules, type RecruitmentDecisionRule } from "@/lib/recruitment/evaluations";
import { createFixtures, resetDatabase } from "./helpers";

/**
 * The decision-rules editor submits the same JSON the old textarea did, so
 * the server's validation is what decides whether a rule set is valid. These
 * tests are therefore about the *shape the editor can produce* — every set
 * of controls in DecisionRulesEditor has to yield something this accepts,
 * and every set it refuses has to be refused with a message naming the fix.
 *
 * They go through updateCommunity rather than requireValidDecisionRules
 * alone, because the question is whether a save works end to end, not
 * whether a function throws.
 */
async function save(alice: Parameters<typeof updateCommunity>[0], rules: RecruitmentDecisionRule[]) {
  return updateCommunity(alice, { recruitmentDecisionRules: rules });
}

describe("decision rules the editor can produce", () => {
  beforeEach(resetDatabase);

  it("accepts the two starters the editor opens on for an unconfigured community", async () => {
    const { alice } = await createFixtures();
    await expect(
      save(alice, [
        { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
        { conditions: {}, outcome: "wider_discussion", defaultResolution: "proceed" },
      ]),
    ).resolves.toBeTruthy();
  });

  it("accepts a cleared minCounts as unconditional, not as an empty object", async () => {
    const { alice } = await createFixtures();
    // The editor deletes the key rather than writing `minCounts: {}`, and
    // the fallback rule depends on that: isUnconditional treats an empty
    // object as unconditional too, but a rule that only *looks* like a
    // fallback is a trap, so the key is dropped.
    const FALLBACK: RecruitmentDecisionRule = { conditions: {}, outcome: "decline" };
    // A rule with a minCount, then the same rule with the key removed — which
    // is exactly what clearing every number in the editor produces, since
    // setMinCount deletes the key rather than writing `minCounts: {}`.
    await expect(
      save(alice, [{ conditions: { minCounts: { proceed: 1 } }, outcome: "proceed" }, FALLBACK]),
    ).resolves.toBeTruthy();
    await expect(
      save(alice, [{ conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" }]),
    ).resolves.toBeTruthy();

    // The distinction that matters: an *empty object* also passes
    // isUnconditional, so the editor dropping the key is belt-and-braces
    // rather than load-bearing. Asserted so the two are known to agree.
    const { recruitmentDecisionRulesSchema } = await import("@/lib/recruitment/evaluations");
    expect(() => recruitmentDecisionRulesSchema.parse([{ conditions: { minCounts: {} }, outcome: "decline" }])).not.toThrow();
  });

  it("accepts every combination of inviter marks the editor's dropdowns offer", async () => {
    const { alice } = await createFixtures();
    for (const knows of [true, false]) {
      for (const vouches of [true, false]) {
        await expect(
          save(alice, [
            { conditions: { inviterKnowsPersonally: knows, inviterThinksGoodFit: vouches }, outcome: "proceed" },
            { conditions: {}, outcome: "decline" },
          ]),
        ).resolves.toBeTruthy();
      }
    }
  });

  it("accepts a zero minCount, which is what an emptied-then-typed field produces", async () => {
    const { alice } = await createFixtures();
    await expect(
      save(alice, [
        { conditions: { minCounts: { decline: 0 } }, outcome: "decline" },
        { conditions: {}, outcome: "proceed" },
      ]),
    ).resolves.toBeTruthy();
  });

  it("refuses a last rule that still has conditions, and says so", async () => {
    const { alice } = await createFixtures();
    await expect(
      save(alice, [{ conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" }]),
    ).rejects.toThrow(/unconditional fallback/);
  });

  it("refuses a community-check rule with no resolution, and says so", async () => {
    const { alice } = await createFixtures();
    await expect(
      save(alice, [
        { conditions: {}, outcome: "wider_discussion" } as unknown as RecruitmentDecisionRule,
        { conditions: {}, outcome: "decline" },
      ]),
    ).rejects.toThrow(/defaultResolution/);
  });

  it("round-trips a set through the database unchanged", async () => {
    const { community: c, alice } = await createFixtures();
    const rules: RecruitmentDecisionRule[] = [
      { conditions: { minCounts: { proceed: 2, unsure: 1 } }, outcome: "proceed" },
      { conditions: { inviterThinksGoodFit: true }, outcome: "wider_discussion", defaultResolution: "decline" },
      { conditions: {}, outcome: "decline" },
    ];
    await save(alice, rules);
    const [row] = await db.select().from((await import("@/db/schema")).community)
      .where((await import("drizzle-orm")).eq((await import("@/db/schema")).community.id, c.id));
    // Key order is normalised by jsonb, so this compares the canonical
    // shape rather than the literal string.
    expect(row.recruitmentDecisionRules).toEqual(rules);
  });

  it("preserves rule order through a save, because order is the semantics", async () => {
    const { alice } = await createFixtures();
    const three: RecruitmentDecisionRule = { conditions: { minCounts: { proceed: 3 } }, outcome: "proceed" };
    const two: RecruitmentDecisionRule = { conditions: { minCounts: { proceed: 2 } }, outcome: "wider_discussion", defaultResolution: "proceed" };
    const FALLBACK: RecruitmentDecisionRule = { conditions: {}, outcome: "decline" };

    // [three, two, fallback] and [two, three, fallback] decide differently:
    // the first admits on three proceed, the second admits on two. jsonb
    // preserves array order, so an editor whose move arrows reordered
    // nothing would silently change the meaning of a rule set.
    // Only the two conditioned rules' thresholds are compared; the
    // fallback's is legitimately absent, and an `undefined` in the array is
    // the right answer rather than a gap in the assertion.
    const thresholds = async () => {
      const [row] = await db.select().from((await import("@/db/schema")).community);
      return (row.recruitmentDecisionRules as RecruitmentDecisionRule[])
        .map((r) => r.conditions.minCounts?.proceed)
        .filter((n): n is number => n !== undefined);
    };

    await save(alice, [three, two, FALLBACK]);
    expect(await thresholds()).toEqual([3, 2]);

    await save(alice, [two, three, FALLBACK]);
    expect(await thresholds()).toEqual([2, 3]);
  });

  // The move arrows can put a conditioned rule last, which the server
  // refuses — so the editor's job is to mark it *before* the save rather
  // than to prevent it. Asserted because the two are a matched pair: the
  // editor's "the last rule has conditions on it" message is only true
  // while the server agrees, and the server's message is only reachable
  // through an editor that lets you get there.
  it("refuses a reorder that leaves a conditioned rule last, and names the fix", async () => {
    const { alice } = await createFixtures();
    const conditioned: RecruitmentDecisionRule = { conditions: { minCounts: { proceed: 3 } }, outcome: "proceed" };
    const FALLBACK: RecruitmentDecisionRule = { conditions: {}, outcome: "decline" };
    await expect(save(alice, [FALLBACK, conditioned])).rejects.toThrow(/unconditional fallback/);
    // ...and the arrangement that does work is the one the editor's message
    // tells the reader to make.
    await expect(save(alice, [conditioned, FALLBACK])).resolves.toBeTruthy();
  });

  it("leaves an empty rule set meaning not-yet-configured rather than an error", async () => {
    const { alice } = await createFixtures();
    await expect(save(alice, [])).resolves.toBeTruthy();
    // ...and the editor opens on starters rather than an empty box, which is
    // a UI decision, but the server has to permit the empty case for a
    // community that has genuinely never set rules.
    expect(() => requireValidDecisionRules([])).not.toThrow();
  });
});
