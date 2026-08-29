import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, budgetProposal } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getBudgetCycle } from "./cycles";
import type { BudgetLineItem } from "./cycles";

type Member = typeof memberTable.$inferSelect;

const lineItemInput = z.object({
  label: z.string().min(1),
  amount: z.number().int().positive(),
});

export const submitBudgetProposalInput = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  lineItems: z.array(lineItemInput).min(1),
  branchId: z.string().uuid().nullable().optional(),
  phaseId: z.string().uuid().nullable().optional(),
});
export type SubmitBudgetProposalInput = z.infer<typeof submitBudgetProposalInput>;

export const updateBudgetProposalInput = submitBudgetProposalInput.partial();
export type UpdateBudgetProposalInput = z.infer<typeof updateBudgetProposalInput>;

function sumLineItems(items: BudgetLineItem[]) {
  return items.reduce((sum, i) => sum + i.amount, 0);
}

// Re-checked here, not just in the zod schema's .min(1), so a direct
// lib caller is protected too — same defense-in-depth precedent Forms'
// own requireValidFields established (see src/lib/forms.ts).
function requireLineItems(items: BudgetLineItem[]) {
  if (items.length === 0) {
    throw new AppError("An itemized proposal needs at least one line item");
  }
}

// Throws unless the cycle is still genuinely open to submissions —
// checked against both its stored status and the deadline itself, since
// the owner moving it to `voting` (Phase 27) is a separate, later event
// from the deadline simply passing.
function requireProposalsOpen(cycleRow: { status: string; proposalDeadline: Date | string }) {
  if (cycleRow.status !== "proposals_open") {
    throw new ConflictError("This budget cycle is no longer accepting proposals");
  }
  if (new Date() > new Date(cycleRow.proposalDeadline)) {
    throw new ConflictError("The proposal deadline has passed");
  }
}

export async function submitBudgetProposal(
  actor: Member,
  budgetCycleId: string,
  input: SubmitBudgetProposalInput,
) {
  const cycleRow = await getBudgetCycle(actor, budgetCycleId);
  requireProposalsOpen(cycleRow);
  requireLineItems(input.lineItems);

  if (input.branchId) {
    const [branchRow] = await db
      .select({ id: branch.id })
      .from(branch)
      .where(and(eq(branch.id, input.branchId), eq(branch.communityId, actor.communityId)));
    if (!branchRow) {
      throw new NotFoundError("Branch not found in your community");
    }
  }

  const [created] = await db
    .insert(budgetProposal)
    .values({
      budgetCycleId,
      submittedBy: actor.id,
      title: input.title,
      description: input.description ?? null,
      lineItems: input.lineItems,
      totalAmount: sumLineItems(input.lineItems),
      branchId: input.branchId ?? null,
      phaseId: input.phaseId ?? null,
    })
    .returning();
  return created;
}

export async function listBudgetProposals(actor: Member, budgetCycleId: string) {
  await getBudgetCycle(actor, budgetCycleId);
  return db
    .select()
    .from(budgetProposal)
    .where(eq(budgetProposal.budgetCycleId, budgetCycleId))
    .orderBy(desc(budgetProposal.submittedAt));
}

export async function getBudgetProposal(actor: Member, proposalId: string) {
  const [row] = await db.select().from(budgetProposal).where(eq(budgetProposal.id, proposalId));
  if (!row) {
    throw new NotFoundError("Proposal not found");
  }
  // Community-scope check by way of its cycle — also confirms the
  // proposal genuinely belongs to the actor's own Community.
  await getBudgetCycle(actor, row.budgetCycleId);
  return row;
}

// "Editable by the submitter until it passes" — no coordinator/owner
// override in this phase (that's Phase 27's confirmation authority,
// which acts on the cycle as a whole, not on rewriting someone else's
// itemization).
export async function updateBudgetProposal(
  actor: Member,
  proposalId: string,
  input: UpdateBudgetProposalInput,
) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  if (proposalRow.submittedBy !== actor.id) {
    throw new ForbiddenError("Only the submitter can edit this proposal");
  }

  const cycleRow = await getBudgetCycle(actor, proposalRow.budgetCycleId);
  requireProposalsOpen(cycleRow);
  if (input.lineItems !== undefined) {
    requireLineItems(input.lineItems);
  }

  if (input.branchId) {
    const [branchRow] = await db
      .select({ id: branch.id })
      .from(branch)
      .where(and(eq(branch.id, input.branchId), eq(branch.communityId, actor.communityId)));
    if (!branchRow) {
      throw new NotFoundError("Branch not found in your community");
    }
  }

  const [updated] = await db
    .update(budgetProposal)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.lineItems !== undefined && {
        lineItems: input.lineItems,
        totalAmount: sumLineItems(input.lineItems),
      }),
      ...(input.branchId !== undefined && { branchId: input.branchId }),
      ...(input.phaseId !== undefined && { phaseId: input.phaseId }),
    })
    .where(eq(budgetProposal.id, proposalId))
    .returning();
  return updated;
}
