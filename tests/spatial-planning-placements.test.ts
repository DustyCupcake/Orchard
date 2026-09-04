import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cycle, member, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  clonePlotFromCycle,
  createPlacement,
  createPlacementTemplate,
  createPlot,
  createZone,
  deletePlacement,
  deletePlacementTemplate,
  getMySpacePreference,
  getPlacement,
  listPlacementMembers,
  listPlacementTemplates,
  listPlacements,
  listSpacePreferences,
  placementAreaSqm,
  placementFootprint,
  placementToGeoJSONFeature,
  rectangleCorners,
  savePlacementAsTemplate,
  updatePlacement,
  upsertMySpacePreference,
  type ScaleCalibration,
} from "@/lib/spatial-planning";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

async function insertSpatialPlanningTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Lay out the Plot",
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

async function setUpModule() {
  const fixtures = await createFixtures();
  const { alice, branch: testBranch, community: testCommunity } = fixtures;
  await updateCommunity(alice, { modulesEnabled: ["spatial_planning"] });
  const holderTask = await insertSpatialPlanningTask(testCommunity.id, testBranch.id, alice.id);
  await claimTask(alice, holderTask.id);
  await grantPermission(testCommunity.id, "spatial_planning", holderTask.id);
  const testCycle = await insertCycle(testCommunity.id, "Cycle A", new Date("2026-01-01"));
  const plotRow = await createPlot(alice, testCycle.id, {
    name: "Main site",
    scaleCalibration: { pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 }, realWorldDistanceMeters: 5 },
  });
  return { ...fixtures, holderTask, cycle: testCycle, plot: plotRow };
}

const rectangleGeometry = { x: 50, y: 50, width: 10, height: 4, rotation: 0 };

describe("Placement", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a non-holder creating a Placement", async () => {
    const { bob, plot: plotRow } = await setUpModule();
    await expect(
      createPlacement(bob, plotRow.id, {
        shapeType: "rectangle",
        geometry: rectangleGeometry,
        label: "Alice's tent",
        category: "tent",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets the holder create a rectangle Placement", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Alice's tent",
      category: "tent",
    });
    expect(created.shapeType).toBe("rectangle");
    expect(created.category).toBe("tent");
    expect(created.status).toBe("confirmed");
  });

  it("rejects an invalid geometry for the given shape type", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    await expect(
      createPlacement(alice, plotRow.id, {
        shapeType: "circle",
        geometry: rectangleGeometry, // missing `radius`
        label: "Bad circle",
        category: "generic",
      }),
    ).rejects.toThrow();
  });

  it("requires at least 3 points for a polygon Placement, 2 for a line", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    await expect(
      createPlacement(alice, plotRow.id, {
        shapeType: "polygon",
        geometry: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        label: "Bad polygon",
        category: "structure",
      }),
    ).rejects.toThrow();
    await expect(
      createPlacement(alice, plotRow.id, {
        shapeType: "line",
        geometry: { points: [{ x: 0, y: 0 }] },
        label: "Bad line",
        category: "generic",
      }),
    ).rejects.toThrow();
  });

  it("validates zoneId belongs to the same Plot", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    await expect(
      createPlacement(alice, plotRow.id, {
        shapeType: "rectangle",
        geometry: rectangleGeometry,
        label: "Tent",
        category: "tent",
        zoneId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("validates linkedTaskId belongs to the community", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    await expect(
      createPlacement(alice, plotRow.id, {
        shapeType: "rectangle",
        geometry: rectangleGeometry,
        label: "Kitchen structure",
        category: "structure",
        linkedTaskId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  // As of Phase 38 ("Shared placements: invite → accept/decline"),
  // naming someone other than yourself links them as `invited`, not
  // `confirmed` — see tests/spatial-planning-collaboration.test.ts for
  // the full invite/accept/decline/diffing coverage this only touches
  // in passing.
  it("links named Members at creation, syncing (not wholesale replacing) on update", async () => {
    const { alice, bob, plot: plotRow, community: testCommunity } = await setUpModule();
    const [carol] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Carol" })
      .returning();

    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Shared tent",
      category: "tent",
      memberIds: [bob.id],
    });
    let links = await listPlacementMembers(alice, created.id);
    expect(links.map((l) => l.memberId)).toEqual([bob.id]);
    expect(links[0].status).toBe("invited");

    await updatePlacement(alice, created.id, { memberIds: [bob.id, carol.id] });
    links = await listPlacementMembers(alice, created.id);
    expect(new Set(links.map((l) => l.memberId))).toEqual(new Set([bob.id, carol.id]));

    await updatePlacement(alice, created.id, { memberIds: [] });
    links = await listPlacementMembers(alice, created.id);
    expect(links).toHaveLength(0);
  });

  it("any member can list and read Placements", async () => {
    const { alice, bob, plot: plotRow } = await setUpModule();
    await createPlacement(alice, plotRow.id, {
      shapeType: "circle",
      geometry: { x: 20, y: 20, radius: 3 },
      label: "Water tank",
      category: "structure",
    });
    const list = await listPlacements(bob, plotRow.id);
    expect(list).toHaveLength(1);
    await expect(getPlacement(bob, list[0].id)).resolves.toBeTruthy();
  });

  it("holder can update and delete a Placement", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    const created = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Tent",
      category: "tent",
    });
    const updated = await updatePlacement(alice, created.id, { label: "Bigger tent" });
    expect(updated.label).toBe("Bigger tent");
    await deletePlacement(alice, created.id);
    await expect(getPlacement(alice, created.id)).rejects.toThrow(NotFoundError);
  });
});

describe("PlacementTemplate", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("holder can create a template and any member can list it", async () => {
    const { alice, bob, community: testCommunity } = await setUpModule();
    await createPlacementTemplate(alice, {
      name: "Standard 2-person tent",
      shapeType: "rectangle",
      geometry: { x: 0, y: 0, width: 2, height: 2, rotation: 0 },
      category: "tent",
    });
    const templates = await listPlacementTemplates(bob);
    expect(templates).toHaveLength(1);
    expect(templates[0].communityId).toBe(testCommunity.id);
  });

  it("saves a Placement into the template library, decoupled from the original", async () => {
    const { alice, plot: plotRow } = await setUpModule();
    const placementRow = await createPlacement(alice, plotRow.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Alice's tent",
      category: "tent",
    });
    const saved = await savePlacementAsTemplate(alice, placementRow.id, "Alice's tent shape");
    expect(saved.geometry).toEqual(placementRow.geometry);

    // Mutating the original Placement afterward must not affect the
    // already-saved template — "decoupled, no live link back."
    await updatePlacement(alice, placementRow.id, {
      geometry: { ...rectangleGeometry, width: 99 },
    });
    const templates = await listPlacementTemplates(alice);
    expect((templates[0].geometry as { width: number }).width).toBe(10);
  });

  it("holder can delete a template", async () => {
    const { alice } = await setUpModule();
    const created = await createPlacementTemplate(alice, {
      name: "Van",
      shapeType: "rectangle",
      geometry: { x: 0, y: 0, width: 5, height: 2, rotation: 0 },
      category: "vehicle",
    });
    await deletePlacementTemplate(alice, created.id);
    expect(await listPlacementTemplates(alice)).toHaveLength(0);
  });
});

describe("SpacePreference", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("any member can set and read their own preference", async () => {
    const { bob } = await setUpModule();
    expect(await getMySpacePreference(bob)).toBeNull();
    const saved = await upsertMySpacePreference(bob, { sleepArrangement: "solo_tent" });
    expect(saved.sleepArrangement).toBe("solo_tent");
    const fetched = await getMySpacePreference(bob);
    expect(fetched?.sleepArrangement).toBe("solo_tent");
  });

  it("upserts in place rather than creating a second row", async () => {
    const { bob } = await setUpModule();
    await upsertMySpacePreference(bob, { sleepArrangement: "solo_tent" });
    await upsertMySpacePreference(bob, { sleepArrangement: "shared_vehicle", accessibilityNotes: "step-free access" });
    const fetched = await getMySpacePreference(bob);
    expect(fetched?.sleepArrangement).toBe("shared_vehicle");
    expect(fetched?.accessibilityNotes).toBe("step-free access");
  });

  it("rejects while the module is off", async () => {
    const fixtures = await createFixtures();
    await expect(
      upsertMySpacePreference(fixtures.alice, { sleepArrangement: "solo_tent" }),
    ).rejects.toThrow(AppError);
  });

  it("only the Spatial-planning holder can list everyone's preferences, scoped to the community", async () => {
    const { alice, bob } = await setUpModule();
    await upsertMySpacePreference(bob, { sleepArrangement: "solo_tent" });
    await expect(listSpacePreferences(bob)).rejects.toThrow(ForbiddenError);
    const list = await listSpacePreferences(alice);
    expect(list).toHaveLength(1);
    expect(list[0].preference.memberId).toBe(bob.id);
  });
});

describe("Cloning Placements across Cycles", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("clones Placements with zoneId remapped, linkedTaskId dropped, and no PlacementMember rows", async () => {
    const { alice, bob, plot: sourcePlot, cycle: sourceCycle, community: testCommunity, holderTask } =
      await setUpModule();
    const sourceZone = await createZone(alice, sourcePlot.id, {
      name: "Kitchen zone",
      category: "kitchen",
      polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      color: "#ff8800",
    });
    const sourcePlacement = await createPlacement(alice, sourcePlot.id, {
      shapeType: "rectangle",
      geometry: rectangleGeometry,
      label: "Kitchen structure",
      category: "structure",
      zoneId: sourceZone.id,
      linkedTaskId: holderTask.id,
      memberIds: [bob.id],
    });

    const targetCycle = await insertCycle(testCommunity.id, "Cycle B", new Date("2026-06-01"));
    const clonedPlot = await clonePlotFromCycle(alice, targetCycle.id, sourceCycle.id);

    const clonedPlacements = await listPlacements(alice, clonedPlot.id);
    expect(clonedPlacements).toHaveLength(1);
    const cloned = clonedPlacements[0];
    expect(cloned.label).toBe(sourcePlacement.label);
    expect(cloned.linkedTaskId).toBeNull();
    expect(cloned.zoneId).not.toBeNull();
    expect(cloned.zoneId).not.toBe(sourceZone.id);

    const links = await listPlacementMembers(alice, cloned.id);
    expect(links).toHaveLength(0);
  });
});

describe("Placement geometry", () => {
  it("computes rectangle corners with no rotation", () => {
    const corners = rectangleCorners({ x: 10, y: 10, width: 4, height: 2, rotation: 0 });
    expect(corners).toEqual([
      { x: 8, y: 9 },
      { x: 12, y: 9 },
      { x: 12, y: 11 },
      { x: 8, y: 11 },
    ]);
  });

  it("rotates rectangle corners by 90 degrees around its center", () => {
    const corners = rectangleCorners({ x: 0, y: 0, width: 4, height: 2, rotation: 90 });
    // A 90-degree rotation swaps the half-width/half-height axes.
    corners.forEach((c) => {
      expect(Math.abs(c.x)).toBeCloseTo(1, 5);
      expect(Math.abs(c.y)).toBeCloseTo(2, 5);
    });
  });

  it("computes real-world area for rectangle, circle, and polygon", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 1, y: 0 },
      realWorldDistanceMeters: 2, // metersPerUnit = 2
    };
    expect(placementAreaSqm("rectangle", { x: 0, y: 0, width: 3, height: 2, rotation: 45 }, calibration)).toBeCloseTo(
      3 * 2 * 4, // area is rotation-invariant, scaled by metersPerUnit^2 = 4
    );
    expect(placementAreaSqm("circle", { x: 0, y: 0, radius: 5 }, calibration)).toBeCloseTo(Math.PI * 25 * 4);
    expect(
      placementAreaSqm(
        "polygon",
        { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
        calibration,
      ),
    ).toBeCloseTo(100 * 4);
    expect(placementAreaSqm("line", { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, calibration)).toBe(0);
  });

  it("returns null footprint for circle, real points for other shapes", () => {
    expect(placementFootprint("circle", { x: 0, y: 0, radius: 5 })).toBeNull();
    expect(placementFootprint("line", { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });
});

describe("Placement GeoJSON export", () => {
  const calibration: ScaleCalibration = { pointA: { x: 0, y: 0 }, pointB: { x: 1, y: 0 }, realWorldDistanceMeters: 1 };

  it("exports a circle as a Point with radiusMeters", () => {
    const feature = placementToGeoJSONFeature(
      { label: "Tank", category: "structure", shapeType: "circle", geometry: { x: 5, y: 5, radius: 2 } },
      calibration,
    );
    expect(feature.geometry.type).toBe("Point");
    expect(feature.geometry.coordinates).toEqual([5, 5]);
    expect((feature.properties as { radiusMeters: number }).radiusMeters).toBeCloseTo(2);
  });

  it("exports a rectangle as a closed Polygon of its 4 corners", () => {
    const feature = placementToGeoJSONFeature(
      { label: "Tent", category: "tent", shapeType: "rectangle", geometry: rectangleGeometry },
      calibration,
    );
    if (feature.geometry.type !== "Polygon") throw new Error("expected a Polygon");
    const ring = feature.geometry.coordinates[0];
    expect(ring).toHaveLength(5); // 4 corners + closing point
    expect(ring[0]).toEqual(ring[4]);
  });

  it("exports a line as an open LineString", () => {
    const feature = placementToGeoJSONFeature(
      {
        label: "Fence",
        category: "generic",
        shapeType: "line",
        geometry: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
      },
      calibration,
    );
    expect(feature.geometry.type).toBe("LineString");
    expect(feature.geometry.coordinates).toHaveLength(3);
  });
});
