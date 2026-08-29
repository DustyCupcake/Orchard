import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, plot, zone } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requireSpatialPlanningEnabled, requireSpatialPlanningHolder } from "./access";

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
// first. Once Phase 39 (Cycle type) exists, the caller re-sorts this so
// a same-type Cycle comes first — see docs/development-plan.md's Phase
// 39 note; this stays a plain query either way, no schema change.
export async function listCyclesWithPlot(actor: Member, excludeCycleId: string) {
  const rows = await db
    .select({ cycleId: plot.cycleId, cycleName: cycle.name, startedAt: cycle.startedAt })
    .from(plot)
    .innerJoin(cycle, eq(cycle.id, plot.cycleId))
    .where(and(eq(plot.communityId, actor.communityId), ne(plot.cycleId, excludeCycleId)))
    .orderBy(desc(cycle.startedAt));
  return rows;
}

// Standalone spatial-plan cloning, independent of Cycle creation
// itself — see docs/spec.md's "Cloning across cycles." Copies the
// source Plot's base/calibration plus every one of its Zones as fresh
// rows onto a brand-new Plot for targetCycleId. Zones carry no Member/
// Task links to begin with, so there's nothing to drop here — that
// carve-out is Placement's, in Phase 37, which extends this same
// function.
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

  const sourceZones = await db.select().from(zone).where(eq(zone.plotId, sourcePlot.id));

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

    if (sourceZones.length > 0) {
      await tx.insert(zone).values(
        sourceZones.map((z) => ({
          plotId: newPlot.id,
          name: z.name,
          category: z.category,
          polygon: z.polygon,
          color: z.color,
        })),
      );
    }

    return newPlot;
  });
}
