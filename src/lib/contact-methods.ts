import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contactMethod, memberIdentity, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import type { DbOrTx } from "@/db";
import { ForbiddenError, NotFoundError } from "./errors";
import { consumeActionToken, issueActionToken } from "./notifications/action-tokens";
import { sendEmailVerificationEmail } from "./mailer";

type Member = typeof memberTable.$inferSelect;

export const CONTACT_METHOD_VISIBILITIES = ["everyone", "task_or_group_mates", "emergency_only"] as const;
export type ContactMethodVisibility = (typeof CONTACT_METHOD_VISIBILITIES)[number];

// `type` is free text by design (member-privacy.ts's own comment), so
// "email" is a convention every call site has to honour rather than a
// constraint the database enforces. Matched case-insensitively but on the
// canonical spelling only: "E-Mail" is a different type as far as this
// codebase is concerned, and being strict here is what stops a telegram
// handle or a typo'd label from being offered as somewhere to receive the
// community's mail.
const EMAIL_TYPE = "email";

// Enough to refuse obvious rubbish, which is all this is for. Not an RFC
// 5322 parser and it doesn't pretend to be one — the only real test of an
// address is whether mail to it arrives, and that is what `verifiedAt`
// records. This exists so the primary picker can't offer a half-typed
// address as a delivery target.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailContactMethod(m: { type: string; value: string }): boolean {
  return m.type.trim().toLowerCase() === EMAIL_TYPE && EMAIL_SHAPE.test(m.value.trim());
}

export const contactMethodInput = z.object({
  type: z.string().min(1),
  value: z.string().min(1),
  visibility: z.enum(CONTACT_METHOD_VISIBILITIES),
});
export type ContactMethodInput = z.infer<typeof contactMethodInput>;

// Core, not module-gated — every Community needs some version of this,
// per docs/spec.md's "Member contact & privacy". Always self-service,
// same as tags/profile answers: a member manages their own methods
// freely, no admin gate anywhere in this file.
export async function listOwnContactMethods(actor: Member) {
  return db.select().from(contactMethod).where(eq(contactMethod.memberId, actor.id));
}

export async function createContactMethod(actor: Member, input: ContactMethodInput) {
  const [created] = await db
    .insert(contactMethod)
    .values({ memberId: actor.id, type: input.type, value: input.value, visibility: input.visibility })
    .returning();
  return created;
}

async function requireOwnContactMethod(actor: Member, id: string) {
  const [row] = await db.select().from(contactMethod).where(eq(contactMethod.id, id));
  if (!row) {
    throw new NotFoundError("Contact method not found");
  }
  if (row.memberId !== actor.id) {
    throw new ForbiddenError("Not your contact method");
  }
  return row;
}

export async function updateContactMethod(actor: Member, id: string, input: ContactMethodInput) {
  const existing = await requireOwnContactMethod(actor, id);

  // Editing the address invalidates the verification *and* the primary flag,
  // together, and this is the only place that rule can be enforced. Two
  // separate hazards, one trigger: a `verifiedAt` still standing on a value
  // nobody has proven control of any more, and a primary row pointing at
  // text typed a second ago — so the community's mail would go to an
  // address that never received anything. A rename that leaves the value
  // alone keeps both, since it is still the address that was verified.
  const valueChanged = existing.value !== input.value;

  const [updated] = await db
    .update(contactMethod)
    .set({
      type: input.type,
      value: input.value,
      visibility: input.visibility,
      ...(valueChanged ? { verifiedAt: null, isPrimary: false } : {}),
    })
    .where(eq(contactMethod.id, id))
    .returning();
  return updated;
}

export async function deleteContactMethod(actor: Member, id: string) {
  const existing = await requireOwnContactMethod(actor, id);

  // Refused rather than quietly cascading, because the alternative is a
  // member deleting the only address the platform writes to and then
  // silently receiving nothing — a missing-mail failure with no error
  // anywhere, which is the kind nobody ever investigates.
  if (existing.isPrimary) {
    throw new ForbiddenError(
      "This is the address your email goes to. Point it somewhere else first, then delete this one.",
    );
  }

  await db.delete(contactMethod).where(eq(contactMethod.id, id));
}

/**
 * Point this member's delivery at one of their own verified email methods.
 *
 * Clear-then-set inside one transaction is what makes "at most one primary"
 * true without a partial unique index: two members pressing the button at
 * the same moment can't interleave a clear and a set, because the whole
 * thing is one statement boundary.
 *
 * All three refusals are one question asked from different sides — can this
 * row be somewhere the community's mail gets delivered? — and each names
 * its remedy, because a member told "no" with no next step concludes the
 * feature is broken rather than that they skipped a step.
 */
export async function setPrimaryContactMethod(actor: Member, id: string) {
  const target = await requireOwnContactMethod(actor, id);

  if (!isEmailContactMethod(target)) {
    throw new ForbiddenError(
      "Only an email address can be the one your email goes to. Add the address as an email first.",
    );
  }
  if (!target.verifiedAt) {
    throw new ForbiddenError(
      "Confirm this address receives mail before pointing your email at it — a link has to go somewhere and land.",
    );
  }

  return db.transaction(async (tx) => {
    await tx
      .update(contactMethod)
      .set({ isPrimary: false })
      .where(and(eq(contactMethod.memberId, actor.id), eq(contactMethod.isPrimary, true)));
    const [updated] = await tx
      .update(contactMethod)
      .set({ isPrimary: true })
      .where(eq(contactMethod.id, id))
      .returning();
    return updated;
  });
}

/**
 * The one definition of where this member's own email goes.
 *
 * Every outbound send reads this and nothing else — announcements, targeted
 * messages, task nominations, the backstop hard-flag. Previously each of
 * those four read `memberIdentity.loginEmail` independently, which is how
 * "the profile offers me an email field" and "mail goes somewhere I can't
 * see" were both true at once.
 *
 * Falls back to the login address for a member with no primary row. 0084
 * seeds nothing for existing members, because a backfill would have had to
 * invent a verification it had no evidence for, and silently dropping
 * people's mail until each one visited their profile is not a way to ship
 * this.
 *
 * `verifiedAt` is re-checked here even though `setPrimaryContactMethod`
 * refuses an unverified row — same posture as `resolveReadableQuestions`:
 * the invariant is enforced on the write, but the thing that actually
 * sends mail has to be right on its own.
 */
export async function resolvePrimaryEmail(memberId: string): Promise<string | null> {
  const [primary] = await db
    .select({ type: contactMethod.type, value: contactMethod.value })
    .from(contactMethod)
    .where(
      and(
        eq(contactMethod.memberId, memberId),
        eq(contactMethod.isPrimary, true),
        isNotNull(contactMethod.verifiedAt),
      ),
    )
    .limit(1);
  if (primary && isEmailContactMethod(primary)) return primary.value;

  const [identity] = await db
    .select({ loginEmail: memberIdentity.loginEmail })
    .from(memberIdentity)
    .where(eq(memberIdentity.memberId, memberId))
    .limit(1);
  return identity?.loginEmail ?? null;
}

// --- Verification
//
// One-time and click-to-act, on the same machinery as the magic link and the
// action tokens: proving you can receive mail at an address is not something
// a checkbox can assert, so it's proven by a message landing in the inbox.
// 24 hours survives "I'll do it later, I'm not at my computer" and stops a
// link found in a mailbox months later being a standing credential.

const VERIFICATION_TOKEN_KIND = "contact_method_verification";
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export async function requestContactMethodVerification(actor: Member, id: string, appUrl: string) {
  const row = await requireOwnContactMethod(actor, id);
  if (!isEmailContactMethod(row)) {
    throw new ForbiddenError("Only an email address can be confirmed.");
  }
  // Re-requesting is neither an error nor a no-op: it mints a fresh token,
  // so a member whose earlier link expired can try again without anyone
  // having to reason about the old row.
  const token = await issueActionToken(
    VERIFICATION_TOKEN_KIND,
    { contactMethodId: row.id, memberId: actor.id },
    VERIFICATION_TTL_MS,
  );
  // `appUrl` is the caller's to supply rather than this module's to
  // discover, for the same reason nominateForTask takes one: resolving a
  // host means reaching for `headers()`, which is request-scoped — fine
  // inside a Server Action and a crash anywhere else. The link also stays
  // on /profile instead of becoming a route of its own, because the token
  // already carries the member id and the page can render the confirm step.
  await sendEmailVerificationEmail(row.value, `${appUrl}/profile?verify=${token}`);
  return row;
}

/**
 * Mark the row verified, if the token names one of the caller's own.
 *
 * Scoped to the member in the payload *and* re-checked against the row's
 * own `memberId`, because a token is a bearer credential that lives in a
 * mailbox: a forwarded link must not let the recipient verify an address
 * belonging to somebody else. `consumeActionToken` has already burned the
 * token by the time either check runs, so a failed attempt costs a new
 * link rather than leaving a replayable one behind.
 */
export async function consumeContactMethodVerification(actor: Member, rawToken: string) {
  const payload = await consumeActionToken<{ contactMethodId: string; memberId: string }>(
    VERIFICATION_TOKEN_KIND,
    rawToken,
  );
  if (!payload || payload.memberId !== actor.id) {
    return { ok: false as const, reason: "That link isn't valid, or it has already been used." };
  }

  const [row] = await db
    .update(contactMethod)
    .set({ verifiedAt: new Date() })
    .where(and(eq(contactMethod.id, payload.contactMethodId), eq(contactMethod.memberId, actor.id)))
    .returning();
  if (!row) {
    return { ok: false as const, reason: "That address is no longer on your profile." };
  }
  return { ok: true as const, value: row.value };
}

/**
 * The provisioned primary: the address a member arrives with.
 *
 * One helper for all five provisioning paths, because the thing that has to
 * be true is that *every* member has a row they can move delivery onto —
 * not that each of five call sites remembered to write one. It is
 * emergency-only rather than everyone-visible because a member's mail
 * address is nobody else's business by default, and that is the same
 * choice `member-privacy.ts` makes for this visibility tier: choosing it is
 * the informed act, so it's the one a member has to keep.
 *
 * `verified: true` is passed by the paths where the address is already
 * proven — a magic link only ever arrives at an address its recipient
 * controls, and an OIDC `email` claim is the IdP's assertion that it does.
 * The OIDC path only passes it when the IdP actually said so (see
 * `emailVerified` below), because an unverified-claim IdP is common and
 * silently treating its claim as proof would make this flag a guess.
 */
export async function seedPrimaryContactMethod(
  tx: DbOrTx,
  memberId: string,
  email: string,
  options: { verified: boolean },
) {
  return tx
    .insert(contactMethod)
    .values({
      memberId,
      type: EMAIL_TYPE,
      value: email,
      visibility: "emergency_only",
      isPrimary: true,
      verifiedAt: options.verified ? new Date() : null,
    })
    .returning();
}

/**
 * Mark one of *this* member's own methods as verified, because they proved
 * they receive mail at it.
 *
 * Scoped to `memberId` and to the one address, deliberately, in that
 * order. A global "verify whichever contact method has this value" would
 * trust a caller to have already established which member it is talking
 * about, and the value being matched is one this app sends a login link
 * to — i.e. a string an unauthenticated caller can choose. Two members
 * may legitimately hold the same address as a non-primary method, and
 * the honest answer for both of them is "we don't know"; the one whose
 * identity the link was actually issued to is the only one this can say
 * anything true about.
 *
 * Idempotent and best-effort: an already-verified row matches nothing
 * and returns null, which is a success, not a failure.
 */
export async function verifyOwnContactMethodByValue(memberId: string, value: string) {
  const [updated] = await db
    .update(contactMethod)
    .set({ verifiedAt: new Date() })
    .where(
      and(
        eq(contactMethod.memberId, memberId),
        eq(contactMethod.value, value),
        isNull(contactMethod.verifiedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

// "people I share a task or group with" (docs/spec.md's contact-method
// visibility tiers) — resolved since this codebase has no separate
// Group entity: task-mates (co-assigned, right now, to the same Task)
// or Branch-mates, reusing Phase 42's own Branch-roster definition
// (distinct members currently holding a task in that branch) as
// "group," the closest existing concept to it. Deliberately doesn't
// reach into Spatial planning's PlacementMember (a real "who I'm
// sharing a tent with" relationship) — that module is opt-in, and this
// visibility tier is core, so leaning on it would make a core feature's
// behavior depend on an optional module being enabled.
export async function isTaskOrGroupMate(actor: Member, targetMemberId: string): Promise<boolean> {
  if (actor.id === targetMemberId) {
    return true;
  }

  const [actorHoldings, targetHoldings] = await Promise.all([
    db
      .select({ taskId: taskAssignment.taskId, branchId: task.branchId })
      .from(taskAssignment)
      .innerJoin(task, eq(taskAssignment.taskId, task.id))
      .where(
        and(
          eq(taskAssignment.memberId, actor.id),
          eq(taskAssignment.isShadow, false),
          eq(task.communityId, actor.communityId),
        ),
      ),
    db
      .select({ taskId: taskAssignment.taskId, branchId: task.branchId })
      .from(taskAssignment)
      .innerJoin(task, eq(taskAssignment.taskId, task.id))
      .where(
        and(
          eq(taskAssignment.memberId, targetMemberId),
          eq(taskAssignment.isShadow, false),
          eq(task.communityId, actor.communityId),
        ),
      ),
  ]);

  const actorTaskIds = new Set(actorHoldings.map((h) => h.taskId));
  const actorBranchIds = new Set(actorHoldings.map((h) => h.branchId));
  return targetHoldings.some((h) => actorTaskIds.has(h.taskId) || actorBranchIds.has(h.branchId));
}

// Everyone-visible + task/group-mate-visible methods on someone else's
// profile. emergency_only never surfaces here regardless of relationship
// — the only way to see one is src/lib/emergency-access.ts's
// activateEmergencyAccess, a real logged act, never an ordinary read.
export async function getVisibleContactMethods(actor: Member, targetMemberId: string) {
  if (actor.id === targetMemberId) {
    return listOwnContactMethods(actor);
  }

  const methods = await db.select().from(contactMethod).where(eq(contactMethod.memberId, targetMemberId));
  const nonEmergency = methods.filter((m) => m.visibility !== "emergency_only");
  if (nonEmergency.length === 0) {
    return nonEmergency;
  }

  const groupMate = nonEmergency.some((m) => m.visibility === "task_or_group_mates")
    ? await isTaskOrGroupMate(actor, targetMemberId)
    : false;

  return nonEmergency.filter((m) => m.visibility === "everyone" || groupMate);
}

// The one path that ever reads an emergency_only method — used only by
// src/lib/emergency-access.ts's activateEmergencyAccess, a real logged
// act, never an ordinary read.
export async function listEmergencyOnlyContactMethods(targetMemberId: string) {
  return db
    .select()
    .from(contactMethod)
    .where(and(eq(contactMethod.memberId, targetMemberId), eq(contactMethod.visibility, "emergency_only")));
}
