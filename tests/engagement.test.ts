import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch as branchTable, callSummary, community, engagementEvent, member, task, taskNomination } from "@/db/schema";
import {
  claimTask,
  nominateForTask,
  parkTask,
  releaseTask,
  resolveTaskNominationDeadlines,
  respondToNomination,
  resumeTask,
} from "@/lib/tasks";
import { createPoll, submitAvailability } from "@/lib/scheduling-polls";
import { markSummaryRead, publishSummary, saveSummary } from "@/lib/scheduling-polls";
import { recomputeAttentionLevels } from "@/lib/attention";
import {
  computeEngagementPattern,
  listEngagementPatternsForCoordinator,
  logCallSummaryUnreadEngagementEvents,
} from "@/lib/engagement";
import { updateCommunity } from "@/lib/settings";
import { createFixtures, resetDatabase } from "./helpers";

const APP_URL = "http://localhost:3000";

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
      title: "Some task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

async function makeCoordinationHolder(fixtures: Awaited<ReturnType<typeof createFixtures>>, actor: typeof fixtures.alice) {
  const [coordTask] = await db
    .insert(task)
    .values({
      communityId: fixtures.community.id,
      branchId: fixtures.branch.id,
      title: "Coordination",
      tags: ["coordination"],
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy: actor.id,
    })
    .returning();
  await claimTask(actor, coordTask.id);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

describe("nudge_ignored: recomputeAttentionLevels", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("logs an event for every real holder the moment a Waiting task crosses into hard", async () => {
    const { branch, alice, bob } = await createFixtures();
    const t = await insertTask(branch.communityId, branch.id, alice.id, { capacity: 2 });
    await claimTask(alice, t.id);
    await claimTask(bob, t.id);
    await parkTask(alice, t.id, { nextCheckinAt: daysAgo(10) }); // > default 7-day grace once overdue

    const result = await recomputeAttentionLevels();
    expect(result.updated).toBe(1);

    const events = await db.select().from(engagementEvent);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.memberId).sort()).toEqual([alice.id, bob.id].sort());
    expect(events.every((e) => e.kind === "nudge_ignored" && e.taskId === t.id)).toBe(true);
  });

  it("doesn't log anything while only soft-flagged (inside the grace period)", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(branch.communityId, branch.id, alice.id);
    await claimTask(alice, t.id);
    await parkTask(alice, t.id, { nextCheckinAt: daysAgo(2) }); // overdue, but well inside the 7-day grace

    await recomputeAttentionLevels();
    expect(await db.select().from(engagementEvent)).toHaveLength(0);
  });

  it("doesn't log anything for an ordinary claimed (not Waiting) task going stale", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(branch.communityId, branch.id, alice.id);
    await claimTask(alice, t.id);
    await db.update(task).set({ statusChangedAt: daysAgo(20) }).where(eq(task.id, t.id));

    await recomputeAttentionLevels();
    expect(await db.select().from(engagementEvent)).toHaveLength(0);
  });

  it("resuming a Waiting task resolves the holder's whole open pattern", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(branch.communityId, branch.id, alice.id);
    await claimTask(alice, t.id);
    await parkTask(alice, t.id, { nextCheckinAt: daysAgo(10) });
    await recomputeAttentionLevels();
    expect((await computeEngagementPattern(alice.id, branch.communityId)).openCount).toBe(1);

    await resumeTask(alice, t.id);
    expect((await computeEngagementPattern(alice.id, branch.communityId)).openCount).toBe(0);
  });

  it("releasing a Waiting task also resolves the holder's pattern, releasing a merely-claimed one doesn't", async () => {
    const { branch, alice, bob } = await createFixtures();

    const waitingTask = await insertTask(branch.communityId, branch.id, alice.id);
    await claimTask(alice, waitingTask.id);
    await parkTask(alice, waitingTask.id, { nextCheckinAt: daysAgo(10) });
    await recomputeAttentionLevels();
    expect((await computeEngagementPattern(alice.id, branch.communityId)).openCount).toBe(1);

    await releaseTask(alice, waitingTask.id);
    expect((await computeEngagementPattern(alice.id, branch.communityId)).openCount).toBe(0);

    // A second, unrelated open event for bob, resolved only by acting on
    // a *Waiting* task specifically — releasing an ordinary claimed task
    // shouldn't touch it.
    const nomTask = await insertTask(branch.communityId, branch.id, alice.id);
    const claimedTask = await insertTask(branch.communityId, branch.id, alice.id);
    await claimTask(bob, claimedTask.id);
    await db.insert(engagementEvent).values({ memberId: bob.id, kind: "nudge_ignored", taskId: nomTask.id });
    expect((await computeEngagementPattern(bob.id, branch.communityId)).openCount).toBe(1);
    await releaseTask(bob, claimedTask.id);
    expect((await computeEngagementPattern(bob.id, branch.communityId)).openCount).toBe(1);
  });
});

describe("task_nomination_expired", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("logs an event when a nomination expires, resets on a real response instead", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);
    const t1 = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination: nom1 } = await nominateForTask(fixtures.alice, t1.id, { memberId: fixtures.bob.id }, APP_URL);
    await db
      .update(taskNomination)
      .set({ respondByDeadline: daysAgo(1) })
      .where(eq(taskNomination.id, nom1.id));
    await resolveTaskNominationDeadlines();

    const pattern = await computeEngagementPattern(fixtures.bob.id, fixtures.community.id);
    expect(pattern.openCount).toBe(1);

    const t2 = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const { nomination: nom2 } = await nominateForTask(fixtures.alice, t2.id, { memberId: fixtures.bob.id }, APP_URL);
    await respondToNomination(fixtures.bob, nom2.id, { response: "declined" });

    expect((await computeEngagementPattern(fixtures.bob.id, fixtures.community.id)).openCount).toBe(0);
  });
});

describe("call_summary_unread_past_window", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpPublishedSummary(fixtures: Awaited<ReturnType<typeof createFixtures>>) {
    const poll = await createPoll(fixtures.alice, {
      branchId: fixtures.branch.id,
      title: "Weekly call",
      resolutionMode: "max_attendance",
      minAttendance: 1,
      rangeStart: "2027-01-01",
      rangeEnd: "2027-01-02",
      requireRead: true,
    });
    const slot = "2027-01-01T10:00:00.000Z";
    await submitAvailability(fixtures.alice, poll.id, { slots: [slot] });
    await submitAvailability(fixtures.bob, poll.id, { slots: [slot] });
    await saveSummary(fixtures.alice, poll.id, { body: "Notes from the call" });
    const published = await publishSummary(fixtures.alice, poll.id);
    return { poll, published };
  }

  it("logs an event for each audience member who hasn't read it once the window passes, skips readers", async () => {
    const fixtures = await createFixtures();
    const { published } = await setUpPublishedSummary(fixtures);
    await markSummaryRead(fixtures.alice, published.id); // alice reads it before the window closes
    await db
      .update(callSummary)
      .set({ publishedAt: daysAgo(5) }) // > default 3-day window
      .where(eq(callSummary.id, published.id));

    const result = await logCallSummaryUnreadEngagementEvents();
    expect(result.logged).toBe(1);

    expect((await computeEngagementPattern(fixtures.alice.id, fixtures.community.id)).openCount).toBe(0);
    expect((await computeEngagementPattern(fixtures.bob.id, fixtures.community.id)).openCount).toBe(1);
  });

  it("leaves a summary still inside its window untouched", async () => {
    const fixtures = await createFixtures();
    await setUpPublishedSummary(fixtures);

    const result = await logCallSummaryUnreadEngagementEvents();
    expect(result.checked).toBe(0);
    expect(result.logged).toBe(0);
  });

  it("never re-checks the same summary twice", async () => {
    const fixtures = await createFixtures();
    const { published } = await setUpPublishedSummary(fixtures);
    await db.update(callSummary).set({ publishedAt: daysAgo(5) }).where(eq(callSummary.id, published.id));

    const first = await logCallSummaryUnreadEngagementEvents();
    expect(first.checked).toBe(1);
    const second = await logCallSummaryUnreadEngagementEvents();
    expect(second.checked).toBe(0);
  });

  it("marking a summary read after the fact still resolves the member's open pattern", async () => {
    const fixtures = await createFixtures();
    const { published } = await setUpPublishedSummary(fixtures);
    await db.update(callSummary).set({ publishedAt: daysAgo(5) }).where(eq(callSummary.id, published.id));
    await logCallSummaryUnreadEngagementEvents();
    expect((await computeEngagementPattern(fixtures.bob.id, fixtures.community.id)).openCount).toBe(1);

    await markSummaryRead(fixtures.bob, published.id);
    expect((await computeEngagementPattern(fixtures.bob.id, fixtures.community.id)).openCount).toBe(0);
  });

  it("respects the community's configured read window", async () => {
    const fixtures = await createFixtures();
    await updateCommunity(fixtures.alice, { callSummaryReadWindowDays: 10 });
    const { published } = await setUpPublishedSummary(fixtures);
    await db.update(callSummary).set({ publishedAt: daysAgo(5) }).where(eq(callSummary.id, published.id));

    const result = await logCallSummaryUnreadEngagementEvents();
    expect(result.checked).toBe(0);
  });
});

describe("computeEngagementPattern", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reads none/noted/soft_flag/pattern off the community's own thresholds", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    expect((await computeEngagementPattern(alice.id, testCommunity.id)).level).toBe("none");

    await db.insert(engagementEvent).values({ memberId: alice.id, kind: "nudge_ignored" });
    expect((await computeEngagementPattern(alice.id, testCommunity.id)).level).toBe("noted");

    await db.insert(engagementEvent).values({ memberId: alice.id, kind: "nudge_ignored" });
    expect((await computeEngagementPattern(alice.id, testCommunity.id)).level).toBe("soft_flag");

    await db.insert(engagementEvent).values({ memberId: alice.id, kind: "nudge_ignored" });
    expect((await computeEngagementPattern(alice.id, testCommunity.id)).level).toBe("pattern");
  });

  it("respects a community's own custom thresholds", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await db
      .update(community)
      .set({ engagementSoftFlagThreshold: 5, engagementPatternThreshold: 8 })
      .where(eq(community.id, testCommunity.id));

    await db.insert(engagementEvent).values({ memberId: alice.id, kind: "nudge_ignored" });
    await db.insert(engagementEvent).values({ memberId: alice.id, kind: "nudge_ignored" });
    expect((await computeEngagementPattern(alice.id, testCommunity.id)).level).toBe("noted");
  });

  it("ignores resolved events entirely", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await db
      .insert(engagementEvent)
      .values({ memberId: alice.id, kind: "nudge_ignored", resolvedAt: new Date() });
    expect((await computeEngagementPattern(alice.id, testCommunity.id)).level).toBe("none");
  });
});

describe("listEngagementPatternsForCoordinator", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only surfaces members holding a task in a branch the actor coordinates, and only a non-none pattern", async () => {
    const fixtures = await createFixtures();
    await makeCoordinationHolder(fixtures, fixtures.alice);

    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: fixtures.community.id, name: "Wood" })
      .returning();
    const [carol] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Carol" }).returning();

    const inBranch = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    await claimTask(fixtures.bob, inBranch.id);
    await db.insert(engagementEvent).values({ memberId: fixtures.bob.id, kind: "nudge_ignored", taskId: inBranch.id });

    const outOfBranch = await insertTask(fixtures.community.id, otherBranch.id, fixtures.alice.id);
    await claimTask(carol, outOfBranch.id);
    await db.insert(engagementEvent).values({ memberId: carol.id, kind: "nudge_ignored", taskId: outOfBranch.id });

    // A member holding an in-branch task but with no open events at all.
    const clean = await insertTask(fixtures.community.id, fixtures.branch.id, fixtures.alice.id);
    const [dave] = await db.insert(member).values({ communityId: fixtures.community.id, name: "Dave" }).returning();
    await claimTask(dave, clean.id);

    const results = await listEngagementPatternsForCoordinator(fixtures.alice);
    expect(results).toEqual([{ memberId: fixtures.bob.id, memberName: "Bob", level: "noted", openCount: 1 }]);
  });

  it("returns nothing for a member who coordinates no branch", async () => {
    const fixtures = await createFixtures();
    expect(await listEngagementPatternsForCoordinator(fixtures.bob)).toEqual([]);
  });
});
