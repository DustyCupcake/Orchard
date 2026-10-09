import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { branch as branchTable, community, member, task, taskAssignment } from "@/db/schema";
import {
  acceptJoinRequest,
  claimOrRequestToJoin,
  claimTask,
  declineJoinRequest,
  releaseTask,
} from "@/lib/tasks";
import { claimAsShadow } from "@/lib/tasks/shadows";
import { createCycle } from "@/lib/cycles";
import { listCoordinatorIdsForScope } from "@/lib/coordination";
import { getPersonalFeed } from "@/lib/dashboard";
import { ConfirmationRequiredError, ForbiddenError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

// coordination_approved is the openness for tasks where who holds them
// matters, so the claim that matters most — the first one — has to be
// approved too, and the approver has to be the task's coordination rather
// than whoever happens to hold it. See src/lib/tasks/join-requests.ts.

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
      title: "Safety lead",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

async function addMember(communityId: string, name: string) {
  const [row] = await db.insert(member).values({ communityId, name }).returning();
  return row;
}

// Makes `who` a real holder of a branch_coordination task in `branchId`
// (cycle-less, so it covers every cycle of that branch).
async function makeBranchCoordinator(
  communityId: string,
  branchId: string,
  who: typeof member.$inferSelect,
  moduleKey: "branch_coordination" | "community_coordination" = "branch_coordination",
  cycleId: string | null = null,
) {
  const t = await insertTask(communityId, branchId, who.id, { title: "Coordination", cycleId });
  await grantPermission(communityId, moduleKey, t.id);
  await claimTask(who, t.id);
  return t;
}

describe("first claim on a coordination_approved task", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("becomes a request when somebody coordinates the scope", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(c.id, branch.id, alice);
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved" });

    const result = await claimOrRequestToJoin(bob, t.id);

    expect(result.status).toBe("requested");
    const holders = await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, t.id));
    expect(holders).toHaveLength(0);
  });

  it("is claimed directly when nobody coordinates the scope (a community with no coordinators still works)", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved" });

    const result = await claimOrRequestToJoin(bob, t.id);

    expect(result.status).toBe("claimed");
  });

  it("is claimed directly by the coordinator themselves, after the existing confirmation", async () => {
    const { community: c, branch, alice } = await createFixtures();
    await makeBranchCoordinator(c.id, branch.id, alice);
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved" });

    await expect(claimOrRequestToJoin(alice, t.id)).rejects.toThrow(ConfirmationRequiredError);
    const result = await claimOrRequestToJoin(alice, t.id, { confirmed: true });
    expect(result.status).toBe("claimed");
  });

  it("is still claimed instantly on a plain `request` task nobody holds", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(c.id, branch.id, alice);
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "request" });

    expect((await claimOrRequestToJoin(bob, t.id)).status).toBe("claimed");
  });

  it("is approved by the branch coordinator, who need not hold the task", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(c.id, branch.id, alice);
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved" });
    const result = await claimOrRequestToJoin(bob, t.id);
    if (result.status !== "requested") throw new Error("expected a request");

    const accepted = await acceptJoinRequest(alice, t.id, result.request.id);

    expect(accepted.status).toBe("claimed");
    const [holder] = await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, t.id));
    expect(holder.memberId).toBe(bob.id);
  });
});

describe("who may approve a coordination_approved join request", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is a community-wide coordinator from a different branch, and not an ordinary holder", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: c.id, name: "Wood" })
      .returning();
    const carol = await addMember(c.id, "Carol");
    const dave = await addMember(c.id, "Dave");
    await makeBranchCoordinator(c.id, otherBranch.id, carol, "community_coordination");
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved", capacity: 3 });
    await claimOrRequestToJoin(bob, t.id).then(async (r) => {
      if (r.status !== "requested") throw new Error("expected a request");
      await acceptJoinRequest(carol, t.id, r.request.id);
    });
    const request = await claimOrRequestToJoin(dave, t.id);
    if (request.status !== "requested") throw new Error("expected a request");

    // Bob now holds it, but holding is not approving once someone coordinates.
    await expect(acceptJoinRequest(bob, t.id, request.request.id)).rejects.toThrow(ForbiddenError);
    await expect(declineJoinRequest(bob, t.id, request.request.id)).rejects.toThrow(ForbiddenError);
    const accepted = await acceptJoinRequest(carol, t.id, request.request.id);
    expect(accepted.status).toBe("claimed");
  });

  it("is a coordinator for the task's own cycle, and not for a different one", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, c.id));
    const cycleA = await createCycle(alice, { source: "blank", name: "2027 Season" });
    const cycleB = await createCycle(alice, { source: "blank", name: "2027 Reunion", confirmed: true });
    const carol = await addMember(c.id, "Carol");
    const dave = await addMember(c.id, "Dave");
    await makeBranchCoordinator(c.id, branch.id, carol, "branch_coordination", cycleA.id);
    await makeBranchCoordinator(c.id, branch.id, dave, "branch_coordination", cycleB.id);
    const t = await insertTask(c.id, branch.id, alice.id, {
      openness: "coordination_approved",
      cycleId: cycleA.id,
    });
    const request = await claimOrRequestToJoin(bob, t.id);
    if (request.status !== "requested") throw new Error("expected a request");

    await expect(acceptJoinRequest(dave, t.id, request.request.id)).rejects.toThrow(ForbiddenError);
    expect((await acceptJoinRequest(carol, t.id, request.request.id)).status).toBe("claimed");
  });

  it("can still be resolved after every holder has left", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const carol = await addMember(c.id, "Carol");
    await makeBranchCoordinator(c.id, branch.id, carol);
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved", capacity: 2 });
    await claimOrRequestToJoin(alice, t.id).then(async (r) => {
      if (r.status !== "requested") throw new Error("expected a request");
      await acceptJoinRequest(carol, t.id, r.request.id);
    });
    const request = await claimOrRequestToJoin(bob, t.id);
    if (request.status !== "requested") throw new Error("expected a request");
    await releaseTask(alice, t.id);

    // The old rule demanded a holder, and there is none: this deadlocked.
    expect((await acceptJoinRequest(carol, t.id, request.request.id)).status).toBe("claimed");
  });

  it("is never a shadow, on either openness", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const carol = await addMember(c.id, "Carol");
    for (const openness of ["request", "coordination_approved"] as const) {
      const t = await insertTask(c.id, branch.id, alice.id, { openness, capacity: 3, title: openness });
      await claimTask(alice, t.id);
      await claimAsShadow(bob, t.id);
      const request = await claimOrRequestToJoin(carol, t.id);
      if (request.status !== "requested") throw new Error("expected a request");

      await expect(acceptJoinRequest(bob, t.id, request.request.id)).rejects.toThrow(ForbiddenError);
      expect((await acceptJoinRequest(alice, t.id, request.request.id)).status).toBe("claimed");
    }
  });

  it("is never the requester, even when they are the scope's only coordinator", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    await makeBranchCoordinator(c.id, branch.id, bob);
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved", capacity: 2 });
    await claimTask(alice, t.id);
    const request = await claimOrRequestToJoin(bob, t.id);
    if (request.status !== "requested") throw new Error("expected a request");

    await expect(acceptJoinRequest(bob, t.id, request.request.id)).rejects.toThrow(ForbiddenError);
    // Nobody *else* coordinates, so the holder can — otherwise this request
    // would sit forever.
    expect((await acceptJoinRequest(alice, t.id, request.request.id)).status).toBe("claimed");
  });

  it("falls back to an ordinary holder only when nobody coordinates the scope", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const carol = await addMember(c.id, "Carol");
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved", capacity: 3 });
    await claimTask(alice, t.id);
    const request = await claimOrRequestToJoin(bob, t.id);
    if (request.status !== "requested") throw new Error("expected a request");

    await expect(acceptJoinRequest(carol, t.id, request.request.id)).rejects.toThrow(ForbiddenError);
    expect((await acceptJoinRequest(alice, t.id, request.request.id)).status).toBe("claimed");
  });
});

describe("listCoordinatorIdsForScope", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lists branch, community-wide and cycle coordinators for the scope, and nobody else", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const [otherBranch] = await db
      .insert(branchTable)
      .values({ communityId: c.id, name: "Wood" })
      .returning();
    const carol = await addMember(c.id, "Carol");
    const dave = await addMember(c.id, "Dave");
    await makeBranchCoordinator(c.id, branch.id, alice);
    await makeBranchCoordinator(c.id, otherBranch.id, bob);
    await makeBranchCoordinator(c.id, otherBranch.id, carol, "community_coordination");

    const result = await listCoordinatorIdsForScope(c.id, { branchId: branch.id, cycleId: null });

    expect(result.everyone).toBe(false);
    expect([...result.memberIds].sort()).toEqual([alice.id, carol.id].sort());
    expect(result.memberIds.has(bob.id)).toBe(false);
    expect(result.memberIds.has(dave.id)).toBe(false);
  });
});

describe("the dashboard's pending join requests", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reaches the coordinator who does not hold the task, and not an ordinary holder", async () => {
    const { community: c, branch, alice, bob } = await createFixtures();
    const carol = await addMember(c.id, "Carol");
    const dave = await addMember(c.id, "Dave");
    await makeBranchCoordinator(c.id, branch.id, carol);
    const t = await insertTask(c.id, branch.id, alice.id, { openness: "coordination_approved", capacity: 3 });
    await claimOrRequestToJoin(bob, t.id).then(async (r) => {
      if (r.status !== "requested") throw new Error("expected a request");
      await acceptJoinRequest(carol, t.id, r.request.id);
    });
    await claimOrRequestToJoin(dave, t.id);

    const coordinatorFeed = await getPersonalFeed(carol);
    const holderFeed = await getPersonalFeed(bob);
    const requesterFeed = await getPersonalFeed(dave);

    expect(coordinatorFeed.pendingJoinRequests.map((r) => r.taskId)).toEqual([t.id]);
    expect(coordinatorFeed.pendingJoinRequests[0].requestedByName).toBe("Dave");
    // Bob holds the task but cannot approve here, so the feed doesn't ask him to.
    expect(holderFeed.pendingJoinRequests).toEqual([]);
    expect(requesterFeed.pendingJoinRequests).toEqual([]);
  });
});
