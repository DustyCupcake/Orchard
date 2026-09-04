import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  branch as branchTable,
  community,
  conflictReport,
  member,
  shiftOccurrence,
  task,
  taskAssignment,
  taskNomination,
} from "@/db/schema";
import { claimTask, claimOrRequestToJoin, nominateForTask, parkTask, resolveTaskNominationDeadlines } from "@/lib/tasks";
import { createTier, updateCommunity } from "@/lib/settings";
import { createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";
import { createBudgetCycle, submitBudgetVote } from "@/lib/budget";
import { closeProposalsToVoting } from "@/lib/budget";
import { createEventProposal } from "@/lib/event-scheduling";
import { createShiftSeries, generateShiftOccurrences, signUpForShift } from "@/lib/shifts";
import { fileConflictReport } from "@/lib/conflict";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

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
      placementInvites: [],
      myLinkedPendingPlacements: [],
      placementRevertNotices: [],
      placementPendingReviews: [],
      calendarEventInvites: [],
      emergencyAccessActivity: [],
      budgetNeedsAction: [],
      eventSchedulingNeedsAction: [],
      shiftCoordinatorNeedsAction: [],
      myShiftsNeedingCompletion: [],
      conflictNeedsAction: [],
      pendingNominations: [],
      expiredNominations: [],
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
      title: "Coordination",
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
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

// docs/development-plan.md's Phase 49: Budget/Event scheduling/Shifts/
// Conflict management never got wired into getPersonalFeed the way
// Recruitment/Spatial planning/Calendar events/Emergency access did as
// each landed. Each test below calls getPersonalFeed exactly once —
// getPersonalFeed is wrapped in React's cache(), so calling it twice
// with the *same* actor object reference within one test (state
// mutated in between) risks reading back a stale memoized result
// rather than the fresh DB state; every existing test above already
// avoids this by construction, followed here too.
describe("getPersonalFeed: Budget/Event scheduling/Shifts/Conflict management needs-action (Phase 49)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function insertOwnerTask(communityId: string, branchId: string, createdBy: string, title: string) {
    const [row] = await db
      .insert(task)
      .values({
        communityId,
        branchId,
        title,
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        createdBy,
      })
      .returning();
    return row;
  }

  it("Budget: owner sees close_to_voting once the deadline has passed", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Budget owner");
    await claimTask(alice, ownerTask.id);
    const cycleRow = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: new Date(Date.now() - 1000).toISOString(),
      ownerTaskId: ownerTask.id,
    });

    const feed = await getPersonalFeed(alice);
    expect(feed.budgetNeedsAction).toEqual([
      { cycleId: cycleRow.id, cycleTitle: "Season budget", kind: "close_to_voting" },
    ]);
  });

  it("Budget: a non-owner member sees nothing while proposals are still open", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Budget owner");
    await claimTask(alice, ownerTask.id);
    await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: new Date(Date.now() + 7 * 86400000).toISOString(),
      ownerTaskId: ownerTask.id,
    });

    const feed = await getPersonalFeed(bob);
    expect(feed.budgetNeedsAction).toEqual([]);
  });

  it("Budget: owner sees confirm_funded_set during voting", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Budget owner");
    await claimTask(alice, ownerTask.id);
    const cycleRow = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: new Date(Date.now() + 86400000).toISOString(),
      ownerTaskId: ownerTask.id,
    });
    await closeProposalsToVoting(alice, cycleRow.id);

    const feed = await getPersonalFeed(alice);
    expect(feed.budgetNeedsAction).toContainEqual({
      cycleId: cycleRow.id,
      cycleTitle: "Season budget",
      kind: "confirm_funded_set",
    });
  });

  it("Budget: any member sees cast_vote during voting before they vote", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Budget owner");
    await claimTask(alice, ownerTask.id);
    const cycleRow = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: new Date(Date.now() + 86400000).toISOString(),
      ownerTaskId: ownerTask.id,
    });
    await closeProposalsToVoting(alice, cycleRow.id);

    const feed = await getPersonalFeed(bob);
    expect(feed.budgetNeedsAction).toContainEqual({
      cycleId: cycleRow.id,
      cycleTitle: "Season budget",
      kind: "cast_vote",
    });
  });

  it("Budget: cast_vote disappears once a member actually votes", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["budget"] });
    const ownerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Budget owner");
    await claimTask(alice, ownerTask.id);
    const cycleRow = await createBudgetCycle(alice, {
      title: "Season budget",
      proposalDeadline: new Date(Date.now() + 86400000).toISOString(),
      ownerTaskId: ownerTask.id,
    });
    await closeProposalsToVoting(alice, cycleRow.id);
    await submitBudgetVote(bob, cycleRow.id, { rankedProposalIds: [] });

    const feed = await getPersonalFeed(bob);
    expect(feed.budgetNeedsAction).toEqual([]);
  });

  it("Event scheduling: owner sees an unresolved proposal, a non-owner sees nothing", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["event_scheduling"] });
    const ownerTask = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Scheduling owner");
    await claimTask(alice, ownerTask.id);
    await grantPermission(alice.communityId, "event_scheduling_owner", ownerTask.id);

    const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    await createEventProposal(bob, {
      host: "Bob",
      title: "Fire circle",
      durationMinutes: 60,
      preferredSlots: [{ startsAt: iso(24), endsAt: iso(25) }],
    });

    const ownerFeed = await getPersonalFeed(alice);
    expect(ownerFeed.eventSchedulingNeedsAction).toEqual([
      { proposalId: expect.any(String), title: "Fire circle", status: "proposed" },
    ]);

    const nonOwnerFeed = await getPersonalFeed(bob);
    expect(nonOwnerFeed.eventSchedulingNeedsAction).toEqual([]);
  });

  it("Shifts: a coordinator sees an ended occurrence with an unresolved signup", async () => {
    const { alice, bob } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["shifts"] });
    const series = await createShiftSeries(alice, { title: "Dish duty", defaultCapacity: 2 });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 7200_000).toISOString() }],
    });
    await signUpForShift(bob, occurrence.id);
    await db
      .update(shiftOccurrence)
      .set({ startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000) })
      .where(eq(shiftOccurrence.id, occurrence.id));

    const coordinatorFeed = await getPersonalFeed(alice);
    expect(coordinatorFeed.shiftCoordinatorNeedsAction).toEqual([
      { occurrenceId: occurrence.id, seriesTitle: "Dish duty", startsAt: expect.any(Date), unresolvedCount: 1 },
    ]);
  });

  it("Shifts: the signed-up member (not the coordinator) sees their own past shift needing completion", async () => {
    const { alice, bob } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["shifts"] });
    const series = await createShiftSeries(alice, { title: "Dish duty", defaultCapacity: 2 });
    const [occurrence] = await generateShiftOccurrences(alice, series.id, {
      mode: "explicit",
      slots: [{ startsAt: new Date(Date.now() + 3600_000).toISOString(), endsAt: new Date(Date.now() + 7200_000).toISOString() }],
    });
    await signUpForShift(bob, occurrence.id);
    await db
      .update(shiftOccurrence)
      .set({ startsAt: new Date(Date.now() - 7200_000), endsAt: new Date(Date.now() - 3600_000) })
      .where(eq(shiftOccurrence.id, occurrence.id));

    const bobFeed = await getPersonalFeed(bob);
    expect(bobFeed.shiftCoordinatorNeedsAction).toEqual([]);
    expect(bobFeed.myShiftsNeedingCompletion).toEqual([
      { signupId: expect.any(String), seriesTitle: "Dish duty", endsAt: expect.any(Date) },
    ]);
  });

  it("Conflict management: a team member sees nothing for a report still inside the acknowledgment window", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    const teamTask = await insertOwnerTask(testCommunity.id, branch.id, alice.id, "Conflict team");
    await claimTask(alice, teamTask.id);
    await grantPermission(testCommunity.id, "conflict_team", teamTask.id);
    await db
      .update(community)
      .set({ conflictAckWindowHours: 1 })
      .where(eq(community.id, testCommunity.id));
    await fileConflictReport(bob, {});

    const feed = await getPersonalFeed(alice);
    expect(feed.conflictNeedsAction).toEqual([]);
  });

  it("Conflict management: a team member sees a report once it's past the acknowledgment window", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    const teamTask = await insertOwnerTask(testCommunity.id, branch.id, alice.id, "Conflict team");
    await claimTask(alice, teamTask.id);
    await grantPermission(testCommunity.id, "conflict_team", teamTask.id);
    await db
      .update(community)
      .set({ conflictAckWindowHours: 1 })
      .where(eq(community.id, testCommunity.id));
    const stale = await fileConflictReport(bob, {});
    await db
      .update(conflictReport)
      .set({ createdAt: new Date(Date.now() - 2 * 3600_000) })
      .where(eq(conflictReport.id, stale.id));

    const feed = await getPersonalFeed(alice);
    expect(feed.conflictNeedsAction).toEqual([{ reportId: stale.id, createdAt: expect.any(Date) }]);
  });

  async function makeCoordinationHolder(communityId: string, branchId: string, actor: typeof member.$inferSelect) {
    const [coordTask] = await db
      .insert(task)
      .values({
        communityId,
        branchId,
        title: "Coordination",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        createdBy: actor.id,
      })
      .returning();
    await grantPermission(communityId, "branch_coordination", coordTask.id);
    await claimTask(actor, coordTask.id);
  }

  it("Task nomination: the nominee sees their own pending nomination, the nominator sees nothing yet", async () => {
    const { alice, bob, branch } = await createFixtures();
    await makeCoordinationHolder(alice.communityId, branch.id, alice);
    const target = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Water the trees");
    await nominateForTask(alice, target.id, { memberId: bob.id }, "http://localhost:3000");

    const nomineeFeed = await getPersonalFeed(bob);
    expect(nomineeFeed.pendingNominations).toHaveLength(1);
    expect(nomineeFeed.pendingNominations[0].taskTitle).toBe("Water the trees");
    expect(nomineeFeed.expiredNominations).toEqual([]);
  });

  it("Task nomination: the nominator sees an expired-without-response nomination", async () => {
    const { alice, bob, branch } = await createFixtures();
    await makeCoordinationHolder(alice.communityId, branch.id, alice);
    const target = await insertOwnerTask(alice.communityId, branch.id, alice.id, "Water the trees");
    const { nomination } = await nominateForTask(alice, target.id, { memberId: bob.id }, "http://localhost:3000");
    await db
      .update(taskNomination)
      .set({ respondByDeadline: new Date(Date.now() - 1000) })
      .where(eq(taskNomination.id, nomination.id));
    await resolveTaskNominationDeadlines();

    const nominatorFeed = await getPersonalFeed(alice);
    expect(nominatorFeed.expiredNominations).toHaveLength(1);
    expect(nominatorFeed.expiredNominations[0].nomineeName).toBe("Bob");
  });
});
