import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { cycle, placement, plot, zone } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { isModuleEnabled } from "../modules";
import { getCommunityRow, requireSpatialPlanningEnabled, requireSpatialPlanningHolder } from "./access";

type Member = typeof memberTable.$inferSelect;

const calibrationPoint = z.object({
  x: z.number(),
  y: z.number(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const scaleCalibrationInput = z
  .object({
    pointA: calibrationPoint,
    pointB: calibrationPoint,
    realWorldDistanceMeters: z.number().positive().optional(),
  })
  .refine(
    (c) =>
      c.realWorldDistanceMeters != null ||
      (c.pointA.lat != null && c.pointA.lng != null && c.pointB.lat != null && c.pointB.lng != null),
    { message: "Provide a real-world distance, or GPS coordinates on both points" },
  );

// A base64 data: URI, not a hosted file — see src/db/schema/spatial-
// planning.ts's schema comment for why. Capped well under Postgres'
// own text-column ceiling; this is just a sane "someone fat-fingered a
// huge upload" guard, not a real design limit.
const MAX_BASE_IMAGE_CHARS = 8_000_000; // ~6MB decoded

const baseImageUrl = z
  .string()
  .max(MAX_BASE_IMAGE_CHARS, "Image is too large")
  .refine((s) => s.startsWith("data:image/") || s.startsWith("http"), {
    message: "Must be a data: image URI or an http(s) URL",
  })
  .nullable()
  .optional();

export const createPlotInput = z.object({
  name: z.string().min(1),
  baseImageUrl,
  baseVector: z.unknown().nullable().optional(),
  scaleCalibration: scaleCalibrationInput.nullable().optional(),
});
export type CreatePlotInput = z.infer<typeof createPlotInput>;

export const updatePlotInput = createPlotInput.partial();
export type UpdatePlotInput = z.infer<typeof updatePlotInput>;

// cycleId === null is a real, valid value here (a Community that never
// turned Cycles on — see src/db/schema/spatial-planning.ts's schema
// comment), not "unspecified," so there's nothing to look up or 404 on.
async function requireCycleInCommunity(communityId: string, cycleId: string | null) {
  if (cycleId === null) return;
  const [row] = await db
    .select({ id: cycle.id })
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found in your community");
  }
}

// One per Cycle (or one per Community, when cycleId is null) — see
// src/db/schema/spatial-planning.ts's schema comment for why this is
// an app-layer check, not a DB constraint, and why null is handled as
// an ordinary value rather than "eq(plot.cycleId, null)," which would
// generate an always-false "= NULL" in SQL — the same isNull-vs-eq
// split src/lib/event-scheduling/crud.ts's cycleScopeCondition already
// uses for the identical reason.
export async function getPlotForCycle(actor: Member, cycleId: string | null) {
  const cycleCondition = cycleId === null ? isNull(plot.cycleId) : eq(plot.cycleId, cycleId);
  const [row] = await db
    .select()
    .from(plot)
    .where(and(cycleCondition, eq(plot.communityId, actor.communityId)));
  return row ?? null;
}

export async function getPlot(actor: Member, plotId: string) {
  const [row] = await db
    .select()
    .from(plot)
    .where(and(eq(plot.id, plotId), eq(plot.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Plot not found");
  }
  return row;
}

// Holder-gated — "edited by whoever holds the Spatial-planning task"
// (docs/development-plan.md's Phase 36 done-when). Read access (any
// member can view) lives in the page itself, not here.
export async function createPlot(actor: Member, cycleId: string | null, rawInput: CreatePlotInput) {
  // Re-validated here, not just trusted from an API route's own
  // createPlotInput.parse() — the same defense-in-depth precedent
  // Forms' requireValidFields and Budget's requireLineItems already
  // established for exactly this class of gap.
  const input = createPlotInput.parse(rawInput);
  const communityRow = await requireSpatialPlanningEnabled(actor);
  await requireSpatialPlanningHolder(actor, communityRow);
  await requireCycleInCommunity(actor.communityId, cycleId);

  const existing = await getPlotForCycle(actor, cycleId);
  if (existing) {
    throw new ConflictError("This Cycle already has a Plot");
  }

  const [created] = await db
    .insert(plot)
    .values({
      communityId: actor.communityId,
      cycleId,
      name: input.name,
      baseImageUrl: input.baseImageUrl ?? null,
      baseVector: input.baseVector ?? null,
      scaleCalibration: input.scaleCalibration ?? null,
      createdBy: actor.id,
    })
    .returning();
  return created;
}

export async function updatePlot(actor: Member, plotId: string, rawInput: UpdatePlotInput) {
  const input = updatePlotInput.parse(rawInput);
  const communityRow = await requireSpatialPlanningEnabled(actor);
  await requireSpatialPlanningHolder(actor, communityRow);
  await getPlot(actor, plotId); // 404s if not in this community

  const [updated] = await db
    .update(plot)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.baseImageUrl !== undefined && { baseImageUrl: input.baseImageUrl }),
      ...(input.baseVector !== undefined && { baseVector: input.baseVector }),
      ...(input.scaleCalibration !== undefined && { scaleCalibration: input.scaleCalibration }),
      updatedAt: new Date(),
    })
    .where(eq(plot.id, plotId))
    .returning();
  return updated;
}

// The standalone clone picker's source list — every past Cycle (other
// than the one being planned) that already has a Plot, most-recent-
// first, with same-type Cycles bubbled to the front once Cycle type
// (Phase 40) is in use — see docs/development-plan.md's own note under
// Phase 36. Falls back to plain most-recent-first when the target
// Cycle has no type at all (nothing to match against) — this stays a
// plain query either way, no schema change on either side.
export async function listCyclesWithPlot(actor: Member, excludeCycleId: string) {
  const rows = await db
    .select({
      cycleId: plot.cycleId,
      cycleName: cycle.name,
      startedAt: cycle.startedAt,
      cycleTypeId: cycle.cycleTypeId,
    })
    .from(plot)
    .innerJoin(cycle, eq(cycle.id, plot.cycleId))
    .where(and(eq(plot.communityId, actor.communityId), ne(plot.cycleId, excludeCycleId)))
    .orderBy(desc(cycle.startedAt));

  const [target] = await db.select({ cycleTypeId: cycle.cycleTypeId }).from(cycle).where(eq(cycle.id, excludeCycleId));
  if (!target?.cycleTypeId) {
    return rows;
  }

  const sameType = rows.filter((r) => r.cycleTypeId === target.cycleTypeId);
  const otherType = rows.filter((r) => r.cycleTypeId !== target.cycleTypeId);
  return [...sameType, ...otherType];
}

// Standalone spatial-plan cloning, independent of Cycle creation
// itself — see docs/spec.md's "Cloning across cycles." Copies the
// source Plot's base/calibration plus every one of its Zones and
// Placements as fresh rows onto a brand-new Plot for targetCycleId.
// Zones carry no Member/Task links to begin with, so there's nothing
// to drop for them. A cloned Placement's zoneId is remapped onto its
// corresponding new Zone (an organizational link, safe to carry
// forward since both were cloned together); its linkedTaskId is always
// dropped and it gets no PlacementMember rows at all — per docs/
// development-plan.md's Phase 37 scope, neither who's attending nor
// which Task instance carries a guaranteed match on this standalone
// path (contrast Phase 38's full-Cycle-clone integration, the one path
// where a Task link *does* carry over, because the Tasks are cloned in
// the same operation there).
export async function clonePlotFromCycle(actor: Member, targetCycleId: string, sourceCycleId: string) {
  const communityRow = await requireSpatialPlanningEnabled(actor);
  await requireSpatialPlanningHolder(actor, communityRow);
  await requireCycleInCommunity(actor.communityId, targetCycleId);

  const existing = await getPlotForCycle(actor, targetCycleId);
  if (existing) {
    throw new ConflictError("This Cycle already has a Plot");
  }

  const sourcePlot = await getPlotForCycle(actor, sourceCycleId);
  if (!sourcePlot) {
    throw new NotFoundError("The source Cycle has no Plot to clone");
  }

  return db.transaction(async (tx) => {
    const [newPlot] = await tx
      .insert(plot)
      .values({
        communityId: actor.communityId,
        cycleId: targetCycleId,
        name: sourcePlot.name,
        baseImageUrl: sourcePlot.baseImageUrl,
        baseVector: sourcePlot.baseVector,
        scaleCalibration: sourcePlot.scaleCalibration,
        createdBy: actor.id,
      })
      .returning();

    await cloneZonesAndPlacementsInto(tx, sourcePlot.id, newPlot.id, null);
    return newPlot;
  });
}

// Shared by both cloning paths — copies every Zone and Placement from
// sourcePlotId onto newPlotId inside an already-open transaction.
// `taskIdMap` is null on the standalone path above (a Placement's
// linkedTaskId always drops to null there); a real oldTaskId->
// newTaskId map on Phase 38's full-Cycle-clone integration below,
// where Tasks were cloned in the very same operation, so the link
// stays meaningful and gets remapped instead. A cloned Placement never
// carries its Member links across either path — see each caller's own
// comment for why.
async function cloneZonesAndPlacementsInto(
  tx: Tx,
  sourcePlotId: string,
  newPlotId: string,
  taskIdMap: Map<string, string> | null,
) {
  const sourceZones = await tx.select().from(zone).where(eq(zone.plotId, sourcePlotId));
  const sourcePlacements = await tx.select().from(placement).where(eq(placement.plotId, sourcePlotId));

  // oldZoneId -> newZoneId, so a cloned Placement's zoneId can be
  // remapped rather than dropped or left dangling.
  const zoneIdMap = new Map<string, string>();
  if (sourceZones.length > 0) {
    const newZones = await tx
      .insert(zone)
      .values(
        sourceZones.map((z) => ({
          plotId: newPlotId,
          name: z.name,
          category: z.category,
          polygon: z.polygon,
          color: z.color,
        })),
      )
      .returning();
    sourceZones.forEach((z, i) => zoneIdMap.set(z.id, newZones[i].id));
  }

  if (sourcePlacements.length > 0) {
    await tx.insert(placement).values(
      sourcePlacements.map((p) => ({
        plotId: newPlotId,
        zoneId: p.zoneId ? (zoneIdMap.get(p.zoneId) ?? null) : null,
        shapeType: p.shapeType,
        geometry: p.geometry,
        label: p.label,
        category: p.category,
        linkedTaskId: taskIdMap && p.linkedTaskId ? (taskIdMap.get(p.linkedTaskId) ?? null) : null,
      })),
    );
  }
}

// The full-Cycle-clone integration (docs/spec.md's "Cloning across
// cycles") — called from src/lib/cycles/crud.ts's cloneMostRecentCycle
// inside its own transaction, only when the caller explicitly asked to
// also clone the spatial plan. Requires the actor to be the Spatial-
// planning holder specifically, not just eligible to start a Cycle —
// the same "a different authority gates this specific piece" reasoning
// Pack import review's "create new branch" step already established
// for Admins vs. cycle-initiation eligibility. Silently does nothing
// if the module is off or the previous Cycle has no Plot — nothing to
// clone either way, not an error.
export async function cloneSpatialPlanIntoNewCycle(
  actor: Member,
  tx: Tx,
  previousCycleId: string,
  newCycleId: string,
  taskIdMap: Map<string, string>,
) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!isModuleEnabled(communityRow, "spatial_planning")) return;
  await requireSpatialPlanningHolder(actor, communityRow);

  const [sourcePlot] = await tx
    .select()
    .from(plot)
    .where(and(eq(plot.cycleId, previousCycleId), eq(plot.communityId, actor.communityId)));
  if (!sourcePlot) return;

  const [newPlot] = await tx
    .insert(plot)
    .values({
      communityId: actor.communityId,
      cycleId: newCycleId,
      name: sourcePlot.name,
      baseImageUrl: sourcePlot.baseImageUrl,
      baseVector: sourcePlot.baseVector,
      scaleCalibration: sourcePlot.scaleCalibration,
      createdBy: actor.id,
    })
    .returning();

  await cloneZonesAndPlacementsInto(tx, sourcePlot.id, newPlot.id, taskIdMap);
}
