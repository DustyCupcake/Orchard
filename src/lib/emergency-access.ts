import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { emergencyAccessLog, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { listEmergencyOnlyContactMethods } from "./contact-methods";
import { ForbiddenError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

// Runs on GDPR Art. 6(1)(d) vital interests, deliberately outside the
// consent framework in src/lib/consent.ts — see member-privacy.ts's
// schema comment. Any member can activate on any other member; the
// logged activation (plus the required, addable-after-the-fact
// explanation) is the accountability trail. Not gated on there actually
// being any emergency-only method to reveal — the act of activating is
// what's logged, regardless of what it turns up.
export async function activateEmergencyAccess(actor: Member, targetMemberId: string, explanation?: string) {
  const [target] = await db.select().from(member).where(eq(member.id, targetMemberId));
  if (!target || target.communityId !== actor.communityId) {
    throw new NotFoundError("Member not found in your community");
  }

  const methods = await listEmergencyOnlyContactMethods(targetMemberId);

  const [log] = await db
    .insert(emergencyAccessLog)
    .values({ activatedBy: actor.id, targetMemberId, explanation: explanation?.trim() || null })
    .returning();

  return { log, methods };
}

// "Can be added after the fact rather than blocking the moment" — the
// activator (only) can set or revise their own explanation any time.
export async function addEmergencyAccessExplanation(actor: Member, logId: string, explanation: string) {
  const [existing] = await db.select().from(emergencyAccessLog).where(eq(emergencyAccessLog.id, logId));
  if (!existing) {
    throw new NotFoundError("Activation not found");
  }
  if (existing.activatedBy !== actor.id) {
    throw new ForbiddenError("Only the member who activated this can add an explanation");
  }

  const [updated] = await db
    .update(emergencyAccessLog)
    .set({ explanation: explanation.trim() || null })
    .where(eq(emergencyAccessLog.id, logId))
    .returning();
  return updated;
}

// Used by the /members/[id] page to decide whether to reveal
// emergency-only contact info right after a fresh activation, without
// putting anything sensitive in the redirect URL — see that page's own
// comment for the full reasoning.
export async function getMostRecentActivation(actor: Member, targetMemberId: string) {
  const [row] = await db
    .select()
    .from(emergencyAccessLog)
    .where(and(eq(emergencyAccessLog.activatedBy, actor.id), eq(emergencyAccessLog.targetMemberId, targetMemberId)))
    .orderBy(desc(emergencyAccessLog.activatedAt))
    .limit(1);
  return row ?? null;
}

// "Both the person activating it and the person whose info is accessed
// get notified" — the log row itself is already the queryable trace
// (the same "the entity is its own notification source" reasoning
// Phase 38's PlacementRevertNotice comment established, applied here
// without inventing a second row since EmergencyAccessLog already *is*
// that record), read back for whichever side the actor is on.
export async function listEmergencyAccessActivity(actor: Member, limit = 20) {
  const rows = await db
    .select()
    .from(emergencyAccessLog)
    .where(or(eq(emergencyAccessLog.activatedBy, actor.id), eq(emergencyAccessLog.targetMemberId, actor.id)))
    .orderBy(desc(emergencyAccessLog.activatedAt))
    .limit(limit);

  const counterpartIds = [
    ...new Set(rows.map((r) => (r.activatedBy === actor.id ? r.targetMemberId : r.activatedBy))),
  ];
  const counterparts = counterpartIds.length
    ? await db.select({ id: member.id, name: member.name }).from(member).where(inArray(member.id, counterpartIds))
    : [];
  const nameById = new Map(counterparts.map((m) => [m.id, m.name]));

  return rows.map((r) => {
    const isActivator = r.activatedBy === actor.id;
    return {
      ...r,
      role: isActivator ? ("activator" as const) : ("target" as const),
      counterpartName: nameById.get(isActivator ? r.targetMemberId : r.activatedBy) ?? "—",
    };
  });
}
