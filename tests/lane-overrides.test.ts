import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle as cycleTable, member } from "@/db/schema";
import {
  deleteCycleJoiningLaneRules,
  getJoinLaneRulesForContext,
  listLaneOverridesByCycle,
  listOverriddenLanes,
  setCommunityJoiningLaneRules,
  setCycleJoiningLaneRules,
  updateCycleLaneRules,
} from "@/lib/recruitment/joining-lanes";
import { JOINING_LANE_DEFAULTS, JOINING_LANE_ORDER } from "@/lib/recruitment/lanes";
import type { JoinLaneKind } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import { createTier } from "@/lib/settings";
import { ForbiddenError, NotFoundError, ConflictError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

// The inheritance model is "an absent row is an absent row": a cycle-scoped
// override is not a copy of the community rule, it is a row that shadows it.
// That is what makes a community default keep being true, and it is also why
// unticking a lane is the only operation here that can quietly do the wrong
// thing — a deleted override does not restore an old value, it restores
// *tracking*, so a test that only checked the immediate value would pass
// even if the row were snapshotted instead.

const nomination: JoinLaneKind = "invited_knows_personally";

describe("per-event admission rule overrides", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function communityWithCycle() {
    const { community: c, alice } = await createFixtures();
    // A cycle cannot exist unless the community runs events.
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, c.id));
    const cycle = await createCycle(alice, { source: "blank", name: "Reunion" });
    return { c, alice, cycle };
  }

  it("a cycle inherits every lane until one is explicitly overridden", async () => {
    const { c, cycle } = await communityWithCycle();
    await setCommunityJoiningLaneRules(c.id, {
      [nomination]: {
        verificationMode: "nomination",
        supportCount: 3,
        applicationRequired: false,
        interviewRequired: false,
        applyInsteadAvailable: true,
      },
    });

    expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([]);
    const resolved = await getJoinLaneRulesForContext(c.id, cycle.id);
    expect(resolved.get(nomination)?.verificationMode).toBe("nomination");
    expect(resolved.get(nomination)?.supportCount).toBe(3);
  });

  it("one overridden lane does not drag the other three with it", async () => {
    const { c, cycle } = await communityWithCycle();
    await setCommunityJoiningLaneRules(c.id, {
      [nomination]: {
        verificationMode: "consensus",
        supportCount: 1,
        applicationRequired: false,
        interviewRequired: false,
        applyInsteadAvailable: true,
      },
    });
    await setCycleJoiningLaneRules(c.id, cycle.id, {
      [nomination]: {
        verificationMode: "basic",
        supportCount: 1,
        applicationRequired: true,
        interviewRequired: false,
        applyInsteadAvailable: true,
      },
    });

    expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([nomination]);
    const resolved = await getJoinLaneRulesForContext(c.id, cycle.id);
    expect(resolved.get(nomination)?.verificationMode).toBe("basic");
    // Untouched lanes still read the community's rule, not the override.
    for (const lane of JOINING_LANE_ORDER.filter((l) => l !== nomination)) {
      expect(resolved.get(lane)).toEqual(
        (await getJoinLaneRulesForContext(c.id, null)).get(lane) ??
          JOINING_LANE_DEFAULTS[lane],
      );
    }
  });

  // The load-bearing one. If removal snapshotted the community value
  // instead of dropping the row, the *immediate* result would look
  // identical and only this assertion would catch it.
  it("unticking a lane hands it back to the community and keeps tracking it", async () => {
    const { c, cycle } = await communityWithCycle();
    await setCommunityJoiningLaneRules(c.id, {
      [nomination]: {
        verificationMode: "basic",
        supportCount: 1,
        applicationRequired: false,
        interviewRequired: false,
        applyInsteadAvailable: true,
      },
    });
    await setCycleJoiningLaneRules(c.id, cycle.id, {
      [nomination]: {
        verificationMode: "consensus",
        supportCount: 1,
        applicationRequired: true,
        interviewRequired: true,
        applyInsteadAvailable: true,
      },
    });
    expect((await getJoinLaneRulesForContext(c.id, cycle.id)).get(nomination)?.verificationMode).toBe(
      "consensus",
    );

    // "Unticked" is a delete, not a write of the community's current value.
    const deleted = await deleteCycleJoiningLaneRules(c.id, cycle.id, [nomination]);
    expect(deleted).toBe(1);
    expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([]);

    // Immediately back to the community's rule...
    expect((await getJoinLaneRulesForContext(c.id, cycle.id)).get(nomination)?.verificationMode).toBe(
      "basic",
    );

    // ...and still following it after the community moves on, which is the
    // whole point of inheritance being an absent row.
    await setCommunityJoiningLaneRules(c.id, {
      [nomination]: {
        verificationMode: "nomination",
        supportCount: 5,
        applicationRequired: false,
        interviewRequired: false,
        applyInsteadAvailable: true,
      },
    });
    const after = (await getJoinLaneRulesForContext(c.id, cycle.id)).get(nomination);
    expect(after?.verificationMode).toBe("nomination");
    expect(after?.supportCount).toBe(5);
  });

  it("resetting one lane leaves the other overrides alone", async () => {
    const { c, cycle } = await communityWithCycle();
    const other: JoinLaneKind = "public_application";
    const rule = (verificationMode: "basic" | "consensus") => ({
      verificationMode,
      supportCount: 1,
      applicationRequired: false,
      interviewRequired: false,
      applyInsteadAvailable: true,
    });
    await setCycleJoiningLaneRules(c.id, cycle.id, {
      [nomination]: rule("consensus"),
      [other]: rule("consensus"),
    });

    await deleteCycleJoiningLaneRules(c.id, cycle.id, [nomination]);

    expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([other]);
  });

  // The community screen's "N events override these" line depends on this,
  // and it is the only thing that makes a community default's blast radius
  // visible before it is edited.
  it("lists which events override which lanes, community-wide", async () => {
    const { community: c, alice } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, c.id));
    const first = await createCycle(alice, { source: "blank", name: "Reunion" });
    const second = await createCycle(alice, { source: "blank", name: "Season", confirmed: true });
    const rule = {
      verificationMode: "consensus" as const,
      supportCount: 1,
      applicationRequired: false,
      interviewRequired: false,
      applyInsteadAvailable: true,
    };

    expect(await listLaneOverridesByCycle(c.id)).toEqual([]);

    await setCycleJoiningLaneRules(c.id, first.id, {
      [nomination]: rule,
      public_application: rule,
    });
    await setCycleJoiningLaneRules(c.id, second.id, { public_application: rule });

    const byCycle = await listLaneOverridesByCycle(c.id);
    expect(byCycle).toHaveLength(2);
    const firstEntry = byCycle.find((o) => o.cycleId === first.id)!;
    expect(firstEntry.lanes).toEqual([nomination, "public_application"].sort());
    expect(byCycle.find((o) => o.cycleId === second.id)!.lanes).toEqual(["public_application"]);

    // Dropping one event's rows takes it off the list rather than leaving
    // a stale entry naming an event that no longer diverges.
    await deleteCycleJoiningLaneRules(c.id, first.id, [nomination, "public_application"]);
    const after = await listLaneOverridesByCycle(c.id);
    expect(after.map((o) => o.cycleId)).toEqual([second.id]);
  });

  it("does not report a community-wide row as an event override", async () => {
    const { c } = await communityWithCycle();

    await setCommunityJoiningLaneRules(c.id, {
      [nomination]: {
        verificationMode: "basic",
        supportCount: 1,
        applicationRequired: false,
        interviewRequired: false,
        applyInsteadAvailable: true,
      },
    });
    // cycleId null is the community's own row, not an event shadowing it.
    expect(await listLaneOverridesByCycle(c.id)).toEqual([]);
  });
  // The authorised entry point. These are the cases the server action used
  // to skip entirely: it called the two writers above directly, so the only
  // gate was the form being hidden from members who couldn't use it.
  describe("updateCycleLaneRules", () => {
    const rule = {
      verificationMode: "basic" as const,
      supportCount: 1,
      applicationRequired: false,
      interviewRequired: false,
      applyInsteadAvailable: true,
    };

    it("refuses a member who isn't eligible to configure events, and writes nothing", async () => {
      const { c, alice, cycle } = await communityWithCycle();
      const bob = (await db.select().from(member).where(eq(member.communityId, c.id))).find((m) => m.name === "Bob")!;
      const gate = await createTier(alice, { name: "Organisers" });
      await db.update(community).set({ cycleInitiationTierId: gate.id }).where(eq(community.id, c.id));
      await db.update(member).set({ tierIds: [gate.id] }).where(eq(member.id, alice.id));

      await expect(updateCycleLaneRules(bob, cycle.id, { [nomination]: rule }, [])).rejects.toThrow(ForbiddenError);
      expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([]);

      // And the same call succeeds for someone who holds the tier, so the
      // refusal above is the gate rather than the call being broken.
      const aliceNow = (await db.select().from(member).where(eq(member.id, alice.id)))[0];
      await updateCycleLaneRules(aliceNow, cycle.id, { [nomination]: rule }, []);
      expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([nomination]);
    });

    it("refuses to touch an event that belongs to another community", async () => {
      const { alice, cycle } = await communityWithCycle();
      const other = await createFixtures();
      await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, other.community.id));

      await expect(
        updateCycleLaneRules(other.alice, cycle.id, { [nomination]: rule }, []),
      ).rejects.toThrow(NotFoundError);
      expect(await listOverriddenLanes(alice.communityId, cycle.id)).toEqual([]);
    });

    it("refuses to edit a closed event's rules", async () => {
      const { c, alice, cycle } = await communityWithCycle();
      await db.update(cycleTable).set({ closedAt: new Date() }).where(eq(cycleTable.id, cycle.id));

      await expect(updateCycleLaneRules(alice, cycle.id, { [nomination]: rule }, [])).rejects.toThrow(ConflictError);
      expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([]);
    });

    it("writes the ticked lanes and drops the unticked ones together", async () => {
      const { c, alice, cycle } = await communityWithCycle();
      await updateCycleLaneRules(alice, cycle.id, { [nomination]: rule, public_application: rule }, []);
      await updateCycleLaneRules(alice, cycle.id, { [nomination]: rule }, ["public_application"]);
      expect(await listOverriddenLanes(c.id, cycle.id)).toEqual([nomination]);
    });
  });
});
