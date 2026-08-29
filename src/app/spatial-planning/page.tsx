import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getCurrentCycle } from "@/lib/profile-questions";
import {
  getMySpacePreference,
  getPlotForCycle,
  isSpatialPlanningHolder,
  listCyclesWithPlot,
  listPlacementTemplates,
  listPlacements,
  listSpacePreferences,
  listZones,
} from "@/lib/spatial-planning";
import Nav from "@/components/Nav";
import PlotEditor from "./PlotEditor";
import { upsertSpacePreferenceAction } from "./actions";
import type { Point, PlacementGeometry, ScaleCalibration } from "@/lib/spatial-planning/geometry";

export const dynamic = "force-dynamic";

const SLEEP_ARRANGEMENTS = [
  { value: "solo_tent", label: "Solo tent" },
  { value: "shared_tent", label: "Shared tent" },
  { value: "solo_vehicle", label: "Solo vehicle" },
  { value: "shared_vehicle", label: "Shared vehicle" },
  { value: "other", label: "Other" },
];

// See docs/spec.md's "Spatial planning" and docs/development-plan.md's
// Phase 36-37 — the base site (Plot), its organizational regions
// (Zone), the things drawn on it (Placement, PlacementTemplate), and
// the profile data that informs planning them (SpacePreference). The
// propose→pending→approve editing-rights layer (Phase 38) isn't built
// yet.
export default async function SpatialPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;
  const communityRow = await getCommunity(currentMember);
  const moduleOn = isModuleEnabled(communityRow, "spatial_planning");

  const currentCycle = moduleOn ? await getCurrentCycle(currentMember.communityId) : null;
  const cycleId = currentCycle?.id ?? null;

  const plotRow = moduleOn ? await getPlotForCycle(currentMember, cycleId) : null;
  const [zones, placements, templates, canEdit, cloneCandidates, communityMembers, mySpacePreference] =
    await Promise.all([
      plotRow ? listZones(currentMember, plotRow.id) : Promise.resolve([]),
      plotRow ? listPlacements(currentMember, plotRow.id) : Promise.resolve([]),
      moduleOn ? listPlacementTemplates(currentMember) : Promise.resolve([]),
      moduleOn ? isSpatialPlanningHolder(currentMember, communityRow) : Promise.resolve(false),
      // Cloning needs a real Cycle to clone *from* and *into* — nothing to
      // offer for a Community that never turned Cycles on, or once this
      // Cycle already has its own Plot.
      moduleOn && currentCycle && !plotRow
        ? listCyclesWithPlot(currentMember, currentCycle.id)
        : Promise.resolve([]),
      moduleOn
        ? db.select({ id: member.id, name: member.name }).from(member).where(eq(member.communityId, currentMember.communityId))
        : Promise.resolve([]),
      moduleOn ? getMySpacePreference(currentMember) : Promise.resolve(null),
    ]);

  const everyonesSpacePreferences =
    moduleOn && canEdit ? await listSpacePreferences(currentMember) : [];
  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 1100 }}>
      <Nav memberName={currentMember.name} />
      <h1>Spatial planning</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && !communityRow.spatialPlanningTaskId && (
        <p style={{ color: "#666" }}>
          No Spatial-planning task designated yet — anyone can view once a Plot exists, but nobody
          can draw or edit until a current Admins holder sets one under Settings.
        </p>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {moduleOn && (
        <PlotEditor
          cycleId={cycleId}
          cycleName={currentCycle?.name ?? null}
          plot={
            plotRow && {
              ...plotRow,
              scaleCalibration: plotRow.scaleCalibration as ScaleCalibration | null,
            }
          }
          initialZones={zones.map((z) => ({ ...z, polygon: z.polygon as Point[] }))}
          initialPlacements={placements.map((p) => ({ ...p, geometry: p.geometry as PlacementGeometry }))}
          initialTemplates={templates.map((t) => ({ ...t, geometry: t.geometry as PlacementGeometry }))}
          communityMembers={communityMembers}
          canEdit={canEdit}
          cloneCandidates={cloneCandidates.map((c) => ({
            cycleId: c.cycleId!,
            cycleName: c.cycleName,
          }))}
        />
      )}

      {moduleOn && (
        <section style={{ marginTop: "2rem", maxWidth: 500 }}>
          <h2>Your Space preferences</h2>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Feeds the layout conversation — informs sizing and grouping, never auto-places you.
          </p>
          <form
            action={upsertSpacePreferenceAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
          >
            <label>
              Sleep/space arrangement
              <br />
              <select
                name="sleepArrangement"
                defaultValue={mySpacePreference?.sleepArrangement ?? "solo_tent"}
                style={{ padding: "0.4rem", width: "100%" }}
              >
                {SLEEP_ARRANGEMENTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <label>
                Vehicle length (m)
                <br />
                <input
                  type="number"
                  name="vehicleLength"
                  defaultValue={
                    (mySpacePreference?.vehicleDimensions as { length: number } | null)?.length ?? ""
                  }
                  style={{ padding: "0.4rem", width: "6rem" }}
                />
              </label>
              <label>
                Width (m)
                <br />
                <input
                  type="number"
                  name="vehicleWidth"
                  defaultValue={
                    (mySpacePreference?.vehicleDimensions as { width: number } | null)?.width ?? ""
                  }
                  style={{ padding: "0.4rem", width: "6rem" }}
                />
              </label>
              <label>
                Height (m)
                <br />
                <input
                  type="number"
                  name="vehicleHeight"
                  defaultValue={
                    (mySpacePreference?.vehicleDimensions as { height: number } | null)?.height ?? ""
                  }
                  style={{ padding: "0.4rem", width: "6rem" }}
                />
              </label>
            </div>

            <label>
              Prefer to be placed near (comma-separated Member IDs)
              <br />
              <input
                type="text"
                name="groupWith"
                defaultValue={mySpacePreference?.groupWith?.join(", ") ?? ""}
                style={{ padding: "0.4rem", width: "100%" }}
              />
            </label>

            <label>
              Sharing this space with (comma-separated Member IDs)
              <br />
              <input
                type="text"
                name="sharingWith"
                defaultValue={mySpacePreference?.sharingWith?.join(", ") ?? ""}
                style={{ padding: "0.4rem", width: "100%" }}
              />
              <br />
              <span style={{ fontSize: "0.8rem", color: "#666" }}>
                A different question from proximity above — who you expect to actually occupy the
                same tent/vehicle with.
              </span>
            </label>

            <label>
              Accessibility notes
              <br />
              <textarea
                name="accessibilityNotes"
                rows={2}
                defaultValue={mySpacePreference?.accessibilityNotes ?? ""}
                style={{ padding: "0.4rem", width: "100%" }}
              />
            </label>

            <button type="submit" style={{ width: "fit-content", padding: "0.4rem 0.8rem" }}>
              Save
            </button>
          </form>

          {canEdit && (
            <div style={{ marginTop: "1.5rem" }}>
              <h3 style={{ fontSize: "1rem" }}>Everyone&rsquo;s Space preferences</h3>
              {everyonesSpacePreferences.length === 0 && (
                <p style={{ color: "#666", fontSize: "0.85rem" }}>Nobody has set theirs yet.</p>
              )}
              {everyonesSpacePreferences.map((row) => (
                <div key={row.preference.memberId} style={{ fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                  <strong>{memberNameById.get(row.preference.memberId) ?? row.memberName}</strong>
                  {" — "}
                  {SLEEP_ARRANGEMENTS.find((o) => o.value === row.preference.sleepArrangement)?.label}
                  {row.preference.accessibilityNotes && ` · ${row.preference.accessibilityNotes}`}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
