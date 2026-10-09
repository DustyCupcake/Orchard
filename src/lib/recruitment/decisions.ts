import { and, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  admission,
  communityInvite,
  form,
  formResponse,
  member,
  evaluation,
  objection,
  recruitmentApplicationInvite,
  recruitmentDecision,
  task,
  taskAssignment,
} from "@/db/schema";
import type { community as communityTable, member as memberTable } from "@/db/schema";
import { createTask } from "../tasks";
import { getCommunityRow, requireRecruitmentScopeForCycle, requireRecruitmentTaskHolder } from "./access";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { computeRecruitmentOutcome } from "./evaluations";
import { listGrantingTaskIds } from "../permissions";
import { admitArrival, ensureArrivalForApplication, recordArrivalDecision } from "./admission";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type RecruitmentDecisionRow = typeof recruitmentDecision.$inferSelect;

const MS_PER_HOUR = 3600_000;

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

// Purely time-computed from widerDiscussionDeadline, the same no-
// scheduler-job-for-the-status-itself pattern Phase 31's returning-
// priority window and Assemblies' computeAssemblyPhase already
// establish — actually resolving it (a real write, possibly creating
// an Accompaniment task) is resolveWiderDiscussionWindows' job below.
export type WiderDiscussionStatus = "open" | "closed" | null;
export function computeWiderDiscussionStatus(decision: RecruitmentDecisionRow): WiderDiscussionStatus {
  if (decision.ruleOutcome !== "wider_discussion") return null;
  if (decision.resolution !== null) return "closed";
  if (!decision.widerDiscussionDeadline) return null;
  return new Date() < decision.widerDiscussionDeadline ? "open" : "closed";
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

// The support shortcut reaching its number (docs/admission-flow.md §2) accepts
// an application the way a `proceed` outcome does, so the record, the member and
// their accompaniment agree about what happened — skipping the rest of the path
// skips the *evaluating*, not the bookkeeping that follows an acceptance. If the
// evaluators have not decided yet there is no decision row to resolve, so one is
// made, saying `proceed` (the nearest honest word) and resolved accepted. A
// decision already waiting out a wider-discussion window is resolved accepted;
// one already declined never reaches here, because the arrival would be closed.
export async function acceptArrivalByShortcut(arrival: typeof admission.$inferSelect) {
  if (!arrival.formResponseId) return admitArrival(arrival.id);
  const [existing] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, arrival.formResponseId));
  let decision: RecruitmentDecisionRow;
  if (!existing) {
    [decision] = await db
      .insert(recruitmentDecision)
      .values({ formResponseId: arrival.formResponseId, ruleOutcome: "proceed", resolution: "accepted" })
      .returning();
  } else if (existing.resolution === null) {
    [decision] = await db
      .update(recruitmentDecision)
      .set({ resolution: "accepted" })
      .where(eq(recruitmentDecision.id, existing.id))
      .returning();
  } else {
    decision = existing;
  }
  await recordArrivalDecision(arrival.formResponseId, "accepted");

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
  const widerDiscussionDeadline =
    result.outcome === "wider_discussion"
      ? new Date(Date.now() + communityRow.recruitmentWiderDiscussionHours * MS_PER_HOUR)
      : null;

  const [created] = await db
    .insert(recruitmentDecision)
    .values({
      formResponseId,
      ruleOutcome: result.outcome,
      defaultResolution: result.defaultResolution,
      resolution,
      widerDiscussionDeadline,
    })
    .returning();

  let decisionRow = created;
  await recordArrivalDecision(formResponseId, resolution);

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

export const resolveWiderDiscussionInput = z.object({
  resolution: z.enum(["accepted", "declined"]),
});
export type ResolveWiderDiscussionInput = z.infer<typeof resolveWiderDiscussionInput>;

// The human-call escape hatch spec names but doesn't mechanize: "an
// objection → evaluators see it and the outcome waits on a human
// call, not the timer." Callable any time resolution is still pending —
// but §2.6/J7 closed the loophole this used to have, which is the whole
// point of the redesign: a recruitment holder can no longer resolve a
// window that has a standing objection on it. The plan says that
// decision belongs to the mediation body ("the objection is never
// thrown out... it stands"), and this is where that promise is enforced
// rather than stated. A window with no objection is still a holder's to
// resolve — they can decline to wait out the clock, which is a decision
// about *timing*, not about overriding anybody's concern.
export async function resolveWiderDiscussionManually(
  actor: Member,
  formResponseId: string,
  input: ResolveWiderDiscussionInput,
) {
  await requireRecruitmentTaskHolder(actor);
  const [responseRow] = await db
    .select({ cycleId: formResponse.cycleId })
    .from(formResponse)
    .where(eq(formResponse.id, formResponseId));
  if (!responseRow) {
    throw new NotFoundError("Application not found");
  }
  // Deciding, like evaluating, is scoped to the holder's placement
  // (§4.3): a cycle-placed recorder only resolves their own cycle's
  // applications.
  await requireRecruitmentScopeForCycle(actor, responseRow.cycleId);
  const decision = await getRecruitmentDecision(formResponseId);
  if (!decision || decision.ruleOutcome !== "wider_discussion") {
    throw new NotFoundError("No open wider-discussion decision for this application");
  }
  if (decision.resolution) {
    throw new ConflictError("This decision has already resolved");
  }

  const [standing] = await db
    .select({ id: objection.id })
    .from(objection)
    .where(
      and(
        eq(objection.formResponseId, formResponseId),
        eq(objection.resolution, "standing"),
      ),
    )
    .limit(1);
  if (standing) {
    throw new ForbiddenError(
      "Someone has raised a concern about this arrival, and it isn't yours to wave through — the mediation team has to talk it through first",
    );
  }

  const [updated] = await db
    .update(recruitmentDecision)
    .set({ resolution: input.resolution })
    .where(eq(recruitmentDecision.id, decision.id))
    .returning();
  await recordArrivalDecision(decision.formResponseId, input.resolution);

  if (input.resolution === "accepted") {
    const communityRow = await getCommunityRow(actor.communityId);
    return applyAcceptanceSideEffects(actor, communityRow, updated);
  }
  return updated;
}

// Scheduled job (see src/instrumentation.ts) — the actual write a
// closed wider-discussion window needs, unlike the purely-read
// computeWiderDiscussionStatus above. Skips any decision with a raised
// Objection: "an objection → evaluators see it and the outcome waits
// on a human call, not the timer" — resolveWiderDiscussionManually is
// that human call.
export async function resolveWiderDiscussionWindows() {
  const due = await db
    .select()
    .from(recruitmentDecision)
    .where(
      and(
        eq(recruitmentDecision.ruleOutcome, "wider_discussion"),
        isNull(recruitmentDecision.resolution),
        lt(recruitmentDecision.widerDiscussionDeadline, new Date()),
      ),
    );

  let resolved = 0;
  let accompanimentsCreated = 0;
  for (const decision of due) {
    const [objectionRow] = await db
      .select({ id: objection.id })
      .from(objection)
      .where(
        and(
          eq(objection.formResponseId, decision.formResponseId),
          // §2.6/J7: only a *standing* objection holds the window. One
          // the body has already settled is history, and letting a
          // settled objection keep blocking the arrival would re-create
          // the veto-by-inaction this whole redesign is about.
          eq(objection.resolution, "standing"),
        ),
      )
      .limit(1);
    if (objectionRow) continue;

    const resolution = decision.defaultResolution === "proceed" ? "accepted" : "declined";
    const [updated] = await db
      .update(recruitmentDecision)
      .set({ resolution })
      .where(eq(recruitmentDecision.id, decision.id))
      .returning();
    resolved++;
    await recordArrivalDecision(decision.formResponseId, resolution);

    if (resolution === "accepted") {
      const [formRow] = await db
        .select({ communityId: form.communityId })
        .from(formResponse)
        .innerJoin(form, eq(formResponse.formId, form.id))
        .where(eq(formResponse.id, decision.formResponseId));
      const communityRow = await getCommunityRow(formRow.communityId);
      // Conversion needs no acting Member (it's a pure record-creation
      // step, same as findOrCreateMemberByEmail), so this still runs
      // even if the recruitment task currently has no holder —
      // Accompaniment's own task creation genuinely does need a real
      // actor to create a Task as, so that part alone stays gated on
      // one existing.
      const converted = await maybeConvertApplicantToMember(updated);
      // The job needs a real actor to create a Task as, so it resolves one:
      // the recruitment task's holder when there is a granting task, else the
      // fallback chain (the converted member's referrer, then the earliest
      // evaluator). Without the second path an open module with no granting
      // task would resolve wider-discussion windows but never create the
      // Accompaniment task that resolution is supposed to produce.
      const actorMember =
        (await getRecruitmentTaskHolderMember(communityRow)) ??
        (await resolveAccompanimentAuthor(communityRow, converted));
      if (actorMember) {
        const withTask = await applyAcceptanceSideEffects(actorMember, communityRow, converted);
        if (withTask?.accompanimentTaskId) accompanimentsCreated++;
      }
    }
  }

  return { checked: due.length, resolved, accompanimentsCreated };
}
