import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { communityInvite, cycle, member, memberIdentity, participation } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { generateToken } from "../token";
import { getCycleJoiningState } from "./joining";
import { getCommunityRow, listHeldRecruitmentScopes, requireRecruitmentTaskHolder } from "./access";

type Member = typeof memberTable.$inferSelect;
type CommunityInviteRow = typeof communityInvite.$inferSelect;

export const createCommunityInviteInput = z.object({
  label: z.string().min(1).nullable().optional(),
  inviterThinksGoodFit: z.boolean().optional(),
  inviterKnowsPersonally: z.boolean().optional(),
  expiresAt: z.string().min(1).nullable().optional(),
  // §4.3/8d — the cycle this invite is for (null = a general community
  // invite). An invite's meaning follows the cycle's joiningInviteMode.
  cycleId: z.string().uuid().nullable().optional(),
});
export type CreateCommunityInviteInput = z.infer<typeof createCommunityInviteInput>;

// Open to any member — generating an invite is a unilateral act, the
// same posture Shifts' createShiftSeries already takes for "rotate a
// task into a shift." Always single-use, no multi-use variant per
// spec's explicit CampTool callout. As of §4.3/8d an invite can be
// scoped to a cycle, where its meaning follows the cycle's
// joiningInviteMode (direct | referral) and creating it gates on that
// mode's door plus the joining period and capacity room; a general
// invite (no cycle) gates on the community-wide invites toggle.
export async function createCommunityInvite(actor: Member, input: CreateCommunityInviteInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const cycleId = input.cycleId ?? null;
  if (cycleId) {
    // Validates the cycle is in-community (throws NotFoundError
    // otherwise) and gives us its live door state.
    const joining = await getCycleJoiningState(actor.communityId, cycleId);
    if (joining.atCapacity) {
      throw new ConflictError("This cycle is full — no capacity left for new joins");
    }
    if (!joining.periodOpen) {
      throw new ConflictError("This cycle's joining period isn't open");
    }
    if (joining.cycle.joiningInviteMode === "referral") {
      // Referral invites route through the evaluated application — the
      // applications door is the one that matters.
      if (!joining.cycle.applicationsOpen) {
        throw new ConflictError("Applications for this cycle are closed");
      }
    } else {
      if (!joining.cycle.invitesOpen) {
        throw new ConflictError("Invites for this cycle are closed");
      }
      // A direct invite holds a capacity slot until redeemed, revoked,
      // or expired — so into a capacity-capped cycle it must carry a
      // non-past expiry: no immortal holds (docs §4.3/8d).
      if (joining.cycle.capacity !== null) {
        if (!input.expiresAt) {
          throw new AppError("Direct invites into a capacity-capped cycle need an expiry date");
        }
        if (new Date(input.expiresAt) <= new Date()) {
          throw new AppError("The expiry must be in the future — no immortal capacity holds");
        }
      }
    }
  } else if (!communityRow.recruitmentInvitesOpen) {
    throw new AppError("This community isn't accepting invite-based joins right now");
  }

  const [created] = await db
    .insert(communityInvite)
    .values({
      communityId: actor.communityId,
      createdBy: actor.id,
      token: generateToken(),
      cycleId,
      label: input.label ?? null,
      inviterThinksGoodFit: input.inviterThinksGoodFit ?? false,
      inviterKnowsPersonally: input.inviterKnowsPersonally ?? false,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .returning();
  return created;
}

// "An invite's meaning follows its cycle's joiningInviteMode" (§4.3/8d):
// a cycle invite is direct or referral per the cycle's *current* mode —
// never snapshotted on the row, so a mode switch on the cycle re-reads
// the same link. An invite with no cycle is today's general,
// direct-redeemable community invite.
export type CommunityInviteJoiningMode = "general" | "direct" | "referral";

export async function getCommunityInviteJoiningMode(row: CommunityInviteRow): Promise<CommunityInviteJoiningMode> {
  if (!row.cycleId) return "general";
  const [cycleRow] = await db.select().from(cycle).where(eq(cycle.id, row.cycleId));
  return cycleRow?.joiningInviteMode === "referral" ? "referral" : "direct";
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
// identifies both). Used by the /invite/[token] page to decide whether
// to show the join form at all.
export async function getCommunityInviteByToken(token: string) {
  const [row] = await db.select().from(communityInvite).where(eq(communityInvite.token, token));
  return row;
}

// §4.3/8d pipeline visibility: outstanding *referral* invites — valid
// (not redeemed/revoked/expired) cycle invites whose cycle is in
// referral mode — belong on the recruitment pipeline alongside the
// applications themselves. Scope-filtering follows
// listApplicationsForEvaluation exactly: a cycle-placed holder sees
// only their own cycle's outstanding referral invites; the cycle-less
// community/evergreen holder sees all of them. General (cycle-less)
// invites redeem directly and are not part of this count.
export async function listOutstandingReferralInvites(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const heldScopes = await listHeldRecruitmentScopes(actor);
  if (heldScopes.size === 0) return [];

  const cycleRows = await db
    .select({ id: cycle.id, name: cycle.name, joiningInviteMode: cycle.joiningInviteMode })
    .from(cycle)
    .where(eq(cycle.communityId, actor.communityId));
  const referralCycles = new Map(
    cycleRows.filter((c) => c.joiningInviteMode === "referral").map((c) => [c.id, c.name]),
  );
  if (referralCycles.size === 0) return [];

  const now = new Date();
  const rows = await db
    .select({
      cycleId: communityInvite.cycleId,
      label: communityInvite.label,
      createdAt: communityInvite.createdAt,
    })
    .from(communityInvite)
    .where(
      and(
        eq(communityInvite.communityId, actor.communityId),
        inArray(communityInvite.cycleId, [...referralCycles.keys()]),
        isNull(communityInvite.redeemedAt),
        isNull(communityInvite.revokedAt),
        or(isNull(communityInvite.expiresAt), gt(communityInvite.expiresAt, now)),
      ),
    )
    .orderBy(desc(communityInvite.createdAt));

  return rows
    .filter((r) => r.cycleId && (heldScopes.has(null) || heldScopes.has(r.cycleId)))
    .map((r) => ({ ...r, cycleId: r.cycleId as string, cycleName: referralCycles.get(r.cycleId as string) ?? "" }));
}

export const redeemCommunityInviteInput = z.object({
  email: z.string().email(),
});
export type RedeemCommunityInviteInput = z.infer<typeof redeemCommunityInviteInput>;

// Public — no actor. "Redeeming a valid, unexpired, unredeemed,
// unrevoked token *is* the proof of legitimacy" (docs/spec.md), so this
// creates the Member outright, no magic-link round-trip needed.
// Deliberately doesn't call createSession itself — that touches
// next/headers, which only works inside a Route Handler/Server Action,
// not this framework-agnostic lib layer (same separation
// findOrCreateMemberByEmail already keeps). The caller starts the
// session with the returned Member's id, same as the ordinary
// magic-link verify route already does.
export async function redeemCommunityInvite(token: string, input: RedeemCommunityInviteInput) {
  const invite = await getCommunityInviteByToken(token);
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

  // §4.3/8d — a referral invite never redeems directly; it routes
  // through the evaluated application (/apply?invite=<token>). The
  // /invite/[token] page redirects there, and the lib guards too.
  const mode = await getCommunityInviteJoiningMode(invite);
  if (mode === "referral") {
    throw new ConflictError("This invite routes through the application process — open its apply link instead");
  }

  const email = input.email.trim().toLowerCase();
  const [existingIdentity] = await db
    .select({ id: memberIdentity.id })
    .from(memberIdentity)
    .where(and(eq(memberIdentity.provider, "magic_link"), eq(memberIdentity.loginEmail, email)));
  if (existingIdentity) {
    throw new ConflictError("This email already belongs to a member — log in instead");
  }

  const newMember = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(member)
      .values({
        communityId: invite.communityId,
        name: email.split("@")[0],
        referredByMemberId: invite.createdBy,
        joinedViaInviteId: invite.id,
      })
      .returning();

    await tx.insert(memberIdentity).values({
      memberId: created.id,
      provider: "magic_link",
      loginEmail: email,
    });

    // Re-checked against the current row, not the one read above —
    // narrows (harmlessly) the window for two simultaneous redemptions
    // of the same link to still only let one through.
    const [claimed] = await tx
      .update(communityInvite)
      .set({ redeemedAt: new Date(), redeemedByMemberId: created.id })
      .where(and(eq(communityInvite.id, invite.id), isNull(communityInvite.redeemedAt)))
      .returning();
    if (!claimed) {
      throw new ConflictError("This invite link has already been used");
    }

    // §4.3/8d (D14): redeeming a direct invite into a cycle seeds the
    // new member's participation there — "coming", idempotently — so
    // they count against the cycle's capacity from day one. No DB-level
    // unique constraint on participation, so same select-then-insert
    // posture declareParticipation keeps.
    if (invite.cycleId) {
      const [existing] = await tx
        .select({ id: participation.id })
        .from(participation)
        .where(and(eq(participation.cycleId, invite.cycleId), eq(participation.memberId, created.id)));
      if (!existing) {
        await tx.insert(participation).values({
          cycleId: invite.cycleId,
          memberId: created.id,
          status: "coming",
        });
      }
    }

    return created;
  });

  return newMember;
}
