import { and, desc, eq, gt, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { admission, communityInvite, cycle } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { generateToken } from "../token";
import { findExistingMemberByLoginEmail, preferredMemberName } from "../member";
import { entryRefusal } from "./joining";
import { getCommunityRow, listHeldRecruitmentScopes, requireRecruitmentTaskHolder } from "./access";
import { consensusDisclosure, consensusWindowFor } from "./consensus";
import { getOpenCheck } from "./community-check";
import { admitArrival, createAdmissionArrival, releaseWaitlist } from "./admission";
import {
  declarationFromInvite,
  listOpenLanes,
  resolveInviteLane,
  type AdmissionLane,
} from "./admission-lanes";
import { DECLARATION_LABELS, laneHandles, laneHoldsCapacity, laneRoute, type LaneRoute } from "./lane-rules";
import { laneRuleOf } from "./admission-lanes";

type Member = typeof memberTable.$inferSelect;
type CommunityInviteRow = typeof communityInvite.$inferSelect;

export const createCommunityInviteInput = z.object({
  label: z.string().min(1).nullable().optional(),
  inviterThinksGoodFit: z.boolean().optional(),
  inviterKnowsPersonally: z.boolean().optional(),
  expiresAt: z.string().min(1).nullable().optional(),
  // docs/plans/archive/joining-admission-plan.md §2.1 — the marks below fix the
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
// The inviter's two marks pick the lane (docs/plans/admission-flow.md §2a), and
// what the lane asks of the invitee happens to the invite here at creation
// so the inviter finds out *before* they hand the link over rather than the
// recipient finding out after:
//
//   direct  — the invitee is admitted the moment they redeem, and the issued
//             invite holds a place in a capped event until redeemed, revoked
//             or expired (so into a capped event it needs a real expiry);
//   check   — the inviter must tick the awareness box, the invitee consents
//             and is announced at redemption, and the community-check window
//             opens there. Holds nothing;
//   process — an application and/or an interview. Holds nothing.
//
// If no lane in this context takes this kind of invite, there is nothing to
// send: the inviter is told so in a sentence, not left with a link that
// can't be used.
export async function createCommunityInvite(actor: Member, input: CreateCommunityInviteInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const marks = {
    inviterThinksGoodFit: input.inviterThinksGoodFit ?? false,
    inviterKnowsPersonally: input.inviterKnowsPersonally ?? false,
  };
  const declaration = declarationFromInvite(marks);
  const cycleId = input.cycleId ?? null;

  const lane = await resolveInviteLane(actor.communityId, cycleId, declaration);
  if (!lane) {
    throw new ConflictError(
      cycleId
        ? `This event doesn't take invitations from someone who ${DECLARATION_LABELS[declaration]}.`
        : `This community isn't taking invitations from someone who ${DECLARATION_LABELS[declaration]} right now.`,
    );
  }
  const route = laneRoute(laneRuleOf(lane));

  // The doors, checked where they matter (docs/plans/admission-flow.md §6) by the same
  // function that checks them when the link is opened and when an application
  // is sent. A closed interviews door is not among them: it holds an arrival at
  // the interview step rather than stopping anyone at the entrance.
  const refusal = await entryRefusal({ communityId: actor.communityId, cycleId, lane, via: "invite_created" });
  if (refusal) throw new ConflictError(refusal);

  // An invite that admits at once holds a place in a capped event until it is
  // redeemed, revoked or expires, so one of those needs to be a real date.
  if (cycleId && route === "direct") {
    const [capped] = await db.select({ capacity: cycle.capacity }).from(cycle).where(eq(cycle.id, cycleId));
    if (capped && capped.capacity !== null) {
      if (!input.expiresAt) {
        throw new AppError("Direct invites into a capacity-capped event need an expiry date");
      }
      if (new Date(input.expiresAt) <= new Date()) {
        throw new AppError("The expiry must be in the future — no immortal capacity holds");
      }
    }
  }

  // J10's first consent step, enforced here rather than at redemption: an
  // inviter who hasn't told the invitee is the person who should be stopped,
  // and stopping them at send means the link never exists to be sent.
  // Deliberately not "warn and proceed" — a lane whose whole legitimacy is
  // consent is not a lane you can use without it.
  if (route === "check" && !input.awarenessConfirmed) {
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
      inviterThinksGoodFit: marks.inviterThinksGoodFit,
      inviterKnowsPersonally: marks.inviterKnowsPersonally,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      awarenessConfirmedAt: input.awarenessConfirmed ? new Date() : null,
      awarenessConfirmedBy: input.awarenessConfirmed ? actor.id : null,
    })
    .returning();
  return created;
}

// What the inviter sees after creating one, so "the marks are shown with
// their consequences" has something to render: the lane the invite will
// take, and which way that lane goes.
export type InviteFollowUp = {
  invite: CommunityInviteRow;
  lane: AdmissionLane | null;
  route: LaneRoute | null;
};

// What an inviter is told about the community check on someone they invited: that it
// is open, or that it ended with the person declined. Nothing about who raised a
// concern or what it was — the inviter is outside the shield by design (§5).
export type InviteCheckState = "open" | "declined" | null;

export async function listMyCommunityInvites(actor: Member) {
  const rows = await db
    .select()
    .from(communityInvite)
    .where(and(eq(communityInvite.communityId, actor.communityId), eq(communityInvite.createdBy, actor.id)))
    .orderBy(desc(communityInvite.createdAt));
  const redeemed = rows.filter((r) => r.redeemedAt);
  const arrivals = redeemed.length
    ? await db
        .select()
        .from(admission)
        .where(inArray(admission.inviteId, redeemed.map((r) => r.id)))
    : [];
  const byInvite = new Map(arrivals.map((a) => [a.inviteId, a]));
  const out: (CommunityInviteRow & { checkState: InviteCheckState })[] = [];
  for (const row of rows) {
    const arrival = byInvite.get(row.id);
    let checkState: InviteCheckState = null;
    if (arrival && (await getOpenCheck(arrival.id))) checkState = "open";
    else if (arrival?.declinedAt && arrival.requiredVerification === "community_check") checkState = "declined";
    out.push({ ...row, checkState });
  }
  return out;
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
  // A direct invite was holding a place in its event; that place is free now.
  if (updated.cycleId) await releaseWaitlist(updated.cycleId);
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

/**
 * The lane an invite takes *now*, in the context it was issued for, and
 * where that lane goes. Resolved live on purpose: an invite is a promise made
 * before anyone arrived, and the lane only becomes a person's path — copied
 * onto their arrival — when they use it. Null when no lane open in that
 * context takes this kind of invite any more, in which case the invite is
 * held rather than revoked (§2a): nothing is lost, and it works again if the
 * lane does.
 */
export async function getCommunityInviteLane(
  row: CommunityInviteRow,
): Promise<{ lane: AdmissionLane; route: LaneRoute } | null> {
  const lane = await resolveInviteLane(row.communityId, row.cycleId, declarationFromInvite(row));
  return lane ? { lane, route: laneRoute(laneRuleOf(lane)) } : null;
}

// §4.3/8d + docs/plans/archive/joining-admission-plan.md §2 pipeline visibility:
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
  const lanesByCycle = new Map<string, ReturnType<typeof laneRuleOf>[]>();
  const lanesFor = async (cycleId: string) => {
    if (!lanesByCycle.has(cycleId)) {
      lanesByCycle.set(cycleId, (await listOpenLanes(actor.communityId, cycleId)).map(laneRuleOf));
    }
    return lanesByCycle.get(cycleId)!;
  };

  const processInvites = [];
  for (const r of rows) {
    if (!r.cycleId) continue;
    if (!(heldScopes.has(null) || heldScopes.has(r.cycleId))) continue;
    const lane = (await lanesFor(r.cycleId)).find((l) => laneHandles(l, declarationFromInvite(r)));
    // A direct lane's outstanding invite is a held place, not a thing for
    // evaluators; an invite whose lane has closed is held, not evaluated.
    if (!lane || laneHoldsCapacity(lane)) continue;
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
  // A lane that admits straight away: they are a member and signed in.
  | { kind: "admitted"; arrivalId: string; token: string; memberId: string; redirectTo: string }
  // A lane that admits straight away, into an event that has since filled up:
  // they are approved and waiting for room, and not a member yet.
  | { kind: "waitlisted"; arrivalId: string; token: string }
  // A community-check lane: they agreed to the disclosure, their arrival is
  // announced, and the window runs. They are not a member yet.
  | { kind: "check"; arrivalId: string; token: string; deadline: Date }
  // A lane that asks only for an interview: they are in the funnel, waiting
  // for one.
  | { kind: "waiting"; arrivalId: string; token: string }
  // A lane that asks for an application: nothing is created until they send
  // it, because the application is where their name and email come from.
  | { kind: "apply" };

// Public — no actor. A valid, unexpired, unredeemed, unrevoked token *is*
// the proof of standing (docs/spec.md). What redeeming does depends on the
// lane the invite takes (docs/plans/admission-flow.md §2a), and in every case the
// person becomes an *arrival* first (§4); only a lane that admits on the
// spot makes them a member in the same breath, and only through the one
// admission function.
//
// Deliberately doesn't call createSession itself — that touches
// next/headers, which only works inside a Route Handler/Server Action, not
// this framework-agnostic lib layer (same separation
// findOrCreateMemberByEmail already keeps). The caller starts the session
// with the returned member's id, same as the ordinary magic-link verify
// route already does.
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

  const resolved = await getCommunityInviteLane(invite);
  if (!resolved) {
    throw new ConflictError(
      "This invitation can't be used right now — the community isn't taking this kind of invitation at the moment. Your link is kept, so try again later.",
    );
  }
  const { lane, route } = resolved;

  // Doors govern entering: an issued invite is not revoked when one closes, it
  // is refused here with a message and works again once the door reopens.
  const refusal = await entryRefusal({ communityId: invite.communityId, cycleId: invite.cycleId, lane, via: "invite_redeemed" });
  if (refusal) throw new ConflictError(`${refusal}. Your link is kept, so try again later.`);

  // A lane with an application is entered by sending the application: the
  // form is where a person's name and email come from, and the arrival is
  // made there with the invite as the vouch behind it.
  if (lane.applicationRequired) {
    return { kind: "apply" };
  }

  if (route === "check" && !input.consentAccepted) {
    throw new AppError(
      "Joining through this invite means your arrival is announced to the community — read the disclosure and tick the box to go on",
    );
  }

  // Every way an address can already belong to somebody, not just the
  // magic_link identity this used to check — an existing SSO member
  // redeeming an invite with their own address must not get a second Member.
  const email = input.email.trim().toLowerCase();
  if (await findExistingMemberByLoginEmail(email)) {
    throw new ConflictError("This email already belongs to a member — log in instead");
  }

  const { communityName, windowHours } = await consensusWindowFor(invite.communityId);
  const disclosure = input.disclosure?.trim() || consensusDisclosure(communityName, windowHours);

  // The claim is atomic: of two simultaneous redemptions of one link, only
  // one gets through. It is undone if the arrival can't be made (the address
  // is already in the funnel), so a failed attempt doesn't spend the link.
  const [claimed] = await db
    .update(communityInvite)
    .set({
      redeemedAt: new Date(),
      ...(route === "check"
        ? { consentAt: new Date(), consentDisclosure: disclosure }
        : {}),
    })
    .where(and(eq(communityInvite.id, invite.id), isNull(communityInvite.redeemedAt)))
    .returning();
  if (!claimed) {
    throw new ConflictError("This invite link has already been used");
  }

  let created;
  try {
    created = await createAdmissionArrival({
      communityId: invite.communityId,
      cycleId: invite.cycleId,
      email,
      name: invite.label?.trim() || preferredMemberName(null, null, null, email),
      lane,
      route: "invite",
      inviteId: invite.id,
      consentGiven: route === "check",
    });
  } catch (err) {
    await db
      .update(communityInvite)
      .set({
        redeemedAt: null,
        consentAt: null,
        consentDisclosure: null,
      })
      .where(eq(communityInvite.id, invite.id));
    throw err;
  }
  const { arrival, token } = created;

  if (route === "direct") {
    const admitted = await admitArrival(arrival.id, { notify: false });
    if (admitted.waitlisted) return { kind: "waitlisted", arrivalId: arrival.id, token };
    const { memberId } = admitted;
    const { firstLoginDestinationFor } = await import("@/lib/first-login");
    return { kind: "admitted", arrivalId: arrival.id, token, memberId, redirectTo: await firstLoginDestinationFor(memberId) };
  }
  if (route === "check") {
    // The window opened with the arrival (consent is what opens it); its deadline is
    // the one the person is told.
    const window = await getOpenCheck(arrival.id);
    return { kind: "check", arrivalId: arrival.id, token, deadline: window!.deadline };
  }
  return { kind: "waiting", arrivalId: arrival.id, token };
}
