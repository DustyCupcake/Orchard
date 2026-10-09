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
import { getInviteRedemptionPath, getJoinLaneRule, joiningLaneForInvite } from "./joining-lanes";
import { getCommunityRow, isRecruitmentTaskHolder, listHeldRecruitmentScopes, requireRecruitmentTaskHolder } from "./access";
import { computeWiderDiscussionStatus, getRecruitmentDecision } from "./decisions";
import { listObjections } from "./objections";
import { consensusDisclosure, consensusWindowFor, recordApplicationConsent } from "./consensus";
import { openNominationForApplication } from "./support";
import { attachApplicantToPairing, createPairings, resolvePairingForApplication } from "./pairs";
import type { JoinLaneKind } from "@/db/schema";

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
  // §2.8 — "who are you sticking with", for an applicant naming another
  // applicant. The link that carries this is the pairing link, and the
  // pair is recorded at the funnel: the platform never decides anything
  // from it (J9), it only exists so the two humans can be offered a
  // shared interview and can see each other's name.
  pairingToken: z.string().min(1).nullable().optional(),
  // §2.8 — names the *members* this applicant is coming with. Each one
  // gets a pairing link; a member who opens it sees the support view.
  pairingMemberIds: z.array(z.string().uuid()).max(20).default([]),
  // J10's binding consent, for a public lane the community set to
  // consensus. Read and ticked on /apply itself (there is no
  // redemption step for somebody who applied on their own), and stored
  // with the exact disclosure that was shown.
  consentAccepted: z.boolean().optional(),
  disclosure: z.string().optional(),
});
export type SubmitRecruitmentApplicationInput = z.input<typeof submitRecruitmentApplicationInput>;
export type ParsedRecruitmentApplicationInput = z.output<typeof submitRecruitmentApplicationInput>;

// Public — no actor. Always resolves the form id itself from the
// Community/Cycle config rather than accepting one from request input —
// see submitPublicFormResponse's own comment for why that matters.
//
// Takes the schema's *input* type, not its output, so a caller can
// submit just the answers and let the defaults (no pairing, no consent,
// no cycle) apply — which is the shape the plain /apply form and the
// public JSON API both actually send.
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
  const pairing = input.pairingToken
    ? await resolvePairingForApplication(input.pairingToken)
    : null;
  if (input.pairingToken && !pairing) {
    throw new NotFoundError("That pairing link isn't valid any more");
  }
  if (pairing && pairing.communityId !== communityId) {
    throw new AppError("That pairing link belongs to another community");
  }

  // Which door does this submission knock on (§4.3/8c)? A cycle-targeted
  // application gates on the cycle's own joining state (period + door +
  // capacity room); the general application gates on the community-wide
  // door toggles. An invite's *lane* — fixed at creation by the
  // inviter's marks, docs/plans/archive/joining-admission-plan.md §2 — decides whether
  // its token belongs here at all: a direct lane redeems on
  // /invite/[token] and is rejected on /apply, while nomination and
  // consensus are *this* page with the lane's own window around it, and
  // a basic process lane is the plain evaluated funnel the token has
  // always been (§4.3/8d).
  let targetCycleId = input.cycleId ?? null;
  if (invite?.cycleId) {
    if (input.cycleId && input.cycleId !== invite.cycleId) {
      throw new AppError("This invite is for a different event");
    }
    targetCycleId = invite.cycleId;
  }
  if (pairing?.cycleId && !targetCycleId) {
    targetCycleId = pairing.cycleId;
  }
  if (invite) {
    const path = await getInviteRedemptionPath(communityId, invite);
    if (path === "direct") {
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

  // Which lane is this application on? An invite answers for itself; a
  // public applicant's is the public lane by definition, and its rule is
  // the one that decides whether they are asked for support, for a
  // community-check consent, or for nothing at all.
  const lane: JoinLaneKind = invite ? joiningLaneForInvite(invite) : "public_application";
  const rule = await getJoinLaneRule(communityId, targetCycleId, lane);

  // J10 — a consensus lane's consent is the applicant's own, read here
  // and stored with the text they read. Refusing it is not a refusal to
  // apply (nothing is created); it just isn't this community's door.
  if (rule.verificationMode === "consensus") {
    if (!input.consentAccepted) {
      throw new AppError(
        "Applying through this door means your arrival is announced to the community — read the disclosure and tick the box to go on",
      );
    }
  }

  const formId = joining?.cycle.recruitmentApplicationFormId ?? communityRow.recruitmentApplicationFormId;
  if (!formId) {
    throw new AppError("No application form is configured for this Community yet");
  }

  const created = await submitPublicFormResponse(formId, { values: input.values });

  if (rule.verificationMode === "consensus") {
    const { communityName, windowHours } = await consensusWindowFor(communityId);
    await recordApplicationConsent(
      created.id,
      input.disclosure?.trim() || consensusDisclosure(communityName, windowHours),
    );
  }

  // Linked whether or not the response is cycle-tagged — the invite's
  // checkboxes feed outcome matching either way (the referral half of
  // §4.3/8d routes the token through this same path).
  if (invite) {
    await db
      .insert(recruitmentApplicationInvite)
      .values({ formResponseId: created.id, communityInviteId: invite.id });
  }

  // §2.2/J6 — a nomination lane opens its support window here, for the
  // same reason an invite opens one at send: the applicant is about to
  // be handed a link, and the whole point is that they have it early
  // enough to actually ask somebody.
  if (rule.verificationMode === "nomination") {
    await openNominationForApplication(created.id, communityId);
  }

  let tagged = created;
  if (joining) {
    const [updated] = await db
      .update(formResponse)
      .set({ cycleId: joining.cycle.id })
      .where(eq(formResponse.id, created.id))
      .returning();
    tagged = updated;
  }

  // §2.8 — the pair is a fact recorded at the funnel. Nothing reads it
  // to make a decision; it exists so two humans can be shown each other's
  // name and offered one interview between them.
  if (pairing) {
    await attachApplicantToPairing(pairing.token, created.id, targetCycleId);
  }
  const pairingMemberIds = input.pairingMemberIds ?? [];
  if (invite && pairingMemberIds.length > 0) {
    // The pair needs a `requestedById` — a pairing with nobody behind it
    // isn't a pairing — and the applicant isn't a member yet, so there
    // is no Member row of theirs to point at. The inviter is the person
    // actually standing behind this arrival, so that is who gets named.
    // A public applicant with no invite behind them gets no automatic
    // pairing: the recruitment team can still link the two by hand
    // (§2.8's manual route), which has a real member doing it, rather
    // than the platform inventing a "who is this from?" record.
    await createPairings(
      { communityId, memberId: invite.createdBy },
      { nomineeMemberIds: pairingMemberIds, pokeMemberIds: [], cycleId: targetCycleId, firstResponseId: created.id },
      { requireMember: false },
    );
  }

  return tagged;
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
// holder's recruitment placement (docs/plans/archive/cycle-scope-remediation-plan.md
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
