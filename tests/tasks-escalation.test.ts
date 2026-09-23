import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch as branchTable, community, task } from "@/db/schema";
import { claimTask, deescalateTask, escalateTask, listEscalatedTasks } from "@/lib/tasks";
import { createCycle } from "@/lib/cycles";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

async function insertTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  overrides: Partial<typeof task.$inferInsert> = {},
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Order the seedlings",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("listEscalatedTasks", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a member with no coordination authority anywhere in the community", async () => {
    const { alice } = await createFixtures();
    await expect(listEscalatedTasks(alice)).rejects.toThrow(ForbiddenError);
  });

  it("lists escalated tasks community-wide, not scoped to the coordinator's own branch", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: testCommunity.id, name: "Wood" })
      .returning();

    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const escalatedElsewhere = await insertTask(testCommunity.id, otherBranch.id, alice.id, {
      title: "Escalated in Wood",
      attentionLevel: "escalated",
    });
    const escalatedHere = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Escalated in Fruit",
      attentionLevel: "escalated",
    });
    await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Just soft-flagged",
      attentionLevel: "soft",
    });

    const escalated = await listEscalatedTasks(alice);
    expect(escalated.map((t) => t.id).sort()).toEqual(
      [escalatedElsewhere.id, escalatedHere.id].sort(),
    );
  });

  it("excludes escalated tasks from another community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const { community: otherCommunity, branch: otherBranch, alice: otherAlice } =
      await createFixtures();
    await insertTask(otherCommunity.id, otherBranch.id, otherAlice.id, {
      title: "Escalated elsewhere",
      attentionLevel: "escalated",
    });

    const escalated = await listEscalatedTasks(alice);
    expect(escalated).toHaveLength(0);
  });
});

describe("escalateTask / deescalateTask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a coordinator escalate any task in their community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Needs owner",
      attentionLevel: "ok",
    });

    const updated = await escalateTask(alice, target.id);
    expect(updated.attentionLevel).toBe("escalated");

    const listed = await listEscalatedTasks(alice);
    expect(listed.map((t) => t.id)).toContain(target.id);
  });

  it("lets a coordinator de-escalate a task", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Was escalated",
      attentionLevel: "escalated",
    });

    const updated = await deescalateTask(alice, target.id);
    expect(updated.attentionLevel).toBe("ok");

    const listed = await listEscalatedTasks(alice);
    expect(listed.map((t) => t.id)).not.toContain(target.id);
  });

  it("rejects escalation by a non-coordinator", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const target = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Needs owner",
    });

    await expect(escalateTask(bob, target.id)).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a task in another community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const { community: otherCommunity, branch: otherBranch, alice: otherAlice } =
      await createFixtures();
    const otherTask = await insertTask(otherCommunity.id, otherBranch.id, otherAlice.id, {
      title: "Other task",
    });

    await expect(escalateTask(alice, otherTask.id)).rejects.toThrow(NotFoundError);
  });
});

describe("backstop admission (§4.7/§5.5)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a cycle's backstop escalate and see only their own cycle's escalated tasks", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, testCommunity.id));
    // Blank cycles arrive with their backstop auto-claimed to the
    // startedBy (D6) — so alice backs cycleA, bob backs cycleB.
    const cycleA = await createCycle(alice, { source: "blank", name: "2027 Season" });
    const cycleB = await createCycle(bob, { source: "blank", name: "2028 Season", confirmed: true });

    const inA = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: cycleA.id,
      attentionLevel: "escalated",
    });
    const inB = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: cycleB.id,
      attentionLevel: "escalated",
    });

    // bob backs cycle B only — the queue, and their escalate reach, is
    // scoped to it (never leaking into cycle A, §2.1's strict rule).
    const bobSees = await listEscalatedTasks(bob);
    expect(bobSees.map((t) => t.id)).toEqual([inB.id]);

    await expect(escalateTask(bob, inA.id)).rejects.toThrow(ForbiddenError);
    expect((await escalateTask(bob, inB.id)).attentionLevel).toBe("escalated");
  });

  it("scopes the community/evergreen backstop to cycle-less tasks only", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, testCommunity.id));
    // alice's cycle exists so the evergreen backstop's scope stays
    // strictly cycle-less (§2.1) — the escalated task below is deliberately
    // unplaced.
    await createCycle(alice, { source: "blank", name: "2027 Season" });

    const evergreen = await insertTask(testCommunity.id, branch.id, bob.id, { title: "Evergreen backstop" });
    await grantPermission(testCommunity.id, "backstop", evergreen.id);
    await claimTask(bob, evergreen.id);

    const cycleless = await insertTask(testCommunity.id, branch.id, alice.id, {
      attentionLevel: "escalated",
    });

    expect((await escalateTask(bob, cycleless.id)).attentionLevel).toBe("escalated");
    const bobSees = await listEscalatedTasks(bob);
    expect(bobSees.map((t) => t.id)).toEqual([cycleless.id]);
  });

  it("still rejects a plain member with neither coordination nor a backstop role", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, testCommunity.id));
    // alice starts a cycle and is its backstop; bob holds nothing.
    await createCycle(alice, { source: "blank", name: "2027 Season" });
    const target = await insertTask(testCommunity.id, branch.id, alice.id);

    await expect(escalateTask(bob, target.id)).rejects.toThrow(ForbiddenError);
    await expect(listEscalatedTasks(bob)).rejects.toThrow(ForbiddenError);
  });
});
