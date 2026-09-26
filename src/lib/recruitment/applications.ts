import { and, desc, eq, inArray } from "drizzle-orm";
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
import { getCycleJoiningState, type CycleJoiningState } from "./joining";
import { getInviteRedemptionKind } from "./joining-lanes";
import { getCommunityRow, isRecruitmentTaskHolder, listHeldRecruitmentScopes, requireRecruitmentTaskHolder } from "./access";
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
  // The cycle this application is for (§4.3/8c): null = the community's
  // general, cycle-less door. When set, the cycle's own joining config
  // gates the submission and the response is tagged with the cycle.
  cycleId: z.string().uuid().nullable().optional(),
});
export type SubmitRecruitmentApplicationInput = z.infer<typeof submitRecruitmentApplicationInput>;

// Public — no actor. Always resolves the form id itself from the
// Community/Cycle config rather than accepting one from request input —
// see submitPublicFormResponse's own comment for why that matters.
export async function submitRecruitmentApplication(
  communityId: string,
  input: SubmitRecruitmentApplicationInput,
) {
  const communityRow = await getCommunityRow(communityId);
  requireModuleEnabled(communityRow, "recruitment");

  // Validated up front, before resolving the door or creating the
  // FormResponse — an invalid token should never leave behind an
  // orphaned, unlinked application the applicant then has to notice and
  // resubmit.
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

  // Which door does this submission knock on (§4.3/8c)? A cycle-targeted
  // application gates on the cycle's own joining state (period + door +
  // capacity room); the general application gates on the community-wide
  // door toggle. An invite's *lane* — fixed at creation by the
  // inviter's marks, docs/joining-admission-plan.md §2 — decides whether
  // its token belongs here at all: a direct lane redeems on
  // /invite/[token] and is rejected on /apply; every process lane routes
  // through this funnel (the token is the vouch, tagging the
  // application with the invite's cycle — §4.3/8d).
  let targetCycleId = input.cycleId ?? null;
  if (invite?.cycleId) {
    if (input.cycleId && input.cycleId !== invite.cycleId) {
      throw new AppError("This invite is for a different event");
    }
    targetCycleId = invite.cycleId;
  }
  if (invite) {
    if ((await getInviteRedemptionKind(communityId, invite)) === "direct") {
      // A direct-lane invite skips the funnel entirely — it redeems on
      // /invite/[token], not through the evaluated application.
      throw new AppError("This invite redeems directly — open its join link instead of applying");
    }
  }
  const joining = targetCycleId ? await getCycleJoiningState(communityId, targetCycleId) : null;
  if (joining) {
    if (joining.atCapacity) {
      throw new AppError("This event is full — no capacity left for new applications");
    }
    if (!joining.periodOpen) {
      throw new AppError("Applications for this event aren't open right now");
    }
    if (!joining.cycle.applicationsOpen) {
      throw new AppError("Applications for this event are closed");
    }
  } else if (!communityRow.recruitmentApplicationsOpen) {
    throw new AppError("This community isn't accepting applications right now");
  }

  const formId = joining?.cycle.recruitmentApplicationFormId ?? communityRow.recruitmentApplicationFormId;
  if (!formId) {
    throw new AppError("No application form is configured for this Community yet");
  }

  const created = await submitPublicFormResponse(formId, { values: input.values });

  // Linked whether or not the response is cycle-tagged — the invite's
  // checkboxes feed outcome matching either way (the referral half of
  // §4.3/8d routes the token through this same path).
  if (invite) {
    await db
      .insert(recruitmentApplicationInvite)
      .values({ formResponseId: created.id, communityInviteId: invite.id });
  }

  if (joining) {
    const [tagged] = await db
      .update(formResponse)
      .set({ cycleId: joining.cycle.id })
      .where(eq(formResponse.id, created.id))
      .returning();
    return tagged;
  }

  return created;
}

// The form a public join lands on — the cycle's own pointer falling
// back to the community's standing form (§4.3/8c). Shared by /apply's
// page (to render the door/context, or "not accepting" copy instead of
// a form) and its action (to build the fields, then submit).
export type PublicApplicationFormResolution =
  | { kind: "general"; form: typeof form.$inferSelect | null; applicationsOpen: boolean }
  | { kind: "cycle"; form: typeof form.$inferSelect | null; joining: CycleJoiningState };

export async function resolvePublicApplicationForm(
  communityId: string,
  cycleId: string | null,
): Promise<PublicApplicationFormResolution> {
  const communityRow = await getCommunityRow(communityId);
  if (!cycleId) {
    const formRow = communityRow.recruitmentApplicationFormId
      ? await getRecruitmentApplicationFormPublicById(communityId, communityRow.recruitmentApplicationFormId)
      : null;
    return { kind: "general", form: formRow, applicationsOpen: communityRow.recruitmentApplicationsOpen };
  }
  const joining = await getCycleJoiningState(communityId, cycleId);
  const formId = joining.cycle.recruitmentApplicationFormId ?? communityRow.recruitmentApplicationFormId;
  const formRow = formId ? await getRecruitmentApplicationFormPublicById(communityId, formId) : null;
  return { kind: "cycle", form: formRow, joining };
}

export async function getRecruitmentApplicationFormPublicById(communityId: string, formId: string) {
  const [formRow] = await db
    .select()
    .from(form)
    .where(and(eq(form.id, formId), eq(form.communityId, communityId)));
  return formRow ?? null;
}

// Human-readable door enforcement for a resolved application surface —
// the /apply action runs this to turn a shut or unconfigured door into
// a clean redirect error; the page uses the resolution's bare state to
// render "not accepting" copy instead of a form.
export function requireApplicationDoorOpen(resolution: PublicApplicationFormResolution) {
  if (resolution.kind === "general") {
    if (!resolution.form) {
      throw new AppError("No application form is configured for this Community yet");
    }
    if (!resolution.applicationsOpen) {
      throw new AppError("This community isn't accepting applications right now");
    }
    return;
  }
  if (!resolution.form) {
    throw new AppError("No application form is configured for this event yet");
  }
  const { joining } = resolution;
  if (joining.atCapacity) {
    throw new AppError("This event is full — no capacity left for new applications");
  }
  if (!joining.periodOpen) {
    throw new AppError("Applications for this event aren't open right now");
  }
  if (!joining.cycle.applicationsOpen) {
    throw new AppError("Applications for this event are closed");
  }
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
// plus any objections, one row per pending application. Scoped by the
// holder's recruitment placement (docs/cycle-scope-remediation-plan.md
// §4.3): a cycle-placed holder sees only that cycle's applications
// (formResponse.cycleId in their held scopes); a holder of the
// cycle-less community/evergreen task sees every application — its own
// cycle's and untagged — the same filter feedback's
// listPostCycleFeedbackResponses already builds.
export async function listApplicationsForEvaluation(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const communityRow = await getCommunityRow(actor.communityId);
  if (!communityRow.recruitmentApplicationFormId) {
    return [];
  }

  const heldScopes = await listHeldRecruitmentScopes(actor);
  const conditions = [eq(formResponse.formId, communityRow.recruitmentApplicationFormId)];
  if (!heldScopes.has(null)) {
    conditions.push(
      inArray(
        formResponse.cycleId,
        [...heldScopes].filter((c): c is string => c !== null),
      ),
    );
  }

  const responses = await db
    .select()
    .from(formResponse)
    .where(and(...conditions))
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
