import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle, member, placementRevertNotice, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import { createCycle } from "@/lib/cycles";
import { getPersonalFeed } from "@/lib/dashboard";
import {
  acceptPlacementInvite,
  acknowledgeRevertNotice,
  approvePendingPlacement,
  createPlacement,
  createPlot,
  createZone,
  declinePlacementInvite,
  getPlotForCycle,
  invitePlacementMember,
  listMyRevertNotices,
  listPendingPlacementReviews,
  listPlacementMembers,
  listPlacements,
  proposePlacementMove,
  removePlacementMember,
  revertPendingPlacement,
  updatePlacement,
} from "@/lib/spatial-planning";
import type { RectangleGeometry } from "@/lib/spatial-planning/geometry";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function insertSpatialPlanningTask(communityId: string, branchId: string, createdBy: string, title = "Lay out the Plot") {
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

async function insertCycle(communityId: string, name: string, startedAt: Date) {
  const [row] = await db
    .insert(cycle)
    .values({ communityId, name, status: "active", startedAt })
    .returning();
  return row;
}

const rectangleGeometry: RectangleGeometry = { x: 50, y: 50, width: 10, height: 4, rotation: 0 };
const movedGeometry: RectangleGeometry = { x: 60, y: 60, width: 10, height: 4, rotation: 0 };
const movedAgainGeometry: RectangleGeometry = { x: 70, y: 70, width: 10, height: 4, rotation: 0 };

async function setUpModule() {
  const fixtures = await createFixtures();
  const { alice, branch: testBranch, community: testCommunity } = fixtures;
  await updateCommunity(alice, { cyclesEnabled: true, modulesEnabled: ["spatial_planning"] });
  const holderTask = await insertSpatialPlanningTask(testCommunity.id, testBranch.id, alice.id);
  await claimTask(alice, holderTask.id);
  await updateCommunity(alice, { spatialPlanningTaskId: holderTask.id });
  const testCycle = await insertCycle(testCommunity.id, "Cycle A", new Date("2026-01-01"));
  const plotRow = await createPlot(alice, testCycle.id, {
    name: "Main site",
    scaleCalibration: { pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 }, realWorldDistanceMeters: 5 },
  });
  return { ...fixtures, holderTask, cycle: testCycle, plot: plotRow };
}

describe("proposePlacementMove", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets the Spatial-planning holder move directly, staying confirmed", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Tent",
      category: "tent",
    });
    const moved = await proposePlacementMove(alice, created.id, { geometry: movedGeometry });
    expect(moved.status).toBe("confirmed");
    expect(moved.geometry).toEqual(movedGeometry);
    expect(moved.pendingByMemberId).toBeNull();
  });

  it("lets a confirmed linked Member move it, landing pending", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Bob's tent",
      category: "tent",
    });
    await invitePlacementMember(alice, created.id, bob.id);
    await acceptPlacementInvite(bob, created.id);

    const moved = await proposePlacementMove(bob, created.id, { geometry: movedGeometry });
    expect(moved.status).toBe("pending");
    expect(moved.pendingByMemberId).toBe(bob.id);
    expect(moved.pendingPrevGeometry).toEqual(rectangleGeometry);
    expect(moved.geometry).toEqual(movedGeometry);
  });

  it("lets whoever holds the linked Task move it, landing pending", async () => {
    const { alice, bob, plot: plotRow, community: testCommunity, branch: testBranch } = await setUpModule();
    const structureTask = await insertSpatialPlanningTask(testCommunity.id, testBranch.id, alice.id, "Build the kitchen");
    await claimTask(bob, structureTask.id);
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Kitchen structure",
      category: "structure",
      linkedTaskId: structureTask.id,
    });

    const moved = await proposePlacementMove(bob, created.id, { geometry: movedGeometry });
    expect(moved.status).toBe("pending");
    expect(moved.pendingByMemberId).toBe(bob.id);
  });

  it("rejects a member with neither a Member nor a Task link", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Unowned structure",
      category: "structure",
    });
    await expect(proposePlacementMove(bob, created.id, { geometry: movedGeometry })).rejects.toThrow(ForbiddenError);
  });

  it("keeps pendingPrevGeometry pointing at the last confirmed state across repeated self-service moves", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Bob's tent",
      category: "tent",
      memberIds: [bob.id],
    });
    // memberIds at creation now links non-self names as `invited` — bob
    // must accept before he can self-service move it.
    await acceptPlacementInvite(bob, created.id);

    const first = await proposePlacementMove(bob, created.id, { geometry: movedGeometry });
    expect(first.pendingPrevGeometry).toEqual(rectangleGeometry);

    const second = await proposePlacementMove(bob, created.id, { geometry: movedAgainGeometry });
    expect(second.pendingPrevGeometry).toEqual(rectangleGeometry); // unchanged, not movedGeometry
    expect(second.geometry).toEqual(movedAgainGeometry);
    expect(second.pendingByMemberId).toBe(bob.id);
  });

  it("rejects invalid geometry for the placement's own shape type", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "circle",
      geometry: { x: 10, y: 10, radius: 3 },
      label: "Tank",
      category: "structure",
    });
    await expect(proposePlacementMove(alice, created.id, { geometry: rectangleGeometry })).rejects.toThrow();
  });
});

describe("approvePendingPlacement / revertPendingPlacement", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpPendingPlacement() {
    const ctx = await setUpModule();
    const created = await createPlacement(ctx.alice, ctx.plot.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Bob's tent",
      category: "tent",
      memberIds: [ctx.bob.id],
    });
    await acceptPlacementInvite(ctx.bob, created.id);
    const pending = await proposePlacementMove(ctx.bob, created.id, { geometry: movedGeometry });
    return { ...ctx, placementRow: pending };
  }

  it("rejects a non-holder approving or reverting", async () => {
    const { bob, placementRow } = await setUpPendingPlacement();
    await expect(approvePendingPlacement(bob, placementRow.id)).rejects.toThrow(ForbiddenError);
    await expect(revertPendingPlacement(bob, placementRow.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects approving/reverting a Placement with nothing pending", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Tent",
      category: "tent",
    });
    await expect(approvePendingPlacement(alice, created.id)).rejects.toThrow(ConflictError);
    await expect(revertPendingPlacement(alice, created.id)).rejects.toThrow(ConflictError);
  });

  it("approve locks in the new geometry as confirmed", async () => {
    const { alice, placementRow } = await setUpPendingPlacement();
    const approved = await approvePendingPlacement(alice, placementRow.id);
    expect(approved.status).toBe("confirmed");
    expect(approved.geometry).toEqual(movedGeometry);
    expect(approved.pendingByMemberId).toBeNull();
    expect(approved.pendingPrevGeometry).toBeNull();
  });

  it("revert restores the prior geometry and creates a notice for the mover", async () => {
    const { alice, bob, placementRow } = await setUpPendingPlacement();
    const reverted = await revertPendingPlacement(alice, placementRow.id, "wrong spot, too close to the fire pit");
    expect(reverted.status).toBe("confirmed");
    expect(reverted.geometry).toEqual(rectangleGeometry);
    expect(reverted.pendingByMemberId).toBeNull();

    const notices = await listMyRevertNotices(bob);
    expect(notices).toHaveLength(1);
    expect(notices[0].notice.note).toBe("wrong spot, too close to the fire pit");
    expect(notices[0].notice.revertedBy).toBe(alice.id);
    expect(notices[0].notice.acknowledgedAt).toBeNull();
  });

  it("revert works with no note given", async () => {
    const { alice, bob, placementRow } = await setUpPendingPlacement();
    await revertPendingPlacement(alice, placementRow.id);
    const notices = await listMyRevertNotices(bob);
    expect(notices[0].notice.note).toBeNull();
  });
});

describe("acknowledgeRevertNotice", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("marks a notice acknowledged, and only the recipient can do it", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Bob's tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await acceptPlacementInvite(bob, created.id);
    await proposePlacementMove(bob, created.id, { geometry: movedGeometry });
    await revertPendingPlacement(alice, created.id, "note");
    const [notice] = await db.select().from(placementRevertNotice).where(eq(placementRevertNotice.recipientMemberId, bob.id));

    await expect(acknowledgeRevertNotice(alice, notice.id)).rejects.toThrow(NotFoundError);
    await acknowledgeRevertNotice(bob, notice.id);
    expect(await listMyRevertNotices(bob)).toHaveLength(0);
  });
});

describe("Shared placements: invite -> accept/decline", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("naming someone other than yourself in memberIds links them as invited, not confirmed", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    const links = await listPlacementMembers(alice, created.id);
    expect(links).toHaveLength(1);
    expect(links[0].status).toBe("invited");

    // Not yet a confirmed editor — can't self-service move.
    await expect(proposePlacementMove(bob, created.id, { geometry: movedGeometry })).rejects.toThrow(ForbiddenError);
  });

  it("naming yourself links you as confirmed immediately", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Alice's tent",
      category: "tent",
      memberIds: [alice.id],
    });
    const links = await listPlacementMembers(alice, created.id);
    expect(links[0].status).toBe("confirmed");
  });

  it("accepting promotes to confirmed and grants self-service edit rights", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    const accepted = await acceptPlacementInvite(bob, created.id);
    expect(accepted.status).toBe("confirmed");
    const moved = await proposePlacementMove(bob, created.id, { geometry: movedGeometry });
    expect(moved.status).toBe("pending");
  });

  it("declining drops the row entirely, no explanation required", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await declinePlacementInvite(bob, created.id);
    expect(await listPlacementMembers(alice, created.id)).toHaveLength(0);
  });

  it("rejects accepting/declining an invite that isn't yours", async () => {
    const { alice, bob, community: testCommunity, plot: plotRow } = await setUpModule();
    const [carol] = await db.insert(member).values({ communityId: testCommunity.id, name: "Carol" }).returning();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await expect(acceptPlacementInvite(carol, created.id)).rejects.toThrow(NotFoundError);
  });

  it("lets a confirmed editor invite someone new via invitePlacementMember", async () => {
    const { alice, bob, community: testCommunity, plot: plotRow } = await setUpModule();
    const [carol] = await db.insert(member).values({ communityId: testCommunity.id, name: "Carol" }).returning();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await acceptPlacementInvite(bob, created.id);
    await invitePlacementMember(bob, created.id, carol.id);
    const links = await listPlacementMembers(alice, created.id);
    expect(links.find((l) => l.memberId === carol.id)?.status).toBe("invited");
  });

  it("rejects a random member inviting or removing", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Tent",
      category: "tent",
    });
    await expect(invitePlacementMember(bob, created.id, bob.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects inviting someone already linked", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await expect(invitePlacementMember(alice, created.id, bob.id)).rejects.toThrow(ConflictError);
  });

  it("a Member can always remove themselves, even without broader edit rights", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    // bob is only `invited`, not even a confirmed editor yet, but can
    // still remove himself (equivalent to declining).
    await removePlacementMember(bob, created.id, bob.id);
    expect(await listPlacementMembers(alice, created.id)).toHaveLength(0);
  });
});

describe("syncPlacementMembers diffing via updatePlacement", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("preserves an already-confirmed member's status across a later memberIds update", async () => {
    const { alice, bob, community: testCommunity, plot: plotRow } = await setUpModule();
    const [carol] = await db.insert(member).values({ communityId: testCommunity.id, name: "Carol" }).returning();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await acceptPlacementInvite(bob, created.id);

    // Holder updates the set to include bob (still there) plus carol
    // (new) — bob's hard-won `confirmed` status must survive this.
    await updatePlacement(alice, created.id, { memberIds: [bob.id, carol.id] });
    const links = await listPlacementMembers(alice, created.id);
    expect(links.find((l) => l.memberId === bob.id)?.status).toBe("confirmed");
    expect(links.find((l) => l.memberId === carol.id)?.status).toBe("invited");
  });

  it("removes a member dropped from the memberIds set", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await updatePlacement(alice, created.id, { memberIds: [] });
    expect(await listPlacementMembers(alice, created.id)).toHaveLength(0);
  });
});

describe("Dashboard: Spatial planning feed items", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("surfaces an invited member's pending invite", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    const feed = await getPersonalFeed(bob);
    expect(feed.placementInvites).toHaveLength(1);
    expect(feed.placementInvites[0].placementId).toBe(created.id);
  });

  it("surfaces a pending Placement to its confirmed Member and to whoever holds its linked Task", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Bob's tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await acceptPlacementInvite(bob, created.id);
    await proposePlacementMove(bob, created.id, { geometry: movedGeometry });

    const bobFeed = await getPersonalFeed(bob);
    expect(bobFeed.myLinkedPendingPlacements.map((p) => p.id)).toContain(created.id);
  });

  it("surfaces the holder-only pending-review queue, empty for a non-holder", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Bob's tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await acceptPlacementInvite(bob, created.id);
    await proposePlacementMove(bob, created.id, { geometry: movedGeometry });

    const aliceFeed = await getPersonalFeed(alice);
    expect(aliceFeed.placementPendingReviews).toHaveLength(1);
    const bobFeed = await getPersonalFeed(bob);
    expect(bobFeed.placementPendingReviews).toHaveLength(0);

    const reviews = await listPendingPlacementReviews(alice);
    expect(reviews[0].placement.id).toBe(created.id);
    await expect(listPendingPlacementReviews(bob)).rejects.toThrow(ForbiddenError);
  });

  it("surfaces an unacknowledged revert notice", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Bob's tent",
      category: "tent",
      memberIds: [bob.id],
    });
    await acceptPlacementInvite(bob, created.id);
    await proposePlacementMove(bob, created.id, { geometry: movedGeometry });
    await revertPendingPlacement(alice, created.id, "too close to the fire");

    const feed = await getPersonalFeed(bob);
    expect(feed.placementRevertNotices).toHaveLength(1);
    expect(feed.placementRevertNotices[0].notice.note).toBe("too close to the fire");
  });

  it("is empty when the module is off", async () => {
    const fixtures = await createFixtures();
    const feed = await getPersonalFeed(fixtures.alice);
    expect(feed.placementInvites).toEqual([]);
    expect(feed.myLinkedPendingPlacements).toEqual([]);
    expect(feed.placementRevertNotices).toEqual([]);
    expect(feed.placementPendingReviews).toEqual([]);
  });
});

describe("Cycle creation: full-Cycle clone with 'also clone spatial planning?'", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("remaps a cloned Placement's linkedTaskId onto the newly-cloned Task, remaps zoneId, and drops Member links", async () => {
    const { alice, bob, plot: plotRow, cycle: sourceCycle, branch: testBranch, community: testCommunity } =
      await setUpModule();
    // The linked Task must actually belong to the Cycle being cloned —
    // cloneTasks only clones tasks scoped to that Cycle (task.cycleId),
    // unlike the standing Spatial-planning holder task itself, which
    // deliberately carries no cycleId at all.
    const [structureTask] = await db
      .insert(task)
      .values({
        communityId: testCommunity.id,
        branchId: testBranch.id,
        cycleId: sourceCycle.id,
        title: "Build the kitchen",
        effort: "owns_a_thing",
        effortMagnitude: { hours_per_week: 2 },
        createdBy: alice.id,
      })
      .returning();

    const sourceZone = await createZone(alice, plotRow.id, {
      name: "Kitchen zone",
      category: "kitchen",
      polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      color: "#ff8800",
    });
    await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Kitchen structure",
      category: "structure",
      zoneId: sourceZone.id,
      linkedTaskId: structureTask.id,
      memberIds: [bob.id],
    });

    const newCycle = await createCycle(alice, {
      source: "clone_previous",
      name: "Next season",
      cloneSpatialPlan: true,
    });

    const newPlot = await getPlotForCycle(alice, newCycle.id);
    expect(newPlot).not.toBeNull();
    const newPlacements = await listPlacements(alice, newPlot!.id);
    expect(newPlacements).toHaveLength(1);
    const cloned = newPlacements[0];
    expect(cloned.label).toBe("Kitchen structure");
    expect(cloned.linkedTaskId).not.toBeNull();
    expect(cloned.linkedTaskId).not.toBe(structureTask.id); // remapped to the newly-cloned task
    expect(cloned.zoneId).not.toBeNull();

    const [clonedTaskRow] = await db.select().from(task).where(eq(task.id, cloned.linkedTaskId!));
    expect(clonedTaskRow.clonedFromTaskId).toBe(structureTask.id);

    const links = await listPlacementMembers(alice, cloned.id);
    expect(links).toHaveLength(0); // Member links never carry over, even on this path
  });

  it("rejects cloneSpatialPlan from a cycle-initiator who isn't the Spatial-planning holder, and rolls back the whole clone", async () => {
    const { bob, community: testCommunity } = await setUpModule();
    // bob can initiate cycles (no tier restriction by default) but
    // doesn't hold the Spatial-planning task.
    const cyclesBefore = (await db.select().from(cycle).where(eq(cycle.communityId, testCommunity.id))).length;
    await expect(
      createCycle(bob, { source: "clone_previous", name: "Next season", cloneSpatialPlan: true }),
    ).rejects.toThrow(ForbiddenError);
    const cyclesAfter = (await db.select().from(cycle).where(eq(cycle.communityId, testCommunity.id))).length;
    expect(cyclesAfter).toBe(cyclesBefore); // the whole transaction rolled back, no new Cycle either
  });

  it("silently skips when the source Cycle has no Plot, still creating the Cycle", async () => {
    const fixtures = await createFixtures();
    const { alice, branch: testBranch, community: testCommunity } = fixtures;
    await updateCommunity(alice, { cyclesEnabled: true, modulesEnabled: ["spatial_planning"] });
    const holderTask = await insertSpatialPlanningTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(alice, holderTask.id);
    await updateCommunity(alice, { spatialPlanningTaskId: holderTask.id });
    await insertCycle(testCommunity.id, "Cycle with no Plot", new Date("2026-01-01"));

    const newCycle = await createCycle(alice, {
      source: "clone_previous",
      name: "Next season",
      cloneSpatialPlan: true,
    });
    expect(newCycle.id).toBeTruthy();
    expect(await getPlotForCycle(alice, newCycle.id)).toBeNull();
  });

  it("cloneSpatialPlan defaults to false when omitted", async () => {
    const { alice } = await setUpModule();
    const newCycle = await createCycle(alice, { source: "clone_previous", name: "Next season" });
    expect(await getPlotForCycle(alice, newCycle.id)).toBeNull();
  });
});
