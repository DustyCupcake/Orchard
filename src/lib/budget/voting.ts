import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetCycle, budgetVote, member, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getBudgetCycle } from "./cycles";
import type { BudgetLineItem } from "./cycles";
import { listBudgetProposals } from "./proposals";

type Member = typeof memberTable.$inferSelect;
type BudgetCycleRow = typeof budgetCycle.$inferSelect;

// "Whoever holds this task is the budget owner" — the same access-
// follows-the-task check Forms' isFeedbackReviewHolder already
// established, baked into the lib functions below rather than gated by
// the caller (unlike createBudgetCycle's requireAdmins, which lives at
// the Server Action/API layer — this authority is well-defined once a
// cycle exists, the way conflictTeamTaskId/feedbackReviewTaskId's is).
// Excludes shadow slots, same reasoning forms.ts's own check uses.
export async function isBudgetOwner(actor: Member, cycleRow: Pick<BudgetCycleRow, "ownerTaskId">) {
  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.id, cycleRow.ownerTaskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

async function requireBudgetOwner(actor: Member, cycleRow: Pick<BudgetCycleRow, "ownerTaskId">) {
  if (!(await isBudgetOwner(actor, cycleRow))) {
    throw new ForbiddenError("Only the current budget-owner task holder can do this");
  }
}

// "Once proposalDeadline passes, the owner ... moves the cycle to
// voting" describes the normal trigger, not a hard precondition this
// enforces — Budget leans on human judgment throughout ("the final
// call is human"), so the owner can close proposals early if they
// judge the list complete. Only the status transition itself is
// enforced.
export async function closeProposalsToVoting(actor: Member, budgetCycleId: string) {
  const cycleRow = await getBudgetCycle(actor, budgetCycleId);
  await requireBudgetOwner(actor, cycleRow);
  if (cycleRow.status !== "proposals_open") {
    throw new ConflictError("This budget cycle isn't accepting proposals right now");
  }

  const [updated] = await db
    .update(budgetCycle)
    .set({ status: "voting" })
    .where(eq(budgetCycle.id, budgetCycleId))
    .returning();
  return updated;
}

// A full permutation of the cycle's actual proposal set — the proposal
// list is frozen once voting opens (submitBudgetProposal only accepts
// `proposals_open`), so every vote ranks the same fixed set. Re-checked
// here, not just via zod, so a direct lib caller is protected too (same
// defense-in-depth precedent Forms'/this module's own proposals.ts
// already established).
function requireValidRanking(rankedProposalIds: string[], validProposalIds: string[]) {
  if (rankedProposalIds.length !== validProposalIds.length) {
    throw new AppError("Your ranking must include every current proposal, no more and no less");
  }
  const validSet = new Set(validProposalIds);
  const seen = new Set<string>();
  for (const id of rankedProposalIds) {
    if (!validSet.has(id)) {
      throw new AppError("Your ranking references a proposal that isn't part of this cycle");
    }
    if (seen.has(id)) {
      throw new AppError("Your ranking lists the same proposal more than once");
    }
    seen.add(id);
  }
}

export const submitBudgetVoteInput = z.object({
  rankedProposalIds: z.array(z.string().uuid()),
  contributionSignal: z.number().int().nonnegative().nullable().optional(),
});
export type SubmitBudgetVoteInput = z.infer<typeof submitBudgetVoteInput>;

// "One vote per member per cycle, replaceable until voting closes" —
// upserts in place, the same select-then-update-or-insert shape
// Assemblies' own submitAssemblyResponse already uses (no DB-level
// unique constraint).
export async function submitBudgetVote(actor: Member, budgetCycleId: string, input: SubmitBudgetVoteInput) {
  const cycleRow = await getBudgetCycle(actor, budgetCycleId);
  if (cycleRow.status !== "voting") {
    throw new ConflictError("Voting isn't open for this budget cycle right now");
  }

  const proposals = await listBudgetProposals(actor, budgetCycleId);
  requireValidRanking(
    input.rankedProposalIds,
    proposals.map((p) => p.id),
  );

  const [existing] = await db
    .select()
    .from(budgetVote)
    .where(and(eq(budgetVote.budgetCycleId, budgetCycleId), eq(budgetVote.memberId, actor.id)));

  const values = {
    rankedProposalIds: input.rankedProposalIds,
    contributionSignal: input.contributionSignal ?? null,
  };

  if (existing) {
    const [updated] = await db
      .update(budgetVote)
      .set(values)
      .where(eq(budgetVote.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(budgetVote)
    .values({ budgetCycleId, memberId: actor.id, ...values })
    .returning();
  return created;
}

// Positional (Borda-style) rank score, not instant-runoff elimination
// — docs/development-plan.md's Phase 27 resolved interpretation, since
// spec names no algorithm. Top rank in an N-proposal ballot scores
// N-1, last scores 0; summed across every vote cast so far, then
// sorted descending for "the" aggregate ranked order.
function computeAggregateRanking(proposalIds: string[], votes: { rankedProposalIds: unknown }[]) {
  const n = proposalIds.length;
  const scores = new Map<string, number>(proposalIds.map((id) => [id, 0]));
  for (const vote of votes) {
    (vote.rankedProposalIds as string[]).forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + (n - 1 - index));
    });
  }
  const order = [...proposalIds].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
  return { order, scores };
}

// The live voting view: each proposal's cost-per-member and a running
// total (fixed costs plus every proposal at-or-above its rank) against
// the current aggregate order — updates as votes accrue, before the
// owner ever confirms anything. "current member count" is the same
// resolved all-members reading Phases 23/24 already settled on in
// place of a still-unbuilt Participation `coming` scope.
export async function getBudgetVotingView(actor: Member, budgetCycleId: string) {
  const cycleRow = await getBudgetCycle(actor, budgetCycleId);
  const proposals = await listBudgetProposals(actor, budgetCycleId);
  const votes = await db.select().from(budgetVote).where(eq(budgetVote.budgetCycleId, budgetCycleId));

  const proposalIds = proposals.map((p) => p.id);
  const { order, scores } = computeAggregateRanking(proposalIds, votes);

  const [{ count: memberCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.communityId, actor.communityId));

  const proposalById = new Map(proposals.map((p) => [p.id, p] as const));
  const fixedTotal = (cycleRow.fixedCosts as BudgetLineItem[]).reduce((sum, i) => sum + i.amount, 0);

  let runningTotal = fixedTotal;
  const ranked = order.map((id, index) => {
    const p = proposalById.get(id)!;
    runningTotal += p.totalAmount;
    return {
      proposal: p,
      rank: index + 1,
      bordaScore: scores.get(id) ?? 0,
      costPerMember: memberCount > 0 ? p.totalAmount / memberCount : null,
      runningTotal,
    };
  });

  return {
    cycle: cycleRow,
    fixedTotal,
    memberCount,
    voteCount: votes.length,
    ranked,
    myVote: votes.find((v) => v.memberId === actor.id) ?? null,
  };
}

export const confirmBudgetCycleInput = z.object({
  confirmedProposalIds: z.array(z.string().uuid()),
  confirmationRationale: z.string().nullable().optional(),
});
export type ConfirmBudgetCycleInput = z.infer<typeof confirmBudgetCycleInput>;

// "The final call is human" — confirmedProposalIds doesn't have to
// match the ranked order, but deviating from it (picking a different
// set than the top-of-ranking would fund for the same count) requires
// a published rationale. See docs/spec.md's Budget: Confirmation.
function requiresConfirmationRationale(rankedOrder: string[], confirmedProposalIds: string[]) {
  const topOfRanking = new Set(rankedOrder.slice(0, confirmedProposalIds.length));
  return !confirmedProposalIds.every((id) => topOfRanking.has(id));
}

export async function confirmBudgetCycle(
  actor: Member,
  budgetCycleId: string,
  input: ConfirmBudgetCycleInput,
) {
  const cycleRow = await getBudgetCycle(actor, budgetCycleId);
  await requireBudgetOwner(actor, cycleRow);
  if (cycleRow.status !== "voting") {
    throw new ConflictError("This budget cycle isn't in voting");
  }

  const proposals = await listBudgetProposals(actor, budgetCycleId);
  const validIds = new Set(proposals.map((p) => p.id));
  const seen = new Set<string>();
  for (const id of input.confirmedProposalIds) {
    if (!validIds.has(id)) {
      throw new NotFoundError("Confirmed proposal isn't part of this cycle");
    }
    if (seen.has(id)) {
      throw new AppError("confirmedProposalIds lists the same proposal more than once");
    }
    seen.add(id);
  }

  const votes = await db.select().from(budgetVote).where(eq(budgetVote.budgetCycleId, budgetCycleId));
  const { order } = computeAggregateRanking(
    proposals.map((p) => p.id),
    votes,
  );
  if (
    requiresConfirmationRationale(order, input.confirmedProposalIds) &&
    !input.confirmationRationale?.trim()
  ) {
    throw new AppError(
      "A rationale is required when the confirmed set deviates from the ranked order",
    );
  }

  const [updated] = await db
    .update(budgetCycle)
    .set({
      status: "confirmed",
      confirmedProposalIds: input.confirmedProposalIds,
      confirmationRationale: input.confirmationRationale?.trim() || null,
    })
    .where(eq(budgetCycle.id, budgetCycleId))
    .returning();
  return updated;
}
