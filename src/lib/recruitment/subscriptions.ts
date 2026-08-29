import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recruitmentSubscription } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow } from "./access";

type Member = typeof memberTable.$inferSelect;

// A standing opt-in, not a task claim — "any qualifying member can
// activate for application alerts and the availability tool Phase 34's
// scheduling needs" (docs/spec.md's Recruitment). No row exists until
// a member's first activation; deactivating flips it back off in
// place rather than deleting the row, so consecutiveNoAvailabilityCount
// (Phase 34's own counter to maintain) survives an activate/deactivate
// cycle.
export async function getMyRecruitmentSubscription(actor: Member) {
  const [row] = await db
    .select()
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  return (
    row ?? {
      id: null,
      memberId: actor.id,
      active: false,
      consecutiveNoAvailabilityCount: 0,
    }
  );
}

export async function setRecruitmentSubscriptionActive(actor: Member, active: boolean) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const [existing] = await db
    .select()
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));

  if (existing) {
    const [updated] = await db
      .update(recruitmentSubscription)
      .set({ active })
      .where(eq(recruitmentSubscription.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(recruitmentSubscription).values({ memberId: actor.id, active }).returning();
  return created;
}
