import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  branch as branchTable,
  community,
  member,
  task,
  taskAssignment,
  taskJoinRequest,
  taskNomination,
  taskSignal,
} from "@/db/schema";
import {
  claimTask,
  countCoordinationTasks,
  createSignal,
  flaggedTasks,
  isSelfAssignWorthAskingAbout,
  listCoordinationResponseQueue,
  listCoordinationScopeTasks,
  listOverdueCheckins,
  listPendingSuggestions,
  needsAnOwner,
  pingCoordinator,
  rankByTagFit,
  suggestMemberForTask,
} from "@/lib/tasks";
import { createCycle } from "@/lib/cycles";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";

// The Coordination view's own reads, and the two pure functions the page
// and the claim surfaces share with it. The scope rules are the part
// worth pinning: every query here resolves "the actor's coordination
// coverage, narrowed to the view-scope cycle" and a leak across that
// boundary would show one coordinator another's event's tasks, which is
// the exact thing docs/plans/archive/cycle-scope-remediation-plan.md §2.1 forbids.

// A branch column for `coordinator`, the same three steps the existing
// coordination tests use: create a task, grant the module on it, claim
// it. The grant is what carries the scope (the granted task's own
// placement), and the claim is what makes them its holder.
type Member = typeof member.$inferSelect;

async function makeBranchCoordinator(
  communityId: string,
  branchId: string,
  createdBy: string,
  coordinator: Member,
) {
  const coordTask = await insertTask(communityId, branchId, createdBy, { title: "Coordination" });
  await grantPermission(communityId, "branch_coordination", coordTask.id);
  await claimTask(coordinator, coordTask.id);
  return coordTask;
}

async function makeTwoCycles(actor: Member) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, actor.communityId));
  const mine = await createCycle(actor, { source: "blank", name: "Mine" });
  // Only one event can be open at a time, and opening a second asks for
  // confirmation — the same ConfirmationRequiredError flow createCycle
  // already documents.
  const theirs = await createCycle(actor, { source: "blank", name: "Theirs", confirmed: true });
  return { mine, theirs };
}

describe("listCoordinationScopeTasks", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns a branch coordinator's own branch's tasks and no others", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const coordTask = await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: testCommunity.id, name: "Kitchen" })
      .returning();

    const mine = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Mine" });
    const notMine = await insertTask(testCommunity.id, otherBranch.id, alice.id, {
      title: "Someone else's",
    });

    const { tasks, counts } = await listCoordinationScopeTasks(alice, []);
    // The coordination task itself is a task in the branch like any
    // other, so it's in scope too — the list isn't a "everything except
    // coordination" view.
    expect(tasks.map((t) => t.id).sort()).toEqual([coordTask.id, mine.id].sort());
    expect(tasks.map((t) => t.id)).not.toContain(notMine.id);
    expect(counts.total).toBe(2);
    expect(counts.unclaimed).toBe(1);
  });

  it("counts by status and attention, and derives the numbers from the rows it returns", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    // The coordination task is a claimed task in the branch too, so
    // every expectation below is one higher than the fixture names
    // suggest — asserted explicitly rather than filtered out, because
    // that behaviour is the point.
    const coordTask = await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    await insertTask(testCommunity.id, branch.id, alice.id, { title: "Unclaimed" });
    const flagged = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Flagged" });
    await db.update(task).set({ attentionLevel: "hard" }).where(eq(task.id, flagged.id));
    const held = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Held" });
    await claimTask(bob, held.id);
    const done = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Done" });
    await claimTask(bob, done.id);
    await db.update(task).set({ status: "done" }).where(eq(task.id, done.id));

    const { tasks, counts } = await listCoordinationScopeTasks(alice, []);
    expect(counts.total).toBe(tasks.length);
    // coordTask + Unclaimed + Flagged + Held + Done.
    expect(counts.total).toBe(5);
    expect(counts.unclaimed).toBe(2);
    // The held task plus the coordination task itself.
    expect(counts.claimed).toBe(2);
    expect(tasks.find((t) => t.id === coordTask.id)?.status).toBe("claimed");
    expect(counts.done).toBe(1);
    expect(counts.flagged).toBe(1);
    // Unclaimed *and* flagged — the overlap a coordinator most wants.
    expect(counts.stuck).toBe(1);
  });

  it("excludes shadow holders from the holder count but keeps the task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    const held = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Held" });
    await claimTask(bob, held.id);
    await db.insert(taskAssignment).values({ taskId: held.id, memberId: alice.id, isShadow: true });

    const { tasks } = await listCoordinationScopeTasks(alice, []);
    const row = tasks.find((t) => t.id === held.id);
    expect(row?.holderCount).toBe(1);
    expect(row?.holderNames).toEqual([bob.name]);
  });

  it("returns nothing for a cycle-row coordinator viewing a different event", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const { mine, theirs } = await makeTwoCycles(alice);

    // A coordination grant placed in "Mine" — row semantics for that
    // event only. It lives in `mine`, so it's in its own scope too.
    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
      cycleId: mine.id,
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const inTheirs = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "In theirs",
      cycleId: theirs.id,
    });
    const inMine = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "In mine",
      cycleId: mine.id,
    });

    const scoped = await listCoordinationScopeTasks(alice, [mine.id]);
    const scopedIds = scoped.tasks.map((t) => t.id);
    expect(scopedIds).toContain(coordTask.id);
    expect(scopedIds).toContain(inMine.id);
    // Each event's auto-created Backstop task is a real task in that
    // event, so it's legitimately in scope too.
    expect(scopedIds).not.toContain(inTheirs.id);
    expect(scopedIds).toHaveLength(3);

    // The same coordinator pointed at the other event sees none of their
    // own tasks — an explicit empty segment, never the other cycle's rows.
    const outOfScope = await listCoordinationScopeTasks(alice, [theirs.id]);
    expect(outOfScope.tasks).toEqual([]);
    expect(outOfScope.counts.total).toBe(0);
  });
});

describe("needsAnOwner / flaggedTasks", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("puts a critical unclaimed task above a merely-old one, and keeps flagged out of the unowned list when done", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    const old = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Old" });
    await db
      .update(task)
      .set({ statusChangedAt: new Date(Date.now() - 90 * 86_400_000) })
      .where(eq(task.id, old.id));
    const critical = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Critical",
      critical: true,
    });
    const doneFlagged = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Done flagged" });
    await db
      .update(task)
      .set({ status: "done", attentionLevel: "escalated" })
      .where(eq(task.id, doneFlagged.id));

    const { tasks } = await listCoordinationScopeTasks(alice, []);
    expect(needsAnOwner(tasks).map((t) => t.title)).toEqual(["Critical", "Old"]);
    // A finished task keeps the attention it earned but isn't a queue.
    expect(flaggedTasks(tasks).map((t) => t.title)).toEqual([]);
  });
});

describe("listPendingSuggestions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("surfaces an unowned task someone was suggested for, with their name", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    const t = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Suggested" });
    await suggestMemberForTask(alice, t.id, bob.id);

    const suggestions = await listPendingSuggestions(alice, []);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].id).toBe(t.id);
    expect(suggestions[0].suggestedMemberName).toBe(bob.name);
  });

  it("drops the suggestion once the task has a holder, or once a nomination went out", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    // Somebody already holds it — the suggestion was overtaken.
    const heldTask = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Held" });
    await suggestMemberForTask(alice, heldTask.id, bob.id);
    await claimTask(bob, heldTask.id);

    // Still unowned, but a nomination is already pending against it —
    // the ask has been made, so re-suggesting is noise.
    const asked = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Already asked" });
    await suggestMemberForTask(alice, asked.id, bob.id);
    await db.insert(taskAssignment).values({ taskId: asked.id, memberId: bob.id });
    await db.insert(taskNomination).values({
      taskId: asked.id,
      nominatedMemberId: bob.id,
      nominatedBy: alice.id,
      respondByDeadline: new Date(Date.now() + 86_400_000),
    });

    const suggestions = await listPendingSuggestions(alice, []);
    expect(suggestions).toEqual([]);
  });
});

describe("listOverdueCheckins", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("only counts a waiting task past its check-in date *plus* the grace window", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    const justDue = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Just due" });
    await claimTask(bob, justDue.id);
    await db
      .update(task)
      .set({ status: "waiting", nextCheckinAt: new Date(Date.now() - 86_400_000) })
      .where(eq(task.id, justDue.id));

    const longOverdue = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Long overdue" });
    await claimTask(bob, longOverdue.id);
    await db
      .update(task)
      .set({ status: "waiting", nextCheckinAt: new Date(Date.now() - 30 * 86_400_000) })
      .where(eq(task.id, longOverdue.id));

    // A check-in due yesterday, with a 14-day grace, is not overdue yet.
    expect((await listOverdueCheckins(alice, [], 14)).map((c) => c.title)).toEqual(["Long overdue"]);
    // With no grace at all, it is.
    expect((await listOverdueCheckins(alice, [], 0)).map((c) => c.title).sort()).toEqual([
      "Just due",
      "Long overdue",
    ]);
  });
});

describe("listCoordinationResponseQueue", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("collects signals, pings, declines and this coordinator's expired nominations", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    const signalled = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Signalled" });
    await createSignal(bob, signalled.id, { kind: "stalled" });

    const pinged = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Pinged" });
    await claimTask(bob, pinged.id);
    await pingCoordinator(bob, pinged.id);

    const declined = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Declined" });
    await db.insert(taskAssignment).values({ taskId: declined.id, memberId: bob.id });
    await db.insert(taskJoinRequest).values({
      taskId: declined.id,
      memberId: bob.id,
      status: "declined",
      declineReason: "prefer to work solo",
    });

    const queue = await listCoordinationResponseQueue(alice, []);
    expect(queue.total).toBe(3);
    expect(queue.signals[0]).toMatchObject({ taskId: signalled.id, detail: "looks stalled" });
    // The signal's author is deliberately unrecoverable — the whole point
    // of an anonymous flag.
    expect(queue.signals[0].who).toBeNull();
    expect(queue.pings[0]).toMatchObject({ taskId: pinged.id, who: bob.name });
    expect(queue.declinedRequests[0]).toMatchObject({ taskId: declined.id, who: bob.name });
  });

  it("ignores a resolved signal and a decline on a finished task", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(testCommunity.id, branch.id, alice.id, alice);

    const resolved = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Resolved" });
    await createSignal(bob, resolved.id, { kind: "stalled" });
    await db
      .update(taskSignal)
      .set({ resolvedAt: new Date() })
      .where(eq(taskSignal.taskId, resolved.id));

    const finished = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Finished" });
    await db.insert(taskJoinRequest).values({ taskId: finished.id, memberId: bob.id, status: "declined" });
    await db.update(task).set({ status: "done" }).where(eq(task.id, finished.id));

    const queue = await listCoordinationResponseQueue(alice, []);
    expect(queue.total).toBe(0);
  });

  it("is empty for a cycle-row coordinator viewing a different event", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const { mine, theirs } = await makeTwoCycles(alice);

    const coordTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Coordination",
      cycleId: mine.id,
    });
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await claimTask(alice, coordTask.id);

    const inTheirs = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "In theirs",
      cycleId: theirs.id,
    });
    await createSignal(bob, inTheirs.id, { kind: "worth_a_look" });

    expect((await listCoordinationResponseQueue(alice, [mine.id])).total).toBe(0);
    expect((await listCoordinationResponseQueue(alice, [theirs.id])).total).toBe(0);
  });
});

describe("isSelfAssignWorthAskingAbout", () => {
  it("asks about an unclaimed or a flagged task, and nothing else", () => {
    expect(isSelfAssignWorthAskingAbout({ status: "unclaimed", attentionLevel: "ok" })).toBe(true);
    expect(isSelfAssignWorthAskingAbout({ status: "claimed", attentionLevel: "soft" })).toBe(true);
    expect(isSelfAssignWorthAskingAbout({ status: "claimed", attentionLevel: "ok" })).toBe(false);
    expect(isSelfAssignWorthAskingAbout({ status: "done", attentionLevel: "ok" })).toBe(false);
  });
});

describe("rankByTagFit", () => {
  it("orders by shared tags, then alphabetically, and never drops anyone", () => {
    const ranked = rankByTagFit(
      [
        { id: "1", name: "Zoe", tags: ["welding"] },
        { id: "2", name: "Amy", tags: ["welding", "prep"] },
        { id: "3", name: "Bob", tags: [] },
        { id: "4", name: "Cal", tags: ["PREP"] },
      ],
      ["welding", "prep"],
    );
    // Amy's two matches first; then the one-match pair alphabetically.
    expect(ranked.map((c) => c.name)).toEqual(["Amy", "Cal", "Zoe", "Bob"]);
  });

  it("is case-insensitive and falls back to alphabetical with no task tags", () => {
    expect(
      rankByTagFit(
        [
          { id: "1", name: "Zoe", tags: ["Welding"] },
          { id: "2", name: "Amy", tags: [] },
        ],
        ["welding"],
      ).map((c) => c.name),
    ).toEqual(["Zoe", "Amy"]);

    expect(
      rankByTagFit(
        [
          { id: "1", name: "Zoe", tags: ["welding"] },
          { id: "2", name: "Amy", tags: [] },
        ],
        [],
      ).map((c) => c.name),
    ).toEqual(["Amy", "Zoe"]);
  });
});

describe("countCoordinationTasks", () => {
  it("returns zeros for no tasks rather than undefined", () => {
    expect(countCoordinationTasks([])).toEqual({
      total: 0,
      unclaimed: 0,
      claimed: 0,
      waiting: 0,
      done: 0,
      flagged: 0,
      stuck: 0,
    });
  });
});
