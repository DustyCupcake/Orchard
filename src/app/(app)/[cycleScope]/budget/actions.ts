"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  closeProposalsToVoting,
  confirmBudgetCycle,
  confirmBudgetCycleInput,
  createBudgetCycle,
  createBudgetCycleInput,
  markBudgetCycleDone,
  submitBudgetProposal,
  submitBudgetProposalInput,
  submitBudgetVote,
  submitBudgetVoteInput,
  updateBudgetCycle,
  updateBudgetCycleInput,
  updateBudgetProposal,
  updateBudgetProposalInput,
} from "@/lib/budget";
import { requireAdmins } from "@/lib/settings";
import { AppError } from "@/lib/errors";

// LineItemsEditor.tsx mirrors its row state into one hidden JSON
// input — same "real <form>, client component only produces the
// payload, the Server Action's own Zod schema is the actual
// validation" shape settings/actions.ts's parseFieldsJson already
// established for FormBuilder. JSON.parse failing here means the
// hidden input itself is malformed (a bug, or a request built by
// hand) rather than anything a user typed — lineItemInput inside
// createBudgetCycleInput/submitBudgetProposalInput etc. is what
// actually validates each item's label/amount/quantity/branchId.
function parseLineItemsJson(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    throw new AppError("Invalid line items — try reloading the page");
  }
}

// Every form on this page carries a hidden `cycleScope` field so a
// redirect after submitting lands back on the exact scoped URL it came
// from (docs/development-plan.md's Phase 65) — never the bare /budget,
// which could bounce through the redirect shim to a *different*
// default scope.
function redirectWithError(cycleScope: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/${cycleScope}/budget?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/${cycleScope}/budget?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Admin-gated — see src/app/api/budget-cycles/route.ts's POST for the
// same reasoning (entering fixed costs/a deadline/the owner task is a
// real configuration decision, not an open one).

// Phase 54 (View-as): every write in this file goes through
// requireMember() below rather than the raw @/lib/api import
// directly, so a session actively rendering as someone else can
// never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

// `cycleId` (Phase 65) is the real Cycle currently resolved on this
// page — see ../budget/page.tsx's own resolveSingleCycleScope call —
// null when Cycles aren't in play at all (this Community never turned
// them on, or none are currently open), matching BudgetCycle.cycleId's
// own "optional — set only when cycles are on" schema comment.
export async function createBudgetCycleAction(formData: FormData) {
  const actor = await requireMember();
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await requireAdmins(actor);
    const deadlineRaw = String(formData.get("proposalDeadline") ?? "");
    const cycleId = String(formData.get("cycleId") ?? "").trim() || null;
    const input = createBudgetCycleInput.parse({
      title: String(formData.get("title") ?? ""),
      cycleId,
      fixedCosts: parseLineItemsJson(String(formData.get("fixedCostsJson") ?? "")),
      proposalDeadline: deadlineRaw ? new Date(deadlineRaw).toISOString() : "",
      ownerTaskId: String(formData.get("ownerTaskId") ?? "").trim(),
    });
    await createBudgetCycle(actor, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget`);
}

// Owner-only, enforced inside updateBudgetCycle — lets the title/fixed
// costs/deadline be corrected after creation (including a deadline
// that was only ever a placeholder, e.g. one set by
// startBudgetCycleForNewCycle's opt-in auto-start). Fields are left
// out of the update entirely, not overwritten with empty values, when
// their raw input is blank — same "only touch what was actually sent"
// posture updateBudgetProposalAction/updateCycleSettingsAction below
// already take.
export async function updateBudgetCycleAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const titleRaw = String(formData.get("title") ?? "").trim();
    const deadlineRaw = String(formData.get("proposalDeadline") ?? "").trim();
    // Unlike the old raw-textarea convention (blank meant "leave
    // untouched"), LineItemsEditor is always pre-loaded with the
    // current fixed costs, so its payload is always the full,
    // deliberately-edited set — sent unconditionally, same as title.
    const input = updateBudgetCycleInput.parse({
      title: titleRaw || undefined,
      fixedCosts: parseLineItemsJson(String(formData.get("fixedCostsJson") ?? "")),
      proposalDeadline: deadlineRaw ? new Date(deadlineRaw).toISOString() : undefined,
    });
    await updateBudgetCycle(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget?cycleUpdated=1`);
}

// Open to any member — "any member submits an itemized proposal ...
// before a submission deadline."
export async function submitBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const input = submitBudgetProposalInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || undefined,
      lineItems: parseLineItemsJson(String(formData.get("lineItemsJson") ?? "")),
      branchId: String(formData.get("branchId") ?? "").trim() || null,
    });
    await submitBudgetProposal(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget?submitted=1`);
}

// Submitter-only, enforced inside updateBudgetProposal.
export async function updateBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const input = updateBudgetProposalInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || undefined,
      lineItems: parseLineItemsJson(String(formData.get("lineItemsJson") ?? "")),
      branchId: String(formData.get("branchId") ?? "").trim() || null,
    });
    await updateBudgetProposal(actor, proposalId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget?updated=1`);
}

// Owner-only, enforced inside closeProposalsToVoting.
export async function closeProposalsToVotingAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await closeProposalsToVoting(actor, budgetCycleId);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget?votingOpened=1`);
}

// A rank per proposal (via a <select> 1..N, no client JS drag-and-drop
// available in this codebase) rather than a single ordered list input
// — sorted server-side into rankedProposalIds. Every proposal on the
// page carries a hidden `proposalId` input in DOM order so
// formData.getAll recovers the full candidate set.
export async function submitBudgetVoteAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

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
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget?voted=1`);
}

// Owner-only, enforced inside confirmBudgetCycle — including the
// required-rationale check when the checked set deviates from the
// aggregate ranked order.
export async function confirmBudgetCycleAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const input = confirmBudgetCycleInput.parse({
      confirmedProposalIds: formData.getAll("confirmedProposalIds").map(String),
      confirmationRationale: String(formData.get("confirmationRationale") ?? "").trim() || undefined,
    });
    await confirmBudgetCycle(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget?confirmed=1`);
}

// The owner's own small confirmation (docs/development-plan.md's Phase
// 65) — lets an Admin close this BudgetCycle's real Cycle without the
// closeCycle warning. Owner-gated, enforced inside markBudgetCycleDone.
export async function markBudgetCycleDoneAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await markBudgetCycleDone(actor, budgetCycleId);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/budget`);
  redirect(`/${cycleScope}/budget?markedDone=1`);
}
