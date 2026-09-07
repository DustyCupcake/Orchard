import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { listGrantingTaskIds } from "@/lib/permissions";
import { resolveDefaultScopeSegment, resolveSingleCycleScope } from "@/lib/cycles";
import { switchToLinkedScopeAction } from "@/app/(app)/cycles/scope-actions";
import {
  getMySpacePreference,
  getPlotForCycle,
  isPlacementEditor,
  isSpatialPlanningHolder,
  listCyclesWithPlot,
  listMyPlacementInvites,
  listMyRevertNotices,
  listPlacementTemplates,
  listPlacements,
  listSpacePreferences,
  listZones,
} from "@/lib/spatial-planning";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL } from "@/components/ui/kit";
import PlotEditor from "./PlotEditor";
import {
  acceptPlacementInviteAction,
  acknowledgeRevertNoticeAction,
  declinePlacementInviteAction,
  upsertSpacePreferenceAction,
} from "./actions";
import type { Point, PlacementGeometry, ScaleCalibration } from "@/lib/spatial-planning/geometry";

export const dynamic = "force-dynamic";

const SLEEP_ARRANGEMENTS = [
  { value: "solo_tent", label: "Solo tent" },
  { value: "shared_tent", label: "Shared tent" },
  { value: "solo_vehicle", label: "Solo vehicle" },
  { value: "shared_vehicle", label: "Shared vehicle" },
  { value: "other", label: "Other" },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// See docs/spec.md's "Spatial planning" and docs/development-plan.md's
// Phase 36-38 — the base site (Plot), its organizational regions
// (Zone), the things drawn on it (Placement, PlacementTemplate), the
// profile data that informs planning them (SpacePreference), and the
// propose→pending→approve editing-rights layer (invites, revert
// notices, isPlacementEditor below).
export default async function SpatialPlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;
  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "spatial_planning");

  // Which cycle's Plot to show — the same off-URL resolution the board
  // and task detail page already read (docs/development-plan.md's
  // Phase 68), replacing the old community-wide getCurrentCycle()
  // heuristic. "ambiguous" (the switcher's aggregate state genuinely
  // covers 2+ open cycles this member is coming to) renders a real
  // "which cycle?" prompt rather than guessing, mirroring Budget's own
  // [cycleScope]/budget/page.tsx prompt shape — reusing its own
  // switchToLinkedScopeAction (Phase 66) to actually narrow the
  // switcher, since this page isn't itself under /[cycleScope]/.
  const scopeSegment = await resolveDefaultScopeSegment(viewing);
  const resolution = moduleOn ? await resolveSingleCycleScope(viewing, scopeSegment) : ({ kind: "none" } as const);

  if (moduleOn && resolution.kind === "ambiguous") {
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Spatial planning</h1>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">Scoped to multiple active cycles — pick one to see its layout:</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {resolution.candidates.map((c) => (
            <form key={c.id} action={switchToLinkedScopeAction}>
              <input type="hidden" name="scope" value={c.id} />
              <input type="hidden" name="returnTo" value="/spatial-planning" />
              <button type="submit" className={BUTTON_SECONDARY}>
                {c.name}
              </button>
            </form>
          ))}
        </div>
      </main>
    );
  }
  const currentCycle = resolution.kind === "resolved" ? resolution.cycle : null;
  const cycleId = currentCycle?.id ?? null;
  const spatialPlanningGrantingTaskIds = await listGrantingTaskIds(communityRow.id, "spatial_planning", cycleId);

  const plotRow = moduleOn ? await getPlotForCycle(viewing, cycleId) : null;
  const [zones, placements, templates, canEdit, cloneCandidates, communityMembers, mySpacePreference] =
    await Promise.all([
      plotRow ? listZones(viewing, plotRow.id) : Promise.resolve([]),
      plotRow ? listPlacements(viewing, plotRow.id) : Promise.resolve([]),
      moduleOn ? listPlacementTemplates(viewing) : Promise.resolve([]),
      moduleOn ? isSpatialPlanningHolder(viewing, communityRow, cycleId) : Promise.resolve(false),
      // Cloning needs a real Cycle to clone *from* and *into* — nothing to
      // offer for a Community that never turned Cycles on, or once this
      // Cycle already has its own Plot.
      moduleOn && currentCycle && !plotRow
        ? listCyclesWithPlot(viewing, currentCycle.id)
        : Promise.resolve([]),
      moduleOn
        ? db.select({ id: member.id, name: member.name }).from(member).where(eq(member.communityId, viewing.communityId))
        : Promise.resolve([]),
      moduleOn ? getMySpacePreference(viewing) : Promise.resolve(null),
    ]);

  const everyonesSpacePreferences =
    moduleOn && canEdit ? await listSpacePreferences(viewing) : [];
  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));

  // Phase 38: which of the current Plot's Placements this member can
  // self-service move (a confirmed Member link, or holding the linked
  // Task) — irrelevant for the holder, who can already edit everything.
  const myEditablePlacementIds =
    !canEdit && placements.length > 0
      ? (
          await Promise.all(
            placements.map(async (p) => ((await isPlacementEditor(viewing, p)) ? p.id : null)),
          )
        ).filter((id): id is string => id !== null)
      : [];

  const [myPlacementInvites, myRevertNotices] = moduleOn
    ? await Promise.all([listMyPlacementInvites(viewing), listMyRevertNotices(viewing)])
    : [[], []];

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Spatial planning</h1>

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && spatialPlanningGrantingTaskIds.length === 0 && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          No Spatial-planning task designated yet — anyone can view once a Plot exists, but nobody
          can draw or edit until a current Admins holder sets one under Settings.
        </p>
      )}

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {moduleOn && (
        <div className="mt-6">
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
            myEditablePlacementIds={myEditablePlacementIds}
            cloneCandidates={cloneCandidates.map((c) => ({
              cycleId: c.cycleId!,
              cycleName: c.cycleName,
            }))}
          />
        </div>
      )}

      {moduleOn && (myPlacementInvites.length > 0 || myRevertNotices.length > 0) && (
        <section className="mt-6 max-w-[500px]">
          {myPlacementInvites.length > 0 && (
            <>
              <SectionHeading>Placement invites</SectionHeading>
              <div className="mt-2 flex flex-col gap-2">
                {myPlacementInvites.map((invite) => (
                  <div key={invite.placementId} className="text-[13px] text-[var(--text)]">
                    <span className="font-medium">{invite.invitedByName}</span> named you on &ldquo;{invite.placementLabel}&rdquo;.
                    <form action={acceptPlacementInviteAction} className="ml-2 inline">
                      <input type="hidden" name="placementId" value={invite.placementId} />
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Accept
                      </button>
                    </form>{" "}
                    <form action={declinePlacementInviteAction} className="inline">
                      <input type="hidden" name="placementId" value={invite.placementId} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Decline
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </>
          )}

          {myRevertNotices.length > 0 && (
            <div className="mt-4">
              <SectionHeading>Reverted edits</SectionHeading>
              <div className="mt-2 flex flex-col gap-2">
                {myRevertNotices.map((n) => (
                  <div key={n.notice.id} className="text-[13px] text-[var(--text)]">
                    <span className="font-medium">{n.revertedByName}</span> reverted your change to &ldquo;{n.placementLabel}&rdquo;
                    {n.notice.note && <> — {n.notice.note}</>}.
                    <form action={acknowledgeRevertNoticeAction} className="ml-2 inline">
                      <input type="hidden" name="noticeId" value={n.notice.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        OK
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {moduleOn && (
        <section className="mt-8 max-w-[500px]">
          <SectionHeading>Your Space preferences</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Feeds the layout conversation — informs sizing and grouping, never auto-places you.
          </p>
          <form action={upsertSpacePreferenceAction} className="mt-3 flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Sleep/space arrangement</span>
              <select name="sleepArrangement" defaultValue={mySpacePreference?.sleepArrangement ?? "solo_tent"} className={INPUT}>
                {SLEEP_ARRANGEMENTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Vehicle length (m)</span>
                <input
                  type="number"
                  name="vehicleLength"
                  defaultValue={(mySpacePreference?.vehicleDimensions as { length: number } | null)?.length ?? ""}
                  className={`${INPUT} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Width (m)</span>
                <input
                  type="number"
                  name="vehicleWidth"
                  defaultValue={(mySpacePreference?.vehicleDimensions as { width: number } | null)?.width ?? ""}
                  className={`${INPUT} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Height (m)</span>
                <input
                  type="number"
                  name="vehicleHeight"
                  defaultValue={(mySpacePreference?.vehicleDimensions as { height: number } | null)?.height ?? ""}
                  className={`${INPUT} w-24`}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className={LABEL}>Prefer to be placed near (comma-separated Member IDs)</span>
              <input type="text" name="groupWith" defaultValue={mySpacePreference?.groupWith?.join(", ") ?? ""} className={INPUT} />
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL}>Sharing this space with (comma-separated Member IDs)</span>
              <input type="text" name="sharingWith" defaultValue={mySpacePreference?.sharingWith?.join(", ") ?? ""} className={INPUT} />
              <span className="text-[12px] text-[var(--text-muted)]">
                A different question from proximity above — who you expect to actually occupy the
                same tent/vehicle with.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL}>Accessibility notes</span>
              <textarea name="accessibilityNotes" rows={2} defaultValue={mySpacePreference?.accessibilityNotes ?? ""} className={INPUT} />
            </label>

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save
            </button>
          </form>

          {canEdit && (
            <div className="mt-6">
              <h3 className="text-[15px] font-medium text-[var(--text)]">Everyone&rsquo;s Space preferences</h3>
              {everyonesSpacePreferences.length === 0 && (
                <p className="mt-1 text-[13px] text-[var(--text-muted)]">Nobody has set theirs yet.</p>
              )}
              <div className="mt-1 flex flex-col gap-1">
                {everyonesSpacePreferences.map((row) => (
                  <p key={row.preference.memberId} className="text-[13px] text-[var(--text)]">
                    <span className="font-medium">{memberNameById.get(row.preference.memberId) ?? row.memberName}</span>
                    {" — "}
                    {SLEEP_ARRANGEMENTS.find((o) => o.value === row.preference.sleepArrangement)?.label}
                    {row.preference.accessibilityNotes && ` · ${row.preference.accessibilityNotes}`}
                  </p>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
