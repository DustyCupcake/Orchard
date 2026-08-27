import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { requirement, task, taskAssignment, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { memberHasTier } from "../eligibility";

type Member = typeof memberTable.$inferSelect;
type Requirement = typeof requirement.$inferSelect;

// MVP scope only enforces individual_gate — group_coverage and
// soft_priority exist as schema/DB enum values (per the spec, cheap to
// include now) but the surfacing/ranking logic they'd drive is deferred
// past MVP, so the CRUD layer doesn't let anyone create one yet.
const requirementValue = z.object({
  tierId: z.string().uuid().optional(),
  language: z.string().min(1).optional(),
  taskId: z.string().uuid().optional(),
  flag: z.string().min(1).optional(),
});

export const createRequirementInput = z
  .object({
    type: z.enum(["tier", "language", "completed_task", "custom"]),
    value: requirementValue,
  })
  .superRefine((input, ctx) => {
    const requiredKey: Record<typeof input.type, keyof z.infer<typeof requirementValue>> = {
      tier: "tierId",
      language: "language",
      completed_task: "taskId",
      custom: "flag",
    };
    const key = requiredKey[input.type];
    if (input.value[key] === undefined) {
      ctx.addIssue({
        code: "custom",
        message: `value.${key} is required for type "${input.type}"`,
        path: ["value", key],
      });
    }
  });
export type CreateRequirementInput = z.infer<typeof createRequirementInput>;

export const updateRequirementInput = z.object({ value: requirementValue });
export type UpdateRequirementInput = z.infer<typeof updateRequirementInput>;

async function requireTaskInCommunity(actor: Member, taskId: string) {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Task not found");
  }
}

export async function listRequirements(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);
  return db.select().from(requirement).where(eq(requirement.taskId, taskId));
}

export async function createRequirement(
  actor: Member,
  taskId: string,
  input: CreateRequirementInput,
) {
  await requireTaskInCommunity(actor, taskId);

  const [created] = await db
    .insert(requirement)
    .values({
      taskId,
      type: input.type,
      mode: "individual_gate",
      value: input.value,
    })
    .returning();
  return created;
}

export async function updateRequirement(
  actor: Member,
  taskId: string,
  requirementId: string,
  input: UpdateRequirementInput,
) {
  await requireTaskInCommunity(actor, taskId);

  const [updated] = await db
    .update(requirement)
    .set({ value: input.value })
    .where(and(eq(requirement.id, requirementId), eq(requirement.taskId, taskId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Requirement not found");
  }
  return updated;
}

export async function deleteRequirement(actor: Member, taskId: string, requirementId: string) {
  await requireTaskInCommunity(actor, taskId);

  const deleted = await db
    .delete(requirement)
    .where(and(eq(requirement.id, requirementId), eq(requirement.taskId, taskId)))
    .returning({ id: requirement.id });
  if (deleted.length === 0) {
    throw new NotFoundError("Requirement not found");
  }
}

async function isSatisfied(dbOrTx: DbOrTx, member: Member, req: Requirement): Promise<boolean> {
  const value = req.value as Record<string, unknown>;

  switch (req.type) {
    case "tier":
      return typeof value.tierId === "string" && memberHasTier(member, value.tierId);

    case "language":
      return typeof value.language === "string" && member.tags.includes(value.language);

    case "custom":
      return typeof value.flag === "string" && member.tags.includes(value.flag);

    case "completed_task": {
      if (typeof value.taskId !== "string") return false;
      // Held or shadowed both count (see docs/spec.md, Shadow slots &
      // succession) — this doesn't filter on is_shadow at all, so it
      // already covers both without extra logic once shadow claims ship.
      const [row] = await dbOrTx
        .select({ status: task.status })
        .from(taskAssignment)
        .innerJoin(task, eq(taskAssignment.taskId, task.id))
        .where(
          and(eq(taskAssignment.taskId, value.taskId), eq(taskAssignment.memberId, member.id)),
        );
      return row?.status === "done";
    }

    default:
      return false;
  }
}

// The core gate: which of a task's individual_gate Requirements does
// this member NOT satisfy. Empty array = eligible to claim.
export async function getUnmetRequirements(
  dbOrTx: DbOrTx,
  member: Member,
  taskId: string,
): Promise<Requirement[]> {
  const gates = await dbOrTx
    .select()
    .from(requirement)
    .where(and(eq(requirement.taskId, taskId), eq(requirement.mode, "individual_gate")));

  if (gates.length === 0) {
    return [];
  }

  const unmet: Requirement[] = [];
  for (const gate of gates) {
    if (!(await isSatisfied(dbOrTx, member, gate))) {
      unmet.push(gate);
    }
  }
  return unmet;
}

// Human-readable summary for error messages / display. tierNameById is
// optional — without it, a tier requirement just shows its raw id.
export function describeRequirement(
  req: Requirement,
  tierNameById?: Map<string, string>,
): string {
  const value = req.value as Record<string, unknown>;
  switch (req.type) {
    case "tier": {
      const id = String(value.tierId ?? "");
      return `Tier: ${tierNameById?.get(id) ?? id}`;
    }
    case "language":
      return `Language: ${value.language}`;
    case "completed_task":
      return `Must have completed a specific prior task`;
    case "custom":
      return `${value.flag}`;
    default:
      return req.type;
  }
}

export async function tierNameLookup(communityId: string): Promise<Map<string, string>> {
  const rows = await db.select().from(tier).where(eq(tier.communityId, communityId));
  return new Map(rows.map((t) => [t.id, t.name]));
}
