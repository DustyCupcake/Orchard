import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { plot, zone } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { requireNotOnsiteLocked } from "../onsite-mode";
import { requireSpatialPlanningHolder, getCommunityRow } from "./access";
import { getPlot } from "./plots";

type Member = typeof memberTable.$inferSelect;

const point = z.object({ x: z.number(), y: z.number() });

export const createZoneInput = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  polygon: z.array(point).min(3, "A Zone needs at least 3 points"),
  color: z.string().min(1),
});
export type CreateZoneInput = z.infer<typeof createZoneInput>;

export const updateZoneInput = createZoneInput.partial();
export type UpdateZoneInput = z.infer<typeof updateZoneInput>;

// Open to any member — "visible to any member" (docs/development-
// plan.md's Phase 36 done-when).
export async function listZones(actor: Member, plotId: string) {
  await getPlot(actor, plotId); // 404s if not in this community
  return db.select().from(zone).where(eq(zone.plotId, plotId)).orderBy(zone.createdAt);
}

export async function getZone(actor: Member, zoneId: string) {
  const [row] = await db
    .select({ zone: zone, communityId: plot.communityId })
    .from(zone)
    .innerJoin(plot, eq(plot.id, zone.plotId))
    .where(and(eq(zone.id, zoneId), eq(plot.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Zone not found");
  }
  return row.zone;
}

// Holder-gated — Zones are "edited directly by whoever holds the
// Spatial-planning task," no propose/approve step (docs/spec.md).
export async function createZone(actor: Member, plotId: string, rawInput: CreateZoneInput) {
  // Re-validated here, not just trusted from an API route's own
  // createZoneInput.parse() — same defense-in-depth precedent as
  // plots.ts's createPlot.
  const input = createZoneInput.parse(rawInput);
  const communityRow = await getCommunityRow(actor.communityId);
  requireNotOnsiteLocked(communityRow);
  await requireSpatialPlanningHolder(actor, communityRow);
  await getPlot(actor, plotId); // 404s if not in this community

  const [created] = await db
    .insert(zone)
    .values({
      plotId,
      name: input.name,
      category: input.category,
      polygon: input.polygon,
      color: input.color,
    })
    .returning();
  return created;
}

export async function updateZone(actor: Member, zoneId: string, rawInput: UpdateZoneInput) {
  const input = updateZoneInput.parse(rawInput);
  const communityRow = await getCommunityRow(actor.communityId);
  requireNotOnsiteLocked(communityRow);
  await requireSpatialPlanningHolder(actor, communityRow);
  await getZone(actor, zoneId); // 404s if not in this community

  const [updated] = await db
    .update(zone)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.polygon !== undefined && { polygon: input.polygon }),
      ...(input.color !== undefined && { color: input.color }),
      updatedAt: new Date(),
    })
    .where(eq(zone.id, zoneId))
    .returning();
  return updated;
}

export async function deleteZone(actor: Member, zoneId: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireNotOnsiteLocked(communityRow);
  await requireSpatialPlanningHolder(actor, communityRow);
  await getZone(actor, zoneId); // 404s if not in this community

  await db.delete(zone).where(eq(zone.id, zoneId));
}
