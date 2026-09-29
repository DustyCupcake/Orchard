import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { consentMethodEnum, consentPurpose, consentRecord, profileQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "./errors";
import { recordSettingChanges } from "./settings/history";

type Member = typeof memberTable.$inferSelect;

export const CONSENT_METHODS = consentMethodEnum.enumValues;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

// One row per distinct purpose a Community needs consent for. Admin-
// gated CRUD at the caller (Server Action + REST route), same posture
// Forms/SensitiveFieldAccessRule already establish — not enforced
// inside this module. Reading the list stays open to any member: they
// need to see what a purpose is before they can meaningfully grant or
// withdraw consent against it.
export const createConsentPurposeInput = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  noticeText: z.string().min(1),
  requiresExplicit: z.boolean().optional(),
  // A purpose gates one of the community's own sensitive questions.
  // This used to be "exactly one of a fixed member column or a
  // question", back when the four columns existed; the columns are
  // gone, so there is one target and the either/or is history. Keeping
  // the field nullable rather than required, because most purposes
  // (photo publication, marketing comms) gate nothing at all.
  gatesQuestionId: z.string().uuid().nullable().optional(),
});
export type CreateConsentPurposeInput = z.infer<typeof createConsentPurposeInput>;

export async function createConsentPurpose(actor: Member, input: CreateConsentPurposeInput) {
  const requiresExplicit = input.requiresExplicit ?? false;
  // "requires_explicit = true for anything gating an Art. 9 field" —
  // defense-in-depth re-check, same precedent Forms'
  // requireValidFields/Budget's requireLineItems already set: don't
  // trust only the zod shape (which allows either value here) to carry
  // a rule this important.
  if (input.gatesQuestionId && !requiresExplicit) {
    throw new AppError("A purpose gating a sensitive question must require explicit consent");
  }

  const existingByKey = await db
    .select({ id: consentPurpose.id })
    .from(consentPurpose)
    .where(and(eq(consentPurpose.communityId, actor.communityId), eq(consentPurpose.key, input.key)));
  if (existingByKey.length > 0) {
    throw new ConflictError(`A consent purpose with key "${input.key}" already exists`);
  }

  // At most one purpose per community may gate a given question: two
  // purposes gating one answer means the member has to work out which
  // notice authorises the read, and a stale grant against the wrong one
  // becomes indistinguishable from a live one.
  if (input.gatesQuestionId) {
    const [target] = await db
      .select({ archivedAt: profileQuestion.archivedAt })
      .from(profileQuestion)
      .where(
        and(
          eq(profileQuestion.id, input.gatesQuestionId),
          eq(profileQuestion.communityId, actor.communityId),
        ),
      );
    if (!target) {
      throw new NotFoundError("Profile question not found in your community");
    }
    if (target.archivedAt) {
      throw new ConflictError("That question is archived, so there is nothing left to gate");
    }
    // Staged, like an access rule: the purpose is written first and the
    // question marked sensitive second, because the flag is refused until
    // an audience exists. A purpose pointed at a not-yet-sensitive
    // question gates nothing today and starts gating the moment the flag
    // goes on — which is also when a notice about it starts meaning
    // something, so the ordering is the safe one either way.
    const existingGate = await db
      .select({ id: consentPurpose.id })
      .from(consentPurpose)
      .where(
        and(
          eq(consentPurpose.communityId, actor.communityId),
          eq(consentPurpose.gatesQuestionId, input.gatesQuestionId),
        ),
      );
    if (existingGate.length > 0) {
      throw new ConflictError("Another purpose already gates that question");
    }
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(consentPurpose)
      .values({
        communityId: actor.communityId,
        key: input.key,
        label: input.label,
        noticeText: input.noticeText,
        requiresExplicit,
        gatesQuestionId: input.gatesQuestionId ?? null,
        noticeVersion: 1,
      })
      .returning();

    // noticeText is deliberately *not* logged. It is a member-facing notice,
    // so a member-readable log that carried the full text of every notice
    // ever written would be a second, unbounded copy of the document — and
    // the field a reader actually needs in the log is which question the
    // notice gates, which is what `gatesQuestionId` below gives. That the
    // wording changed later is a separate question, and the table has no
    // update path for it today (see below createConsentPurpose's caller),
    // so nothing is lost by starting here.
    await recordSettingChanges(tx, {
      actor,
      entity: "consent_purpose",
      action: "created",
      entityId: row.id,
      entityLabel: row.label,
      current: {},
      changes: {
        key: row.key,
        label: row.label,
        requiresExplicit: row.requiresExplicit,
        gatesQuestionId: row.gatesQuestionId,
      },
    });
    return row;
  });
}

export async function listConsentPurposes(actor: Member) {
  return db.select().from(consentPurpose).where(eq(consentPurpose.communityId, actor.communityId));
}

export async function deleteConsentPurpose(actor: Member, purposeId: string) {
  const [existing] = await db
    .select({
      id: consentPurpose.id,
      key: consentPurpose.key,
      label: consentPurpose.label,
      requiresExplicit: consentPurpose.requiresExplicit,
      gatesQuestionId: consentPurpose.gatesQuestionId,
    })
    .from(consentPurpose)
    .where(and(eq(consentPurpose.id, purposeId), eq(consentPurpose.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Consent purpose not found");
  }

  await db.transaction(async (tx) => {
    await tx.delete(consentPurpose).where(eq(consentPurpose.id, purposeId));
    // A deleted consent purpose is a withdrawal of the notice itself, so
    // this row is the record that it ever existed and what it covered.
    // The notice text is not in it — see createConsentPurpose above.
    await recordSettingChanges(tx, {
      actor,
      entity: "consent_purpose",
      action: "deleted",
      entityId: purposeId,
      entityLabel: existing.label,
      current: existing,
      changes: { key: null, label: null, gatesQuestionId: null },
    });
  });
}

async function getActiveConsentRecord(memberId: string, purposeId: string) {
  const [row] = await db
    .select()
    .from(consentRecord)
    .where(and(eq(consentRecord.memberId, memberId), eq(consentRecord.purposeId, purposeId), isNull(consentRecord.withdrawnAt)));
  return row ?? null;
}

export async function hasActiveConsent(memberId: string, purposeId: string): Promise<boolean> {
  return Boolean(await getActiveConsentRecord(memberId, purposeId));
}

// Idempotent — granting again while already active just returns the
// existing record rather than stacking a second row, since "already
// consented" isn't meaningfully an error.
export async function grantConsent(actor: Member, purposeId: string, method: ConsentMethod = "explicit_action") {
  const [purpose] = await db
    .select()
    .from(consentPurpose)
    .where(and(eq(consentPurpose.id, purposeId), eq(consentPurpose.communityId, actor.communityId)));
  if (!purpose) {
    throw new NotFoundError("Consent purpose not found");
  }

  const existingActive = await getActiveConsentRecord(actor.id, purposeId);
  if (existingActive) {
    return existingActive;
  }

  const [created] = await db
    .insert(consentRecord)
    .values({
      memberId: actor.id,
      purposeId,
      noticeVersion: purpose.noticeVersion,
      method,
      withdrawnAt: null,
    })
    .returning();
  return created;
}

// Must actually revoke access (re-checked at read time by whatever this
// purpose gates), not just flag it — see src/lib/sensitive-data.ts's
// consumption of listMembersWithActiveConsent below.
export async function withdrawConsent(actor: Member, purposeId: string) {
  const existingActive = await getActiveConsentRecord(actor.id, purposeId);
  if (!existingActive) {
    throw new NotFoundError("No active consent to withdraw");
  }
  const [updated] = await db
    .update(consentRecord)
    .set({ withdrawnAt: new Date() })
    .where(eq(consentRecord.id, existingActive.id))
    .returning();
  return updated;
}

// The /profile "your consent" surface: every purpose in the community,
// alongside whether the actor currently has it active.
export async function listMyConsentStatus(actor: Member) {
  const [purposes, records] = await Promise.all([
    listConsentPurposes(actor),
    db.select().from(consentRecord).where(eq(consentRecord.memberId, actor.id)),
  ]);

  return purposes.map((p) => {
    const forPurpose = records.filter((r) => r.purposeId === p.id);
    const active = forPurpose.find((r) => r.withdrawnAt === null) ?? null;
    const mostRecent = forPurpose.sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())[0] ?? null;
    return {
      purpose: p,
      active: Boolean(active),
      grantedAt: active?.grantedAt ?? null,
      withdrawnAt: !active && mostRecent ? mostRecent.withdrawnAt : null,
    };
  });
}

// Which purpose, if any, gates each sensitive question in this community.
//
// This was written as two functions — one over the four fixed member
// columns, one over questions — and for its whole life the question half
// had no caller, so an Admin could configure a purpose gating a question,
// a member could grant and withdraw it, the settings list would display
// it, and withdrawing it changed nothing at all. It is now the only one,
// and it is called from the read path in sensitive-data.ts, so a
// withdrawal takes effect on the next read rather than never.
export async function getGatingPurposesForQuestions(communityId: string) {
  const rows = await db
    .select()
    .from(consentPurpose)
    .where(and(eq(consentPurpose.communityId, communityId), isNotNull(consentPurpose.gatesQuestionId)));

  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.gatesQuestionId) {
      map.set(r.gatesQuestionId, r);
    }
  }
  return map;
}

export async function listMembersWithActiveConsent(purposeId: string): Promise<Set<string>> {
  const rows = await db
    .select({ memberId: consentRecord.memberId })
    .from(consentRecord)
    .where(and(eq(consentRecord.purposeId, purposeId), isNull(consentRecord.withdrawnAt)));
  return new Set(rows.map((r) => r.memberId));
}
