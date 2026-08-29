"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  closeProposalsToVoting,
  confirmBudgetCycle,
  confirmBudgetCycleInput,
  createBudgetCycle,
  createBudgetCycleInput,
  submitBudgetProposal,
  submitBudgetProposalInput,
  submitBudgetVote,
  submitBudgetVoteInput,
  updateBudgetProposal,
  updateBudgetProposalInput,
} from "@/lib/budget";
import { requireAdmins } from "@/lib/settings";
import { AppError } from "@/lib/errors";

// "label|amount" per line — the same plain-textarea convention Forms'
// own settings action uses for its fields (parseFormFields in
// src/app/settings/actions.ts) rather than a dynamic add-row UI; this
// codebase has no client-side JS beyond Scheduling polls' one
// deliberate exception.
function parseLineItems(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, amount] = line.split("|").map((p) => p?.trim() ?? "");
      return { label, amount: Number(amount) };
    });
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/budget?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/budget?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Admin-gated — see src/app/api/budget-cycles/route.ts's POST for the
// same reasoning (entering fixed costs/a deadline/the owner task is a
// real configuration decision, not an open one).
export async function createBudgetCycleAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const deadlineRaw = String(formData.get("proposalDeadline") ?? "");
    const input = createBudgetCycleInput.parse({
      title: String(formData.get("title") ?? ""),
      fixedCosts: parseLineItems(String(formData.get("fixedCostsRaw") ?? "")),
      proposalDeadline: deadlineRaw ? new Date(deadlineRaw).toISOString() : "",
      ownerTaskId: String(formData.get("ownerTaskId") ?? "").trim(),
    });
    await createBudgetCycle(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/budget");
  redirect("/budget");
}

// Open to any member — "any member submits an itemized proposal ...
// before a submission deadline."
export async function submitBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));

  try {
    const input = submitBudgetProposalInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || undefined,
      lineItems: parseLineItems(String(formData.get("lineItemsRaw") ?? "")),
      branchId: String(formData.get("branchId") ?? "").trim() || null,
    });
    await submitBudgetProposal(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/budget");
  redirect("/budget?submitted=1");
}

// Submitter-only, enforced inside updateBudgetProposal.
export async function updateBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    const input = updateBudgetProposalInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || undefined,
      lineItems: parseLineItems(String(formData.get("lineItemsRaw") ?? "")),
      branchId: String(formData.get("branchId") ?? "").trim() || null,
    });
    await updateBudgetProposal(actor, proposalId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/budget");
  redirect("/budget?updated=1");
}

// Owner-only, enforced inside closeProposalsToVoting.
export async function closeProposalsToVotingAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));

  try {
    await closeProposalsToVoting(actor, budgetCycleId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/budget");
  redirect("/budget?votingOpened=1");
}

// A rank per proposal (via a <select> 1..N, no client JS drag-and-drop
// available in this codebase) rather than a single ordered list input
// — sorted server-side into rankedProposalIds. Every proposal on the
// page carries a hidden `proposalId` input in DOM order so
// formData.getAll recovers the full candidate set.
export async function submitBudgetVoteAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));

  try {
    const proposalIds = formData.getAll("proposalId").map(String);
    const ranks = proposalIds.map((id) => ({ id, rank: Number(formData.get(`rank_${id}`)) }));
    if (ranks.some((r) => !Number.isInteger(r.rank) || r.rank < 1 || r.rank > proposalIds.length)) {
      throw new AppError(`Give every proposal a unique rank from 1 to ${proposalIds.length}`);
    }
    if (new Set(ranks.map((r) => r.rank)).size !== ranks.length) {
      throw new AppError("Each proposal needs a unique rank — no ties");
    }
    ranks.sort((a, b) => a.rank - b.rank);

    const contributionRaw = String(formData.get("contributionSignal") ?? "").trim();
    const input = submitBudgetVoteInput.parse({
      rankedProposalIds: ranks.map((r) => r.id),
      contributionSignal: contributionRaw ? Number(contributionRaw) : null,
    });
    await submitBudgetVote(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/budget");
  redirect("/budget?voted=1");
}

// Owner-only, enforced inside confirmBudgetCycle — including the
// required-rationale check when the checked set deviates from the
// aggregate ranked order.
export async function confirmBudgetCycleAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));

  try {
    const input = confirmBudgetCycleInput.parse({
      confirmedProposalIds: formData.getAll("confirmedProposalIds").map(String),
      confirmationRationale: String(formData.get("confirmationRationale") ?? "").trim() || undefined,
    });
    await confirmBudgetCycle(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/budget");
  redirect("/budget?confirmed=1");
}
