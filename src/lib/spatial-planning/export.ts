import {
  isGeoAnchored,
  localToLatLng,
  metersPerUnit,
  placementFootprint,
  type CircleGeometry,
  type PlacementGeometry,
  type PlacementShapeType,
  type Point,
  type ScaleCalibration,
} from "./geometry";

// Pure GeoJSON builders — no DB, safe to import from a "use client"
// component directly (this is exactly the reciprocal of a Plot's own
// geo-anchored GeoJSON import — see docs/spec.md's Export bullet: "the
// same shape a Plot's geo-anchored import already accepts, so the two
// are one mechanism used in both directions"). Export itself (choosing
// image vs. GeoJSON, triggering the browser download) happens entirely
// client-side — there's no server endpoint for it, the same "entirely
// client-side, no dedicated endpoint" posture the reference bulk-import
// feature this module was scoped against also uses.

type ZoneLike = { name: string; category: string; color: string; polygon: Point[] };
type PlacementLike = {
  label: string;
  category: string;
  shapeType: PlacementShapeType;
  geometry: PlacementGeometry;
};

function pointToCoordinate(p: Point, calibration: ScaleCalibration | null | undefined): [number, number] {
  if (isGeoAnchored(calibration)) {
    const { lat, lng } = localToLatLng(p, calibration!);
    return [lng, lat];
  }
  return [p.x, p.y];
}

function pointsToCoordinates(points: Point[], calibration: ScaleCalibration | null | undefined) {
  return points.map((p) => pointToCoordinate(p, calibration));
}

function polygonToCoordinates(polygon: Point[], calibration: ScaleCalibration | null | undefined) {
  const ring = pointsToCoordinates(polygon, calibration);
  // GeoJSON polygons must close (first point repeated as last).
  if (ring.length > 0) {
    const [firstX, firstY] = ring[0];
    const [lastX, lastY] = ring[ring.length - 1];
    if (firstX !== lastX || firstY !== lastY) ring.push(ring[0]);
  }
  return [ring];
}

export function zoneToGeoJSONFeature(zone: ZoneLike, calibration: ScaleCalibration | null | undefined) {
  return {
    type: "Feature" as const,
    properties: {
      name: zone.name,
      category: zone.category,
      color: zone.color,
      // Lets a consumer tell real WGS84 coordinates apart from plain
      // local units — see geometry.ts's isGeoAnchored.
      geoAnchored: isGeoAnchored(calibration),
    },
    geometry: {
      type: "Polygon" as const,
      coordinates: polygonToCoordinates(zone.polygon, calibration),
    },
  };
}

export function zonesToGeoJSONFeatureCollection(
  zones: ZoneLike[],
  calibration: ScaleCalibration | null | undefined,
) {
  return {
    type: "FeatureCollection" as const,
    features: zones.map((z) => zoneToGeoJSONFeature(z, calibration)),
  };
}

// A circle has no native GeoJSON representation — exported as a Point
// at its center with a `radiusMeters` property rather than an
// approximated polygon, so re-importing it round-trips exactly instead
// of silently becoming an N-gon. Every other shape type has a real
// point list via placementFootprint (rectangle's corners, or polygon/
// line's own points) — polygon exports as a closed Polygon, line as an
// open LineString, matching which one is actually the closer analog.
export function placementToGeoJSONFeature(
  placement: PlacementLike,
  calibration: ScaleCalibration | null | undefined,
) {
  const properties = {
    label: placement.label,
    category: placement.category,
    shapeType: placement.shapeType,
    geoAnchored: isGeoAnchored(calibration),
  };

  if (placement.shapeType === "circle") {
    const circle = placement.geometry as CircleGeometry;
    return {
      type: "Feature" as const,
      properties: {
        ...properties,
        radiusMeters: calibration ? circle.radius * metersPerUnit(calibration) : circle.radius,
      },
      geometry: {
        type: "Point" as const,
        coordinates: pointToCoordinate({ x: circle.x, y: circle.y }, calibration),
      },
    };
  }

  const points = placementFootprint(placement.shapeType, placement.geometry)!;
  if (placement.shapeType === "line") {
    return {
      type: "Feature" as const,
      properties,
      geometry: { type: "LineString" as const, coordinates: pointsToCoordinates(points, calibration) },
    };
  }
  return {
    type: "Feature" as const,
    properties,
    geometry: { type: "Polygon" as const, coordinates: polygonToCoordinates(points, calibration) },
  };
}

export function placementsToGeoJSONFeatureCollection(
  placements: PlacementLike[],
  calibration: ScaleCalibration | null | undefined,
) {
  return {
    type: "FeatureCollection" as const,
    features: placements.map((p) => placementToGeoJSONFeature(p, calibration)),
  };
}

// "Whole Plot" export scope (docs/development-plan.md's Phase 37:
// "extends Phase 36's export to include Placement as an export
// scope") — every Zone and every Placement in one FeatureCollection.
export function plotToGeoJSONFeatureCollection(
  zones: ZoneLike[],
  placements: PlacementLike[],
  calibration: ScaleCalibration | null | undefined,
) {
  return {
    type: "FeatureCollection" as const,
    features: [
      ...zones.map((z) => zoneToGeoJSONFeature(z, calibration)),
      ...placements.map((p) => placementToGeoJSONFeature(p, calibration)),
    ],
  };
}
