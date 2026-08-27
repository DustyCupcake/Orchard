import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, task, taskAssignment } from "@/db/schema";
import {
  acceptJoinRequest,
  claimOrRequestToJoin,
  claimTask,
  createRequirement,
  declineJoinRequest,
  listJoinRequests,
  listMyPendingJoinRequests,
  withdrawJoinRequest,
} from "@/lib/tasks";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

type ClaimResult = Awaited<ReturnType<typeof claimOrRequestToJoin>>;
function asRequested(result: ClaimResult) {
  if (result.status !== "requested") {
    throw new Error("expected a pending request, got an instant claim");
  }
  return result.request;
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
      title: "Build the deck",
      effort: "one_off",
      effortMagnitude: { duration: "multi_day" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("claimOrRequestToJoin", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("claims instantly when the task has no current holder, regardless of openness", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { openness: "request" });

    const result = await claimOrRequestToJoin(alice, t.id);
    expect(result.status).toBe("claimed");
  });

  it("claims instantly on an open task even once it already has a holder", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "open",
      capacity: 2,
    });
    await claimTask(alice, t.id);

    const result = await claimOrRequestToJoin(bob, t.id);
    expect(result.status).toBe("claimed");
  });

  it("creates a pending request instead of claiming on an already-held request task", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);

    const result = await claimOrRequestToJoin(bob, t.id);
    const request = asRequested(result);
    expect(request.status).toBe("pending");
    expect(request.memberId).toBe(bob.id);

    const [bobAssignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(bobAssignment).toBeUndefined();
  });

  it("creates a pending request on an already-held coordination_approved task", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "coordination_approved",
      capacity: 2,
    });
    await claimTask(alice, t.id);

    const result = await claimOrRequestToJoin(bob, t.id);
    expect(result.status).toBe("requested");
  });

  it("rejects a duplicate pending request from the same member", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);
    await claimOrRequestToJoin(bob, t.id);

    await expect(claimOrRequestToJoin(bob, t.id)).rejects.toThrow(ConflictError);
  });

  it("rejects requesting to join a task the requester already holds", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);

    await expect(claimOrRequestToJoin(alice, t.id)).rejects.toThrow(ConflictError);
  });

  it("still enforces Requirement gating on the request path", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);
    await createRequirement(alice, t.id, { type: "custom", value: { flag: "trusted" } });

    await expect(claimOrRequestToJoin(bob, t.id)).rejects.toThrow(ForbiddenError);
  });

  it("files a request even when the task is already at capacity — filing doesn't need room", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 1,
    });
    await claimTask(alice, t.id);

    const result = await claimOrRequestToJoin(bob, t.id);
    expect(result.status).toBe("requested");

    const requests = await listJoinRequests(alice, t.id);
    expect(requests).toHaveLength(1);
  });
});

describe("accept/decline/withdraw join requests", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a current holder accept a pending request, claiming it for the requester", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);
    const request = asRequested(await claimOrRequestToJoin(bob, t.id));

    const updated = await acceptJoinRequest(alice, t.id, request.id);
    expect(updated.status).toBe("claimed");

    const [assignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(assignment).toBeDefined();

    const requests = await listJoinRequests(alice, t.id);
    expect(requests[0].status).toBe("accepted");
    expect(requests[0].resolvedBy).toBe(alice.id);
  });

  it("lets a current holder decline a pending request with a reason", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);
    const request = asRequested(await claimOrRequestToJoin(bob, t.id));

    const declined = await declineJoinRequest(alice, t.id, request.id, {
      reason: "prefer to work solo",
    });
    expect(declined.status).toBe("declined");
    expect(declined.declineReason).toBe("prefer to work solo");

    const [assignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.memberId, bob.id));
    expect(assignment).toBeUndefined();
  });

  it("rejects accept/decline from someone who doesn't hold the task", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: community.id, name: "Carol" })
      .returning();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);
    const request = asRequested(await claimOrRequestToJoin(bob, t.id));

    await expect(acceptJoinRequest(carol, t.id, request.id)).rejects.toThrow(ForbiddenError);
    await expect(declineJoinRequest(carol, t.id, request.id)).rejects.toThrow(ForbiddenError);
  });

  it("on coordination_approved, only the coordination-slot holder can approve when one exists", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: community.id, name: "Carol" })
      .returning();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "coordination_approved",
      capacity: 3,
    });
    await claimTask(alice, t.id);
    await db
      .update(taskAssignment)
      .set({ isCoordinationSlot: true })
      .where(and(eq(taskAssignment.taskId, t.id), eq(taskAssignment.memberId, alice.id)));
    await claimTask(bob, t.id); // holds the task too, but isn't the coordination slot

    const request = asRequested(await claimOrRequestToJoin(carol, t.id));

    await expect(acceptJoinRequest(bob, t.id, request.id)).rejects.toThrow(ForbiddenError);
    const accepted = await acceptJoinRequest(alice, t.id, request.id);
    expect(accepted.status).toBe("claimed");
  });

  it("on coordination_approved with no coordination slot filled, any holder can approve", async () => {
    const { community, branch, alice } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: community.id, name: "Carol" })
      .returning();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "coordination_approved",
      capacity: 3,
    });
    await claimTask(alice, t.id);

    const request = asRequested(await claimOrRequestToJoin(carol, t.id));

    const accepted = await acceptJoinRequest(alice, t.id, request.id);
    expect(accepted.status).toBe("claimed");
  });

  it("rejects resolving a request that's already been resolved", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);
    const request = asRequested(await claimOrRequestToJoin(bob, t.id));
    await declineJoinRequest(alice, t.id, request.id);

    await expect(acceptJoinRequest(alice, t.id, request.id)).rejects.toThrow(ConflictError);
  });

  it("lets the requester withdraw their own pending request, but not someone else's", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const [carol] = await db
      .insert(member)
      .values({ communityId: community.id, name: "Carol" })
      .returning();
    const t = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 2,
    });
    await claimTask(alice, t.id);
    const request = asRequested(await claimOrRequestToJoin(bob, t.id));

    await expect(withdrawJoinRequest(carol, t.id, request.id)).rejects.toThrow(ForbiddenError);

    await withdrawJoinRequest(bob, t.id, request.id);
    const requests = await listJoinRequests(alice, t.id);
    expect(requests).toHaveLength(0);

    // withdrawing frees them up to request again
    const second = await claimOrRequestToJoin(bob, t.id);
    expect(second.status).toBe("requested");
  });

  it("rejects accepting a request that no longer exists", async () => {
    const { community, branch, alice } = await createFixtures();
    const t = await insertTask(community.id, branch.id, alice.id, { openness: "request" });
    await claimTask(alice, t.id);

    await expect(
      acceptJoinRequest(alice, t.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("listMyPendingJoinRequests", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns a map of taskId -> requestId for the actor's own pending requests", async () => {
    const { community, branch, alice, bob } = await createFixtures();
    const t1 = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 1,
    });
    const t2 = await insertTask(community.id, branch.id, alice.id, {
      openness: "request",
      capacity: 1,
      title: "Second task",
    });
    await claimTask(alice, t1.id);
    await claimTask(alice, t2.id);

    const r1 = asRequested(await claimOrRequestToJoin(bob, t1.id));
    const r2 = asRequested(await claimOrRequestToJoin(bob, t2.id));

    const pending = await listMyPendingJoinRequests(bob);
    expect(pending.get(t1.id)).toBe(r1.id);
    expect(pending.get(t2.id)).toBe(r2.id);
  });
});
