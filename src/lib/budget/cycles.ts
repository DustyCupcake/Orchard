import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetCycle, community, cycle, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";

type Member = typeof memberTable.$inferSelect;

const lineItemInput = z.object({
  label: z.string().min(1),
  amount: z.number().int().positive(),
});
export type BudgetLineItem = z.infer<typeof lineItemInput>;

export const createBudgetCycleInput = z.object({
  title: z.string().min(1),
  cycleId: z.string().uuid().nullable().optional(),
  fixedCosts: z.array(lineItemInput).optional(),
  proposalDeadline: z.string().datetime(),
  ownerTaskId: z.string().uuid(),
});
export type CreateBudgetCycleInput = z.infer<typeof createBudgetCycleInput>;

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "One active cycle at a time for v1" — see docs/development-plan.md's
// Phase 26 out-of-scope note. A prior cycle sitting at `confirmed`
// (Phase 27) doesn't block starting a fresh one; anything still
// `proposals_open`/`voting` does.
export async function createBudgetCycle(actor: Member, input: CreateBudgetCycleInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "budget");

  const [taskRow] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, input.ownerTaskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) {
    throw new NotFoundError("Task not found in your community");
  }

  if (input.cycleId) {
    const [cycleRow] = await db
      .select({ id: cycle.id })
      .from(cycle)
      .where(and(eq(cycle.id, input.cycleId), eq(cycle.communityId, actor.communityId)));
    if (!cycleRow) {
      throw new NotFoundError("Cycle not found in your community");
    }
  }

  const existing = await getCurrentBudgetCycle(actor);
  if (existing && existing.status !== "confirmed") {
    throw new ConflictError("This Community already has an active budget cycle");
  }

  const [created] = await db
    .insert(budgetCycle)
    .values({
      communityId: actor.communityId,
      cycleId: input.cycleId ?? null,
      title: input.title,
      fixedCosts: input.fixedCosts ?? [],
      proposalDeadline: new Date(input.proposalDeadline),
      ownerTaskId: input.ownerTaskId,
      createdBy: actor.id,
    })
    .returning();
  return created;
}

// The most recently created cycle for the actor's Community — the only
// one that matters day to day, since v1 keeps at most one non-
// `confirmed` cycle at a time (see createBudgetCycle above). A past
// `confirmed` cycle still surfaces here until a new one is started, so
// /budget can show its final funded set rather than going blank.
export async function getCurrentBudgetCycle(actor: Member) {
  const [row] = await db
    .select()
    .from(budgetCycle)
    .where(eq(budgetCycle.communityId, actor.communityId))
    .orderBy(desc(budgetCycle.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getBudgetCycle(actor: Member, budgetCycleId: string) {
  const [row] = await db
    .select()
    .from(budgetCycle)
    .where(and(eq(budgetCycle.id, budgetCycleId), eq(budgetCycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Budget cycle not found");
  }
  return row;
}
