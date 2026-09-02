import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { consentMethodEnum, consentPurpose, consentRecord } from "@/db/schema";
import { sensitiveFieldKeyEnum } from "@/db/schema/sensitive-field-access-rule";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

// Deliberately not imported from src/lib/sensitive-data.ts — that
// module needs to import *this* one (to gate field population/
// visibility on active consent), and a two-way import between sibling
// lib files is exactly the circular-import shape Phase 39's own
// cycles/crud.ts lesson warns against. Derived straight from the same
// Postgres enum SensitiveFieldAccessRule already uses instead.
type SensitiveFieldKey = (typeof sensitiveFieldKeyEnum.enumValues)[number];

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
  gatesSensitiveField: z.enum(sensitiveFieldKeyEnum.enumValues).nullable().optional(),
});
export type CreateConsentPurposeInput = z.infer<typeof createConsentPurposeInput>;

export async function createConsentPurpose(actor: Member, input: CreateConsentPurposeInput) {
  const requiresExplicit = input.requiresExplicit ?? false;
  // "requires_explicit = true for anything gating an Art. 9 field" —
  // defense-in-depth re-check, same precedent Forms'
  // requireValidFields/Budget's requireLineItems already set: don't
  // trust only the zod shape (which allows either value here) to carry
  // a rule this important.
  if (input.gatesSensitiveField && !requiresExplicit) {
    throw new AppError("A purpose gating a Sensitive-data field must require explicit consent");
  }

  const existingByKey = await db
    .select({ id: consentPurpose.id })
    .from(consentPurpose)
    .where(and(eq(consentPurpose.communityId, actor.communityId), eq(consentPurpose.key, input.key)));
  if (existingByKey.length > 0) {
    throw new ConflictError(`A consent purpose with key "${input.key}" already exists`);
  }

  if (input.gatesSensitiveField) {
    const existingGate = await db
      .select({ id: consentPurpose.id })
      .from(consentPurpose)
      .where(
        and(
          eq(consentPurpose.communityId, actor.communityId),
          eq(consentPurpose.gatesSensitiveField, input.gatesSensitiveField),
        ),
      );
    if (existingGate.length > 0) {
      throw new ConflictError(`Another purpose already gates "${input.gatesSensitiveField}"`);
    }
  }

  const [created] = await db
    .insert(consentPurpose)
    .values({
      communityId: actor.communityId,
      key: input.key,
      label: input.label,
      noticeText: input.noticeText,
      requiresExplicit,
      gatesSensitiveField: input.gatesSensitiveField ?? null,
      noticeVersion: 1,
    })
    .returning();
  return created;
}

export async function listConsentPurposes(actor: Member) {
  return db.select().from(consentPurpose).where(eq(consentPurpose.communityId, actor.communityId));
}

export async function deleteConsentPurpose(actor: Member, purposeId: string) {
  const [existing] = await db
    .select({ id: consentPurpose.id })
    .from(consentPurpose)
    .where(and(eq(consentPurpose.id, purposeId), eq(consentPurpose.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Consent purpose not found");
  }
  await db.delete(consentPurpose).where(eq(consentPurpose.id, purposeId));
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

// The Sensitive-data wiring (Phase 22, extended by Phase 46): which
// purpose, if any, gates each field in this community.
export async function getGatingPurposesForCommunity(communityId: string) {
  const rows = await db
    .select()
    .from(consentPurpose)
    .where(and(eq(consentPurpose.communityId, communityId), isNotNull(consentPurpose.gatesSensitiveField)));

  const map = new Map<SensitiveFieldKey, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.gatesSensitiveField) {
      map.set(r.gatesSensitiveField, r);
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
