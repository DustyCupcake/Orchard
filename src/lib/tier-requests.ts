import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { member, tier, tierRequest } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { memberHasTier } from "./eligibility";
import { isAdmin } from "./settings/admins";

type Member = typeof memberTable.$inferSelect;

// Manual tiers are a hand-designated thing (docs/spec.md, "Manual — leads
// designate members into the tier by hand"), and they gate real access: a
// sensitive-data audience can be "unlocked by tier X", and starting an event
// can be limited to a tier. For a long time the only way to hold one was to
// tick it on your own profile, which made "who is in tier X" mean "who
// wanted to be" and turned every tier-keyed gate into a self-service one.
//
// So a manual tier is now asked for, and confirmed by someone who can vouch
// for it: an Admin, or a member already in that tier. Nothing here is a
// gate on the *request* — anyone can ask — only on the grant.
//
// A pending request grants nothing; member.tierIds changes only on approval.
// A member can always leave a tier themselves: giving access up never needs
// anybody's say-so.

async function requireManualTierInCommunity(actor: Member, tierId: string) {
  const [row] = await db
    .select()
    .from(tier)
    .where(and(eq(tier.id, tierId), eq(tier.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Tier not found in your community");
  }
  if (row.criterionType !== "manual") {
    // A computed tier (tenure, completions, cycle-type count…) is owned by
    // its own sync logic; there is nothing to ask for.
    throw new ConflictError("That tier is earned automatically, so it can't be requested");
  }
  return row;
}

/**
 * Whether `actor` may confirm requests for this tier: an Admin, or a member
 * who is already in it. The requester is excluded by the callers — an Admin
 * is the one exception (see decideTierRequest).
 */
export async function canConfirmTier(actor: Member, tierId: string): Promise<boolean> {
  return memberHasTier(actor, tierId) || (await isAdmin(actor));
}

export async function requestTier(actor: Member, tierId: string) {
  await requireManualTierInCommunity(actor, tierId);
  if (memberHasTier(actor, tierId)) {
    throw new ConflictError("You're already in that tier");
  }
  const [existing] = await db
    .select({ id: tierRequest.id })
    .from(tierRequest)
    .where(and(eq(tierRequest.memberId, actor.id), eq(tierRequest.tierId, tierId), isNull(tierRequest.decidedAt)));
  if (existing) {
    throw new ConflictError("You've already asked for that tier — it's waiting for someone to confirm it");
  }
  const [created] = await db.insert(tierRequest).values({ memberId: actor.id, tierId }).returning();
  return created;
}

export async function withdrawTierRequest(actor: Member, requestId: string) {
  const [removed] = await db
    .delete(tierRequest)
    .where(and(eq(tierRequest.id, requestId), eq(tierRequest.memberId, actor.id), isNull(tierRequest.decidedAt)))
    .returning({ id: tierRequest.id });
  if (!removed) {
    throw new NotFoundError("No pending request to withdraw");
  }
}

/** Leaving a manual tier needs nobody's confirmation. */
export async function leaveTier(actor: Member, tierId: string) {
  await requireManualTierInCommunity(actor, tierId);
  if (!memberHasTier(actor, tierId)) {
    throw new ConflictError("You're not in that tier");
  }
  await db
    .update(member)
    .set({ tierIds: actor.tierIds.filter((id) => id !== tierId) })
    .where(eq(member.id, actor.id));
}

export type OwnTierRequestState = { tierId: string; status: "pending" | "declined"; requestId: string };

/**
 * The member's own view: which of their requests are waiting, and which tier
 * they were last told no for (so the profile can say so once, instead of the
 * request silently vanishing). A tier they have since been approved into, or
 * asked for again, shows its current state instead.
 */
export async function listOwnTierRequestStates(actor: Member): Promise<Map<string, OwnTierRequestState>> {
  const rows = await db
    .select()
    .from(tierRequest)
    .where(eq(tierRequest.memberId, actor.id))
    .orderBy(desc(tierRequest.requestedAt));
  const byTier = new Map<string, OwnTierRequestState>();
  for (const r of rows) {
    if (byTier.has(r.tierId)) continue; // newest first: the latest request is the state
    if (r.decidedAt === null) byTier.set(r.tierId, { tierId: r.tierId, status: "pending", requestId: r.id });
    else if (r.decision === "declined") byTier.set(r.tierId, { tierId: r.tierId, status: "declined", requestId: r.id });
  }
  return byTier;
}

export type TierRequestToConfirm = {
  id: string;
  tierId: string;
  tierName: string;
  memberId: string;
  memberName: string;
  requestedAt: Date;
};

/**
 * Pending requests this member may decide: every one for an Admin, and for
 * anyone else only the tiers they are in. Someone else's, never their own —
 * except an Admin's, since an Admin can already change the tier's definition
 * and who is allowed to hold it, so making them wait on a second person
 * would only lock a one-Admin community out of its own tiers.
 */
export async function listTierRequestsToConfirm(actor: Member): Promise<TierRequestToConfirm[]> {
  const admin = await isAdmin(actor);
  if (!admin && actor.tierIds.length === 0) return [];

  const rows = await db
    .select({
      id: tierRequest.id,
      tierId: tierRequest.tierId,
      tierName: tier.name,
      memberId: tierRequest.memberId,
      memberName: member.name,
      requestedAt: tierRequest.requestedAt,
    })
    .from(tierRequest)
    .innerJoin(tier, eq(tier.id, tierRequest.tierId))
    .innerJoin(member, eq(member.id, tierRequest.memberId))
    .where(
      and(
        eq(tier.communityId, actor.communityId),
        isNull(tierRequest.decidedAt),
        admin ? undefined : inArray(tierRequest.tierId, actor.tierIds),
        admin ? undefined : ne(tierRequest.memberId, actor.id),
      ),
    )
    .orderBy(asc(tierRequest.requestedAt));
  return rows;
}

export async function decideTierRequest(actor: Member, requestId: string, decision: "approved" | "declined") {
  const [request] = await db
    .select({ request: tierRequest, communityId: tier.communityId })
    .from(tierRequest)
    .innerJoin(tier, eq(tier.id, tierRequest.tierId))
    .where(eq(tierRequest.id, requestId));
  // The community check is on the tier the request names, so a request id
  // from another community reads as missing rather than as forbidden.
  if (!request || request.communityId !== actor.communityId) {
    throw new NotFoundError("Request not found");
  }
  if (request.request.decidedAt) {
    throw new ConflictError("That request has already been decided");
  }

  const admin = await isAdmin(actor);
  const requestedOwn = request.request.memberId === actor.id;
  if (!(admin || (memberHasTier(actor, request.request.tierId) && !requestedOwn))) {
    throw new ForbiddenError("Only an Admin, or someone already in this tier, can confirm it");
  }

  await db.transaction(async (tx) => {
    // The guard is in the WHERE as well as the read above, so two people
    // pressing the button at once decide it once.
    const [decided] = await tx
      .update(tierRequest)
      .set({ decidedAt: new Date(), decidedBy: actor.id, decision })
      .where(and(eq(tierRequest.id, requestId), isNull(tierRequest.decidedAt)))
      .returning();
    if (!decided) {
      throw new ConflictError("That request has already been decided");
    }
    if (decision === "approved") {
      const [target] = await tx.select({ tierIds: member.tierIds }).from(member).where(eq(member.id, request.request.memberId));
      if (target && !target.tierIds.includes(request.request.tierId)) {
        await tx
          .update(member)
          .set({ tierIds: [...target.tierIds, request.request.tierId] })
          .where(eq(member.id, request.request.memberId));
      }
    }
  });
}
