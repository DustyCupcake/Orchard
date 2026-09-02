import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { member, requirement, task, taskAssignment, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { memberHasTier } from "../eligibility";
import { requireNotOnsiteLockedForCommunity } from "../onsite-mode";
import { requireTaskInCommunity } from "./shared";

type Member = typeof memberTable.$inferSelect;
type Requirement = typeof requirement.$inferSelect;

// MVP scope only enforced individual_gate — group_coverage and
// soft_priority sat as schema/DB enum values with no CRUD path to
// create one and no surfacing logic once created. docs/development-
// plan.md's Phase 50 finally builds both: mode is now a real, optional
// creation-time choice (defaulting to individual_gate, unchanged), and
// see this file's own computeRequirementFitScore/getGroupCoverageStatus
// below for what each mode actually does once it exists.
const requirementValue = z.object({
  tierId: z.string().uuid().optional(),
  language: z.string().min(1).optional(),
  taskId: z.string().uuid().optional(),
  flag: z.string().min(1).optional(),
});

export const createRequirementInput = z
  .object({
    type: z.enum(["tier", "language", "completed_task", "custom"]),
    mode: z.enum(["individual_gate", "group_coverage", "soft_priority"]).optional(),
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

export async function listRequirements(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);
  return db.select().from(requirement).where(eq(requirement.taskId, taskId));
}

export async function createRequirement(
  actor: Member,
  taskId: string,
  input: CreateRequirementInput,
) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);
  await requireTaskInCommunity(actor, taskId);

  const [created] = await db
    .insert(requirement)
    .values({
      taskId,
      type: input.type,
      mode: input.mode ?? "individual_gate",
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
  await requireNotOnsiteLockedForCommunity(actor.communityId);
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
  await requireNotOnsiteLockedForCommunity(actor.communityId);
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

// "A standing line on the task's status ('Spanish speaker: covered /
// not yet covered'), computed live by checking whether *any* current
// holder satisfies it — no separate bookkeeping of who's covering
// what" (docs/spec.md's Requirement). Shadow slots don't count toward
// coverage any more than they count toward capacity — see Shadow
// slots & succession. Takes the task's already-fetched requirement
// list (callers like listTasksWithAssignments already have it) rather
// than re-querying, and only does any work at all when at least one
// group_coverage requirement is actually present.
export async function getGroupCoverageStatus(
  dbOrTx: DbOrTx,
  taskId: string,
  taskRequirements: Requirement[],
): Promise<Map<string, boolean>> {
  const coverageReqs = taskRequirements.filter((r) => r.mode === "group_coverage");
  const result = new Map<string, boolean>();
  if (coverageReqs.length === 0) {
    return result;
  }

  const holderRows = await dbOrTx
    .select({ memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.isShadow, false)));
  const holders =
    holderRows.length === 0
      ? []
      : await dbOrTx
          .select()
          .from(member)
          .where(inArray(member.id, holderRows.map((h) => h.memberId)));

  for (const req of coverageReqs) {
    let covered = false;
    for (const holder of holders) {
      if (await isSatisfied(dbOrTx, holder, req)) {
        covered = true;
        break;
      }
    }
    result.set(req.id, covered);
  }
  return result;
}

// How many of the actor's own community would satisfy this particular
// individual_gate Requirement — the "narrower the eligible pool, the
// harder to staff" measure the fit-score boost below scales by. A
// plain full-community scan, same cost class as e.g. composition.ts's
// own community-wide reads elsewhere in this codebase — fine at this
// app's scale, not something worth indexing for.
async function countEligibleMembers(
  dbOrTx: DbOrTx,
  communityId: string,
  req: Requirement,
): Promise<number> {
  const value = req.value as Record<string, unknown>;

  if (req.type === "completed_task") {
    if (typeof value.taskId !== "string") return 0;
    const rows = await dbOrTx
      .select({ memberId: taskAssignment.memberId })
      .from(taskAssignment)
      .innerJoin(task, eq(taskAssignment.taskId, task.id))
      .where(and(eq(taskAssignment.taskId, value.taskId), eq(task.status, "done")));
    return new Set(rows.map((r) => r.memberId)).size;
  }

  const communityMembers = await dbOrTx.select().from(member).where(eq(member.communityId, communityId));
  let count = 0;
  for (const m of communityMembers) {
    if (await isSatisfied(dbOrTx, m, req)) count++;
  }
  return count;
}

// The "requirements that fit you" sort dimension — docs/spec.md's
// Requirement section and Views' "what fits me": a resolved, narrow
// reading per docs/development-plan.md's Phase 50, deliberately NOT
// the full automated tag→task matching MVP scope still permanently
// defers. Purely a number a member can choose to sort by; never a
// default ordering, never touches claim eligibility.
//
// individual_gate: boosts only for a satisfied requirement, weighted
// by 1/(eligible pool size) — the narrower the pool, the harder this
// task is to staff for someone who actually qualifies, so it pulls
// harder for them specifically.
// group_coverage: boosts only while the line is still genuinely unmet
// AND the actor would satisfy it — stops pulling the moment someone
// else already covers it, per spec's own "dynamic... stops pulling on
// them the moment someone else covers it."
// soft_priority: a flat boost whenever satisfied — "never blocks a
// claim, never flags a gap... purely a surfacing signal."
export async function computeRequirementFitScore(
  dbOrTx: DbOrTx,
  actor: Member,
  taskRequirements: Requirement[],
  groupCoverage: Map<string, boolean>,
): Promise<number> {
  let score = 0;
  for (const req of taskRequirements) {
    if (req.mode === "individual_gate") {
      if (await isSatisfied(dbOrTx, actor, req)) {
        const poolSize = await countEligibleMembers(dbOrTx, actor.communityId, req);
        score += poolSize > 0 ? 1 / poolSize : 1;
      }
    } else if (req.mode === "group_coverage") {
      if (!groupCoverage.get(req.id) && (await isSatisfied(dbOrTx, actor, req))) {
        score += 1;
      }
    } else if (req.mode === "soft_priority") {
      if (await isSatisfied(dbOrTx, actor, req)) {
        score += 1;
      }
    }
  }
  return score;
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
