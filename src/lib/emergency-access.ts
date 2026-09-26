import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  emergencyAccessLog,
  member,
  profileAnswer,
  profileQuestion,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { listEmergencyOnlyContactMethods } from "./contact-methods";
import { AppError, ForbiddenError, NotFoundError } from "./errors";
import { formatFieldValue } from "./field-shape";

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
  const answers = await listEmergencyAnswers(targetMemberId);

  // Required the moment a *question* is going to be read, and optional for
  // a contact method, which is the asymmetry the whole feature rests on.
  //
  // "Look up this phone number" is a request the log answers on its own:
  // who, when, whose number. "Read Bob's medication" is not — the
  // activator is the only one who knows whether there was a fire, and the
  // member being read about is about to be notified. A log entry with a
  // null explanation for that read says someone looked and not why, which
  // is exactly the read the notification can't explain. Nullable stays
  // the right shape for the column because a method-only activation
  // legitimately has nothing to add.
  if (answers.length > 0 && !explanation?.trim()) {
    throw new AppError(
      `Say why before activating. ${target.name} has ${answers.length === 1 ? "a question" : `${answers.length} questions`} marked for emergency access, and the member is notified that it was read \u2014 the log has to carry the reason, not just the fact.`,
    );
  }

  const [log] = await db
    .insert(emergencyAccessLog)
    .values({ activatedBy: actor.id, targetMemberId, explanation: explanation?.trim() || null })
    .returning();

  return { log, methods, answers };
}

/**
 * The answers an emergency activation reveals: this member's real answers
 * to questions marked for emergency access.
 *
 * Filtered on `emergencyAccess && sensitive`, and the second condition is
 * not belt-and-braces. A non-sensitive question is readable by the whole
 * community, so "revealing" one under emergency access would put a read
 * of public data into the log as though it had been protected \u2014 which
 * is the one thing an audit trail must never do. The write side refuses
 * the combination (assertEmergencyHasSomethingToOverride), so this is
 * unreachable through the settings; the read side still has to be right on
 * its own, for the same reason resolveReadableQuestions fails closed.
 *
 * Declines aren't answers, and a deferred one is explicitly not an answer
 * either, so neither appears here: reporting "I declined to say" as a
 * value would be reading a refusal as content.
 */
export async function listEmergencyAnswers(targetMemberId: string) {
  const rows = await db
    .select({
      questionId: profileQuestion.id,
      label: profileQuestion.label,
      responseType: profileQuestion.responseType,
      status: profileAnswer.status,
      value: profileAnswer.value,
    })
    .from(profileAnswer)
    .innerJoin(profileQuestion, eq(profileQuestion.id, profileAnswer.questionId))
    .where(
      and(
        eq(profileAnswer.memberId, targetMemberId),
        // Standing answers only. A per-event answer belongs to that event
        // and is reached through the event, not through "this member has
        // an emergency" — otherwise activating once would surface a year
        // of history nobody asked about.
        isNull(profileAnswer.cycleId),
        eq(profileQuestion.emergencyAccess, true),
        eq(profileQuestion.sensitive, true),
        isNull(profileQuestion.archivedAt),
      ),
    )
    .orderBy(profileQuestion.label);

  // Only real answers. A decline is a refusal to hold the value at all and
  // a deferral is explicitly not an answer, so neither is content — and
  // rendering "I declined to say" in a reveal would read a refusal as
  // though it were the thing that was withheld.
  return rows
    .filter((r) => r.status === "answered")
    .map((r) => ({
      questionId: r.questionId,
      label: r.label,
      // formatFieldValue rather than String(value): a boolean is a real
      // `false` (which prints as "false") and a date is a raw ISO string,
      // and this is the one surface where a member's answer is read by
      // someone who is looking for it.
      value: formatFieldValue(r.value, r.responseType),
    }));
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
