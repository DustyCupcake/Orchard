import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { community, member, memberIdentity, signInSetup } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { isOidcConfigured } from "../oidc";
import { requireAdmins } from "../settings/admins";
import {
  createUser,
  findUserIdByEmail,
  grantRole,
  revokeRole,
  sendInvite,
  ZitadelError,
  zitadelConfigFor,
} from "../zitadel";

type Member = typeof memberTable.$inferSelect;
type Setup = typeof signInSetup.$inferSelect;

// docs/admission-flow.md §6a — making "admitted" mean something at the provider.
//
// Admission never waits on any of this and is never undone by it: the person is admitted
// either way, and what is recorded here is whether they can also sign in yet. It is
// idempotent in every step (find before create, an existing grant is success), so a retry
// — the administrators' button, or admitting someone who already has an account — is
// always safe.

export type ProvisionResult = {
  /** Null when the community doesn't create accounts on admission, so there is nothing to say. */
  setup: Setup | null;
  /** The provider emailed the person a link to set up their sign-in. */
  invited: boolean;
};

async function loginEmailOf(memberId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: memberIdentity.loginEmail })
    .from(memberIdentity)
    .where(eq(memberIdentity.memberId, memberId))
    .orderBy(asc(memberIdentity.createdAt))
    .limit(1);
  return row?.email ?? null;
}

async function record(memberId: string, communityId: string, patch: Partial<typeof signInSetup.$inferInsert>): Promise<Setup> {
  const [existing] = await db.select().from(signInSetup).where(eq(signInSetup.memberId, memberId));
  if (existing) {
    const [updated] = await db
      .update(signInSetup)
      .set({ ...patch, attempts: existing.attempts + 1, updatedAt: new Date() })
      .where(eq(signInSetup.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(signInSetup)
    .values({ memberId, communityId, ...patch, attempts: 1 })
    .returning();
  return created;
}

/**
 * Give a member a sign-in account at the provider and the role to use it, if the
 * community has asked for that. Safe to call whenever, and as often as you like.
 */
export async function provisionSignIn(memberId: string): Promise<ProvisionResult> {
  const [row] = await db.select({ member, community }).from(member).innerJoin(community, eq(member.communityId, community.id)).where(eq(member.id, memberId));
  if (!row) throw new NotFoundError("Member not found");
  const { community: communityRow, member: memberRow } = row;
  if (!isOidcConfigured(communityRow) || !communityRow.ssoCreateOnAdmit) return { setup: null, invited: false };

  const config = zitadelConfigFor(communityRow);
  if (!config) {
    const setup = await record(memberId, communityRow.id, {
      status: "failed",
      lastError:
        "The provider's service token or project isn't set up for Orchard, so nothing can be created automatically. Create their account and grant the role by hand, then mark it done.",
    });
    return { setup, invited: false };
  }

  const email = await loginEmailOf(memberId);
  if (!email) {
    return { setup: await record(memberId, communityRow.id, { status: "failed", lastError: "This member has no sign-in address to create an account for." }), invited: false };
  }

  try {
    let userId = await findUserIdByEmail(config, email);
    let invited = false;
    if (!userId) {
      userId = await createUser(config, { email, name: memberRow.name });
      await sendInvite(config, userId);
      invited = true;
    }
    await grantRole(config, userId);

    // Their first sign-in resolves to this member by `sub`, with no matching on addresses.
    const [theirs] = await db
      .select({ id: memberIdentity.id, sub: memberIdentity.providerSubject })
      .from(memberIdentity)
      .where(and(eq(memberIdentity.memberId, memberId), eq(memberIdentity.provider, "oidc")));
    if (!theirs) {
      const [owner] = await db
        .select({ memberId: memberIdentity.memberId })
        .from(memberIdentity)
        .where(and(eq(memberIdentity.provider, "oidc"), eq(memberIdentity.providerSubject, userId)));
      if (owner && owner.memberId !== memberId) {
        throw new ZitadelError("That provider account is already linked to a different member here", false);
      }
      if (!owner) {
        await db.insert(memberIdentity).values({ memberId, provider: "oidc", providerSubject: userId, loginEmail: email });
      }
    }
    const setup = await record(memberId, communityRow.id, { status: "done", lastError: null, providerUserId: userId, doneAt: new Date() });
    return { setup, invited };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    const retryable = err instanceof ZitadelError ? err.retryable : false;
    console.error("[sign-in] could not set up the sign-in account:", message);
    return { setup: await record(memberId, communityRow.id, { status: retryable ? "pending" : "failed", lastError: message }), invited: false };
  }
}

/** The administrators' to-do: members admitted whose sign-in isn't set up, newest first. */
export async function listSignInTodos(actor: Member) {
  await requireAdmins(actor);
  return db
    .select({ setup: signInSetup, name: member.name })
    .from(signInSetup)
    .innerJoin(member, eq(signInSetup.memberId, member.id))
    .where(and(eq(signInSetup.communityId, actor.communityId), inArray(signInSetup.status, ["pending", "failed"])))
    .orderBy(desc(signInSetup.updatedAt));
}

export async function retrySignInSetup(actor: Member, memberId: string) {
  await requireAdmins(actor);
  const [target] = await db.select().from(member).where(and(eq(member.id, memberId), eq(member.communityId, actor.communityId)));
  if (!target) throw new NotFoundError("Member not found");
  return provisionSignIn(memberId);
}

/** For a community with no way to automate it: an administrator did it by hand. */
export async function markSignInSetUp(actor: Member, memberId: string) {
  await requireAdmins(actor);
  const [setup] = await db.select().from(signInSetup).where(and(eq(signInSetup.memberId, memberId), eq(signInSetup.communityId, actor.communityId)));
  if (!setup) throw new NotFoundError("Nothing to mark");
  if (setup.status === "done") throw new ConflictError("That sign-in is already set up");
  const [updated] = await db
    .update(signInSetup)
    .set({ status: "done", lastError: null, doneAt: new Date(), updatedAt: new Date() })
    .where(eq(signInSetup.id, setup.id))
    .returning();
  return updated;
}

/**
 * Take the person's role at the provider back, because they have left (docs/admission-flow.md
 * §6a: the provider and Orchard can't disagree about who belongs). Returns null when the
 * community hasn't asked for it or there's nothing to revoke, true when done, false when it
 * failed — which the caller reports rather than hides, since a person who left but can still
 * sign in at the provider is exactly the disagreement this exists to prevent.
 */
export async function revokeSignInOnLeave(memberRow: Member, subject: string | null): Promise<boolean | null> {
  const [communityRow] = await db.select().from(community).where(eq(community.id, memberRow.communityId));
  if (!communityRow || !isOidcConfigured(communityRow) || !communityRow.ssoRevokeOnLeave || !subject) return null;
  const config = zitadelConfigFor(communityRow);
  if (!config) return false;
  try {
    await revokeRole(config, subject);
    return true;
  } catch (err) {
    console.error("[sign-in] could not take the role back:", err instanceof Error ? err.message : err);
    return false;
  }
}
