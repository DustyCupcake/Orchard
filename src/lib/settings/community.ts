import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, form, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import { recruitmentDecisionRulesSchema, requireValidDecisionRules } from "../recruitment/evaluations";
import { requireNotOnsiteLocked } from "../onsite-mode";

type Member = typeof memberTable.$inferSelect;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #3a6cd9");

export async function getCommunity(actor: Member) {
  const [row] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// Deliberately narrow — per docs/development-plan.md's Phase 9 scope
// ("branches, tiers, and cycle/phase structure"), not the full
// Configuration model. membership_model and branch_membership_model
// stay DB-only for now. The call defaults are wired up here in
// Phase 19 — see src/lib/settings/branches.ts for the per-Branch
// overrides that fall back to these. modulesEnabled is wired up in
// Phase 22 — see src/lib/modules.ts.
export const updateCommunityInput = z.object({
  name: z.string().min(1).optional(),
  cyclesEnabled: z.boolean().optional(),
  phasesEnabled: z.boolean().optional(),
  cycleInitiationTierId: z.string().uuid().nullable().optional(),
  defaultCallHasAgenda: z.boolean().optional(),
  defaultCallNeedsSummary: z.boolean().optional(),
  defaultCallRequireRead: z.boolean().optional(),
  conflictAckWindowHours: z.number().int().positive().optional(),
  modulesEnabled: z.array(z.string()).optional(),
  // Null turns off the standing post-cycle feedback ask — see
  // src/db/schema/community.ts's schema comment and src/lib/forms.ts.
  // Its own review-task authority is a PermissionGrant now (Phase 63)
  // — see setPermissionGrantAction/addPermissionGrantAction/
  // removePermissionGrantAction in src/app/(app)/settings/actions.ts,
  // not this input.
  postCycleFeedbackFormId: z.string().uuid().nullable().optional(),
  // Null turns off application intake — /apply says so. Same non-FK
  // pointer reasoning as postCycleFeedbackFormId.
  recruitmentApplicationFormId: z.string().uuid().nullable().optional(),
  recruitmentEvaluatorCount: z.number().int().positive().optional(),
  recruitmentDecisionRules: recruitmentDecisionRulesSchema.optional(),
  recruitmentSubscriptionLapseThreshold: z.number().int().positive().optional(),
  recruitmentWiderDiscussionHours: z.number().int().positive().optional(),
  // Null clears it — "surfaced to whoever's about to send an actual
  // decline, never sent automatically."
  recruitmentRejectionTemplate: z.string().nullable().optional(),
  // "Only offered if phases are on" (docs/spec.md's Configuration
  // table) — /settings only renders the checkbox when phasesEnabled is
  // already true, re-checked here too. See src/lib/onsite-mode.ts for
  // what turning it on actually locks.
  onsiteModeEnabled: z.boolean().optional(),
  // "Reply within [N days]" — see src/db/schema/community.ts's own
  // comment and src/lib/tasks/nominations.ts.
  taskNominationResponseDays: z.number().int().positive().optional(),
  // Response tracking thresholds and the call-summary read window —
  // see src/db/schema/community.ts's own comments and
  // src/lib/engagement.ts.
  engagementSoftFlagThreshold: z.number().int().positive().optional(),
  engagementPatternThreshold: z.number().int().positive().optional(),
  callSummaryReadWindowDays: z.number().int().positive().optional(),
  // Community branding — see design_handoff_conventions/README.md. Null
  // clears back to the design tokens' own default accent (design tokens
  // fall back to the documented cobalt/plum pair when either is null).
  accentPrimary: hexColor.nullable().optional(),
  accentSecondary: hexColor.nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  // OIDC second auth provider — see src/db/schema/community.ts's own
  // comment and src/lib/oidc.ts. Null clears it back to magic-link
  // only; the client secret itself is never accepted here, it's an env
  // var (OIDC_CLIENT_SECRET).
  oidcIssuerUrl: z.string().url().nullable().optional(),
  oidcClientId: z.string().min(1).nullable().optional(),
  oidcRequiredRole: z.string().min(1).nullable().optional(),
});
export type UpdateCommunityInput = z.infer<typeof updateCommunityInput>;

export async function updateCommunity(actor: Member, input: UpdateCommunityInput) {
  const [currentRow] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!currentRow) {
    throw new NotFoundError("Community not found");
  }

  // The one escape hatch: turning on-site mode off is always allowed
  // even while locked (it's the only way back to normal editing) — any
  // other settings change while it's on, including bundling one into
  // the same submission, is rejected.
  if (input.onsiteModeEnabled !== false) {
    requireNotOnsiteLocked(currentRow);
  }

  if (input.onsiteModeEnabled === true) {
    const effectivePhasesEnabled = input.phasesEnabled ?? currentRow.phasesEnabled;
    if (!effectivePhasesEnabled) {
      throw new AppError("On-site mode requires Phases to be enabled first");
    }
  }

  if (input.cycleInitiationTierId) {
    const [tierRow] = await db
      .select({ id: tier.id, communityId: tier.communityId })
      .from(tier)
      .where(eq(tier.id, input.cycleInitiationTierId));
    if (!tierRow || tierRow.communityId !== actor.communityId) {
      throw new NotFoundError("Tier not found in your community");
    }
  }

  if (input.postCycleFeedbackFormId) {
    const [formRow] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.id, input.postCycleFeedbackFormId), eq(form.communityId, actor.communityId)));
    if (!formRow) {
      throw new NotFoundError("Form not found in your community");
    }
  }

  if (input.recruitmentApplicationFormId) {
    const [formRow] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.id, input.recruitmentApplicationFormId), eq(form.communityId, actor.communityId)));
    if (!formRow) {
      throw new NotFoundError("Form not found in your community");
    }
  }

  if (input.recruitmentDecisionRules !== undefined) {
    requireValidDecisionRules(input.recruitmentDecisionRules);
  }

  const [updated] = await db
    .update(community)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.cyclesEnabled !== undefined && { cyclesEnabled: input.cyclesEnabled }),
      ...(input.phasesEnabled !== undefined && { phasesEnabled: input.phasesEnabled }),
      ...(input.cycleInitiationTierId !== undefined && {
        cycleInitiationTierId: input.cycleInitiationTierId,
      }),
      ...(input.defaultCallHasAgenda !== undefined && { defaultCallHasAgenda: input.defaultCallHasAgenda }),
      ...(input.defaultCallNeedsSummary !== undefined && {
        defaultCallNeedsSummary: input.defaultCallNeedsSummary,
      }),
      ...(input.defaultCallRequireRead !== undefined && {
        defaultCallRequireRead: input.defaultCallRequireRead,
      }),
      ...(input.conflictAckWindowHours !== undefined && {
        conflictAckWindowHours: input.conflictAckWindowHours,
      }),
      ...(input.modulesEnabled !== undefined && { modulesEnabled: input.modulesEnabled }),
      ...(input.postCycleFeedbackFormId !== undefined && {
        postCycleFeedbackFormId: input.postCycleFeedbackFormId,
      }),
      ...(input.recruitmentApplicationFormId !== undefined && {
        recruitmentApplicationFormId: input.recruitmentApplicationFormId,
      }),
      ...(input.recruitmentEvaluatorCount !== undefined && {
        recruitmentEvaluatorCount: input.recruitmentEvaluatorCount,
      }),
      ...(input.recruitmentDecisionRules !== undefined && {
        recruitmentDecisionRules: input.recruitmentDecisionRules,
      }),
      ...(input.recruitmentSubscriptionLapseThreshold !== undefined && {
        recruitmentSubscriptionLapseThreshold: input.recruitmentSubscriptionLapseThreshold,
      }),
      ...(input.recruitmentWiderDiscussionHours !== undefined && {
        recruitmentWiderDiscussionHours: input.recruitmentWiderDiscussionHours,
      }),
      ...(input.recruitmentRejectionTemplate !== undefined && {
        recruitmentRejectionTemplate: input.recruitmentRejectionTemplate,
      }),
      ...(input.onsiteModeEnabled !== undefined && { onsiteModeEnabled: input.onsiteModeEnabled }),
      ...(input.taskNominationResponseDays !== undefined && {
        taskNominationResponseDays: input.taskNominationResponseDays,
      }),
      ...(input.engagementSoftFlagThreshold !== undefined && {
        engagementSoftFlagThreshold: input.engagementSoftFlagThreshold,
      }),
      ...(input.engagementPatternThreshold !== undefined && {
        engagementPatternThreshold: input.engagementPatternThreshold,
      }),
      ...(input.callSummaryReadWindowDays !== undefined && {
        callSummaryReadWindowDays: input.callSummaryReadWindowDays,
      }),
      ...(input.accentPrimary !== undefined && { accentPrimary: input.accentPrimary }),
      ...(input.accentSecondary !== undefined && { accentSecondary: input.accentSecondary }),
      ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
      ...(input.oidcIssuerUrl !== undefined && { oidcIssuerUrl: input.oidcIssuerUrl }),
      ...(input.oidcClientId !== undefined && { oidcClientId: input.oidcClientId }),
      ...(input.oidcRequiredRole !== undefined && { oidcRequiredRole: input.oidcRequiredRole }),
    })
    .where(eq(community.id, actor.communityId))
    .returning();

  return updated;
}
