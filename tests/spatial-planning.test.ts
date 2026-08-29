import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cycle, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { updateCommunity } from "@/lib/settings";
import {
  clonePlotFromCycle,
  createPlot,
  createZone,
  deleteZone,
  edgeLengthsMeters,
  getPlotForCycle,
  isGeoAnchored,
  latLngToLocal,
  listCyclesWithPlot,
  listZones,
  localToLatLng,
  metersPerUnit,
  polygonAreaLocalUnits,
  polygonAreaSqm,
  updatePlot,
  updateZone,
  zoneToGeoJSONFeature,
  zonesToGeoJSONFeatureCollection,
  type ScaleCalibration,
} from "@/lib/spatial-planning";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

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
  await updateCommunity(alice, { spatialPlanningTaskId: holderTask.id });
  const testCycle = await insertCycle(testCommunity.id, "Cycle A", new Date("2026-01-01"));
  return { ...fixtures, holderTask, cycle: testCycle };
}

const squarePolygon = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("Plot", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects while the module is off", async () => {
    const { alice, cycle: testCycle } = await createFixtures().then(async (f) => {
      const testCycle = await insertCycle(f.community.id, "Cycle A", new Date());
      return { ...f, cycle: testCycle };
    });
    await expect(createPlot(alice, testCycle.id, { name: "Main site" })).rejects.toThrow(AppError);
  });

  it("rejects a non-holder even with the module on", async () => {
    const { bob, cycle: testCycle } = await setUpModule();
    await expect(createPlot(bob, testCycle.id, { name: "Main site" })).rejects.toThrow(ForbiddenError);
  });

  it("lets the holder create a Plot", async () => {
    const { alice, cycle: testCycle } = await setUpModule();
    const created = await createPlot(alice, testCycle.id, { name: "Main site" });
    expect(created.name).toBe("Main site");
    expect(created.cycleId).toBe(testCycle.id);

    const fetched = await getPlotForCycle(alice, testCycle.id);
    expect(fetched?.id).toBe(created.id);
  });

  it("enforces one Plot per Cycle", async () => {
    const { alice, cycle: testCycle } = await setUpModule();
    await createPlot(alice, testCycle.id, { name: "Main site" });
    await expect(createPlot(alice, testCycle.id, { name: "Second attempt" })).rejects.toThrow(ConflictError);
  });

  it("rejects an oversized data: URI base image", async () => {
    const { alice, cycle: testCycle } = await setUpModule();
    const huge = "data:image/png;base64," + "A".repeat(9_000_000);
    await expect(createPlot(alice, testCycle.id, { name: "Main site", baseImageUrl: huge })).rejects.toThrow();
  });

  it("updates calibration and base image", async () => {
    const { alice, cycle: testCycle } = await setUpModule();
    const created = await createPlot(alice, testCycle.id, { name: "Main site" });
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 100, y: 0 },
      realWorldDistanceMeters: 50,
    };
    const updated = await updatePlot(alice, created.id, { scaleCalibration: calibration });
    expect(updated.scaleCalibration).toEqual(calibration);
  });

  it("clones a Plot and its Zones from a previous Cycle, without touching the target's Task/Member links (Zones have none)", async () => {
    const { alice, cycle: sourceCycle, community: testCommunity } = await setUpModule();
    const sourcePlot = await createPlot(alice, sourceCycle.id, {
      name: "Last year's site",
      scaleCalibration: { pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 }, realWorldDistanceMeters: 10 },
    });
    await createZone(alice, sourcePlot.id, {
      name: "Kitchen",
      category: "kitchen",
      polygon: squarePolygon,
      color: "#ff0000",
    });

    const targetCycle = await insertCycle(testCommunity.id, "Cycle B", new Date("2026-06-01"));
    const cloned = await clonePlotFromCycle(alice, targetCycle.id, sourceCycle.id);
    expect(cloned.cycleId).toBe(targetCycle.id);
    expect(cloned.name).toBe("Last year's site");
    expect(cloned.scaleCalibration).toEqual(sourcePlot.scaleCalibration);

    const clonedZones = await listZones(alice, cloned.id);
    expect(clonedZones).toHaveLength(1);
    expect(clonedZones[0].name).toBe("Kitchen");
    expect(clonedZones[0].plotId).not.toBe(sourcePlot.id);
  });

  it("refuses to clone onto a Cycle that already has a Plot", async () => {
    const { alice, cycle: sourceCycle, community: testCommunity } = await setUpModule();
    await createPlot(alice, sourceCycle.id, { name: "Source" });
    const targetCycle = await insertCycle(testCommunity.id, "Cycle B", new Date("2026-06-01"));
    await createPlot(alice, targetCycle.id, { name: "Already exists" });
    await expect(clonePlotFromCycle(alice, targetCycle.id, sourceCycle.id)).rejects.toThrow(ConflictError);
  });

  it("refuses to clone from a Cycle with no Plot", async () => {
    const { alice, cycle: sourceCycle, community: testCommunity } = await setUpModule();
    const emptySourceCycle = await insertCycle(testCommunity.id, "Empty", new Date("2025-01-01"));
    const targetCycle = await insertCycle(testCommunity.id, "Cycle B", new Date("2026-06-01"));
    await expect(clonePlotFromCycle(alice, targetCycle.id, emptySourceCycle.id)).rejects.toThrow(NotFoundError);
    void sourceCycle;
  });

  it("supports a null cycleId for a Community that never turned Cycles on", async () => {
    const fixtures = await createFixtures();
    const { alice, branch: testBranch, community: testCommunity } = fixtures;
    await updateCommunity(alice, { modulesEnabled: ["spatial_planning"] });
    const holderTask = await insertSpatialPlanningTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(alice, holderTask.id);
    await updateCommunity(alice, { spatialPlanningTaskId: holderTask.id });

    const created = await createPlot(alice, null, { name: "The one site" });
    expect(created.cycleId).toBeNull();
    expect(await getPlotForCycle(alice, null)).not.toBeNull();
    await expect(createPlot(alice, null, { name: "Second attempt" })).rejects.toThrow(ConflictError);
  });

  it("lists Cycles with a Plot most-recent-first, excluding the target Cycle itself", async () => {
    const { alice, cycle: cycleA, community: testCommunity } = await setUpModule();
    await createPlot(alice, cycleA.id, { name: "A" });
    const cycleB = await insertCycle(testCommunity.id, "Cycle B", new Date("2026-06-01"));
    await createPlot(alice, cycleB.id, { name: "B" });
    const cycleC = await insertCycle(testCommunity.id, "Cycle C", new Date("2027-01-01"));

    const list = await listCyclesWithPlot(alice, cycleC.id);
    expect(list.map((r) => r.cycleId)).toEqual([cycleB.id, cycleA.id]);
  });
});

describe("Zone", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a non-holder creating a Zone", async () => {
    const { alice, bob, cycle: testCycle } = await setUpModule();
    const plotRow = await createPlot(alice, testCycle.id, { name: "Main site" });
    await expect(
      createZone(bob, plotRow.id, { name: "Kitchen", category: "kitchen", polygon: squarePolygon, color: "#f00" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("lets any member list Zones", async () => {
    const { alice, bob, cycle: testCycle } = await setUpModule();
    const plotRow = await createPlot(alice, testCycle.id, { name: "Main site" });
    await createZone(alice, plotRow.id, {
      name: "Kitchen",
      category: "kitchen",
      polygon: squarePolygon,
      color: "#f00",
    });
    const zones = await listZones(bob, plotRow.id);
    expect(zones).toHaveLength(1);
  });

  it("requires at least 3 points", async () => {
    const { alice, cycle: testCycle } = await setUpModule();
    const plotRow = await createPlot(alice, testCycle.id, { name: "Main site" });
    await expect(
      createZone(alice, plotRow.id, {
        name: "Bad",
        category: "kitchen",
        polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
        color: "#f00",
      }),
    ).rejects.toThrow();
  });

  it("holder can update and delete a Zone", async () => {
    const { alice, cycle: testCycle } = await setUpModule();
    const plotRow = await createPlot(alice, testCycle.id, { name: "Main site" });
    const created = await createZone(alice, plotRow.id, {
      name: "Kitchen",
      category: "kitchen",
      polygon: squarePolygon,
      color: "#f00",
    });
    const updated = await updateZone(alice, created.id, { color: "#0f0" });
    expect(updated.color).toBe("#0f0");
    await deleteZone(alice, created.id);
    expect(await listZones(alice, plotRow.id)).toHaveLength(0);
  });
});

describe("Geometry", () => {
  it("computes shoelace area for a simple square", () => {
    expect(polygonAreaLocalUnits(squarePolygon)).toBe(100);
  });

  it("derives metersPerUnit from an explicit distance", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 10, y: 0 },
      realWorldDistanceMeters: 5,
    };
    expect(metersPerUnit(calibration)).toBeCloseTo(0.5);
  });

  it("scales polygon area by metersPerUnit squared", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 1, y: 0 },
      realWorldDistanceMeters: 2, // metersPerUnit = 2
    };
    // 10x10 local square = 100 local units², × 2² = 400 sqm
    expect(polygonAreaSqm(squarePolygon, calibration)).toBeCloseTo(400);
  });

  it("computes edge lengths in meters for all edges including the closing one", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 1, y: 0 },
      realWorldDistanceMeters: 1, // metersPerUnit = 1
    };
    const lengths = edgeLengthsMeters(squarePolygon, calibration);
    expect(lengths).toHaveLength(4);
    lengths.forEach((l) => expect(l).toBeCloseTo(10));
  });

  it("rejects calibration with neither a distance nor GPS", () => {
    const calibration = { pointA: { x: 0, y: 0 }, pointB: { x: 10, y: 0 } } as ScaleCalibration;
    expect(() => metersPerUnit(calibration)).toThrow(AppError);
  });

  it("derives distance from GPS when both points are geo-anchored", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0, lat: 0, lng: 0 },
      pointB: { x: 10, y: 0, lat: 0, lng: 0.001 }, // ~111.2m east at the equator
    };
    expect(metersPerUnit(calibration)).toBeCloseTo(11.12, 0);
  });

  it("isGeoAnchored is true only when both points carry lat/lng", () => {
    const noGeo: ScaleCalibration = { pointA: { x: 0, y: 0 }, pointB: { x: 1, y: 0 }, realWorldDistanceMeters: 1 };
    const withGeo: ScaleCalibration = {
      pointA: { x: 0, y: 0, lat: 10, lng: 20 },
      pointB: { x: 1, y: 0, lat: 10, lng: 20.001 },
    };
    expect(isGeoAnchored(noGeo)).toBe(false);
    expect(isGeoAnchored(withGeo)).toBe(true);
  });

  it("round-trips local -> lat/lng -> local", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0, lat: 45, lng: -73 },
      pointB: { x: 50, y: 0, lat: 45, lng: -72.9994 },
    };
    const original = { x: 23, y: -17 };
    const geo = localToLatLng(original, calibration);
    const back = latLngToLocal(geo, calibration);
    expect(back.x).toBeCloseTo(original.x, 1);
    expect(back.y).toBeCloseTo(original.y, 1);
  });

  it("refuses lat/lng conversion when not geo-anchored", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 1, y: 0 },
      realWorldDistanceMeters: 1,
    };
    expect(() => localToLatLng({ x: 0, y: 0 }, calibration)).toThrow(AppError);
  });
});

describe("GeoJSON export", () => {
  it("exports local units as coordinates when not geo-anchored", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0 },
      pointB: { x: 1, y: 0 },
      realWorldDistanceMeters: 1,
    };
    const feature = zoneToGeoJSONFeature(
      { name: "Kitchen", category: "kitchen", color: "#f00", polygon: squarePolygon },
      calibration,
    );
    expect(feature.properties.geoAnchored).toBe(false);
    expect(feature.geometry.coordinates[0][0]).toEqual([0, 0]);
    // Closed ring: first point repeated as last.
    const ring = feature.geometry.coordinates[0];
    expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it("exports real lat/lng coordinates when geo-anchored", () => {
    const calibration: ScaleCalibration = {
      pointA: { x: 0, y: 0, lat: 45, lng: -73 },
      pointB: { x: 50, y: 0, lat: 45, lng: -72.9994 },
    };
    const collection = zonesToGeoJSONFeatureCollection(
      [{ name: "Kitchen", category: "kitchen", color: "#f00", polygon: squarePolygon }],
      calibration,
    );
    expect(collection.features[0].properties.geoAnchored).toBe(true);
    const [lng, lat] = collection.features[0].geometry.coordinates[0][0];
    expect(lat).toBeCloseTo(45, 1);
    expect(lng).toBeCloseTo(-73, 1);
  });
});
