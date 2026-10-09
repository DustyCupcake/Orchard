import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  admission,
  form,
  formResponse,
  member,
  recruitmentDecision,
  recruitmentSubscription,
  schedulingEntry,
  schedulingPoll,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireModuleEnabled } from "../modules";
import { getCommunityRow } from "./access";
import { loadStandingSlots } from "./standing-availability";

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

// Every active subscriber in the actor's own Community whose intro-
// call poll hasn't confirmed a slot yet, so /applications can nudge
// "submit your availability" — the readable half of the mechanism
// updateRecruitmentSubscriptionLapses below writes. Not required
// participation (the intro call already resolves against just the two
// evaluators + the applicant, per docs/development-plan.md's Phase
// 34); a subscriber's own submission here is voluntary and never
// blocks or changes the poll's own resolution — see this function's
// own module-level comment on updateRecruitmentSubscriptionLapses for
// why it's tracked anyway.
export async function listOpenIntroCallsForSubscriber(actor: Member) {
  const subscribed = await isSubscribed(actor);
  if (!subscribed) return [];

  const rows = await db
    .select({ decision: recruitmentDecision, pollId: schedulingPoll.id, communityId: form.communityId })
    .from(recruitmentDecision)
    .innerJoin(schedulingPoll, eq(recruitmentDecision.introCallPollId, schedulingPoll.id))
    .innerJoin(formResponse, eq(recruitmentDecision.formResponseId, formResponse.id))
    .innerJoin(form, eq(formResponse.formId, form.id))
    .where(and(isNull(schedulingPoll.confirmedSlotStart), eq(form.communityId, actor.communityId)));

  const legacy = await Promise.all(
    rows.map(async (r) => {
      const [entry] = await db
        .select({ id: schedulingEntry.id })
        .from(schedulingEntry)
        .where(and(eq(schedulingEntry.pollId, r.pollId), eq(schedulingEntry.memberId, actor.id)))
        .limit(1);
      return { formResponseId: r.decision.formResponseId, pollId: r.pollId, submittedByMe: Boolean(entry) };
    }),
  );

  // Interviews now: the poll each arrival with an interview gets as they enter
  // (docs/admission-flow.md §2), still waiting for a time to be confirmed. What
  // the subscriber has offered *standing* counts as having offered, so there is
  // nothing to re-paint onto each one.
  const interviews = await db
    .select({ arrivalId: admission.id, formResponseId: admission.formResponseId, pollId: schedulingPoll.id, slots: schedulingPoll.rangeStart })
    .from(admission)
    .innerJoin(schedulingPoll, eq(admission.interviewPollId, schedulingPoll.id))
    .where(and(isNull(schedulingPoll.confirmedSlotStart), eq(admission.communityId, actor.communityId), isNull(admission.admittedMemberId), isNull(admission.declinedAt), isNull(admission.withdrawnAt)));
  const standing = (await loadStandingSlots(actor.communityId, [actor.id])).get(actor.id);
  const interviewItems = await Promise.all(
    interviews.map(async (r) => {
      const [entry] = await db
        .select({ id: schedulingEntry.id })
        .from(schedulingEntry)
        .where(and(eq(schedulingEntry.pollId, r.pollId), eq(schedulingEntry.memberId, actor.id)))
        .limit(1);
      return { formResponseId: r.formResponseId, pollId: r.pollId, submittedByMe: Boolean(entry) || Boolean(standing && standing.size > 0) };
    }),
  );
  return [...legacy, ...interviewItems];
}

// Scheduled job (see src/instrumentation.ts). **Resolved interpretation
// of an under-specified spec mechanic**, per docs/development-plan.md's
// Phase 48: spec's one sentence ("auto-lapses after N consecutive
// applications with no availability given") reads most naturally
// against the intro-call SchedulingPoll each application produces
// (Phase 34), not against evaluators specifically — evaluators are
// resolved separately, as whoever holds the recruitment task (Phase
// 33), unrelated to subscription. A subscriber isn't a required
// participant on that poll (only the two evaluators and the applicant
// are — see createIntroCallPoll in decisions.ts), but can still submit
// availability to it like any other member via the ordinary
// submitAvailability, the same "a wider bench who wants to stay in the
// loop and might weigh in" reading that gives "enabling their
// availability tool" a real function distinct from being an evaluator.
// Processes each decision exactly once, the moment its intro call
// confirms a slot (subscriptionLapseProcessedAt is the marker) — a
// call that never resolves at all is a stuck-pipeline problem the
// Recruitment pipeline view already flags, not something this counter
// separately times out.
export async function updateRecruitmentSubscriptionLapses() {
  const due = await db
    .select({ decision: recruitmentDecision, pollId: schedulingPoll.id, communityId: form.communityId })
    .from(recruitmentDecision)
    .innerJoin(schedulingPoll, eq(recruitmentDecision.introCallPollId, schedulingPoll.id))
    .innerJoin(formResponse, eq(recruitmentDecision.formResponseId, formResponse.id))
    .innerJoin(form, eq(formResponse.formId, form.id))
    .where(and(isNull(recruitmentDecision.subscriptionLapseProcessedAt), isNotNull(schedulingPoll.confirmedSlotStart)));

  let processed = 0;
  let lapsed = 0;
  for (const row of due) {
    const communityRow = await getCommunityRow(row.communityId);

    const activeSubscribers = await db
      .select({ sub: recruitmentSubscription })
      .from(recruitmentSubscription)
      .innerJoin(member, eq(recruitmentSubscription.memberId, member.id))
      .where(and(eq(recruitmentSubscription.active, true), eq(member.communityId, communityRow.id)));

    for (const { sub } of activeSubscribers) {
      const [entry] = await db
        .select({ id: schedulingEntry.id })
        .from(schedulingEntry)
        .where(and(eq(schedulingEntry.pollId, row.pollId), eq(schedulingEntry.memberId, sub.memberId)))
        .limit(1);

      if (entry) {
        await db
          .update(recruitmentSubscription)
          .set({ consecutiveNoAvailabilityCount: 0 })
          .where(eq(recruitmentSubscription.id, sub.id));
        continue;
      }

      const newCount = sub.consecutiveNoAvailabilityCount + 1;
      const shouldLapse = newCount >= communityRow.recruitmentSubscriptionLapseThreshold;
      await db
        .update(recruitmentSubscription)
        .set({ consecutiveNoAvailabilityCount: newCount, ...(shouldLapse && { active: false }) })
        .where(eq(recruitmentSubscription.id, sub.id));
      if (shouldLapse) lapsed++;
    }

    await db
      .update(recruitmentDecision)
      .set({ subscriptionLapseProcessedAt: new Date() })
      .where(eq(recruitmentDecision.id, row.decision.id));
    processed++;
  }

  // The interviews now: processed once per arrival, the moment its slot is
  // confirmed. A subscriber counts as having given availability if they have an
  // entry on the poll *or* offered the confirmed slot standing.
  const dueInterviews = await db
    .select({ arrival: admission, confirmedSlotStart: schedulingPoll.confirmedSlotStart })
    .from(admission)
    .innerJoin(schedulingPoll, eq(admission.interviewPollId, schedulingPoll.id))
    .where(and(isNull(admission.subscriptionLapseProcessedAt), isNotNull(schedulingPoll.confirmedSlotStart)));
  for (const row of dueInterviews) {
    const communityRow = await getCommunityRow(row.arrival.communityId);
    const slot = row.confirmedSlotStart!.toISOString();
    const activeSubscribers = await db
      .select({ sub: recruitmentSubscription })
      .from(recruitmentSubscription)
      .innerJoin(member, eq(recruitmentSubscription.memberId, member.id))
      .where(and(eq(recruitmentSubscription.active, true), eq(member.communityId, communityRow.id)));
    const standing = await loadStandingSlots(communityRow.id, activeSubscribers.map((a) => a.sub.memberId), new Date(0));

    for (const { sub } of activeSubscribers) {
      const [entry] = await db
        .select({ id: schedulingEntry.id })
        .from(schedulingEntry)
        .where(and(eq(schedulingEntry.pollId, row.arrival.interviewPollId!), eq(schedulingEntry.memberId, sub.memberId)))
        .limit(1);
      if (entry || standing.get(sub.memberId)?.has(slot)) {
        await db.update(recruitmentSubscription).set({ consecutiveNoAvailabilityCount: 0 }).where(eq(recruitmentSubscription.id, sub.id));
        continue;
      }
      const newCount = sub.consecutiveNoAvailabilityCount + 1;
      const shouldLapse = newCount >= communityRow.recruitmentSubscriptionLapseThreshold;
      await db
        .update(recruitmentSubscription)
        .set({ consecutiveNoAvailabilityCount: newCount, ...(shouldLapse && { active: false }) })
        .where(eq(recruitmentSubscription.id, sub.id));
      if (shouldLapse) lapsed++;
    }
    await db.update(admission).set({ subscriptionLapseProcessedAt: new Date() }).where(eq(admission.id, row.arrival.id));
    processed++;
  }

  return { processed, lapsed };
}

async function isSubscribed(actor: Member): Promise<boolean> {
  const [row] = await db
    .select({ active: recruitmentSubscription.active })
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  return Boolean(row?.active);
}
