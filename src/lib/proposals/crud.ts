import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, task, taskProposal } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { createTask, createTaskInput } from "../tasks/crud";
import { addTaskDependency } from "../tasks/dependencies";
import { claimTask } from "../tasks/lifecycle";
import { createRequirement, createRequirementInput } from "../tasks/requirements";
import { isAdmin } from "../settings/admins";
import { addPermissionGrant, allowsMultipleGrants, PERMISSION_MODULE_KEYS, setPermissionGrant } from "../permissions";

type Member = typeof memberTable.$inferSelect;

export const createProposalInput = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  wantsToClaim: z.boolean().optional(),
  suggestedMemberId: z.string().uuid().nullable().optional(),
  suggestedMemberNote: z.string().nullable().optional(),
});
export type CreateProposalInput = z.infer<typeof createProposalInput>;

export async function createProposal(actor: Member, input: CreateProposalInput) {
  if (input.suggestedMemberId) {
    const [suggested] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, input.suggestedMemberId), eq(member.communityId, actor.communityId)));
    if (!suggested) {
      throw new NotFoundError("Suggested member not found in your community");
    }
  }

  const [created] = await db
    .insert(taskProposal)
    .values({
      communityId: actor.communityId,
      title: input.title,
      description: input.description ?? "",
      submittedBy: actor.id,
      wantsToClaim: input.wantsToClaim ?? false,
      suggestedMemberId: input.suggestedMemberId ?? null,
      suggestedMemberNote: input.suggestedMemberNote ?? null,
    })
    .returning();

  return created;
}

export async function listProposals(actor: Member, filters: { status?: string } = {}) {
  const conditions = [eq(taskProposal.communityId, actor.communityId)];
  if (filters.status) {
    conditions.push(
      eq(taskProposal.status, filters.status as (typeof taskProposal.status.enumValues)[number]),
    );
  }

  return db
    .select()
    .from(taskProposal)
    .where(and(...conditions))
    .orderBy(desc(taskProposal.createdAt));
}

export async function getProposal(actor: Member, proposalId: string) {
  const [row] = await db
    .select()
    .from(taskProposal)
    .where(and(eq(taskProposal.id, proposalId), eq(taskProposal.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Proposal not found");
  }
  return row;
}

// Whoever's reviewing fills in everything a bare proposal doesn't have
// — same shape as an ordinary task create, minus title/description
// (already on the proposal, but still overridable here) plus an
// optional set of Requirements to attach right away.
export const activateProposalInput = createTaskInput
  .omit({ title: true, description: true })
  .extend({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    requirements: z.array(createRequirementInput).optional(),
    dependsOnTaskIds: z.array(z.string().uuid()).optional(),
    grantModuleKeys: z.array(z.enum(PERMISSION_MODULE_KEYS)).optional(),
  });
export type ActivateProposalInput = z.infer<typeof activateProposalInput>;

// Not wrapped in one DB transaction: creating the task, attaching
// requirements, and the best-effort auto-claim each call into their own
// existing (already-transactional-where-it-matters) functions rather
// than a fourth copy of that logic. If a later step fails, the task
// still exists and coordination can finish it by hand through the
// ordinary task/requirement endpoints — an acceptable gap for a
// human-triggered review action, not a hot concurrent path like claim.
export async function activateProposal(
  actor: Member,
  proposalId: string,
  input: ActivateProposalInput,
) {
  const proposalRow = await getProposal(actor, proposalId);
  if (proposalRow.status !== "pending") {
    throw new ConflictError(`Cannot activate a proposal that is ${proposalRow.status}`);
  }

  const [proposer] = await db.select().from(member).where(eq(member.id, proposalRow.submittedBy));

  let newTask = await createTask(
    actor,
    {
      branchId: input.branchId,
      cycleId: input.cycleId,
      phaseId: input.phaseId,
      title: input.title ?? proposalRow.title,
      description: input.description ?? proposalRow.description,
      tags: input.tags,
      effort: input.effort,
      effortMagnitude: input.effortMagnitude,
      capacity: input.capacity,
      openness: input.openness,
      endorsementThreshold: input.endorsementThreshold,
      critical: input.critical,
      browsePeriodEnd: input.browsePeriodEnd,
    },
    proposalRow.submittedBy,
  );

  if (proposalRow.suggestedMemberId) {
    const [updated] = await db
      .update(task)
      .set({ suggestedMemberId: proposalRow.suggestedMemberId })
      .where(eq(task.id, newTask.id))
      .returning();
    newTask = updated;
  }

  for (const req of input.requirements ?? []) {
    await createRequirement(actor, newTask.id, req);
  }

  for (const dependsOnTaskId of input.dependsOnTaskIds ?? []) {
    await addTaskDependency(actor, newTask.id, dependsOnTaskId);
  }

  // "Permissions granted by this task" (docs/development-plan.md's
  // Phase 64) — deliberately a follow-up write, not folded into
  // createTask above: PermissionGrant.taskId needs a real task row,
  // which doesn't exist until createTask returns. Re-checked here,
  // not just trusted from the caller, since activateProposal/
  // activateProposalAction are intentionally open to any member
  // (proposals/page.tsx: "no coordinator role gating this yet") while
  // every other PermissionGrant write in this codebase is Admin-only
  // (settings/actions.ts's setPermissionGrantAction et al.) — silently
  // skipping rather than throwing keeps a forged grantModuleKeys field
  // from blocking the rest of an otherwise-legitimate activation.
  if (input.grantModuleKeys && input.grantModuleKeys.length > 0 && (await isAdmin(actor))) {
    for (const moduleKey of input.grantModuleKeys) {
      if (allowsMultipleGrants(moduleKey)) {
        await addPermissionGrant(actor.communityId, moduleKey, newTask.id);
      } else {
        await setPermissionGrant(actor.communityId, moduleKey, newTask.id);
      }
    }
  }

  let autoClaimed = false;
  if (proposalRow.wantsToClaim && proposer) {
    try {
      newTask = await claimTask(proposer, newTask.id);
      autoClaimed = true;
    } catch {
      // Best-effort — a Requirement added during activation (or the
      // task somehow already filling) shouldn't block activation
      // itself. The proposer, or coordination, can still claim it.
    }
  }

  await db
    .update(taskProposal)
    .set({ status: "activated", activatedTaskId: newTask.id })
    .where(eq(taskProposal.id, proposalId));

  return { task: newTask, autoClaimed };
}

export async function declineProposal(actor: Member, proposalId: string, reason?: string) {
  const proposalRow = await getProposal(actor, proposalId);
  if (proposalRow.status !== "pending") {
    throw new ConflictError(`Cannot decline a proposal that is ${proposalRow.status}`);
  }

  const [updated] = await db
    .update(taskProposal)
    .set({ status: "declined", declineReason: reason ?? null })
    .where(eq(taskProposal.id, proposalId))
    .returning();
  return updated;
}
