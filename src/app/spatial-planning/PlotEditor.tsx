"use client";

import { useMemo, useRef, useState } from "react";
import {
  edgeLengthsMeters,
  isGeoAnchored,
  metersPerUnit,
  placementAreaSqm,
  placementFootprint,
  polygonAreaSqm,
  polygonCentroid,
  rectangleCorners,
  type CircleGeometry,
  type PlacementGeometry,
  type PlacementShapeType,
  type Point,
  type RectangleGeometry,
  type ScaleCalibration,
} from "@/lib/spatial-planning/geometry";
import {
  placementToGeoJSONFeature,
  plotToGeoJSONFeatureCollection,
  zoneToGeoJSONFeature,
} from "@/lib/spatial-planning/export";

// The Plot's own local coordinate space IS the SVG viewBox, 1:1 — the
// simplest possible mapping (no separate pan/zoom/pixel-to-unit layer
// for v1). A base image is stretched to exactly fill it; calibration
// and every drawn shape are authored directly in these units.
const VB_WIDTH = 1000;
const VB_HEIGHT = 700;

type PlotRow = {
  id: string;
  name: string;
  baseImageUrl: string | null;
  baseVector: unknown;
  scaleCalibration: ScaleCalibration | null;
};

type ZoneRow = {
  id: string;
  plotId: string;
  name: string;
  category: string;
  polygon: Point[];
  color: string;
};

type PlacementRow = {
  id: string;
  plotId: string;
  zoneId: string | null;
  shapeType: PlacementShapeType;
  geometry: PlacementGeometry;
  label: string;
  category: string;
  linkedTaskId: string | null;
};

type PlacementTemplateRow = {
  id: string;
  name: string;
  shapeType: PlacementShapeType;
  geometry: PlacementGeometry;
  category: string;
};

type MemberOption = { id: string; name: string };

// The rendered color for every category a Placement can have — see
// src/db/schema/spatial-planning.ts's schema comment: "rendered color
// follows category, no separate stored color field."
const PLACEMENT_CATEGORY_COLOR: Record<string, string> = {
  tent: "#4488cc",
  vehicle: "#cc8844",
  structure: "#888888",
  furniture: "#22aa66",
  generic: "#aa66cc",
};

const PLACEMENT_CATEGORIES: { value: string; label: string }[] = [
  { value: "tent", label: "Tent" },
  { value: "vehicle", label: "Vehicle" },
  { value: "structure", label: "Structure" },
  { value: "furniture", label: "Furniture" },
  { value: "generic", label: "Generic" },
];

type Mode =
  | "view"
  | "calibrate"
  | "draw-zone"
  | "edit-zone"
  | "draw-placement"
  | "edit-placement";

function polygonToSvgPoints(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

// Best-effort ring extraction from a GeoJSON Feature/FeatureCollection
// with Polygon/MultiPolygon geometry — rendered as local-unit outlines
// directly, the same "whatever numbers are there, drawn as local
// units" posture non-geo-anchored export already takes.
function extractVectorRings(baseVector: unknown): Point[][] {
  const rings: Point[][] = [];
  function fromCoords(coords: number[][][]) {
    for (const ring of coords) {
      rings.push(ring.map(([x, y]) => ({ x, y })));
    }
  }
  function fromGeometry(geom: { type: string; coordinates: unknown }) {
    if (!geom) return;
    if (geom.type === "Polygon") fromCoords(geom.coordinates as number[][][]);
    if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates as number[][][][]) fromCoords(poly);
    }
  }
  const v = baseVector as { type?: string; geometry?: unknown; features?: { geometry: unknown }[] };
  if (!v || typeof v !== "object") return rings;
  if (v.type === "FeatureCollection" && Array.isArray(v.features)) {
    for (const f of v.features) fromGeometry(f.geometry as { type: string; coordinates: unknown });
  } else if (v.type === "Feature") {
    fromGeometry(v.geometry as { type: string; coordinates: unknown });
  } else if (v.type === "Polygon" || v.type === "MultiPolygon") {
    fromGeometry(v as { type: string; coordinates: unknown });
  }
  return rings;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function PlotEditor({
  cycleId,
  cycleName,
  plot,
  initialZones,
  initialPlacements,
  initialTemplates,
  communityMembers,
  canEdit,
  cloneCandidates,
}: {
  cycleId: string | null;
  cycleName: string | null;
  plot: PlotRow | null;
  initialZones: ZoneRow[];
  initialPlacements: PlacementRow[];
  initialTemplates: PlacementTemplateRow[];
  communityMembers: MemberOption[];
  canEdit: boolean;
  cloneCandidates: { cycleId: string; cycleName: string }[];
}) {
  const [plotRow, setPlotRow] = useState(plot);
  const [zones, setZones] = useState(initialZones);
  const [placements, setPlacements] = useState(initialPlacements);
  const [templates, setTemplates] = useState(initialTemplates);
  const [mode, setMode] = useState<Mode>("view");
  const [error, setError] = useState<string | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  // --- Plot creation (no Plot yet) ---
  const [newPlotName, setNewPlotName] = useState("");
  const [creating, setCreating] = useState(false);
  const [vectorText, setVectorText] = useState("");
  const [cloneSourceCycleId, setCloneSourceCycleId] = useState("");

  // --- Calibration ---
  const [calPoints, setCalPoints] = useState<Point[]>([]);
  const [calDistance, setCalDistance] = useState("");
  const [calUseGps, setCalUseGps] = useState(false);
  const [calLatLng, setCalLatLng] = useState({ latA: "", lngA: "", latB: "", lngB: "" });

  // --- Drawing a new Zone ---
  const [drawPoints, setDrawPoints] = useState<Point[]>([]);
  const [newZoneFields, setNewZoneFields] = useState({ name: "", category: "", color: "#4488cc" });

  // --- Editing an existing Zone ---
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [editPoints, setEditPoints] = useState<Point[]>([]);
  const [selectedVertex, setSelectedVertex] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // --- Drawing/editing a Placement (rectangle/circle/polygon/line) ---
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [draftShapeType, setDraftShapeType] = useState<PlacementShapeType>("rectangle");
  // Rectangle/circle: a positioned, draggable (and for rectangle,
  // rotatable) draft — set once dimensions are confirmed, then moved by
  // dragging its body rather than repeated clicks (a single click has
  // no natural "where" for a shape with real dimensions the way a
  // polygon vertex does).
  const [draftGeometry, setDraftGeometry] = useState<RectangleGeometry | CircleGeometry | null>(null);
  // Polygon/line: click-to-add-points, same mechanic Zone drawing uses.
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [placementFields, setPlacementFields] = useState({
    label: "",
    category: "generic",
    linkedTaskId: "",
    memberIds: [] as string[],
  });
  const [dimensionsInput, setDimensionsInput] = useState({ width: "3", height: "2", radius: "1.5" });
  const [templateId, setTemplateId] = useState("");
  const bodyDragging = useRef(false);
  const rotateDragging = useRef(false);

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const selectedPlacement = placements.find((p) => p.id === selectedPlacementId) ?? null;
  const categories = useMemo(() => [...new Set(zones.map((z) => z.category))], [zones]);
  const visibleZones = zones.filter((z) => mode !== "edit-zone" || z.id !== selectedZoneId).filter(
    (z) => !hiddenCategories.has(z.category),
  );
  const visiblePlacements = placements.filter(
    (p) => mode !== "edit-placement" || p.id !== selectedPlacementId,
  );

  // Local-unit <-> real-world-meters conversion for dimension inputs —
  // falls back to treating the typed number as already-local-units
  // when the Plot has no calibration yet, same graceful-without-
  // calibration posture Zone's own live labels already take.
  function metersToLocalUnits(meters: number): number {
    if (!plotRow?.scaleCalibration) return meters;
    try {
      return meters / metersPerUnit(plotRow.scaleCalibration);
    } catch {
      return meters;
    }
  }

  // The inverse — needed when a template's geometry (always stored in
  // local units, like any Placement's) prefills the dimension inputs,
  // which display and later re-convert as meters. Without this, a
  // template's local-unit width/height would be treated as meters and
  // double-converted by placeDraftShape.
  function localUnitsToMeters(units: number): number {
    if (!plotRow?.scaleCalibration) return units;
    try {
      return units * metersPerUnit(plotRow.scaleCalibration);
    } catch {
      return units;
    }
  }

  function clientPointToLocal(e: { clientX: number; clientY: number }): Point {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * VB_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * VB_HEIGHT,
    };
  }

  async function refreshZones(plotId: string) {
    const res = await fetch(`/api/spatial-planning/zones?plotId=${plotId}`);
    const data = await res.json();
    if (res.ok) setZones(data.zones);
  }

  async function refreshPlacements(plotId: string) {
    const res = await fetch(`/api/spatial-planning/placements?plotId=${plotId}`);
    const data = await res.json();
    if (res.ok) setPlacements(data.placements);
  }

  // --- Plot creation handlers ---

  async function createPlot(body: Record<string, unknown>) {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/spatial-planning/plot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, name: newPlotName || "Main site", ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create Plot");
      setPlotRow(data.plot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    await createPlot({ baseImageUrl: dataUrl });
  }

  async function handleVectorImport() {
    try {
      const parsed = JSON.parse(vectorText);
      await createPlot({ baseVector: parsed });
    } catch {
      setError("That doesn't look like valid GeoJSON");
    }
  }

  async function handleCloneCreate() {
    if (!cloneSourceCycleId || !cycleId) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/spatial-planning/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCycleId: cycleId, sourceCycleId: cloneSourceCycleId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to clone");
      setPlotRow(data.plot);
      await Promise.all([refreshZones(data.plot.id), refreshPlacements(data.plot.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  // --- Calibration handlers ---

  function onCalibrateClick(e: React.MouseEvent<SVGSVGElement>) {
    if (calPoints.length >= 2) return;
    setCalPoints([...calPoints, clientPointToLocal(e)]);
  }

  async function saveCalibration() {
    if (calPoints.length !== 2 || !plotRow) return;
    const [pointA, pointB] = calPoints;
    const calibration: ScaleCalibration = calUseGps
      ? {
          pointA: { ...pointA, lat: Number(calLatLng.latA), lng: Number(calLatLng.lngA) },
          pointB: { ...pointB, lat: Number(calLatLng.latB), lng: Number(calLatLng.lngB) },
        }
      : { pointA, pointB, realWorldDistanceMeters: Number(calDistance) };

    try {
      const res = await fetch(`/api/spatial-planning/plot/${plotRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scaleCalibration: calibration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to calibrate");
      setPlotRow(data.plot);
      setMode("view");
      setCalPoints([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Draw-zone handlers ---

  function onDrawClick(e: React.MouseEvent<SVGSVGElement>) {
    setDrawPoints([...drawPoints, clientPointToLocal(e)]);
  }

  async function saveNewZone() {
    if (!plotRow || drawPoints.length < 3) return;
    try {
      const res = await fetch("/api/spatial-planning/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plotId: plotRow.id, polygon: drawPoints, ...newZoneFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save Zone");
      setZones([...zones, data.zone]);
      setMode("view");
      setDrawPoints([]);
      setNewZoneFields({ name: "", category: "", color: "#4488cc" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Edit-zone handlers ---

  function startEditingZone(z: ZoneRow) {
    setSelectedZoneId(z.id);
    setEditPoints(z.polygon);
    setSelectedVertex(null);
    setMode("edit-zone");
  }

  function onVertexPointerDown(index: number, e: React.PointerEvent) {
    e.stopPropagation();
    dragging.current = index;
    setSelectedVertex(index);
  }

  function onEditPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragging.current === null) return;
    const p = clientPointToLocal(e);
    setEditPoints((pts) => pts.map((pt, i) => (i === dragging.current ? p : pt)));
  }

  function onEditPointerUp() {
    dragging.current = null;
  }

  function insertVertexAt(index: number) {
    // Inserts a new point at the midpoint of the edge starting at
    // `index` — the "click a midpoint to add a vertex there" mechanic
    // (docs/spec.md's Collaborative drawing tool).
    const a = editPoints[index];
    const b = editPoints[(index + 1) % editPoints.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const next = [...editPoints.slice(0, index + 1), mid, ...editPoints.slice(index + 1)];
    setEditPoints(next);
  }

  function deleteSelectedVertex() {
    if (selectedVertex === null || editPoints.length <= 3) return;
    setEditPoints(editPoints.filter((_, i) => i !== selectedVertex));
    setSelectedVertex(null);
  }

  async function saveEditedZone() {
    if (!selectedZoneId) return;
    try {
      const res = await fetch(`/api/spatial-planning/zones/${selectedZoneId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polygon: editPoints }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save Zone");
      setZones(zones.map((z) => (z.id === data.zone.id ? data.zone : z)));
      setMode("view");
      setSelectedVertex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteZone(id: string) {
    if (!confirm("Delete this Zone?")) return;
    const res = await fetch(`/api/spatial-planning/zones/${id}`, { method: "DELETE" });
    if (res.ok) {
      setZones(zones.filter((z) => z.id !== id));
      setSelectedZoneId(null);
      setMode("view");
    }
  }

  // --- Draw/edit Placement handlers ---

  function startNewPlacement() {
    setPlacementFields({ label: "", category: "generic", linkedTaskId: "", memberIds: [] });
    setDimensionsInput({ width: "3", height: "2", radius: "1.5" });
    setTemplateId("");
    setDraftShapeType("rectangle");
    setDraftGeometry(null);
    setDraftPoints([]);
    setSelectedPlacementId(null);
    setMode("draw-placement");
  }

  function applyTemplateSelection(id: string) {
    setTemplateId(id);
    const t = templates.find((t) => t.id === id);
    if (!t) return;
    setDraftShapeType(t.shapeType);
    setPlacementFields((f) => ({ ...f, category: t.category }));
    if (t.shapeType === "rectangle") {
      const g = t.geometry as RectangleGeometry;
      setDimensionsInput((d) => ({
        ...d,
        width: String(localUnitsToMeters(g.width)),
        height: String(localUnitsToMeters(g.height)),
      }));
    } else if (t.shapeType === "circle") {
      const g = t.geometry as CircleGeometry;
      setDimensionsInput((d) => ({ ...d, radius: String(localUnitsToMeters(g.radius)) }));
    }
  }

  // Seeds a positioned, draggable draft at canvas center — dimensions
  // are typed in meters (or local units, if the Plot isn't calibrated
  // yet) and converted once here, not re-converted on every drag.
  function placeDraftShape() {
    const cx = VB_WIDTH / 2;
    const cy = VB_HEIGHT / 2;
    if (draftShapeType === "rectangle") {
      setDraftGeometry({
        x: cx,
        y: cy,
        width: metersToLocalUnits(Number(dimensionsInput.width) || 1),
        height: metersToLocalUnits(Number(dimensionsInput.height) || 1),
        rotation: 0,
      });
    } else if (draftShapeType === "circle") {
      setDraftGeometry({ x: cx, y: cy, radius: metersToLocalUnits(Number(dimensionsInput.radius) || 1) });
    }
  }

  function onPlacementCanvasClick(e: React.MouseEvent<SVGSVGElement>) {
    if (draftShapeType === "polygon" || draftShapeType === "line") {
      setDraftPoints([...draftPoints, clientPointToLocal(e)]);
    }
  }

  function onDraftBodyPointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    bodyDragging.current = true;
  }

  function onRotateHandlePointerDown(e: React.PointerEvent) {
    e.stopPropagation();
    rotateDragging.current = true;
  }

  function onPlacementPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!draftGeometry) return;
    const p = clientPointToLocal(e);
    if (bodyDragging.current) {
      setDraftGeometry({ ...draftGeometry, x: p.x, y: p.y });
    } else if (rotateDragging.current && "width" in draftGeometry) {
      // Inverse of rectangleCorners' rotation: the handle sits straight
      // up from center when rotation=0, so the dragged offset's angle
      // (measured the same way rectangleCorners' forward rotation
      // would place it) *is* the new rotation, no further solving
      // needed — see geometry.ts's schema comment on why rotation only
      // applies to rectangle.
      const dx = p.x - draftGeometry.x;
      const dy = p.y - draftGeometry.y;
      const rotation = (Math.atan2(dx, -dy) * 180) / Math.PI;
      setDraftGeometry({ ...draftGeometry, rotation });
    }
  }

  function onPlacementPointerUp() {
    bodyDragging.current = false;
    rotateDragging.current = false;
  }

  function currentDraftGeometry(): PlacementGeometry | null {
    if (draftShapeType === "polygon" || draftShapeType === "line") {
      return draftPoints.length > 0 ? { points: draftPoints } : null;
    }
    return draftGeometry;
  }

  async function saveNewPlacement() {
    if (!plotRow) return;
    const geometry = currentDraftGeometry();
    if (!geometry) return;
    try {
      const res = await fetch("/api/spatial-planning/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plotId: plotRow.id,
          shapeType: draftShapeType,
          geometry,
          label: placementFields.label,
          category: placementFields.category,
          linkedTaskId: placementFields.linkedTaskId || null,
          memberIds: placementFields.memberIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save Placement");
      setPlacements([...placements, data.placement]);
      setMode("view");
      setDraftGeometry(null);
      setDraftPoints([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startEditingPlacement(p: PlacementRow) {
    setSelectedPlacementId(p.id);
    setDraftShapeType(p.shapeType);
    if (p.shapeType === "polygon" || p.shapeType === "line") {
      setDraftPoints((p.geometry as { points: Point[] }).points);
      setDraftGeometry(null);
    } else {
      setDraftGeometry(p.geometry as RectangleGeometry | CircleGeometry);
      setDraftPoints([]);
    }
    setPlacementFields({
      label: p.label,
      category: p.category,
      linkedTaskId: p.linkedTaskId ?? "",
      memberIds: [],
    });
    setMode("edit-placement");

    const res = await fetch(`/api/spatial-planning/placements/${p.id}`);
    const data = await res.json();
    if (res.ok) {
      setPlacementFields((f) => ({ ...f, memberIds: data.members.map((m: { memberId: string }) => m.memberId) }));
    }
  }

  async function saveEditedPlacement() {
    if (!selectedPlacementId) return;
    const geometry = currentDraftGeometry();
    try {
      const res = await fetch(`/api/spatial-planning/placements/${selectedPlacementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(geometry && { geometry }),
          label: placementFields.label,
          category: placementFields.category,
          linkedTaskId: placementFields.linkedTaskId || null,
          memberIds: placementFields.memberIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save Placement");
      setPlacements(placements.map((p) => (p.id === data.placement.id ? data.placement : p)));
      setMode("view");
      setSelectedPlacementId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deletePlacementHandler(id: string) {
    if (!confirm("Delete this Placement?")) return;
    const res = await fetch(`/api/spatial-planning/placements/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPlacements(placements.filter((p) => p.id !== id));
      setSelectedPlacementId(null);
      setMode("view");
    }
  }

  async function saveCurrentAsTemplate(placementId: string) {
    const name = prompt("Save this shape into the template library as:");
    if (!name) return;
    const res = await fetch(`/api/spatial-planning/placements/${placementId}/save-as-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (res.ok) setTemplates([...templates, data.template]);
  }

  // --- Export ---

  function exportImage() {
    if (!svgRef.current) return;
    const svgString = new XMLSerializer().serializeToString(svgRef.current);
    downloadBlob(`${plotRow?.name ?? "plot"}.svg`, svgString, "image/svg+xml");
  }

  function exportGeoJSON(scope: "plot" | "zone" | "placement") {
    if (!plotRow) return;
    const calibration = plotRow.scaleCalibration;
    if (scope === "zone" && selectedZone) {
      const feature = zoneToGeoJSONFeature(selectedZone, calibration);
      downloadBlob(`${selectedZone.name}.geojson`, JSON.stringify(feature, null, 2), "application/geo+json");
    } else if (scope === "placement" && selectedPlacement) {
      const feature = placementToGeoJSONFeature(selectedPlacement, calibration);
      downloadBlob(`${selectedPlacement.label}.geojson`, JSON.stringify(feature, null, 2), "application/geo+json");
    } else {
      // Whole-Plot scope: every Zone and every Placement in one
      // FeatureCollection — docs/development-plan.md's Phase 37
      // "extends Phase 36's export to include Placement as an export
      // scope."
      const collection = plotToGeoJSONFeatureCollection(zones, placements, calibration);
      downloadBlob(`${plotRow.name}.geojson`, JSON.stringify(collection, null, 2), "application/geo+json");
    }
  }

  // --- Live geometry for the polygon currently being drawn/edited ---

  function liveLabels(points: Point[]) {
    if (points.length < 3 || !plotRow?.scaleCalibration) return null;
    try {
      const areaSqm = polygonAreaSqm(points, plotRow.scaleCalibration);
      const lengths = edgeLengthsMeters(points, plotRow.scaleCalibration);
      const centroid = polygonCentroid(points);
      return { areaSqm, lengths, centroid };
    } catch {
      return null;
    }
  }

  // ==================================================================

  if (!plotRow) {
    return (
      <section style={{ marginTop: "1rem" }}>
        {cycleName && <p style={{ color: "#666" }}>Planning for: {cycleName}</p>}
        {!canEdit ? (
          <p style={{ color: "#666" }}>No Plot yet for this Cycle.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 480 }}>
            <p>No Plot yet for this Cycle — start one:</p>
            {error && <p style={{ color: "crimson" }}>{error}</p>}
            <label>
              Name
              <br />
              <input
                type="text"
                value={newPlotName}
                onChange={(e) => setNewPlotName(e.target.value)}
                placeholder="Main site"
                style={{ padding: "0.4rem", width: "100%" }}
              />
            </label>

            <fieldset>
              <legend>Import a base image</legend>
              <input type="file" accept="image/*" disabled={creating} onChange={handleImageUpload} />
            </fieldset>

            <fieldset>
              <legend>Import a vector/GeoJSON boundary</legend>
              <textarea
                rows={4}
                value={vectorText}
                onChange={(e) => setVectorText(e.target.value)}
                placeholder="Paste a GeoJSON Feature or FeatureCollection"
                style={{ padding: "0.4rem", width: "100%" }}
              />
              <button type="button" disabled={creating || !vectorText} onClick={handleVectorImport}>
                Import
              </button>
            </fieldset>

            <fieldset>
              <legend>Or draw from scratch</legend>
              <button type="button" disabled={creating} onClick={() => createPlot({})}>
                Start blank
              </button>
            </fieldset>

            {cloneCandidates.length > 0 && (
              <fieldset>
                <legend>Or clone a previous Cycle&rsquo;s Plot</legend>
                <select
                  value={cloneSourceCycleId}
                  onChange={(e) => setCloneSourceCycleId(e.target.value)}
                  style={{ padding: "0.4rem", width: "100%" }}
                >
                  <option value="">— choose a Cycle —</option>
                  {cloneCandidates.map((c) => (
                    <option key={c.cycleId} value={c.cycleId}>
                      {c.cycleName}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={creating || !cloneSourceCycleId} onClick={handleCloneCreate}>
                  Clone
                </button>
              </fieldset>
            )}
          </div>
        )}
      </section>
    );
  }

  const activePoints = mode === "draw-zone" ? drawPoints : mode === "edit-zone" ? editPoints : null;
  const labels = activePoints ? liveLabels(activePoints) : null;

  // A rectangle draft's live label reuses liveLabels exactly by
  // funneling its corners through the same polygon math — rotation
  // never changes area, so this is correct with no special-casing. A
  // circle draft gets just an area label (no per-edge lengths to show).
  const isPlacementDrawMode = mode === "draw-placement" || mode === "edit-placement";
  const placementDraftPoints =
    isPlacementDrawMode && draftGeometry && "width" in draftGeometry ? rectangleCorners(draftGeometry) : null;
  const placementLabels = placementDraftPoints ? liveLabels(placementDraftPoints) : null;
  const circleDraftAreaSqm =
    isPlacementDrawMode && draftGeometry && "radius" in draftGeometry && plotRow?.scaleCalibration
      ? (() => {
          try {
            return placementAreaSqm("circle", draftGeometry, plotRow.scaleCalibration);
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <section style={{ marginTop: "1rem", display: "flex", gap: "1.5rem" }}>
      <div>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          {plotRow.name}
          {cycleName && ` · ${cycleName}`}
          {!plotRow.scaleCalibration && " · not calibrated yet"}
          {isGeoAnchored(plotRow.scaleCalibration) && " · geo-anchored"}
        </p>

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          style={{ width: "100%", maxWidth: 800, border: "1px solid #ccc", background: "#f7f7f5", touchAction: "none" }}
          onClick={
            mode === "calibrate"
              ? onCalibrateClick
              : mode === "draw-zone"
                ? onDrawClick
                : isPlacementDrawMode
                  ? onPlacementCanvasClick
                  : undefined
          }
          onPointerMove={
            mode === "edit-zone" ? onEditPointerMove : isPlacementDrawMode ? onPlacementPointerMove : undefined
          }
          onPointerUp={
            mode === "edit-zone" ? onEditPointerUp : isPlacementDrawMode ? onPlacementPointerUp : undefined
          }
        >
          {plotRow.baseImageUrl && (
            <image href={plotRow.baseImageUrl} x={0} y={0} width={VB_WIDTH} height={VB_HEIGHT} preserveAspectRatio="none" />
          )}
          {!plotRow.baseImageUrl &&
            extractVectorRings(plotRow.baseVector).map((ring, i) => (
              <polygon key={i} points={polygonToSvgPoints(ring)} fill="none" stroke="#888" strokeWidth={2} />
            ))}

          {visibleZones.map((z) => (
            <polygon
              key={z.id}
              points={polygonToSvgPoints(z.polygon)}
              fill={z.color}
              fillOpacity={z.id === selectedZoneId ? 0.6 : 0.35}
              stroke={z.color}
              strokeWidth={z.id === selectedZoneId ? 3 : 1.5}
              onClick={(e) => {
                e.stopPropagation();
                if (mode === "view") setSelectedZoneId(z.id === selectedZoneId ? null : z.id);
              }}
              style={{ cursor: mode === "view" ? "pointer" : "default" }}
            />
          ))}

          {visiblePlacements.map((p) => {
            const color = PLACEMENT_CATEGORY_COLOR[p.category] ?? PLACEMENT_CATEGORY_COLOR.generic;
            const selected = p.id === selectedPlacementId;
            const commonProps = {
              fillOpacity: selected ? 0.7 : 0.45,
              stroke: color,
              strokeWidth: selected ? 3 : 1.5,
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                if (mode === "view") setSelectedPlacementId(p.id === selectedPlacementId ? null : p.id);
              },
              style: { cursor: mode === "view" ? "pointer" : "default" },
            };
            if (p.shapeType === "circle") {
              const g = p.geometry as CircleGeometry;
              return <circle key={p.id} cx={g.x} cy={g.y} r={g.radius} fill={color} {...commonProps} />;
            }
            const points = placementFootprint(p.shapeType, p.geometry)!;
            return p.shapeType === "line" ? (
              <polyline key={p.id} points={polygonToSvgPoints(points)} fill="none" {...commonProps} />
            ) : (
              <polygon key={p.id} points={polygonToSvgPoints(points)} fill={color} {...commonProps} />
            );
          })}

          {mode === "calibrate" &&
            calPoints.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={6} fill="none" stroke="#cc00cc" strokeWidth={2} />
                <text x={p.x + 8} y={p.y - 8} fontSize={12} fill="#cc00cc">
                  {i === 0 ? "A" : "B"}
                </text>
              </g>
            ))}

          {mode === "draw-zone" && (
            <>
              <polyline
                points={polygonToSvgPoints(drawPoints)}
                fill="none"
                stroke={newZoneFields.color}
                strokeWidth={2}
              />
              {drawPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4} fill={newZoneFields.color} />
              ))}
            </>
          )}

          {mode === "edit-zone" && (
            <>
              <polygon
                points={polygonToSvgPoints(editPoints)}
                fill={selectedZone?.color}
                fillOpacity={0.35}
                stroke={selectedZone?.color}
                strokeWidth={2}
              />
              {editPoints.map((p, i) => {
                const next = editPoints[(i + 1) % editPoints.length];
                const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
                return (
                  <g key={i}>
                    <circle
                      cx={mid.x}
                      cy={mid.y}
                      r={4}
                      fill="#fff"
                      stroke="#888"
                      strokeWidth={1}
                      style={{ cursor: "copy" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        insertVertexAt(i);
                      }}
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={6}
                      fill={selectedVertex === i ? "#ff2222" : "#fff"}
                      stroke="#333"
                      strokeWidth={2}
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => onVertexPointerDown(i, e)}
                    />
                  </g>
                );
              })}
            </>
          )}

          {isPlacementDrawMode && draftShapeType === "rectangle" && draftGeometry && "width" in draftGeometry && (
            <g>
              <polygon
                points={polygonToSvgPoints(rectangleCorners(draftGeometry))}
                fill={PLACEMENT_CATEGORY_COLOR[placementFields.category] ?? PLACEMENT_CATEGORY_COLOR.generic}
                fillOpacity={0.5}
                stroke="#222"
                strokeWidth={2}
                style={{ cursor: "grab" }}
                onPointerDown={onDraftBodyPointerDown}
              />
              {/* Rotation handle — sits a fixed distance "above" the
                  rectangle's own top edge, rotated along with it, so it
                  stays visually attached as the shape turns. Dragging it
                  sets rotation directly (see onPlacementPointerMove). */}
              {(() => {
                const handleDistance = draftGeometry.height / 2 + 30;
                const rad = (draftGeometry.rotation * Math.PI) / 180;
                const hx = draftGeometry.x + -handleDistance * Math.sin(rad);
                const hy = draftGeometry.y + -handleDistance * Math.cos(rad);
                return (
                  <>
                    <line x1={draftGeometry.x} y1={draftGeometry.y} x2={hx} y2={hy} stroke="#222" strokeWidth={1} />
                    <circle
                      cx={hx}
                      cy={hy}
                      r={7}
                      fill="#fff"
                      stroke="#222"
                      strokeWidth={2}
                      style={{ cursor: "alias" }}
                      onPointerDown={onRotateHandlePointerDown}
                    />
                  </>
                );
              })()}
            </g>
          )}

          {isPlacementDrawMode && draftShapeType === "circle" && draftGeometry && "radius" in draftGeometry && (
            <circle
              cx={draftGeometry.x}
              cy={draftGeometry.y}
              r={draftGeometry.radius}
              fill={PLACEMENT_CATEGORY_COLOR[placementFields.category] ?? PLACEMENT_CATEGORY_COLOR.generic}
              fillOpacity={0.5}
              stroke="#222"
              strokeWidth={2}
              style={{ cursor: "grab" }}
              onPointerDown={onDraftBodyPointerDown}
            />
          )}

          {isPlacementDrawMode && (draftShapeType === "polygon" || draftShapeType === "line") && (
            <>
              <polyline
                points={polygonToSvgPoints(draftPoints)}
                fill="none"
                stroke={PLACEMENT_CATEGORY_COLOR[placementFields.category] ?? PLACEMENT_CATEGORY_COLOR.generic}
                strokeWidth={2}
              />
              {draftPoints.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  fill={PLACEMENT_CATEGORY_COLOR[placementFields.category] ?? PLACEMENT_CATEGORY_COLOR.generic}
                />
              ))}
            </>
          )}

          {placementLabels && (
            <text
              x={placementLabels.centroid.x}
              y={placementLabels.centroid.y}
              fontSize={13}
              textAnchor="middle"
              fill="#222"
            >
              {Math.round(placementLabels.areaSqm).toLocaleString()} m²
            </text>
          )}
          {circleDraftAreaSqm != null && draftGeometry && (
            <text x={draftGeometry.x} y={draftGeometry.y} fontSize={13} textAnchor="middle" fill="#222">
              {Math.round(circleDraftAreaSqm).toLocaleString()} m²
            </text>
          )}

          {labels && (
            <>
              <text x={labels.centroid.x} y={labels.centroid.y} fontSize={13} textAnchor="middle" fill="#222">
                {Math.round(labels.areaSqm).toLocaleString()} m²
              </text>
              {activePoints!.map((p, i) => {
                const next = activePoints![(i + 1) % activePoints!.length];
                const mid = { x: (p.x + next.x) / 2, y: (p.y + next.y) / 2 };
                return (
                  <text key={i} x={mid.x} y={mid.y} fontSize={11} textAnchor="middle" fill="#555">
                    {Math.round(labels.lengths[i])} m
                  </text>
                );
              })}
            </>
          )}
        </svg>

        {mode === "calibrate" && (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 400 }}>
            <p style={{ fontSize: "0.85rem", color: "#666" }}>
              Click two points on the plan ({calPoints.length}/2 placed).
            </p>
            {calPoints.length === 2 && (
              <>
                <label>
                  <input type="checkbox" checked={calUseGps} onChange={(e) => setCalUseGps(e.target.checked)} />{" "}
                  Use GPS coordinates instead of a distance (geo-anchors this Plot)
                </label>
                {!calUseGps ? (
                  <label>
                    Real-world distance between A and B (meters)
                    <br />
                    <input
                      type="number"
                      value={calDistance}
                      onChange={(e) => setCalDistance(e.target.value)}
                      style={{ padding: "0.4rem", width: "100%" }}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      Point A lat/lng
                      <br />
                      <input
                        type="text"
                        placeholder="lat"
                        value={calLatLng.latA}
                        onChange={(e) => setCalLatLng({ ...calLatLng, latA: e.target.value })}
                        style={{ padding: "0.4rem", width: "48%", marginRight: "2%" }}
                      />
                      <input
                        type="text"
                        placeholder="lng"
                        value={calLatLng.lngA}
                        onChange={(e) => setCalLatLng({ ...calLatLng, lngA: e.target.value })}
                        style={{ padding: "0.4rem", width: "48%" }}
                      />
                    </label>
                    <label>
                      Point B lat/lng
                      <br />
                      <input
                        type="text"
                        placeholder="lat"
                        value={calLatLng.latB}
                        onChange={(e) => setCalLatLng({ ...calLatLng, latB: e.target.value })}
                        style={{ padding: "0.4rem", width: "48%", marginRight: "2%" }}
                      />
                      <input
                        type="text"
                        placeholder="lng"
                        value={calLatLng.lngB}
                        onChange={(e) => setCalLatLng({ ...calLatLng, lngB: e.target.value })}
                        style={{ padding: "0.4rem", width: "48%" }}
                      />
                    </label>
                  </>
                )}
                <button type="button" onClick={saveCalibration}>
                  Save calibration
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setMode("view");
                setCalPoints([]);
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {mode === "draw-zone" && (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 400 }}>
            <p style={{ fontSize: "0.85rem", color: "#666" }}>
              Click to add points ({drawPoints.length} so far). Needs at least 3.
            </p>
            <input
              type="text"
              placeholder="Name"
              value={newZoneFields.name}
              onChange={(e) => setNewZoneFields({ ...newZoneFields, name: e.target.value })}
              style={{ padding: "0.4rem" }}
            />
            <input
              type="text"
              placeholder="Category (e.g. kitchen, quiet zone)"
              value={newZoneFields.category}
              onChange={(e) => setNewZoneFields({ ...newZoneFields, category: e.target.value })}
              style={{ padding: "0.4rem" }}
            />
            <input
              type="color"
              value={newZoneFields.color}
              onChange={(e) => setNewZoneFields({ ...newZoneFields, color: e.target.value })}
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                disabled={drawPoints.length < 3 || !newZoneFields.name || !newZoneFields.category}
                onClick={saveNewZone}
              >
                Save Zone
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("view");
                  setDrawPoints([]);
                }}
              >
                Cancel
              </button>
              {drawPoints.length > 0 && (
                <button type="button" onClick={() => setDrawPoints(drawPoints.slice(0, -1))}>
                  Undo last point
                </button>
              )}
            </div>
          </div>
        )}

        {mode === "edit-zone" && (
          <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={saveEditedZone}>
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("view");
                setSelectedVertex(null);
              }}
            >
              Cancel
            </button>
            <button type="button" disabled={selectedVertex === null || editPoints.length <= 3} onClick={deleteSelectedVertex}>
              Delete selected point
            </button>
            <span style={{ fontSize: "0.8rem", color: "#666" }}>
              Drag a point to move it, click a small circle on an edge to add a point there.
            </span>
          </div>
        )}

        {(mode === "draw-placement" || mode === "edit-placement") && (
          <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 420 }}>
            {mode === "draw-placement" && !draftGeometry && draftPoints.length === 0 && (
              <>
                {templates.length > 0 && (
                  <label>
                    Start from a saved shape
                    <br />
                    <select
                      value={templateId}
                      onChange={(e) => applyTemplateSelection(e.target.value)}
                      style={{ padding: "0.4rem", width: "100%" }}
                    >
                      <option value="">— none —</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.shapeType})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Shape
                  <br />
                  <select
                    value={draftShapeType}
                    onChange={(e) => setDraftShapeType(e.target.value as PlacementShapeType)}
                    style={{ padding: "0.4rem", width: "100%" }}
                  >
                    <option value="rectangle">Rectangle (tent, vehicle, structure footprint)</option>
                    <option value="circle">Circle</option>
                    <option value="polygon">Polygon (drawn by hand)</option>
                    <option value="line">Line (drawn by hand)</option>
                  </select>
                </label>
                {draftShapeType === "rectangle" && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <label>
                      Width ({plotRow.scaleCalibration ? "m" : "units"})
                      <br />
                      <input
                        type="number"
                        value={dimensionsInput.width}
                        onChange={(e) => setDimensionsInput({ ...dimensionsInput, width: e.target.value })}
                        style={{ padding: "0.4rem", width: "6rem" }}
                      />
                    </label>
                    <label>
                      Height ({plotRow.scaleCalibration ? "m" : "units"})
                      <br />
                      <input
                        type="number"
                        value={dimensionsInput.height}
                        onChange={(e) => setDimensionsInput({ ...dimensionsInput, height: e.target.value })}
                        style={{ padding: "0.4rem", width: "6rem" }}
                      />
                    </label>
                  </div>
                )}
                {draftShapeType === "circle" && (
                  <label>
                    Radius ({plotRow.scaleCalibration ? "m" : "units"})
                    <br />
                    <input
                      type="number"
                      value={dimensionsInput.radius}
                      onChange={(e) => setDimensionsInput({ ...dimensionsInput, radius: e.target.value })}
                      style={{ padding: "0.4rem", width: "6rem" }}
                    />
                  </label>
                )}
                {(draftShapeType === "rectangle" || draftShapeType === "circle") && (
                  <button type="button" onClick={placeDraftShape}>
                    Place on the plan
                  </button>
                )}
                {(draftShapeType === "polygon" || draftShapeType === "line") && (
                  <p style={{ fontSize: "0.85rem", color: "#666" }}>
                    Click on the plan to add points ({draftPoints.length} so far,{" "}
                    {draftShapeType === "polygon" ? "at least 3" : "at least 2"} needed).
                  </p>
                )}
              </>
            )}

            {(draftGeometry || draftPoints.length > 0) && (
              <>
                {(draftShapeType === "rectangle" || draftShapeType === "circle") && (
                  <p style={{ fontSize: "0.8rem", color: "#666" }}>
                    Drag the shape to reposition it{draftShapeType === "rectangle" && "; drag the small handle to rotate it"}.
                  </p>
                )}
                <input
                  type="text"
                  placeholder="Label"
                  value={placementFields.label}
                  onChange={(e) => setPlacementFields({ ...placementFields, label: e.target.value })}
                  style={{ padding: "0.4rem" }}
                />
                <select
                  value={placementFields.category}
                  onChange={(e) => setPlacementFields({ ...placementFields, category: e.target.value })}
                  style={{ padding: "0.4rem" }}
                >
                  {PLACEMENT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <label>
                  Linked Task ID (optional)
                  <br />
                  <input
                    type="text"
                    placeholder="paste the task's ID from its /tasks/… URL"
                    value={placementFields.linkedTaskId}
                    onChange={(e) => setPlacementFields({ ...placementFields, linkedTaskId: e.target.value })}
                    style={{ padding: "0.4rem", width: "100%" }}
                  />
                </label>
                {communityMembers.length > 0 && (
                  <fieldset>
                    <legend>Linked Members</legend>
                    {communityMembers.map((m) => (
                      <label key={m.id} style={{ display: "block", fontSize: "0.85rem" }}>
                        <input
                          type="checkbox"
                          checked={placementFields.memberIds.includes(m.id)}
                          onChange={() =>
                            setPlacementFields((f) => ({
                              ...f,
                              memberIds: f.memberIds.includes(m.id)
                                ? f.memberIds.filter((id) => id !== m.id)
                                : [...f.memberIds, m.id],
                            }))
                          }
                        />{" "}
                        {m.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    disabled={!placementFields.label}
                    onClick={mode === "draw-placement" ? saveNewPlacement : saveEditedPlacement}
                  >
                    Save Placement
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("view");
                      setDraftGeometry(null);
                      setDraftPoints([]);
                      setSelectedPlacementId(null);
                    }}
                  >
                    Cancel
                  </button>
                  {draftPoints.length > 0 && (
                    <button type="button" onClick={() => setDraftPoints(draftPoints.slice(0, -1))}>
                      Undo last point
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {mode === "view" && (
          <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {canEdit && (
              <button type="button" onClick={() => setMode("calibrate")}>
                {plotRow.scaleCalibration ? "Recalibrate" : "Calibrate scale"}
              </button>
            )}
            {canEdit && (
              <button type="button" disabled={!plotRow.scaleCalibration && false} onClick={() => setMode("draw-zone")}>
                Add Zone
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={startNewPlacement}>
                Add Placement
              </button>
            )}
            <button type="button" onClick={exportImage}>
              Export as image
            </button>
            <button type="button" onClick={() => exportGeoJSON("plot")}>
              Export whole Plot as GeoJSON
            </button>
            {selectedZone && (
              <button type="button" onClick={() => exportGeoJSON("zone")}>
                Export &ldquo;{selectedZone.name}&rdquo; as GeoJSON
              </button>
            )}
            {selectedPlacement && (
              <button type="button" onClick={() => exportGeoJSON("placement")}>
                Export &ldquo;{selectedPlacement.label}&rdquo; as GeoJSON
              </button>
            )}
            {selectedPlacement && canEdit && (
              <button type="button" onClick={() => saveCurrentAsTemplate(selectedPlacement.id)}>
                Save shape as template
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ minWidth: 220 }}>
        {categories.length > 0 && (
          <fieldset style={{ marginBottom: "1rem" }}>
            <legend>Layers</legend>
            {categories.map((c) => (
              <label key={c} style={{ display: "block", fontSize: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={!hiddenCategories.has(c)}
                  onChange={() =>
                    setHiddenCategories((prev) => {
                      const next = new Set(prev);
                      if (next.has(c)) next.delete(c);
                      else next.add(c);
                      return next;
                    })
                  }
                />{" "}
                {c}
              </label>
            ))}
          </fieldset>
        )}

        <h3 style={{ fontSize: "1rem" }}>Zones</h3>
        {zones.length === 0 && <p style={{ color: "#666", fontSize: "0.85rem" }}>None yet.</p>}
        {zones.map((z) => (
          <div
            key={z.id}
            style={{
              padding: "0.4rem",
              marginBottom: "0.3rem",
              border: z.id === selectedZoneId ? "2px solid #333" : "1px solid #ddd",
              fontSize: "0.85rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ width: 10, height: 10, background: z.color, display: "inline-block" }} />
              <strong>{z.name}</strong>
              <span style={{ color: "#666" }}>({z.category})</span>
            </div>
            {plotRow.scaleCalibration && (
              <div style={{ color: "#666" }}>
                {Math.round(polygonAreaSqm(z.polygon, plotRow.scaleCalibration)).toLocaleString()} m²
              </div>
            )}
            {canEdit && mode === "view" && (
              <div style={{ marginTop: "0.2rem", display: "flex", gap: "0.4rem" }}>
                <button type="button" onClick={() => startEditingZone(z)}>
                  Edit
                </button>
                <button type="button" onClick={() => deleteZone(z.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}

        <h3 style={{ fontSize: "1rem", marginTop: "1rem" }}>Placements</h3>
        {placements.length === 0 && <p style={{ color: "#666", fontSize: "0.85rem" }}>None yet.</p>}
        {placements.map((p) => (
          <div
            key={p.id}
            style={{
              padding: "0.4rem",
              marginBottom: "0.3rem",
              border: p.id === selectedPlacementId ? "2px solid #333" : "1px solid #ddd",
              fontSize: "0.85rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: PLACEMENT_CATEGORY_COLOR[p.category] ?? PLACEMENT_CATEGORY_COLOR.generic,
                  display: "inline-block",
                }}
              />
              <strong>{p.label}</strong>
              <span style={{ color: "#666" }}>
                ({p.category} · {p.shapeType})
              </span>
            </div>
            {plotRow.scaleCalibration && (
              <div style={{ color: "#666" }}>
                {Math.round(placementAreaSqm(p.shapeType, p.geometry, plotRow.scaleCalibration)).toLocaleString()} m²
              </div>
            )}
            {canEdit && mode === "view" && (
              <div style={{ marginTop: "0.2rem", display: "flex", gap: "0.4rem" }}>
                <button type="button" onClick={() => startEditingPlacement(p)}>
                  Edit
                </button>
                <button type="button" onClick={() => deletePlacementHandler(p.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
