import { and, desc, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { admission, admissionLane, communityInvite, cycle, member, memberIdentity } from "@/db/schema";
import type { member as memberTable, AdmissionVerification, JoinLaneKind } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { generateToken } from "../token";
import { seedCycleParticipation } from "../participation";
import { seedPrimaryContactMethod } from "../contact-methods";
import { findExistingMemberByLoginEmail, preferredMemberName } from "../member";
import { getCycleJoiningState } from "./joining";
import { getCommunityRow, listHeldRecruitmentScopes, requireRecruitmentTaskHolder } from "./access";
import {
  getInviteRedemptionPath,
  getJoinLaneRule,
  getJoinLaneRulesForContext,
  joiningLaneForInvite,
  pathHoldsCapacity,
  redemptionPathForInvite,
  settledPathForRule,
  type JoiningLaneRule,
  type JoiningRedemptionPath,
} from "./joining-lanes";
import { openNominationForInvite } from "./support";
import { completeConsensusArrival, consensusDisclosure, consensusWindowFor } from "./consensus";
import { createAdmissionArrival, readLaneSnapshot } from "./admission";
import { resolveInviteLane, declarationFromInvite, laneSnapshot } from "./admission-lanes";

type Member = typeof memberTable.$inferSelect;
type CommunityInviteRow = typeof communityInvite.$inferSelect;

export const createCommunityInviteInput = z.object({
  label: z.string().min(1).nullable().optional(),
  inviterThinksGoodFit: z.boolean().optional(),
  inviterKnowsPersonally: z.boolean().optional(),
  expiresAt: z.string().min(1).nullable().optional(),
  // docs/joining-admission-plan.md §2.1 — the marks below fix the
  // invite's *lane* at send time (knows-personally, good-fit, neither);
  // the cycle this invite is for (null = a general community invite)
  // picks the context its lane rule resolves in.
  cycleId: z.string().uuid().nullable().optional(),
  // §2.6/J10 — the inviter's awareness tick. Mandatory on a consensus
  // lane (the lib refuses the invite without it) and meaningless
  // anywhere else, so it is simply absent there rather than stored
  // false: "the inviter said nobody was told" is not a state anyone
  // should be able to express.
  awarenessConfirmed: z.boolean().optional(),
});
export type CreateCommunityInviteInput = z.infer<typeof createCommunityInviteInput>;

// Open to any member — generating an invite is a unilateral act, the
// same posture Shifts' createShiftSeries already takes for "rotate a
// task into a shift." Always single-use, no multi-use variant per
// spec's explicit CampTool callout.
//
// What the lane's rule does to the invite is the whole of
// docs/joining-admission-plan.md §2, and it happens here at creation so
// the inviter finds out *before* they hand the link over rather than the
// recipient finding out after:
//
//   direct     — redeems on the spot, and holds a capacity slot until
//                redeemed/revoked/expired (so into a capped event it
//                needs a real expiry);
//   nomination — a support window opens at creation, and the invitee is
//                routed to it. Holds nothing;
//   consensus  — the inviter must tick the awareness box, the invitee
//                consents and is announced at redemption, and the
//                community-check window opens there. Holds nothing;
//   process    — routes into the evaluated application, exactly as the
//                old `referral` mode did. Holds nothing.
export async function createCommunityInvite(actor: Member, input: CreateCommunityInviteInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const declaration = {
    inviterThinksGoodFit: input.inviterThinksGoodFit ?? false,
    inviterKnowsPersonally: input.inviterKnowsPersonally ?? false,
  };
  const lane = joiningLaneForInvite(declaration);
  const cycleId = input.cycleId ?? null;

  const rule = cycleId
    ? (await getJoinLaneRule(actor.communityId, cycleId, lane))
    : (await getJoinLaneRule(actor.communityId, null, lane));
  const path = (await import("./lanes")).redemptionPathForRule(rule);

  if (cycleId) {
    // Validates the cycle is in-community (throws NotFoundError
    // otherwise) and gives us its live door state.
    const joining = await getCycleJoiningState(actor.communityId, cycleId);
    if (joining.atCapacity) {
      throw new ConflictError("This event is full — no capacity left for new joins");
    }
    if (!joining.periodOpen) {
      throw new ConflictError("This event's joining period isn't open");
    }
    // Every path needs *some* door: the direct one on invites, the two
    // that go through an application on applications, and a lane that
    // asks for an interview additionally on interviews — the third door
    // §2.3 adds. Without the last check a community could close
    // interviews and still be signing people up for interviews.
    if (path === "direct") {
      if (!joining.cycle.invitesOpen) {
        throw new ConflictError("Invites for this event are closed");
      }
      if (rule.interviewRequired && !joining.cycle.interviewsOpen) {
        throw new ConflictError("Interviews for this event are closed");
      }
      if (joining.cycle.capacity !== null) {
        if (!input.expiresAt) {
          throw new AppError("Direct invites into a capacity-capped event need an expiry date");
        }
        if (new Date(input.expiresAt) <= new Date()) {
          throw new AppError("The expiry must be in the future — no immortal capacity holds");
        }
      }
    } else {
      if (!joining.cycle.applicationsOpen) {
        throw new ConflictError("Applications for this event are closed");
      }
      if (rule.interviewRequired && !joining.cycle.interviewsOpen) {
        throw new ConflictError("Interviews for this event are closed");
      }
    }
  } else if (path === "direct") {
    if (!communityRow.recruitmentInvitesOpen) {
      throw new AppError("This community isn't accepting invite-based joins right now");
    }
    if (rule.interviewRequired && !communityRow.recruitmentInterviewsOpen) {
      throw new AppError("This community isn't running interviews right now");
    }
  } else {
    // A non-direct general invite still funnels through /apply (or
    // through the support/consent pages that lead there), so both
    // community doors must be open — it is an invite link *and* its
    // path is the application funnel.
    if (!communityRow.recruitmentInvitesOpen) {
      throw new AppError("This community isn't accepting invite-based joins right now");
    }
    if (!communityRow.recruitmentApplicationsOpen) {
      throw new AppError("This community isn't accepting applications right now");
    }
    if (rule.interviewRequired && !communityRow.recruitmentInterviewsOpen) {
      throw new AppError("This community isn't running interviews right now");
    }
  }

  // J10's first consent step, enforced here rather than at redemption:
  // an inviter who hasn't told the invitee is the person who should be
  // stopped, and stopping them at send means the link never exists to be
  // sent. Deliberately not "warn and proceed" — a consensus lane whose
  // whole legitimacy is consent is not a lane you can use without it.
  if (rule.verificationMode === "consensus" && !input.awarenessConfirmed) {
    throw new AppError(
      "This lane announces every arrival to the community, so tick the box saying you've told them before you can send the invite",
    );
  }

  const [created] = await db
    .insert(communityInvite)
    .values({
      communityId: actor.communityId,
      createdBy: actor.id,
      token: generateToken(),
      cycleId,
      label: input.label ?? null,
      inviterThinksGoodFit: declaration.inviterThinksGoodFit,
      inviterKnowsPersonally: declaration.inviterKnowsPersonally,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      awarenessConfirmedAt: input.awarenessConfirmed ? new Date() : null,
      awarenessConfirmedBy: input.awarenessConfirmed ? actor.id : null,
      consensusState: rule.verificationMode === "consensus" ? "awaiting_consent" : "not_required",
    })
    .returning();

  // A nomination's window opens the moment the invite does, because the
  // inviter's support-poke list is chosen at send time (§2.4) and there
  // is nothing to poke about afterwards.
  if (path === "nomination") {
    await openNominationForInvite(created);
  }
  return created;
}

// What the inviter sees after creating one, so §5.3's "the marks are
// shown with their consequences" and "the poke member-picker or
// share-link option for nomination lanes" have something to render: the
// lane, the path, and — for a nomination — the support link to hand out
// or poke people with.
export type InviteFollowUp = {
  invite: CommunityInviteRow;
  lane: JoinLaneKind;
  path: JoiningRedemptionPath;
  rule: JoiningLaneRule;
  supportToken: string | null;
  supportDeadline: Date | null;
  interviewRequired: boolean;
};

export async function getInviteFollowUp(inviteId: string): Promise<InviteFollowUp | null> {
  const [invite] = await db.select().from(communityInvite).where(eq(communityInvite.id, inviteId));
  if (!invite) return null;
  const lane = joiningLaneForInvite(invite);
  const rule = await getJoinLaneRule(invite.communityId, invite.cycleId, lane);
  const { getNominationForInvite } = await import("./support");
  const nomination = await getNominationForInvite(invite.id);
  return {
    invite,
    lane,
    path: redemptionPathForInvite(invite, await getJoinLaneRulesForContext(invite.communityId, invite.cycleId)),
    rule,
    supportToken: nomination?.supportToken ?? null,
    supportDeadline: nomination?.deadline ?? null,
    interviewRequired: rule.interviewRequired,
  };
}

export async function listMyCommunityInvites(actor: Member) {
  return db
    .select()
    .from(communityInvite)
    .where(and(eq(communityInvite.communityId, actor.communityId), eq(communityInvite.createdBy, actor.id)))
    .orderBy(desc(communityInvite.createdAt));
}

async function getOwnCommunityInvite(actor: Member, inviteId: string) {
  const [row] = await db
    .select()
    .from(communityInvite)
    .where(and(eq(communityInvite.id, inviteId), eq(communityInvite.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Invite not found");
  }
  if (row.createdBy !== actor.id) {
    throw new ForbiddenError("Only the member who created this invite can revoke it");
  }
  return row;
}

export async function revokeCommunityInvite(actor: Member, inviteId: string) {
  const row = await getOwnCommunityInvite(actor, inviteId);
  if (row.redeemedAt) {
    throw new ConflictError("This invite has already been redeemed");
  }
  if (row.revokedAt) {
    throw new ConflictError("This invite has already been revoked");
  }

  const [updated] = await db
    .update(communityInvite)
    .set({ revokedAt: new Date() })
    .where(eq(communityInvite.id, inviteId))
    .returning();
  return updated;
}

export type CommunityInviteStatus = "valid" | "redeemed" | "revoked" | "expired" | "not_found";

export function communityInviteStatus(row: CommunityInviteRow | undefined): CommunityInviteStatus {
  if (!row) return "not_found";
  if (row.redeemedAt) return "redeemed";
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt < new Date()) return "expired";
  return "valid";
}

// Public — no actor, no community-scoping input (the token alone
// identifies both). Used by the /invite/[token] page to decide which of
// the four §2 paths to render.
export async function getCommunityInviteByToken(token: string) {
  const [row] = await db.select().from(communityInvite).where(eq(communityInvite.token, token));
  return row;
}

export type CommunityInviteRedemptionPath = JoiningRedemptionPath;

export async function getCommunityInviteRedemptionPath(row: CommunityInviteRow): Promise<CommunityInviteRedemptionPath> {
  return getInviteRedemptionPath(row.communityId, row);
}

// Back-compat alias for the two-path vocabulary the rest of the
// codebase used before the redesign; "is this an invite that hands over
// a member on the spot" is still the only question several call sites
// ask, and answering it with a four-way path would have them all
// re-implement the same two-line test.
export async function getCommunityInviteRedeemsDirectly(row: CommunityInviteRow): Promise<boolean> {
  return (await getCommunityInviteRedemptionPath(row)) === "direct";
}

// §4.3/8d + docs/joining-admission-plan.md §2 pipeline visibility:
// outstanding *cycle* invites whose path is anything but `direct`
// belong on the recruitment pipeline alongside the applications
// themselves, because that is where they funnel — a nomination is
// waiting for supporters, a check window for the community, a process
// lane for evaluators, and in all three cases the recruitment team is
// the one who will be asked about it. The lane is fixed at creation;
// resolution reads the cycle's own `joining_lane` row, else the
// community-wide one. Scope-filtering follows listApplicationsForEvaluation
// exactly: a cycle-placed holder sees only their own cycle's; the
// cycle-less community/evergreen holder sees all of them. General
// (cycle-less) invites resolve like any lane but are not part of this
// count.
export async function listOutstandingReferralInvites(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const heldScopes = await listHeldRecruitmentScopes(actor);
  if (heldScopes.size === 0) return [];

  const now = new Date();
  const rows = await db
    .select({
      id: communityInvite.id,
      cycleId: communityInvite.cycleId,
      label: communityInvite.label,
      createdAt: communityInvite.createdAt,
      inviterThinksGoodFit: communityInvite.inviterThinksGoodFit,
      inviterKnowsPersonally: communityInvite.inviterKnowsPersonally,
      consensusState: communityInvite.consensusState,
    })
    .from(communityInvite)
    .where(
      and(
        eq(communityInvite.communityId, actor.communityId),
        isNotNull(communityInvite.cycleId),
        isNull(communityInvite.redeemedAt),
        isNull(communityInvite.revokedAt),
        or(isNull(communityInvite.expiresAt), gt(communityInvite.expiresAt, now)),
      ),
    )
    .orderBy(desc(communityInvite.createdAt));
  if (rows.length === 0) return [];

  const cycleRows = await db
    .select({ id: cycle.id, name: cycle.name })
    .from(cycle)
    .where(
      and(
        eq(cycle.communityId, actor.communityId),
        inArray(cycle.id, [...new Set(rows.filter((r) => r.cycleId).map((r) => r.cycleId as string))]),
      ),
    );
  const cycleNames = new Map(cycleRows.map((c) => [c.id, c.name]));
  const rulesByCycle = new Map<string, Map<JoinLaneKind, JoiningLaneRule>>();
  const rulesFor = async (cycleId: string) => {
    if (!rulesByCycle.has(cycleId)) {
      rulesByCycle.set(cycleId, await getJoinLaneRulesForContext(actor.communityId, cycleId));
    }
    return rulesByCycle.get(cycleId)!;
  };

  const processInvites = [];
  for (const r of rows) {
    if (!r.cycleId) continue;
    if (!(heldScopes.has(null) || heldScopes.has(r.cycleId))) continue;
    const rules = await rulesFor(r.cycleId);
    if (pathHoldsCapacity(redemptionPathForInvite(r, rules))) continue;
    processInvites.push({ ...r, cycleId: r.cycleId, cycleName: cycleNames.get(r.cycleId) ?? "" });
  }
  return processInvites;
}

export const redeemCommunityInviteInput = z.object({
  email: z.string().email(),
  // §2.6/J10's binding consent. Required — and required *to be true* —
// on a consensus lane, absent everywhere else. The action writes the
// disclosure text it was shown alongside the tick, so the record
// answers "what were they told" rather than just "did they agree".
  consentAccepted: z.boolean().optional(),
  disclosure: z.string().optional(),
});
export type RedeemCommunityInviteInput = z.infer<typeof redeemCommunityInviteInput>;

export type RedemptionOutcome =
  // The person is admitted immediately (direct lane: no verification, no application, no interview).
  | { kind: "admitted"; arrivalId: string; token: string; memberId: string; redirectTo: string }
  // A community-check lane: the person has consented, the arrival is announced,
  // and the community check window runs. They are not a member yet.
  | { kind: "check"; arrivalId: string; token: string; deadline: Date }
  // A lane with a process (application and/or interview): the person is in the funnel.
  // nextStep is "application" or "interview" depending on the lane.
  | { kind: "process"; arrivalId: string; token: string; nextStep: "application" | "interview" }
  // A lane with a support shortcut: the person can ask for supports alongside their path.
  // The supportToken lets them render the support view.
  | { kind: "support_shortcut"; arrivalId: string; token: string; supportToken: string; supportShortcutCount: number }
  // The person is told they need to apply (process lane but not yet submitted).
  // This is the old "process" outcome.
  | { kind: "apply"; arrivalId: string; token: string };

// Public — no actor. "Redeeming a valid, unexpired, unredeemed,
// unrevoked token *is* the proof of legitimacy" (docs/spec.md), so for
// any path that hands over a Member this creates one outright, no
// magic-link round-trip needed. Deliberately doesn't call
// createSession itself — that touches next/headers, which only works
// inside a Route Handler/Server Action, not this framework-agnostic lib
// layer (same separation findOrCreateMemberByEmail already keeps). The
// caller starts the session with the returned Member's id, same as the
// ordinary magic-link verify route already does.
export async function redeemCommunityInvite(
  inviteToken: string,
  input: RedeemCommunityInviteInput,
): Promise<RedemptionOutcome> {
  const invite = await getCommunityInviteByToken(inviteToken);
  if (!invite) {
    throw new NotFoundError("Invite link not found");
  }
  const status = communityInviteStatus(invite);
  if (status === "redeemed") {
    throw new ConflictError("This invite link has already been used");
  }
  if (status === "revoked") {
    throw new ConflictError("This invite link has been revoked");
  }
  if (status === "expired") {
    throw new ConflictError("This invite link has expired");
  }
  const communityRow = await getCommunityRow(invite.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  // Resolve the lane from the new admission_lane table (with fallback to old joining_lane)
  const declaration = declarationFromInvite(invite);
  const lane = await resolveInviteLane(invite.communityId, declaration);
  if (!lane) {
    throw new AppError("No lane is configured for this type of invite");
  }

  // Check if the lane is a direct lane (no verification, no application, no interview)
  const isDirect = lane.verification === "none" && !lane.applicationRequired && !lane.interviewRequired;

  // Check if it's a community check lane
  const isCommunityCheck = lane.verification === "community_check";

  // Check if the lane has a process (application or interview)
  const hasProcess = lane.applicationRequired || lane.interviewRequired;

  // Check if the lane has a support shortcut
  const hasSupportShortcut = (lane.supportShortcutCount ?? 0) > 0;

  // For a community check lane, require consent
  if (isCommunityCheck && !input.consentAccepted) {
    throw new AppError(
      "Joining through this invite means your arrival is announced to the community — read the disclosure and tick the box to go on",
    );
  }

  const email = input.email.trim().toLowerCase();
  // Every way an address can already belong to somebody, not just the
  // magic_link identity this used to check.
  const existing = await findExistingMemberByLoginEmail(email);
  if (existing) {
    throw new ConflictError("This email already belongs to a member — log in instead");
  }

  // Get the lane snapshot for the arrival
  const snapshot = laneSnapshot(lane);

  // Get the person's name (from the inviter's label or a default)
  const name = invite.label ?? preferredMemberName(null, null, null, email);

  // Get community info for consensus window
  const { communityName, windowHours } = await consensusWindowFor(invite.communityId);
  const disclosure =
    input.disclosure?.trim() || consensusDisclosure(communityName, windowHours);

  // Create the arrival row with the lane snapshot
  const { arrivalId, token } = await createAdmissionArrival({
    communityId: invite.communityId,
    cycleId: invite.cycleId,
    email,
    name,
    laneId: lane.id,
    route: "invite",
    origin: "funnel",
    inviteId: invite.id,
    formResponseId: undefined,
    requiredVerification: snapshot.requiredVerification,
    requiredApplication: snapshot.requiredApplication,
    requiredInterview: snapshot.requiredInterview,
    requiredEvaluation: snapshot.requiredEvaluation,
    reportsNeeded: snapshot.reportsNeeded,
    supportShortcutCount: snapshot.supportShortcutCount,
  });

  // Update the invite with redemption info
  const isConsensus = isCommunityCheck;
  const deadline = isConsensus ? new Date(Date.now() + windowHours * 3_600_000) : null;

  await db
    .update(communityInvite)
    .set({
      redeemedAt: new Date(),
      redeemedByMemberId: null, // No member yet — they become a member at admission
      ...(isConsensus
        ? { consentAt: new Date(), consentDisclosure: disclosure, consensusState: "announced" as const, consensusDeadline: deadline }
        : {}),
    })
    .where(and(eq(communityInvite.id, invite.id), isNull(communityInvite.redeemedAt)));

  // If it's a direct lane (no verification, no application, no interview),
  // admit immediately through the admission function
  if (isDirect) {
    // TODO: Call the admission function to create the Member
    // For now, return the admitted outcome with the arrival token
    // The admission function will be called by the caller or a background job
    // We need to create the member here since there's no process
    const newMember = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(member)
        .values({
          communityId: invite.communityId,
          name: preferredMemberName(null, null, null, email),
          referredByMemberId: invite.createdBy,
          joinedViaInviteId: invite.id,
        })
        .returning();

      await tx.insert(memberIdentity).values({
        memberId: created.id,
        provider: "magic_link",
        loginEmail: email,
      });

      await seedPrimaryContactMethod(tx, created.id, email, { verified: false });

      // Update the arrival with the member ID
      await tx
        .update(admission)
        .set({ admittedAt: new Date(), admittedMemberId: created.id })
        .where(eq(admission.id, arrivalId));

      // Update the invite with the member ID
      await tx
        .update(communityInvite)
        .set({ redeemedByMemberId: created.id })
        .where(eq(communityInvite.id, invite.id));

      // Seed participation for cycle invites (D14)
      if (invite.cycleId) {
        await seedCycleParticipation(tx, invite.cycleId, created.id);
      }

      return created;
    });

    // Mark the arrival as admitted
    await db
      .update(admission)
      .set({ admittedAt: new Date(), admittedMemberId: newMember.id })
      .where(eq(admission.id, arrivalId));

    const { firstLoginDestinationFor } = await import("@/lib/first-login");
    return {
      kind: "admitted",
      arrivalId,
      token,
      memberId: newMember.id,
      redirectTo: await firstLoginDestinationFor(newMember.id),
    };
  }

  // For community check: consent given, window opens
  if (isCommunityCheck) {
    const deadline = new Date(Date.now() + windowHours * 3_600_000);
    await db
      .update(communityInvite)
      .set({ consensusDeadline: deadline })
      .where(eq(communityInvite.id, invite.id));

    // Record consent
    await db
      .update(communityInvite)
      .set({ consentAt: new Date(), consentDisclosure: disclosure, consensusState: "announced" as const, consensusDeadline: deadline })
      .where(eq(communityInvite.id, invite.id));

    // Record consent for the arrival
    await db
      .update(admission)
      .set({ consentGivenAt: new Date() })
      .where(eq(admission.id, arrivalId));

    return {
      kind: "check",
      arrivalId,
      token,
      deadline,
    };
  }

  // For process lanes (application and/or interview)
  if (hasProcess) {
    // If it has an application, the next step is the application
    // If it only has an interview (no application), the next step is the interview
    const nextStep = lane.applicationRequired ? "application" : "interview";

    // If there's a support shortcut, include the support token
    if (hasSupportShortcut) {
      // The support token is the arrival's token - supporters use this
      return {
        kind: "support_shortcut",
        arrivalId,
        token,
        supportToken: token,
        supportShortcutCount: lane.supportShortcutCount!,
      };
    }

    return {
      kind: "process",
      arrivalId,
      token,
      nextStep,
    };
  }

  // If no process and not direct, fall through to apply
  return {
    kind: "apply",
    arrivalId,
    token,
  };
}

// The window's own admission write, exposed so the /invite page can ask
// "did this one land while nobody objected?" without reaching into
// consensus.ts's internals.
export { completeConsensusArrival };
