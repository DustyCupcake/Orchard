import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, form, task, tier } from "@/db/schema";
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
  adminsTag: z.string().min(1).optional(),
  coordinationTag: z.string().min(1).optional(),
  defaultCallHasAgenda: z.boolean().optional(),
  defaultCallNeedsSummary: z.boolean().optional(),
  defaultCallRequireRead: z.boolean().optional(),
  // Null turns the Conflict management module off — see
  // src/db/schema/community.ts's schema comment and src/lib/conflict.ts.
  conflictTeamTaskId: z.string().uuid().nullable().optional(),
  conflictAckWindowHours: z.number().int().positive().optional(),
  modulesEnabled: z.array(z.string()).optional(),
  // Null turns off the standing post-cycle feedback ask / clears its
  // review-task authority — see src/db/schema/community.ts's schema
  // comment and src/lib/forms.ts.
  postCycleFeedbackFormId: z.string().uuid().nullable().optional(),
  feedbackReviewTaskId: z.string().uuid().nullable().optional(),
  // Whichever task reviews Event scheduling proposals — see
  // src/db/schema/community.ts's schema comment and
  // src/lib/event-scheduling.
  eventSchedulingOwnerTaskId: z.string().uuid().nullable().optional(),
  // Whichever task is "a recruitment-facing task" for Phases 32-35 —
  // see src/db/schema/community.ts's schema comment and
  // src/lib/recruitment.
  recruitmentTaskId: z.string().uuid().nullable().optional(),
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
  // Whichever task reviews pending Placements and edits Zones — see
  // src/db/schema/community.ts's schema comment and
  // src/lib/spatial-planning.
  spatialPlanningTaskId: z.string().uuid().nullable().optional(),
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
  // Whichever task's holder can send a community-wide announcement —
  // see src/db/schema/community.ts's own comment and src/lib/messages.ts.
  // Null clears it, same as every other "the task is the authority"
  // pointer above.
  announcementTaskId: z.string().uuid().nullable().optional(),
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

  if (input.conflictTeamTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.conflictTeamTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
  }

  if (input.feedbackReviewTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.feedbackReviewTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
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

  if (input.eventSchedulingOwnerTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.eventSchedulingOwnerTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
  }

  if (input.recruitmentTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.recruitmentTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
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

  if (input.spatialPlanningTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.spatialPlanningTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
  }

  if (input.announcementTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.announcementTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
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
      ...(input.adminsTag !== undefined && { adminsTag: input.adminsTag }),
      ...(input.coordinationTag !== undefined && { coordinationTag: input.coordinationTag }),
      ...(input.defaultCallHasAgenda !== undefined && { defaultCallHasAgenda: input.defaultCallHasAgenda }),
      ...(input.defaultCallNeedsSummary !== undefined && {
        defaultCallNeedsSummary: input.defaultCallNeedsSummary,
      }),
      ...(input.defaultCallRequireRead !== undefined && {
        defaultCallRequireRead: input.defaultCallRequireRead,
      }),
      ...(input.conflictTeamTaskId !== undefined && { conflictTeamTaskId: input.conflictTeamTaskId }),
      ...(input.conflictAckWindowHours !== undefined && {
        conflictAckWindowHours: input.conflictAckWindowHours,
      }),
      ...(input.modulesEnabled !== undefined && { modulesEnabled: input.modulesEnabled }),
      ...(input.postCycleFeedbackFormId !== undefined && {
        postCycleFeedbackFormId: input.postCycleFeedbackFormId,
      }),
      ...(input.feedbackReviewTaskId !== undefined && { feedbackReviewTaskId: input.feedbackReviewTaskId }),
      ...(input.eventSchedulingOwnerTaskId !== undefined && {
        eventSchedulingOwnerTaskId: input.eventSchedulingOwnerTaskId,
      }),
      ...(input.recruitmentTaskId !== undefined && { recruitmentTaskId: input.recruitmentTaskId }),
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
      ...(input.spatialPlanningTaskId !== undefined && {
        spatialPlanningTaskId: input.spatialPlanningTaskId,
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
      ...(input.announcementTaskId !== undefined && { announcementTaskId: input.announcementTaskId }),
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
