"use client";

import { useMemo, useRef, useState } from "react";
import {
  edgeLengthsMeters,
  isGeoAnchored,
  polygonAreaSqm,
  polygonCentroid,
  type Point,
  type ScaleCalibration,
} from "@/lib/spatial-planning/geometry";
import { zoneToGeoJSONFeature, zonesToGeoJSONFeatureCollection } from "@/lib/spatial-planning/export";

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

type Mode = "view" | "calibrate" | "draw-zone" | "edit-zone";

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
  canEdit,
  cloneCandidates,
}: {
  cycleId: string | null;
  cycleName: string | null;
  plot: PlotRow | null;
  initialZones: ZoneRow[];
  canEdit: boolean;
  cloneCandidates: { cycleId: string; cycleName: string }[];
}) {
  const [plotRow, setPlotRow] = useState(plot);
  const [zones, setZones] = useState(initialZones);
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

  const selectedZone = zones.find((z) => z.id === selectedZoneId) ?? null;
  const categories = useMemo(() => [...new Set(zones.map((z) => z.category))], [zones]);
  const visibleZones = zones.filter((z) => mode !== "edit-zone" || z.id !== selectedZoneId).filter(
    (z) => !hiddenCategories.has(z.category),
  );

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
      await refreshZones(data.plot.id);
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

  // --- Export ---

  function exportImage() {
    if (!svgRef.current) return;
    const svgString = new XMLSerializer().serializeToString(svgRef.current);
    downloadBlob(`${plotRow?.name ?? "plot"}.svg`, svgString, "image/svg+xml");
  }

  function exportGeoJSON(scope: "plot" | "zone") {
    if (!plotRow) return;
    const calibration = plotRow.scaleCalibration;
    if (scope === "zone" && selectedZone) {
      const feature = zoneToGeoJSONFeature(selectedZone, calibration);
      downloadBlob(`${selectedZone.name}.geojson`, JSON.stringify(feature, null, 2), "application/geo+json");
    } else {
      const collection = zonesToGeoJSONFeatureCollection(zones, calibration);
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
          onClick={mode === "calibrate" ? onCalibrateClick : mode === "draw-zone" ? onDrawClick : undefined}
          onPointerMove={mode === "edit-zone" ? onEditPointerMove : undefined}
          onPointerUp={mode === "edit-zone" ? onEditPointerUp : undefined}
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
      </div>
    </section>
  );
}
