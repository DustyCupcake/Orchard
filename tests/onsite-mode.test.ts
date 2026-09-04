import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cycle, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { createRequirement } from "@/lib/tasks/requirements";
import {
  createBranch,
  deleteBranch,
  updateBranch,
  createTier,
  deleteTier,
  updateTier,
  createCycleType,
  deleteCycleType,
  updateCycleType,
  updateCommunity,
} from "@/lib/settings";
import { createCycle } from "@/lib/cycles";
import { createEventProposal, confirmEventProposalSlot, publishEventSchedule } from "@/lib/event-scheduling";
import { createPlot, createZone, updateZone, deleteZone, createPlacement, updatePlacement } from "@/lib/spatial-planning";
import { requireNotOnsiteLocked, requireNotOnsiteLockedForCommunity } from "@/lib/onsite-mode";
import { AppError, ConflictError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

async function insertTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "A task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
    })
    .returning();
  return row;
}

function iso(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}
function slot(startHour: number, endHour: number) {
  return { startsAt: iso(startHour), endsAt: iso(endHour) };
}

describe("requireNotOnsiteLocked / requireNotOnsiteLockedForCommunity", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is a no-op when off, throws ConflictError when on", () => {
    expect(() => requireNotOnsiteLocked({ onsiteModeEnabled: false })).not.toThrow();
    expect(() => requireNotOnsiteLocked({ onsiteModeEnabled: true })).toThrow(ConflictError);
  });

  it("resolves the community row itself when no row is already in hand", async () => {
    const { alice } = await createFixtures();
    await expect(requireNotOnsiteLockedForCommunity(alice.communityId)).resolves.toBeUndefined();
    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(requireNotOnsiteLockedForCommunity(alice.communityId)).rejects.toThrow(ConflictError);
  });
});

describe("the on-site toggle itself", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects turning it on without Phases enabled", async () => {
    const { alice } = await createFixtures();
    await expect(updateCommunity(alice, { onsiteModeEnabled: true })).rejects.toThrow(AppError);
  });

  it("turns on once Phases is enabled, in the same or an earlier call", async () => {
    const { alice } = await createFixtures();
    const updated = await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    expect(updated.onsiteModeEnabled).toBe(true);
  });

  it("locks every other settings change on this same function once on", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(updateCommunity(alice, { name: "New name" })).rejects.toThrow(ConflictError);
  });

  it("the off-toggle always works, even bundled with another field change", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    const updated = await updateCommunity(alice, { onsiteModeEnabled: false, name: "Renamed while unlocking" });
    expect(updated.onsiteModeEnabled).toBe(false);
    expect(updated.name).toBe("Renamed while unlocking");
  });

  it("restores normal editing immediately once turned back off", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await updateCommunity(alice, { onsiteModeEnabled: false });
    const updated = await updateCommunity(alice, { name: "Back to normal" });
    expect(updated.name).toBe("Back to normal");
  });
});

describe("shift-lock: branches, tiers, cycle types, Requirements, starting a Cycle", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function lockedFixtures() {
    const fixtures = await createFixtures();
    await updateCommunity(fixtures.alice, { phasesEnabled: true, onsiteModeEnabled: true });
    return fixtures;
  }

  it("locks branch CRUD while on, and works once off", async () => {
    const { alice, branch } = await lockedFixtures();
    await expect(createBranch(alice, { name: "New branch" })).rejects.toThrow(ConflictError);
    await expect(updateBranch(alice, branch.id, { name: "Renamed" })).rejects.toThrow(ConflictError);
    await expect(deleteBranch(alice, branch.id)).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const created = await createBranch(alice, { name: "New branch" });
    expect(created.name).toBe("New branch");
  });

  it("locks tier CRUD while on, and works once off", async () => {
    const { alice } = await lockedFixtures();
    await expect(createTier(alice, { name: "Experienced" })).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const tier = await createTier(alice, { name: "Experienced" });
    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(updateTier(alice, tier.id, { name: "Renamed" })).rejects.toThrow(ConflictError);
    await expect(deleteTier(alice, tier.id)).rejects.toThrow(ConflictError);
  });

  it("locks cycle-type CRUD while on, and works once off", async () => {
    const { alice } = await lockedFixtures();
    await expect(createCycleType(alice, { name: "Season" })).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const cycleType = await createCycleType(alice, { name: "Season" });
    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(updateCycleType(alice, cycleType.id, { name: "Renamed" })).rejects.toThrow(ConflictError);
    await expect(deleteCycleType(alice, cycleType.id)).rejects.toThrow(ConflictError);
  });

  it("locks Requirement CRUD while on, and works once off", async () => {
    const { alice, branch } = await lockedFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);
    await expect(
      createRequirement(alice, t.id, { type: "language", value: { language: "spanish" } }),
    ).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const req = await createRequirement(alice, t.id, { type: "language", value: { language: "spanish" } });
    expect(req.type).toBe("language");
  });

  it("locks starting a new Cycle while on, and works once off", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { cyclesEnabled: true, phasesEnabled: true, onsiteModeEnabled: true });
    await expect(createCycle(alice, { name: "New season", source: "blank", phases: [] })).rejects.toThrow(
      ConflictError,
    );

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const created = await createCycle(alice, { name: "New season", source: "blank", phases: [] });
    expect(created.name).toBe("New season");
  });
});

describe("read-only-reference: publishing the Event schedule", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("locks publishing while on, and works once off", async () => {
    const { alice, bob, branch, community: testCommunity } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["event_scheduling"] });
    const ownerTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, ownerTask.id);
    await grantPermission(testCommunity.id, "event_scheduling_owner", ownerTask.id);

    const proposal = await createEventProposal(bob, {
      host: "Bob",
      title: "Session",
      durationMinutes: 60,
      preferredSlots: [slot(24, 25)],
    });
    await confirmEventProposalSlot(alice, proposal.id, slot(24, 25));

    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(publishEventSchedule(alice)).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const result = await publishEventSchedule(alice);
    expect(result.publishedCount).toBe(1);
  });
});

describe("read-only-reference: Spatial-planning Zone/Placement edits", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpPlot() {
    const fixtures = await createFixtures();
    const { alice, branch, community: testCommunity } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["spatial_planning"] });
    const holderTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await claimTask(alice, holderTask.id);
    await grantPermission(testCommunity.id, "spatial_planning", holderTask.id);
    const [testCycle] = await db
      .insert(cycle)
      .values({ communityId: testCommunity.id, name: "Cycle A", status: "active", startedAt: new Date() })
      .returning();
    const plot = await createPlot(alice, testCycle.id, {
      name: "Main site",
      scaleCalibration: { pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 }, realWorldDistanceMeters: 5 },
    });
    return { ...fixtures, plot };
  }

  it("locks Zone edits while on, and works once off", async () => {
    const { alice, plot } = await setUpPlot();
    const squarePolygon = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];

    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(
      createZone(alice, plot.id, { name: "Kitchen", category: "kitchen", polygon: squarePolygon, color: "#f00" }),
    ).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const zone = await createZone(alice, plot.id, {
      name: "Kitchen",
      category: "kitchen",
      polygon: squarePolygon,
      color: "#f00",
    });

    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(updateZone(alice, zone.id, { name: "Renamed" })).rejects.toThrow(ConflictError);
    await expect(deleteZone(alice, zone.id)).rejects.toThrow(ConflictError);
  });

  it("locks Placement create/update while on, and works once off", async () => {
    const { alice, plot } = await setUpPlot();
    const rectangleGeometry = { x: 50, y: 50, width: 10, height: 4, rotation: 0 };

    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(
      createPlacement(alice, plot.id, {
        shapeType: "rectangle",
        geometry: rectangleGeometry,
        label: "Alice's tent",
        category: "tent",
      }),
    ).rejects.toThrow(ConflictError);

    await updateCommunity(alice, { onsiteModeEnabled: false });
    const created = await createPlacement(alice, plot.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Alice's tent",
      category: "tent",
    });

    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    await expect(
      updatePlacement(alice, created.id, { label: "Renamed" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("everything an event actually runs on stays fully live", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("task claiming keeps working while on-site mode is on", async () => {
    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { phasesEnabled: true, onsiteModeEnabled: true });
    const t = await insertTask(alice.communityId, branch.id, alice.id);
    const claimed = await claimTask(alice, t.id);
    expect(claimed.status).toBe("claimed");
  });
});
