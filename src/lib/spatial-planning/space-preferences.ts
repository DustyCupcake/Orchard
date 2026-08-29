import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, spacePreference } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCommunityRow, requireSpatialPlanningHolder } from "./access";
import { requireModuleEnabled } from "../modules";

type Member = typeof memberTable.$inferSelect;

export const upsertSpacePreferenceInput = z.object({
  sleepArrangement: z.enum(["solo_tent", "shared_tent", "solo_vehicle", "shared_vehicle", "other"]),
  vehicleDimensions: z
    .object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive() })
    .nullable()
    .optional(),
  groupWith: z.array(z.string().uuid()).nullable().optional(),
  sharingWith: z.array(z.string().uuid()).nullable().optional(),
  accessibilityNotes: z.string().nullable().optional(),
});
export type UpsertSpacePreferenceInput = z.infer<typeof upsertSpacePreferenceInput>;

// Self-service, any member — "a member-profile extension," the same
// always-self-editable posture Sensitive data's fixed fields and a
// once-ever ProfileAnswer both already take (docs/spec.md's Space
// preferences). Upserted in place, the same select-then-update-or-
// insert posture Assemblies'/Budget's own response tables use — no DB
// unique constraint needed since memberId is already the primary key.
export async function upsertMySpacePreference(actor: Member, rawInput: UpsertSpacePreferenceInput) {
  const input = upsertSpacePreferenceInput.parse(rawInput);
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "spatial_planning");

  const [existing] = await db.select().from(spacePreference).where(eq(spacePreference.memberId, actor.id));

  if (existing) {
    const [updated] = await db
      .update(spacePreference)
      .set({
        sleepArrangement: input.sleepArrangement,
        vehicleDimensions: input.vehicleDimensions ?? null,
        groupWith: input.groupWith ?? null,
        sharingWith: input.sharingWith ?? null,
        accessibilityNotes: input.accessibilityNotes ?? null,
      })
      .where(eq(spacePreference.memberId, actor.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(spacePreference)
    .values({
      memberId: actor.id,
      sleepArrangement: input.sleepArrangement,
      vehicleDimensions: input.vehicleDimensions ?? null,
      groupWith: input.groupWith ?? null,
      sharingWith: input.sharingWith ?? null,
      accessibilityNotes: input.accessibilityNotes ?? null,
    })
    .returning();
  return created;
}

export async function getMySpacePreference(actor: Member) {
  const [row] = await db.select().from(spacePreference).where(eq(spacePreference.memberId, actor.id));
  return row ?? null;
}

// Holder-only — "visible to whoever's drawing the layout" (docs/
// spec.md), not a community-wide roster. spacePreference carries no
// communityId of its own (memberId is its primary key), so scoping to
// this community goes through Member.
export async function listSpacePreferences(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  await requireSpatialPlanningHolder(actor, communityRow);
  return db
    .select({ preference: spacePreference, memberName: member.name })
    .from(spacePreference)
    .innerJoin(member, eq(member.id, spacePreference.memberId))
    .where(eq(member.communityId, actor.communityId));
}
