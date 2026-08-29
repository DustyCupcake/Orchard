import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { placementTemplate } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { getCommunityRow, requireSpatialPlanningHolder } from "./access";
import { getPlacement } from "./placements";

type Member = typeof memberTable.$inferSelect;

const placementShapeTypeInput = z.enum(["rectangle", "circle", "polygon", "line"]);
const placementCategoryInput = z.enum(["tent", "vehicle", "structure", "furniture", "generic"]);

export const createPlacementTemplateInput = z.object({
  name: z.string().min(1),
  shapeType: placementShapeTypeInput,
  geometry: z.unknown(),
  category: placementCategoryInput,
});
export type CreatePlacementTemplateInput = z.infer<typeof createPlacementTemplateInput>;

// Open to any member — seeing what's already in the library is useful
// even for someone who can't (yet) place anything with it.
export async function listPlacementTemplates(actor: Member) {
  return db
    .select()
    .from(placementTemplate)
    .where(eq(placementTemplate.communityId, actor.communityId))
    .orderBy(placementTemplate.name);
}

// Holder-gated, matching Placement's own edit gating (docs/spec.md's
// Shape inventory is described as something "any Placement can be
// saved into," but in Phase 37 only the Spatial-planning task holder
// ever has a Placement to save from in the first place).
export async function createPlacementTemplate(actor: Member, rawInput: CreatePlacementTemplateInput) {
  const input = createPlacementTemplateInput.parse(rawInput);
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);

  const [created] = await db
    .insert(placementTemplate)
    .values({
      communityId: actor.communityId,
      name: input.name,
      shapeType: input.shapeType,
      geometry: input.geometry,
      category: input.category,
    })
    .returning();
  return created;
}

// "Saved from an existing Placement... decoupled, no live link back" —
// snapshots the Placement's current shape/category under a new name
// rather than storing any reference to it.
export async function savePlacementAsTemplate(actor: Member, placementId: string, name: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  const source = await getPlacement(actor, placementId); // 404s if not in this community

  const [created] = await db
    .insert(placementTemplate)
    .values({
      communityId: actor.communityId,
      name,
      shapeType: source.shapeType,
      geometry: source.geometry,
      category: source.category,
    })
    .returning();
  return created;
}

export async function deletePlacementTemplate(actor: Member, templateId: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);

  const [row] = await db
    .select({ id: placementTemplate.id })
    .from(placementTemplate)
    .where(and(eq(placementTemplate.id, templateId), eq(placementTemplate.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Template not found");
  }
  await db.delete(placementTemplate).where(eq(placementTemplate.id, templateId));
}
