import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { admission, recruitmentSubscription, schedulingEntry, schedulingPoll } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow } from "./access";
import { loadStandingSlots } from "./standing-availability";

type Member = typeof memberTable.$inferSelect;

// A standing opt-in, not a task claim — "any qualifying member can activate for
// application alerts and the availability tool" (docs/spec.md's Recruitment). One row per
// member, created on first activation and toggled in place afterward rather than deleted
// on deactivation.
//
// It is the person's own setting and nothing else changes it. It used to lapse by itself
// after N applications with no availability given, which quietly cancelled a setting that
// member had chosen on purpose — and with standing availability (a grid a holder fills in
// once, read by every interview) the whole mechanism was moot anyway, since anyone who has
// filled one in keeps offering it (docs/plans/admission-flow.md §7).
export async function getMyRecruitmentSubscription(actor: Member) {
  const [row] = await db
    .select()
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  return row ?? { id: null, memberId: actor.id, active: false };
}

export async function setRecruitmentSubscriptionActive(actor: Member, active: boolean) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const [existing] = await db.select().from(recruitmentSubscription).where(eq(recruitmentSubscription.memberId, actor.id));
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

/**
 * The interviews still waiting for a time, for a subscribed member: the poll each person
 * with an interview gets as they enter (docs/plans/admission-flow.md §2), until a slot is
 * confirmed. Offering your times is voluntary and never blocks the poll; what you have
 * offered *standing* counts as having offered, so there is nothing to re-paint onto each.
 */
export async function listOpenInterviewsForSubscriber(actor: Member) {
  if (!(await isSubscribed(actor))) return [];
  const interviews = await db
    .select({ arrivalId: admission.id, pollId: schedulingPoll.id })
    .from(admission)
    .innerJoin(schedulingPoll, eq(admission.interviewPollId, schedulingPoll.id))
    .where(
      and(
        isNull(schedulingPoll.confirmedSlotStart),
        eq(admission.communityId, actor.communityId),
        isNull(admission.admittedMemberId),
        isNull(admission.declinedAt),
        isNull(admission.withdrawnAt),
      ),
    );
  const standing = (await loadStandingSlots(actor.communityId, [actor.id])).get(actor.id);
  return Promise.all(
    interviews.map(async (r) => {
      const [entry] = await db
        .select({ id: schedulingEntry.id })
        .from(schedulingEntry)
        .where(and(eq(schedulingEntry.pollId, r.pollId), eq(schedulingEntry.memberId, actor.id)))
        .limit(1);
      return { arrivalId: r.arrivalId, pollId: r.pollId, submittedByMe: Boolean(entry) || Boolean(standing && standing.size > 0) };
    }),
  );
}

async function isSubscribed(actor: Member): Promise<boolean> {
  const [row] = await db
    .select({ active: recruitmentSubscription.active })
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  return Boolean(row?.active);
}
