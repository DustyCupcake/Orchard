import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, form, task, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";

type Member = typeof memberTable.$inferSelect;

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
});
export type UpdateCommunityInput = z.infer<typeof updateCommunityInput>;

export async function updateCommunity(actor: Member, input: UpdateCommunityInput) {
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
    })
    .where(eq(community.id, actor.communityId))
    .returning();

  return updated;
}
