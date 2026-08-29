import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { communityInvite, member, memberIdentity } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { generateToken } from "../token";
import { getCommunityRow } from "./access";

type Member = typeof memberTable.$inferSelect;
type CommunityInviteRow = typeof communityInvite.$inferSelect;

export const createCommunityInviteInput = z.object({
  label: z.string().min(1).nullable().optional(),
  inviterThinksGoodFit: z.boolean().optional(),
  inviterKnowsPersonally: z.boolean().optional(),
  expiresAt: z.string().min(1).nullable().optional(),
});
export type CreateCommunityInviteInput = z.infer<typeof createCommunityInviteInput>;

// Open to any member — generating an invite is a unilateral act, the
// same posture Shifts' createShiftSeries already takes for "rotate a
// task into a shift." Always single-use, no multi-use variant per
// spec's explicit CampTool callout.
export async function createCommunityInvite(actor: Member, input: CreateCommunityInviteInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const [created] = await db
    .insert(communityInvite)
    .values({
      communityId: actor.communityId,
      createdBy: actor.id,
      token: generateToken(),
      label: input.label ?? null,
      inviterThinksGoodFit: input.inviterThinksGoodFit ?? false,
      inviterKnowsPersonally: input.inviterKnowsPersonally ?? false,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .returning();
  return created;
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

    return created;
  });

  return newMember;
}
