import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  communityInvite,
  form,
  formResponse,
  member,
  recruitmentApplicationInvite,
  recruitmentSubscription,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getForm, submitPublicFormResponse } from "../forms";
import { computeRecruitmentOutcome } from "./evaluations";
import { getCommunityRow, isRecruitmentTaskHolder, requireRecruitmentTaskHolder } from "./access";
import { computeWiderDiscussionStatus, getRecruitmentDecision } from "./decisions";
import { listObjections } from "./objections";

type Member = typeof memberTable.$inferSelect;

export async function getRecruitmentApplicationForm(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.recruitmentApplicationFormId) {
    return null;
  }
  return getForm(actor, communityRow.recruitmentApplicationFormId);
}

// Public — no actor. Used by /apply, which has no member session to
// scope a lookup through.
export async function getRecruitmentApplicationFormPublic(communityId: string) {
  const communityRow = await getCommunityRow(communityId);
  if (!communityRow.recruitmentApplicationFormId) {
    return null;
  }
  const [formRow] = await db
    .select()
    .from(form)
    .where(and(eq(form.id, communityRow.recruitmentApplicationFormId), eq(form.communityId, communityId)));
  return formRow ?? null;
}

export const submitRecruitmentApplicationInput = z.object({
  values: z.record(z.string(), z.unknown()),
  // Optional — see src/db/schema/recruitment.ts's
  // recruitmentApplicationInvite comment for why an applicant might
  // reference an invite link here instead of just redeeming it.
  inviteToken: z.string().min(1).nullable().optional(),
});
export type SubmitRecruitmentApplicationInput = z.infer<typeof submitRecruitmentApplicationInput>;

// Public — no actor. Always resolves the form id itself from
// Community.recruitmentApplicationFormId rather than accepting one
// from request input — see submitPublicFormResponse's own comment for
// why that matters.
export async function submitRecruitmentApplication(
  communityId: string,
  input: SubmitRecruitmentApplicationInput,
) {
  const communityRow = await getCommunityRow(communityId);
  requireModuleEnabled(communityRow, "recruitment");
  if (!communityRow.recruitmentApplicationFormId) {
    throw new AppError("No application form is configured for this Community yet");
  }

  // Validated up front, before creating the FormResponse — an invalid
  // token should never leave behind an orphaned, unlinked application
  // the applicant then has to notice and resubmit.
  let invite: typeof communityInvite.$inferSelect | undefined;
  if (input.inviteToken) {
    [invite] = await db
      .select()
      .from(communityInvite)
      .where(and(eq(communityInvite.token, input.inviteToken), eq(communityInvite.communityId, communityId)));
    if (!invite) {
      throw new NotFoundError("Invite link not found");
    }
    if (invite.revokedAt) {
      throw new ConflictError("This invite link has been revoked");
    }
  }

  const created = await submitPublicFormResponse(communityRow.recruitmentApplicationFormId, {
    values: input.values,
  });

  if (invite) {
    await db
      .insert(recruitmentApplicationInvite)
      .values({ formResponseId: created.id, communityInviteId: invite.id });
  }

  return created;
}

async function isSubscribed(actor: Member): Promise<boolean> {
  const [row] = await db
    .select({ active: recruitmentSubscription.active })
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  return Boolean(row?.active);
}

// "On submission, every member with an active RecruitmentSubscription
// gets alerted" — this codebase's existing "visible flag surfaced on a
// page, not a push notification" posture. A subscriber who doesn't
// hold the recruitment task sees that something's pending, never the
// applicant's actual answers — that's holder-only, via
// listApplicationsForEvaluation below.
export async function listApplicationAlerts(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.recruitmentApplicationFormId) {
    return [];
  }
  const isHolder = await isRecruitmentTaskHolder(actor);
  if (!isHolder && !(await isSubscribed(actor))) {
    throw new ForbiddenError("Subscribe to recruitment alerts, or hold the recruitment task, to see this");
  }

  const responses = await db
    .select({ id: formResponse.id, submittedAt: formResponse.submittedAt })
    .from(formResponse)
    .where(eq(formResponse.formId, communityRow.recruitmentApplicationFormId))
    .orderBy(desc(formResponse.submittedAt));

  return Promise.all(
    responses.map(async (r) => {
      const { outcome, evaluationsFiled, evaluatorsNeeded } = await computeRecruitmentOutcome(communityRow, r.id);
      const decision = await getRecruitmentDecision(r.id);
      return {
        id: r.id,
        submittedAt: r.submittedAt,
        evaluationsFiled,
        evaluatorsNeeded,
        outcome,
        resolution: decision?.resolution ?? null,
        widerDiscussionStatus: decision ? computeWiderDiscussionStatus(decision) : null,
      };
    }),
  );
}

// Holder-only — full applicant answers, filed evaluations, the
// live-computed outcome, and (once reached) the persisted decision
// plus any objections, one row per pending application.
export async function listApplicationsForEvaluation(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.recruitmentApplicationFormId) {
    return [];
  }

  const responses = await db
    .select()
    .from(formResponse)
    .where(eq(formResponse.formId, communityRow.recruitmentApplicationFormId))
    .orderBy(desc(formResponse.submittedAt));

  return Promise.all(
    responses.map(async (response) => {
      const { outcome, evaluationsFiled, evaluatorsNeeded, evaluations } = await computeRecruitmentOutcome(
        communityRow,
        response.id,
      );
      const decision = await getRecruitmentDecision(response.id);
      const objections = decision ? await listObjections(actor, response.id) : [];
      const convertedMember = decision?.convertedMemberId
        ? await db.select().from(member).where(eq(member.id, decision.convertedMemberId)).then((rows) => rows[0] ?? null)
        : null;
      return {
        response,
        evaluations,
        outcome,
        evaluationsFiled,
        evaluatorsNeeded,
        decision,
        widerDiscussionStatus: decision ? computeWiderDiscussionStatus(decision) : null,
        objections,
        convertedMember,
      };
    }),
  );
}
