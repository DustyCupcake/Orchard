import { AppError } from "../errors";

// Pure geometry helpers — no DB, no auth. Operates on the Plot's own
// local coordinate units (not pixels-on-screen, not lat/lng); real-
// world meters are always derived via a Plot's scaleCalibration. See
// docs/spec.md's "Spatial planning" and "Geo-anchoring (optional)".

export type Point = { x: number; y: number };
export type CalibrationPoint = Point & { lat?: number; lng?: number };
export type ScaleCalibration = {
  pointA: CalibrationPoint;
  pointB: CalibrationPoint;
  // Required unless both points carry lat/lng (in which case the real
  // distance is derived from them instead — see metersPerUnit — so the
  // two numbers can never drift apart).
  realWorldDistanceMeters?: number;
};

const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg: number) {
  return (deg * Math.PI) / 180;
}

// Haversine — plenty precise at site scale (a venue, not a country),
// and this is the only geodesic math this module needs.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function isFullyGeoAnchored(calibration: ScaleCalibration): boolean {
  const { pointA, pointB } = calibration;
  return pointA.lat != null && pointA.lng != null && pointB.lat != null && pointB.lng != null;
}

export function isGeoAnchored(calibration: ScaleCalibration | null | undefined): boolean {
  return calibration != null && isFullyGeoAnchored(calibration);
}

// The one number every other function here builds on: how many real-
// world meters correspond to one local coordinate unit.
export function metersPerUnit(calibration: ScaleCalibration): number {
  const { pointA, pointB, realWorldDistanceMeters } = calibration;
  const localDist = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
  if (localDist === 0) {
    throw new AppError("Calibration points can't be the same point");
  }
  const realDist = isFullyGeoAnchored(calibration)
    ? haversineMeters(pointA.lat!, pointA.lng!, pointB.lat!, pointB.lng!)
    : realWorldDistanceMeters;
  if (realDist == null || realDist <= 0) {
    throw new AppError("Calibration needs either a real-world distance or GPS coordinates on both points");
  }
  return realDist / localDist;
}

// Shoelace formula, local units² — the standard polygon-area formula,
// no library needed for it.
export function polygonAreaLocalUnits(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonAreaSqm(points: Point[], calibration: ScaleCalibration): number {
  const mPerUnit = metersPerUnit(calibration);
  return polygonAreaLocalUnits(points) * mPerUnit * mPerUnit;
}

export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

// One length per edge (including the closing edge back to the first
// point), in real-world meters — what the live "length label on each
// edge" (docs/spec.md) is built from.
export function edgeLengthsMeters(points: Point[], calibration: ScaleCalibration): number[] {
  if (points.length < 2) return [];
  const mPerUnit = metersPerUnit(calibration);
  const lengths: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    lengths.push(Math.hypot(p2.x - p1.x, p2.y - p1.y) * mPerUnit);
  }
  return lengths;
}

// --- Geo-anchor transform (local units <-> real WGS84) ---
//
// A flat-earth local tangent plane centered on pointA — GPS itself is
// only accurate to a few meters, and a Plot is site-scale (hundreds of
// meters, not kilometers), so this is more than precise enough and far
// simpler than full geodesic projection math. Only used for
// import/export (see the Export section of docs/spec.md's Spatial
// planning); live area/length feedback above never needs it.

const METERS_PER_DEGREE_LAT = 111320;

function metersPerDegreeLng(atLat: number) {
  return METERS_PER_DEGREE_LAT * Math.cos(toRadians(atLat));
}

function requireGeoAnchored(calibration: ScaleCalibration): asserts calibration is ScaleCalibration & {
  pointA: Required<Pick<CalibrationPoint, "lat" | "lng">> & CalibrationPoint;
} {
  if (!isFullyGeoAnchored(calibration)) {
    throw new AppError("This Plot has no GPS geo-anchor set");
  }
}

// Local units -> {lat, lng}, using the same similarity transform
// (translate, rotate, uniform scale) the two calibration points define.
export function localToLatLng(point: Point, calibration: ScaleCalibration): { lat: number; lng: number } {
  requireGeoAnchored(calibration);
  const { pointA, pointB } = calibration;
  const scale = metersPerUnit(calibration);

  const dLocal = { x: pointB.x - pointA.x, y: pointB.y - pointA.y };
  const localAngle = Math.atan2(dLocal.y, dLocal.x);
  // Bearing (from north, clockwise) between the two real-world points —
  // this plus localAngle gives the rotation between the two coordinate
  // systems.
  const dLatMeters = (pointB.lat! - pointA.lat!) * METERS_PER_DEGREE_LAT;
  const dLngMeters = (pointB.lng! - pointA.lng!) * metersPerDegreeLng(pointA.lat!);
  const realAngle = Math.atan2(dLatMeters, dLngMeters); // treat (east=x, north=y) same axes as local
  const rotation = realAngle - localAngle;

  const v = { x: point.x - pointA.x, y: point.y - pointA.y };
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const eastMeters = (v.x * cos - v.y * sin) * scale;
  const northMeters = (v.x * sin + v.y * cos) * scale;

  return {
    lat: pointA.lat! + northMeters / METERS_PER_DEGREE_LAT,
    lng: pointA.lng! + eastMeters / metersPerDegreeLng(pointA.lat!),
  };
}

// The inverse of localToLatLng — {lat, lng} -> local units.
export function latLngToLocal(geo: { lat: number; lng: number }, calibration: ScaleCalibration): Point {
  requireGeoAnchored(calibration);
  const { pointA, pointB } = calibration;
  const scale = metersPerUnit(calibration);

  const dLocal = { x: pointB.x - pointA.x, y: pointB.y - pointA.y };
  const localAngle = Math.atan2(dLocal.y, dLocal.x);
  const dLatMeters = (pointB.lat! - pointA.lat!) * METERS_PER_DEGREE_LAT;
  const dLngMeters = (pointB.lng! - pointA.lng!) * metersPerDegreeLng(pointA.lat!);
  const realAngle = Math.atan2(dLatMeters, dLngMeters);
  const rotation = realAngle - localAngle;

  const eastMeters = (geo.lng - pointA.lng!) * metersPerDegreeLng(pointA.lat!);
  const northMeters = (geo.lat - pointA.lat!) * METERS_PER_DEGREE_LAT;

  // Rotate back by -rotation, then unscale.
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const x = ((eastMeters * cos - northMeters * sin) / scale) + pointA.x;
  const y = ((eastMeters * sin + northMeters * cos) / scale) + pointA.y;
  return { x, y };
}
