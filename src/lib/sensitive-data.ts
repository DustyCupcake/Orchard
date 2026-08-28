import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, member, sensitiveFieldAccessRule, task, taskAssignment, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "./errors";
import { requireModuleEnabled } from "./modules";

type Member = typeof memberTable.$inferSelect;

export const SENSITIVE_FIELD_KEYS = [
  "health_conditions",
  "allergies",
  "emergency_contact",
  "orientation",
] as const;
export type SensitiveFieldKey = (typeof SENSITIVE_FIELD_KEYS)[number];

export const SENSITIVE_FIELD_LABELS: Record<SensitiveFieldKey, string> = {
  health_conditions: "Health conditions",
  allergies: "Allergies",
  emergency_contact: "Emergency contact",
  orientation: "Orientation",
};

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// A member's own values — always theirs to see and edit regardless of
// any access rule (only *others'* access is purpose-bound, per
// docs/spec.md). Still requires the module to be on: turning it off
// means this data isn't being collected at all, not just hidden.
export const updateOwnSensitiveDataInput = z.object({
  healthConditions: z.string().nullable().optional(),
  allergies: z.string().nullable().optional(),
  emergencyContact: z.string().nullable().optional(),
  orientation: z.string().nullable().optional(),
});
export type UpdateOwnSensitiveDataInput = z.infer<typeof updateOwnSensitiveDataInput>;

export async function updateOwnSensitiveData(actor: Member, input: UpdateOwnSensitiveDataInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "sensitive_data");

  const [updated] = await db
    .update(member)
    .set({
      ...(input.healthConditions !== undefined && { healthConditions: input.healthConditions }),
      ...(input.allergies !== undefined && { allergies: input.allergies }),
      ...(input.emergencyContact !== undefined && { emergencyContact: input.emergencyContact }),
      ...(input.orientation !== undefined && { orientation: input.orientation }),
    })
    .where(eq(member.id, actor.id))
    .returning();
  return updated;
}

// Rules: which task or tier unlocks a field for *other* members' data.
// Exactly one of unlockedByTaskId/unlockedByTierId per rule — a field
// can carry more than one rule (e.g. a task and a tier that each
// independently unlock it).
export const createSensitiveFieldAccessRuleInput = z.object({
  fieldKey: z.enum(SENSITIVE_FIELD_KEYS),
  unlockedByTaskId: z.string().uuid().nullable().optional(),
  unlockedByTierId: z.string().uuid().nullable().optional(),
});
export type CreateSensitiveFieldAccessRuleInput = z.infer<typeof createSensitiveFieldAccessRuleInput>;

export async function createSensitiveFieldAccessRule(
  actor: Member,
  input: CreateSensitiveFieldAccessRuleInput,
) {
  const hasTask = Boolean(input.unlockedByTaskId);
  const hasTier = Boolean(input.unlockedByTierId);
  if (hasTask === hasTier) {
    throw new AppError("Pick exactly one of a task or a tier to unlock this field");
  }

  if (input.unlockedByTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.unlockedByTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
  }
  if (input.unlockedByTierId) {
    const [tierRow] = await db
      .select({ id: tier.id })
      .from(tier)
      .where(and(eq(tier.id, input.unlockedByTierId), eq(tier.communityId, actor.communityId)));
    if (!tierRow) {
      throw new NotFoundError("Tier not found in your community");
    }
  }

  const [created] = await db
    .insert(sensitiveFieldAccessRule)
    .values({
      communityId: actor.communityId,
      fieldKey: input.fieldKey,
      unlockedByTaskId: input.unlockedByTaskId ?? null,
      unlockedByTierId: input.unlockedByTierId ?? null,
    })
    .returning();
  return created;
}

export async function listSensitiveFieldAccessRules(actor: Member) {
  return db
    .select()
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.communityId, actor.communityId));
}

export async function deleteSensitiveFieldAccessRule(actor: Member, ruleId: string) {
  const [existing] = await db
    .select({ id: sensitiveFieldAccessRule.id })
    .from(sensitiveFieldAccessRule)
    .where(
      and(eq(sensitiveFieldAccessRule.id, ruleId), eq(sensitiveFieldAccessRule.communityId, actor.communityId)),
    );
  if (!existing) {
    throw new NotFoundError("Rule not found");
  }
  await db.delete(sensitiveFieldAccessRule).where(eq(sensitiveFieldAccessRule.id, ruleId));
}

// Which fields the actor is currently unlocked for, via any matching
// rule — a Tier rule checks the actor's own tierIds; a Task rule
// checks whether they currently (really — a shadow doesn't count)
// hold that task.
export async function listUnlockedFields(actor: Member): Promise<SensitiveFieldKey[]> {
  const rules = await listSensitiveFieldAccessRules(actor);
  if (rules.length === 0) return [];

  const taskIds = [...new Set(rules.map((r) => r.unlockedByTaskId).filter((id): id is string => Boolean(id)))];
  let heldTaskIds = new Set<string>();
  if (taskIds.length > 0) {
    const holdings = await db
      .select({ taskId: taskAssignment.taskId })
      .from(taskAssignment)
      .where(
        and(
          eq(taskAssignment.memberId, actor.id),
          eq(taskAssignment.isShadow, false),
          inArray(taskAssignment.taskId, taskIds),
        ),
      );
    heldTaskIds = new Set(holdings.map((h) => h.taskId));
  }

  const unlocked = new Set<SensitiveFieldKey>();
  for (const rule of rules) {
    if (rule.unlockedByTierId && actor.tierIds.includes(rule.unlockedByTierId)) {
      unlocked.add(rule.fieldKey);
    }
    if (rule.unlockedByTaskId && heldTaskIds.has(rule.unlockedByTaskId)) {
      unlocked.add(rule.fieldKey);
    }
  }
  return SENSITIVE_FIELD_KEYS.filter((k) => unlocked.has(k));
}

// The /sensitive-data page's whole surface: for each field the viewer
// is unlocked for, every community member's value — the same "surface
// exactly what's relevant to what you hold, in one place" pattern
// /coordination and /escalation already use.
export async function getSensitiveDataTable(actor: Member) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "sensitive_data");

  const fields = await listUnlockedFields(actor);
  if (fields.length === 0) {
    return { fields: [] as SensitiveFieldKey[], rows: [] as { id: string; name: string; values: Record<string, string | null> }[] };
  }

  const members = await db
    .select({
      id: member.id,
      name: member.name,
      healthConditions: member.healthConditions,
      allergies: member.allergies,
      emergencyContact: member.emergencyContact,
      orientation: member.orientation,
    })
    .from(member)
    .where(eq(member.communityId, actor.communityId))
    .orderBy(member.name);

  const rows = members.map((m) => ({
    id: m.id,
    name: m.name,
    values: Object.fromEntries(fields.map((f) => [f, m[camelField(f)]])),
  }));

  return { fields, rows };
}

function camelField(key: SensitiveFieldKey): "healthConditions" | "allergies" | "emergencyContact" | "orientation" {
  return {
    health_conditions: "healthConditions",
    allergies: "allergies",
    emergency_contact: "emergencyContact",
    orientation: "orientation",
  }[key] as "healthConditions" | "allergies" | "emergencyContact" | "orientation";
}

