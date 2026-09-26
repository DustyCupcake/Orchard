import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  community,
  member,
  profileQuestion,
  sensitiveFieldAccessRule,
  task,
  taskAssignment,
  tier,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "./errors";
import { requireModuleEnabled } from "./modules";
import { getGatingPurposesForCommunity, hasActiveConsent, listMembersWithActiveConsent } from "./consent";
import { listGrantingTaskIds, PERMISSION_MODULE_KEYS, type PermissionModuleKey } from "./permissions";

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

  // Phase 46: "turning a given field on for a member requires an
  // active, non-withdrawn ConsentRecord against the matching
  // ConsentPurpose... before the field is populated" — only checked for
  // a field actually being set to a non-null value; clearing one never
  // needs consent, and a field with no configured gating purpose stays
  // exactly as ungated as it was in Phase 22 (a Community has to
  // consciously define the purpose before this gate does anything).
  const fieldsBeingSet: { key: SensitiveFieldKey; value: string | null | undefined }[] = [
    { key: "health_conditions", value: input.healthConditions },
    { key: "allergies", value: input.allergies },
    { key: "emergency_contact", value: input.emergencyContact },
    { key: "orientation", value: input.orientation },
  ];
  const gatingPurposes = await getGatingPurposesForCommunity(actor.communityId);
  for (const { key, value } of fieldsBeingSet) {
    if (!value) continue;
    const purpose = gatingPurposes.get(key);
    if (!purpose) continue;
    if (!(await hasActiveConsent(actor.id, purpose.id))) {
      throw new AppError(`Grant consent for "${purpose.label}" before setting ${SENSITIVE_FIELD_LABELS[key]}`);
    }
  }

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

// Rules: which task, tier, or permission grant unlocks a field for
// *other* members' data. Exactly one of unlockedByTaskId/
// unlockedByTierId/unlockedByGrantModuleKey per rule — a field can
// carry more than one rule (e.g. a task and a tier that each
// independently unlock it). unlockedByGrantModuleKey is the third route
// (docs/food-drinks-module-plan.md's D3): community-wide, deliberately
// not narrowed by the granting task's placement, since a sensitive
// field is one community record — the rule's scope is "any holder of
// any task granting this module", exercised by matching grant-route
// rules against the union of all that module's granting tasks.
export const createSensitiveFieldAccessRuleInput = z.object({
  // Exactly one of the two, checked below. Both are nullable here rather
  // than one being required, because the "pick exactly one of three
  // unlock routes" rule already establishes that this validator's job is
  // shapes and the counts are the app layer's — same posture as the three
  // routes, and one place to look for it.
  fieldKey: z.enum(SENSITIVE_FIELD_KEYS).nullable().optional(),
  questionId: z.string().uuid().nullable().optional(),
  unlockedByTaskId: z.string().uuid().nullable().optional(),
  unlockedByTierId: z.string().uuid().nullable().optional(),
  unlockedByGrantModuleKey: z.enum(PERMISSION_MODULE_KEYS).nullable().optional(),
});
export type CreateSensitiveFieldAccessRuleInput = z.infer<typeof createSensitiveFieldAccessRuleInput>;

export async function createSensitiveFieldAccessRule(
  actor: Member,
  input: CreateSensitiveFieldAccessRuleInput,
) {
  const hasTask = Boolean(input.unlockedByTaskId);
  const hasTier = Boolean(input.unlockedByTierId);
  const hasGrantModule = Boolean(input.unlockedByGrantModuleKey);
  const chosen = [hasTask, hasTier, hasGrantModule].filter(Boolean).length;
  if (chosen !== 1) {
    throw new AppError("Pick exactly one of a task, a tier, or a grant module to unlock this field");
  }

  // Exactly one *target* as well as exactly one route. A rule naming
  // nothing, or both a fixed column and a question, is not a narrower
  // version of a rule — it's an ambiguous one, and the read side would
  // have to guess which the Admin meant.
  const targets = [Boolean(input.fieldKey), Boolean(input.questionId)].filter(Boolean).length;
  if (targets !== 1) {
    throw new AppError(
      "Pick exactly one of a fixed Sensitive-data field or a profile question to unlock this for",
    );
  }

  if (input.questionId) {
    // A rule may only name a question that is actually marked sensitive.
    // The other direction — refusing to mark one sensitive until a rule
    // exists — lives in profile-questions/questions.ts as
    // `assertSensitiveAllowed`, since only that module can see the
    // current flags. Both halves are needed: this one stops a rule
    // accumulating against a question that isn't protected, and the other
    // stops a question being protected by nothing.
    const [target] = await db
      .select({ archivedAt: profileQuestion.archivedAt })
      .from(profileQuestion)
      .where(
        and(
          eq(profileQuestion.id, input.questionId),
          eq(profileQuestion.communityId, actor.communityId),
        ),
      );
    if (!target) {
      throw new NotFoundError("Profile question not found in your community");
    }
    if (target.archivedAt) {
      throw new ConflictError("That question is archived, so there is nothing left to unlock");
    }
    // Deliberately NOT requiring the question to be sensitive yet. The two
    // are halves of one decision, and requiring each first is a deadlock
    // with no reachable start: a rule names a question, and the flag is
    // refused until a rule exists. So the rule is the half that goes
    // first, and a rule against a not-yet-sensitive question is a
    // *staged* rule \u2014 it restricts nothing, because the question is
    // public, and it starts working the moment the flag is ticked.
    //
    // Which is the whole sequence: build the audience, then declare the
    // question sensitive. The reverse order is the one that needs
    // refusing, and it is refused in profile-questions/questions.ts
    // (assertSensitiveAllowed) because a flag with no audience is the
    // state where a question is restricted to nobody.
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
      fieldKey: input.fieldKey ?? null,
      questionId: input.questionId ?? null,
      unlockedByTaskId: input.unlockedByTaskId ?? null,
      unlockedByTierId: input.unlockedByTierId ?? null,
      unlockedByGrantModuleKey: input.unlockedByGrantModuleKey ?? null,
    })
    .returning();
  return created;
}

/** How many access rules name this question. The sensitive flag's precondition. */
export async function countQuestionAccessRules(questionId: string) {
  const rows = await db
    .select({ id: sensitiveFieldAccessRule.id })
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.questionId, questionId));
  return rows.length;
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

// Which rules the actor currently satisfies, given a set of candidate
// rules. ONE resolution for both target kinds, because the three unlock
// routes mean the same thing to a fixed member column and to a question
// — and a second copy is how "task rules count, tier rules don't" bugs
// arrive. A Tier rule checks the actor's own tierIds; a Task rule checks
// whether they currently (really — a shadow doesn't count) hold that
// task; a Grant-module rule checks whether they currently hold ANY task
// granting that permission module in this community (the community-wide
// third route — docs/food-drinks-module-plan.md's D3).
async function satisfiedRuleIds(actor: Member, rules: (typeof sensitiveFieldAccessRule.$inferSelect)[]) {
  if (rules.length === 0) return new Set<string>();

  // Every task whose hold could satisfy some rule: the Task route's own
  // ids, plus — for each Grant-module rule — every task currently
  // granting that module. The module route is deliberately "whoever holds
  // ANY task granting it", community-wide rather than narrowed to one
  // task (D3), so this is an expansion, not a lookup of one id.
  const interestingTaskIds = new Set(
    rules.map((r) => r.unlockedByTaskId).filter((id): id is string => Boolean(id)),
  );
  const grantModuleKeys = [
    ...new Set(
      rules
        .map((r) => r.unlockedByGrantModuleKey)
        .filter((key): key is PermissionModuleKey => Boolean(key)),
    ),
  ];
  // moduleKey -> the tasks that grant it. Kept per module (not flattened
  // into one pool) because each rule has to be matched against *its own*
  // module's granting tasks — a hold of a `budget` task must not satisfy
  // a rule that names `kitchen`.
  const grantTaskIdsByModule = new Map<PermissionModuleKey, string[]>();
  for (const moduleKey of grantModuleKeys) {
    const grantingTaskIds = await listGrantingTaskIds(actor.communityId, moduleKey);
    grantTaskIdsByModule.set(moduleKey, grantingTaskIds);
    for (const id of grantingTaskIds) interestingTaskIds.add(id);
  }

  const heldTaskIds = new Set<string>();
  if (interestingTaskIds.size > 0) {
    const holdings = await db
      .select({ taskId: taskAssignment.taskId })
      .from(taskAssignment)
      .where(
        and(
          eq(taskAssignment.memberId, actor.id),
          eq(taskAssignment.isShadow, false),
          inArray(taskAssignment.taskId, [...interestingTaskIds]),
        ),
      );
    for (const holding of holdings) heldTaskIds.add(holding.taskId);
  }

  const satisfied = new Set<string>();
  for (const rule of rules) {
    if (rule.unlockedByTierId && actor.tierIds.includes(rule.unlockedByTierId)) {
      satisfied.add(rule.id);
    }
    if (rule.unlockedByTaskId && heldTaskIds.has(rule.unlockedByTaskId)) {
      satisfied.add(rule.id);
    }
    if (rule.unlockedByGrantModuleKey) {
      const grantingTaskIds = grantTaskIdsByModule.get(rule.unlockedByGrantModuleKey) ?? [];
      if (grantingTaskIds.some((id) => heldTaskIds.has(id))) {
        satisfied.add(rule.id);
      }
    }
  }
  return satisfied;
}

// Which fields the actor is currently unlocked for, via any matching
// rule. Still the fixed member-column set, and still what Kitchen's
// dietary view reads.
export async function listUnlockedFields(actor: Member): Promise<SensitiveFieldKey[]> {
  const rules = (await listSensitiveFieldAccessRules(actor)).filter(
    (r): r is typeof r & { fieldKey: SensitiveFieldKey } => r.fieldKey !== null,
  );
  const satisfied = await satisfiedRuleIds(actor, rules);
  const unlocked = new Set<SensitiveFieldKey>();
  for (const rule of rules) {
    if (satisfied.has(rule.id)) unlocked.add(rule.fieldKey);
  }
  return SENSITIVE_FIELD_KEYS.filter((k) => unlocked.has(k));
}

/**
 * Which of one member's answers `viewer` may read.
 *
 * THE definition of profile-question readability, and deliberately the
 * only one — a permission that has to be re-derived at each render site
 * is one that eventually isn't. The ladder is three levels:
 *
 *   1. not sensitive  → everyone may read. A decline is the member's only
 *      lever, and the one that always works.
 *   2. sensitive      → the configured audience, which is the union of the
 *      holders of any linked rule. Un-ticking the share box reduces this to
 *      emergency-only.
 *   3. own answer    → always readable, at any level.
 *
 * **Fails closed**, which is the load-bearing property. A sensitive
 * question with no rule has an *empty* audience, so it reads as "nobody
 * but the owner" — not as "everyone, because no rule was found to forbid
 * it". Marking a question sensitive is refused unless a rule exists
 * (assertSensitiveAllowed in profile-questions/questions.ts) so the empty
 * case is meant to be unreachable, but the database is editable by hand
 * and an archived question keeps its rules, so the read side still has to
 * be right on its own. The asymmetry is the point: being wrong in this
 * direction costs a hidden answer, and being wrong in the other direction
 * costs someone's medication.
 */
export async function resolveReadableQuestions(
  viewer: Member,
  ownerId: string,
  rows: { questionId: string; sensitive: boolean; shareWithAudience: boolean }[],
): Promise<Set<string>> {
  const readable = new Set<string>();
  const sensitiveIds = new Set<string>();
  for (const row of rows) {
    if (row.sensitive) sensitiveIds.add(row.questionId);
    else readable.add(row.questionId);
  }
  // Level 3 short-circuits everything: you can always read your own.
  if (viewer.id === ownerId || sensitiveIds.size === 0) {
    for (const id of sensitiveIds) readable.add(id);
    return readable;
  }

  // Level 2, minus the member's own reduction: un-ticking the share box
  // on a sensitive question is the answer choosing emergency-only, so it
  // is filtered out here and never reaches the audience test at all.
  const candidateIds = rows
    .filter((r) => r.sensitive && r.shareWithAudience)
    .map((r) => r.questionId);
  if (candidateIds.length === 0) return readable;

  const rules = (
    await db
      .select()
      .from(sensitiveFieldAccessRule)
      .where(
        and(
          eq(sensitiveFieldAccessRule.communityId, viewer.communityId),
          inArray(sensitiveFieldAccessRule.questionId, candidateIds),
        ),
      )
  );
  const satisfied = await satisfiedRuleIds(viewer, rules);
  for (const rule of rules) {
    if (rule.questionId && satisfied.has(rule.id)) readable.add(rule.questionId);
  }
  return readable;
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

  // Phase 46's read-gate: a field with a configured gating purpose only
  // shows for a member who currently has active, non-withdrawn consent
  // against it — re-checked here on every read, so a withdrawal takes
  // effect immediately rather than needing a separate sweep. A field
  // with no gating purpose configured stays exactly as visible as
  // Phase 22 always made it (SensitiveFieldAccessRule's own task/tier
  // gate is unaffected either way, applied on top as before).
  const gatingPurposes = await getGatingPurposesForCommunity(actor.communityId);
  const activeMembersByPurposeId = new Map<string, Set<string>>();
  for (const purpose of gatingPurposes.values()) {
    activeMembersByPurposeId.set(purpose.id, await listMembersWithActiveConsent(purpose.id));
  }

  const rows = members.map((m) => ({
    id: m.id,
    name: m.name,
    values: Object.fromEntries(
      fields.map((f) => {
        const purpose = gatingPurposes.get(f);
        if (purpose && !activeMembersByPurposeId.get(purpose.id)!.has(m.id)) {
          return [f, null];
        }
        return [f, m[camelField(f)]];
      }),
    ),
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

