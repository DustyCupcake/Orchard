import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getCurrentCycle } from "@/lib/profile-questions";
import {
  getPlotForCycle,
  isSpatialPlanningHolder,
  listCyclesWithPlot,
  listZones,
} from "@/lib/spatial-planning";
import Nav from "@/components/Nav";
import PlotEditor from "./PlotEditor";
import type { Point, ScaleCalibration } from "@/lib/spatial-planning/geometry";

export const dynamic = "force-dynamic";

// See docs/spec.md's "Spatial planning" and docs/development-plan.md's
// Phase 36 — the base site (Plot) and its organizational regions
// (Zone). Placements (Phase 37) and the propose→pending→approve
// editing-rights layer (Phase 38) aren't built yet.
export default async function SpatialPlanningPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const communityRow = await getCommunity(currentMember);
  const moduleOn = isModuleEnabled(communityRow, "spatial_planning");

  const currentCycle = moduleOn ? await getCurrentCycle(currentMember.communityId) : null;
  const cycleId = currentCycle?.id ?? null;

  const plotRow = moduleOn ? await getPlotForCycle(currentMember, cycleId) : null;
  const [zones, canEdit, cloneCandidates] = await Promise.all([
    plotRow ? listZones(currentMember, plotRow.id) : Promise.resolve([]),
    moduleOn ? isSpatialPlanningHolder(currentMember, communityRow) : Promise.resolve(false),
    // Cloning needs a real Cycle to clone *from* and *into* — nothing to
    // offer for a Community that never turned Cycles on, or once this
    // Cycle already has its own Plot.
    moduleOn && currentCycle && !plotRow
      ? listCyclesWithPlot(currentMember, currentCycle.id)
      : Promise.resolve([]),
  ]);

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
          canEdit={canEdit}
          cloneCandidates={cloneCandidates.map((c) => ({
            cycleId: c.cycleId!,
            cycleName: c.cycleName,
          }))}
        />
      )}
    </main>
  );
}
