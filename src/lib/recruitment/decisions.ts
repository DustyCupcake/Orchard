import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  admission,
  communityInvite,
  member,
  evaluation,
  recruitmentApplicationInvite,
  recruitmentDecision,
  task,
  taskAssignment,
} from "@/db/schema";
import type { community as communityTable, member as memberTable } from "@/db/schema";
import { createTask } from "../tasks";
import { getCommunityRow } from "./access";
import { computeRecruitmentOutcome } from "./evaluations";
import { listGrantingTaskIds } from "../permissions";
import { admitArrival, closeArrival, ensureArrivalForApplication, recordArrivalDecision } from "./admission";
import { openCheck } from "./community-check";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type RecruitmentDecisionRow = typeof recruitmentDecision.$inferSelect;

export async function getRecruitmentDecision(formResponseId: string) {
  const [row] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, formResponseId));
  return row ?? null;
}

// The reverse lookup a task detail page needs to know "is this task an
// Accompaniment task, and if so, whose engagement record does its
// holder get to see" — see docs/spec.md's Recruitment ("the
// accompanier gets explicit... visibility into the new member's
// engagement record") and docs/development-plan.md's Phase 52. Null
// whenever this isn't an Accompaniment task at all, or the decision
// that created it never converted a real Member (an untagged
// application Form — see Phase 48's own maybeConvertApplicantToMember).
export async function getAccompaniedMemberId(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ convertedMemberId: recruitmentDecision.convertedMemberId })
    .from(recruitmentDecision)
    .where(eq(recruitmentDecision.accompanimentTaskId, taskId));
  return row?.convertedMemberId ?? null;
}

// Whoever currently holds the recruitment task, first by claimedAt —
// used as the acting/creating member for automated task creation that
// has no live human actor behind it (the scheduled wider-discussion
// resolution job). Synchronous, evaluator-triggered creation instead
// uses the filing evaluator directly, a real person taking a real
// action.
// Not an authority question: the scheduled auto-resolution job needs a real
// actor to create the Accompaniment Task *as*, since a Task needs a real
// creator. The holder of the granting task was the obvious stand-in, which
// was fine while the module was necessarily granted — but an open module may
// have no granting task at all, and the job still has to run. Hence the
// fallback chain (docs/open-permissions-plan.md §4.2): the converted member's
// referrer (a real person with a real stake in this applicant), then the
// earliest-claimed evaluator, and only then give up. Never a random member —
// the Accompaniment task is visible, and its creator is part of the record.
async function getRecruitmentTaskHolderMember(communityRow: CommunityRow): Promise<Member | null> {
  const grantingTaskIds = await listGrantingTaskIds(communityRow.id, "recruitment");
  if (grantingTaskIds.length === 0) return null;
  const [holding] = await db
    .select({ memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .where(and(inArray(taskAssignment.taskId, grantingTaskIds), eq(taskAssignment.isShadow, false)))
    .orderBy(taskAssignment.claimedAt)
    .limit(1);
  if (!holding) return null;
  const [holder] = await db.select().from(member).where(eq(member.id, holding.memberId));
  return holder ?? null;
}

// The author's own fallback, for the open-with-no-granting-task case: the
// converted member's referrer, else the earliest evaluator who filed on this
// application. Returns null when there is genuinely nobody to be.
async function resolveAccompanimentAuthor(
  communityRow: CommunityRow,
  decision: RecruitmentDecisionRow,
): Promise<Member | null> {
  if (decision.convertedMemberId) {
    const [converted] = await db.select().from(member).where(eq(member.id, decision.convertedMemberId));
    const referrerId = converted?.referredByMemberId;
    if (referrerId) {
      const [referrer] = await db.select().from(member).where(eq(member.id, referrerId));
      if (referrer) return referrer;
    }
  }

  const [earliestEvaluation] = await db
    .select({ evaluatorId: evaluation.evaluatorId })
    .from(evaluation)
    .where(eq(evaluation.formResponseId, decision.formResponseId))
    .orderBy(evaluation.filedAt)
    .limit(1);
  if (!earliestEvaluation) return null;

  const [evaluator] = await db.select().from(member).where(eq(member.id, earliestEvaluation.evaluatorId));
  return evaluator ?? null;
}

// An accepted application becomes a member through the one admission function
// (docs/admission-flow.md §6), the same as every other way in, so what a new
// member starts with — an identity, a way to be reached, a place in the event,
// the answers they already gave on the form — cannot differ by route. The
// arrival is made here for an application that predates arrivals and is still
// in flight; a form that can't identify a person at all (no question marked as
// their name and email) is a real, visible limitation, surfaced on the
// Accompaniment task's own description, not a silent failure — and
// submitRecruitmentApplication no longer lets such a form take applications.
async function maybeConvertApplicantToMember(decision: RecruitmentDecisionRow): Promise<RecruitmentDecisionRow> {
  if (decision.convertedMemberId) return decision;
  const arrival = await ensureArrivalForApplication(decision.formResponseId);
  if (!arrival) return decision;
  await admitArrival(arrival.id);
  const [updated] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
  return updated ?? decision;
}

// Idempotent — accompanimentTaskId is the marker. suggestedMemberId
// pre-fills from the accepted applicant's own referredByMemberId once
// maybeConvertApplicantToMember above has run (spec's exact framing —
// "the same 'carry a shadow forward as a suggested next claimant'
// reasoning Phase 14 already established for succession, applied here
// to a referrer instead of a shadow," docs/development-plan.md's Phase
// 34); falls back to the linked invite's own creator directly when
// conversion didn't happen (an untagged application Form — see
// maybeConvertApplicantToMember's own comment) so this still degrades
// to Phase 34's original resolved interpretation rather than losing
// the suggestion entirely.
async function maybeCreateAccompanimentTask(actor: Member, communityRow: CommunityRow, decision: RecruitmentDecisionRow) {
  if (decision.accompanimentTaskId) return null;
  // Same branchId dependency as createIntroCallPoll, and the same reasoning:
  // a Task cannot be created without a branchId, and an open module with no
  // granting task has none to borrow. Reported, not guessed.
  const grantingTaskIds = await listGrantingTaskIds(communityRow.id, "recruitment");
  if (grantingTaskIds.length === 0) return null;
  const [recruitmentTaskRow] = await db.select().from(task).where(inArray(task.id, grantingTaskIds));
  if (!recruitmentTaskRow) return null;

  let suggestedMemberId: string | null = null;
  if (decision.convertedMemberId) {
    const [convertedMember] = await db.select().from(member).where(eq(member.id, decision.convertedMemberId));
    suggestedMemberId = convertedMember?.referredByMemberId ?? null;
  } else {
    const [linked] = await db
      .select({ createdBy: communityInvite.createdBy })
      .from(recruitmentApplicationInvite)
      .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
      .where(eq(recruitmentApplicationInvite.formResponseId, decision.formResponseId));
    suggestedMemberId = linked?.createdBy ?? null;
  }

  const [waiting] = decision.convertedMemberId
    ? []
    : await db
        .select({ id: admission.id })
        .from(admission)
        .where(and(eq(admission.formResponseId, decision.formResponseId), isNotNull(admission.waitlistedAt)));

  const description = waiting
    ? `Accompany the new member accepted via the application submitted through /apply (id ${decision.formResponseId}) — see /applications for the full submission. They are accepted but waiting for a place in a full event, so they are not a member yet; they become one, and this task applies, when room appears or an administrator admits them.`
    : decision.convertedMemberId
    ? `Accompany the new member accepted via the application submitted through /apply (id ${decision.formResponseId}) — see /applications for the full submission.`
    : `Accompany the new member accepted via the application submitted through /apply (id ${decision.formResponseId}) — see /applications for the full submission. The application Form isn't tagged with a name/email field, so no Member was created automatically; someone will need to invite or otherwise onboard this person by hand.`;

  const created = await createTask(
    actor,
    {
      branchId: recruitmentTaskRow.branchId,
      title: "Accompany new member",
      description,
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
    },
    actor.id,
  );

  if (suggestedMemberId) {
    await db.update(task).set({ suggestedMemberId }).where(eq(task.id, created.id));
  }

  const [updated] = await db
    .update(recruitmentDecision)
    .set({ accompanimentTaskId: created.id })
    .where(eq(recruitmentDecision.id, decision.id))
    .returning();
  return updated;
}

// The write half of an acceptance, split out of recordDecisionIfReached
// so that src/lib/recruitment/mediation.ts can reuse it: an objection
// that the body *clears* admits the applicant exactly the way a `proceed`
// rule does, and re-implementing the conversion + accompaniment steps
// there would be how the two paths started disagreeing about what
// "accepted" means. Idempotent at both steps (convertedMemberId and
// accompanimentTaskId are the markers), so calling it on an already-
// accepted decision is a no-op rather than a double conversion.
export async function applyAcceptanceSideEffects(
  actor: Member,
  communityRow: CommunityRow,
  decision: RecruitmentDecisionRow,
) {
  const converted = await maybeConvertApplicantToMember(decision);
  const withTask = await maybeCreateAccompanimentTask(actor, communityRow, converted);
  return withTask ?? converted;
}

// One decision, applied to one arrival: the funnel's own way of saying "this
// arrival is accepted" or "this arrival is declined", whatever caused it — the
// support shortcut reaching its number, a community check that ended (the clock,
// mediation clearing a concern, mediation upholding one). Nothing here asks who is
// calling, which is the point (docs/admission-flow.md §5): the old mediation
// outcome went through a holder-only function and was lost when its caller wasn't
// one, and the window's clock then applied its *default* in its place.
//
// Skipping or deciding the evaluating does not skip the bookkeeping that follows an
// acceptance, so the record, the member and their accompaniment agree about what
// happened. If the evaluators have not decided yet there is no decision row to
// resolve, so one is made, saying `proceed` (the nearest honest word); a decision
// already waiting out a wider discussion is resolved. An arrival with no
// application has no decision at all — it is admitted or closed.
export async function settleArrivalDecision(arrival: typeof admission.$inferSelect, resolution: "accepted" | "declined") {
  if (!arrival.formResponseId) {
    if (resolution === "accepted") return admitArrival(arrival.id);
    await closeArrival(arrival.id, "declined");
    return null;
  }
  const [existing] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, arrival.formResponseId));
  let decision: RecruitmentDecisionRow;
  if (!existing) {
    [decision] = await db
      .insert(recruitmentDecision)
      .values({
        formResponseId: arrival.formResponseId,
        ruleOutcome: resolution === "accepted" ? "proceed" : "decline",
        resolution,
      })
      .returning();
  } else if (existing.resolution !== resolution) {
    [decision] = await db
      .update(recruitmentDecision)
      .set({ resolution })
      .where(eq(recruitmentDecision.id, existing.id))
      .returning();
  } else {
    decision = existing;
  }
  await recordArrivalDecision(arrival.formResponseId, resolution);
  if (resolution === "declined") return null;

  const result = await admitArrival(arrival.id);
  const communityRow = await getCommunityRow(arrival.communityId);
  const [fresh] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.id, decision.id));
  // The accompaniment needs a real member to create a task as, which the job
  // resolves the same way: the recruitment task's holder, else the converted
  // member's referrer or the earliest evaluator. Nobody to be is a report, not a
  // guess — the person is admitted either way.
  const actorMember =
    (await getRecruitmentTaskHolderMember(communityRow)) ?? (fresh ? await resolveAccompanimentAuthor(communityRow, fresh) : null);
  if (actorMember && fresh && !result.waitlisted) await applyAcceptanceSideEffects(actorMember, communityRow, fresh);
  return result;
}

/** The support shortcut reaching its number accepts an application the way a `proceed` does. */
export async function acceptArrivalByShortcut(arrival: typeof admission.$inferSelect) {
  return settleArrivalDecision(arrival, "accepted");
}

// The real, persisted trigger point Phase 33 deliberately didn't build
// — called after every submitEvaluation, but only actually does
// anything the first time enough evaluators have filed for this
// formResponseId (idempotent: a recruitmentDecision row already
// existing means this is a no-op). See src/db/schema/recruitment.ts's
// recruitmentDecision comment for the full state-machine reasoning.
export async function recordDecisionIfReached(actor: Member, formResponseId: string) {
  const existing = await getRecruitmentDecision(formResponseId);
  if (existing) return existing;

  const communityRow = await getCommunityRow(actor.communityId);
  const result = await computeRecruitmentOutcome(communityRow, formResponseId);
  if (!result.outcome) return null;

  const resolution: "accepted" | "declined" | null =
    result.outcome === "proceed" ? "accepted" : result.outcome === "decline" ? "declined" : null;

  const [created] = await db
    .insert(recruitmentDecision)
    .values({
      formResponseId,
      ruleOutcome: result.outcome,
      defaultResolution: result.defaultResolution,
      resolution,
    })
    .returning();

  let decisionRow = created;
  await recordArrivalDecision(formResponseId, resolution);

  // A wider discussion is a community check (§5): a window on the arrival in which
  // any member can raise a concern, ending by what the decision form said it does
  // when nobody does. The window's length and deadline live on the check, which is
  // the one place they are read.
  if (result.outcome === "wider_discussion") {
    const arrival = await ensureArrivalForApplication(formResponseId);
    if (arrival) await openCheck(arrival, "evaluation", result.defaultResolution === "proceed" ? "admit" : "decline");
  }

  // There is no call to schedule here any more. The interview comes *before* the
  // decision (docs/admission-flow.md §2): it was made when the arrival entered, and
  // the reports being decided from are the interviewers' own. A decision only
  // records what the reports lead to.

  if (resolution === "accepted") {
    const converted = await maybeConvertApplicantToMember(decisionRow);
    const updated = await maybeCreateAccompanimentTask(actor, communityRow, converted);
    if (updated) decisionRow = updated;
  }

  return decisionRow;
}
