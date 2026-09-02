import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contactMethod, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

export const CONTACT_METHOD_VISIBILITIES = ["everyone", "task_or_group_mates", "emergency_only"] as const;
export type ContactMethodVisibility = (typeof CONTACT_METHOD_VISIBILITIES)[number];

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
  await requireOwnContactMethod(actor, id);
  const [updated] = await db
    .update(contactMethod)
    .set({ type: input.type, value: input.value, visibility: input.visibility })
    .where(eq(contactMethod.id, id))
    .returning();
  return updated;
}

export async function deleteContactMethod(actor: Member, id: string) {
  await requireOwnContactMethod(actor, id);
  await db.delete(contactMethod).where(eq(contactMethod.id, id));
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
