import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch as branchTable, community, member, task, taskAssignment } from "@/db/schema";
import { claimTask, claimOrRequestToJoin, parkTask } from "@/lib/tasks";
import { createTier } from "@/lib/settings";
import { createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

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
      title: "Water the trees",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("getPersonalFeed", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is empty for a member holding nothing", async () => {
    const { alice } = await createFixtures();
    const feed = await getPersonalFeed(alice);
    expect(feed).toEqual({
      pendingJoinRequests: [],
      upcomingCheckins: [],
      flaggedHeldTasks: [],
      recruitmentNeedsAction: [],
    });
  });

  it("excludes shadow assignments and done tasks", async () => {
    const { alice, branch } = await createFixtures();
    const shadowed = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      attentionLevel: "hard",
    });
    await db.insert(taskAssignment).values({ taskId: shadowed.id, memberId: alice.id, isShadow: true });

    const done = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "done",
      attentionLevel: "hard",
      title: "Finished",
    });
    await db.insert(taskAssignment).values({ taskId: done.id, memberId: alice.id });

    const feed = await getPersonalFeed(alice);
    expect(feed.flaggedHeldTasks).toHaveLength(0);
  });

  it("lists a currently-held flagged task", async () => {
    const { alice, branch } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id, {
      status: "claimed",
      attentionLevel: "soft",
    });
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: alice.id });

    const feed = await getPersonalFeed(alice);
    expect(feed.flaggedHeldTasks).toEqual([
      { id: t.id, title: t.title, branchName: branch.name, attentionLevel: "soft" },
    ]);
  });

  it("lists upcoming check-ins for parked (Waiting) held tasks, soonest first", async () => {
    const { alice, branch } = await createFixtures();
    const t1 = await insertTask(alice.communityId, branch.id, alice.id, { title: "Later check-in" });
    const t2 = await insertTask(alice.communityId, branch.id, alice.id, { title: "Sooner check-in" });
    await claimTask(alice, t1.id);
    await claimTask(alice, t2.id);

    const later = new Date(Date.now() + 7 * 86400000);
    const sooner = new Date(Date.now() + 1 * 86400000);
    await parkTask(alice, t1.id, { nextCheckinAt: later });
    await parkTask(alice, t2.id, { nextCheckinAt: sooner });

    const feed = await getPersonalFeed(alice);
    expect(feed.upcomingCheckins.map((c) => c.title)).toEqual(["Sooner check-in", "Later check-in"]);
  });

  it("lists pending join requests only on tasks the actor currently holds", async () => {
    const { alice, bob, branch } = await createFixtures();
    const held = await insertTask(alice.communityId, branch.id, alice.id, {
      capacity: 2,
      openness: "request",
    });
    const notHeld = await insertTask(alice.communityId, branch.id, alice.id, {
      capacity: 2,
      openness: "request",
      title: "Not alice's",
    });
    await claimTask(alice, held.id);
    await claimTask(bob, notHeld.id);

    const [carol] = await db
      .insert(member)
      .values({ communityId: alice.communityId, name: "Carol" })
      .returning();

    await claimOrRequestToJoin(carol, held.id);
    await claimOrRequestToJoin(carol, notHeld.id);

    const feed = await getPersonalFeed(alice);
    expect(feed.pendingJoinRequests).toHaveLength(1);
    expect(feed.pendingJoinRequests[0].taskId).toBe(held.id);
    expect(feed.pendingJoinRequests[0].requestedByName).toBe("Carol");
  });
});

describe("getCommunitySnapshot", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("counts members per tier", async () => {
    const { alice } = await createFixtures();
    const experienced = await createTier(alice, { name: "Experienced" });
    await db.update(member).set({ tierIds: [experienced.id] }).where(eq(member.id, alice.id));

    const refetched = (await db.select().from(member).where(eq(member.id, alice.id)))[0];
    const snapshot = await getCommunitySnapshot(refetched);
    expect(snapshot.tierCounts).toEqual([{ id: experienced.id, name: "Experienced", count: 1 }]);
  });

  it("branch spread counts distinct current holders, excluding shadows and done tasks", async () => {
    const { alice, bob, branch } = await createFixtures();
    const t1 = await insertTask(alice.communityId, branch.id, alice.id, { capacity: 3 });
    await claimTask(alice, t1.id);
    await claimTask(bob, t1.id);

    const done = await insertTask(alice.communityId, branch.id, alice.id, { status: "done", title: "Old" });
    await db.insert(taskAssignment).values({ taskId: done.id, memberId: alice.id });

    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: alice.communityId, name: "Wood" })
      .returning();
    const shadowedTask = await insertTask(alice.communityId, otherBranch.id, alice.id);
    await db.insert(taskAssignment).values({ taskId: shadowedTask.id, memberId: alice.id, isShadow: true });

    const snapshot = await getCommunitySnapshot(alice);
    const fruit = snapshot.branchSpread.find((b) => b.id === branch.id)!;
    const wood = snapshot.branchSpread.find((b) => b.id === otherBranch.id)!;
    expect(fruit.memberCount).toBe(2);
    expect(wood.memberCount).toBe(0);
  });

  it("derives branch health status from the worst flag present, active tasks only", async () => {
    const { alice, branch } = await createFixtures();
    await insertTask(alice.communityId, branch.id, alice.id, { attentionLevel: "soft" });

    let snapshot = await getCommunitySnapshot(alice);
    expect(snapshot.branchHealth.find((b) => b.id === branch.id)?.status).toBe("attention_needed");

    await insertTask(alice.communityId, branch.id, alice.id, { attentionLevel: "escalated", title: "Escalated" });
    snapshot = await getCommunitySnapshot(alice);
    expect(snapshot.branchHealth.find((b) => b.id === branch.id)?.status).toBe("struggling");

    // A done task's stale attention_level shouldn't count — a fresh
    // branch with only a done+escalated task should still read "on
    // track", not "struggling".
    const [freshBranch] = await db
      .insert(branchTable)
      .values({ communityId: alice.communityId, name: "Wood" })
      .returning();
    await insertTask(alice.communityId, freshBranch.id, alice.id, {
      status: "done",
      attentionLevel: "escalated",
      title: "Done but flagged",
    });
    const freshSnapshot = await getCommunitySnapshot(alice);
    expect(freshSnapshot.branchHealth.find((b) => b.id === freshBranch.id)?.status).toBe("on_track");
  });

  it("shows real flag counts only to a coordination-view holder", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    await insertTask(alice.communityId, branch.id, alice.id, { attentionLevel: "hard" });

    let snapshot = await getCommunitySnapshot(bob);
    expect(snapshot.branchHealth.find((b) => b.id === branch.id)?.counts).toBeNull();

    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      tags: ["coordination"],
      title: "Coordination",
    });
    await claimTask(bob, coordTask.id);

    snapshot = await getCommunitySnapshot(bob);
    const health = snapshot.branchHealth.find((b) => b.id === branch.id)!;
    expect(health.counts).toEqual({ soft: 0, hard: 1, escalated: 0 });
  });

  it("active member count is null when there's no current cycle at all", async () => {
    const { alice } = await createFixtures();
    const snapshot = await getCommunitySnapshot(alice);
    expect(snapshot.activeMemberCount).toBeNull();
  });

  it("active member count reads Participation 'coming' for the most recent cycle only", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await declareParticipation(alice, cyc.id, { status: "coming" });
    await declareParticipation(bob, cyc.id, { status: "maybe" });

    const snapshot = await getCommunitySnapshot(alice);
    expect(snapshot.activeMemberCount).toBe(1);
  });
});
