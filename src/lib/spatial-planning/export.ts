import { isGeoAnchored, localToLatLng, type Point, type ScaleCalibration } from "./geometry";

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

function polygonToCoordinates(polygon: Point[], calibration: ScaleCalibration | null | undefined) {
  const geoAnchored = isGeoAnchored(calibration);
  const ring = polygon.map((p) => {
    if (geoAnchored) {
      const { lat, lng } = localToLatLng(p, calibration!);
      return [lng, lat];
    }
    return [p.x, p.y];
  });
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
