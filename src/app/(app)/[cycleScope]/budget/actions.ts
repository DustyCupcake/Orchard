"use server";

import { ZodError } from "zod";
import { eventInstantFromLocal } from "@/lib/cycles";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  approveBudgetProposal,
  closeBudgetProposal,
  confirmEntry,
  declineBudgetProposal,
  getBudgetCycle,
  markBudgetCycleDone,
  markEntryReimbursed,
  recordEntry,
  recordEntryInput,
  rejectEntry,
  reverseEntry,
  setBudgetPledge,
  setBudgetProposalSupport,
  submitBudgetProposal,
  submitBudgetProposalInput,
  updateBudgetCycle,
  updateBudgetCycleInput,
  updateBudgetProposal,
  updateBudgetProposalInput,
  withdrawBudgetProposal,
} from "@/lib/budget";
import { AppError } from "@/lib/errors";
import { budgetPath } from "./paths";

// LineItemsEditor.tsx mirrors its row state into one hidden JSON
// input — same "real <form>, client component only produces the
// payload, the Server Action's own Zod schema is the actual
// validation" shape settings/actions.ts's parseFieldsJson already
// established for FormBuilder. JSON.parse failing here means the
// hidden input itself is malformed (a bug, or a request built by
// hand) rather than anything a user typed — lineItemInput inside
// submitBudgetProposalInput etc. is what actually validates each
// item's label/amount/quantity/branchId.
function parseLineItemsJson(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) throw new Error("not an array");
    return parsed;
  } catch {
    throw new AppError("Invalid line items — try reloading the page");
  }
}

// A proposal with nothing in the line items editor reaches the schema as
// an empty array, whose own message ("expected array to have >=1 items")
// means nothing to the person who left the rows blank.
function parseProposalLineItemsJson(raw: string): unknown {
  const items = parseLineItemsJson(raw) as unknown[];
  if (items.length === 0) {
    throw new AppError("Add at least one line item with a label and an amount");
  }
  return items;
}

// Every form on this page carries a hidden `cycleScope` field so a
// redirect after submitting lands back on the exact scoped URL it came
// from (docs/plans/development-plan.md's Phase 65) — never the bare /budget,
// which could bounce through the redirect shim to a *different*
// default scope. budgetPath also knows the community's own budget lives at
// /budget/fund and not at /fund/budget.
//
// `compose` names the form a refused submission came from ("proposal"), so the
// error lands back on that open form rather than on the page behind it.
function redirectWithError(cycleScope: string, err: unknown, compose?: string): never {
  const back = `${budgetPath(cycleScope)}?${compose ? `compose=${compose}&` : ""}error=`;
  if (err instanceof ZodError) {
    redirect(back + encodeURIComponent(err.issues[0]?.message ?? "Invalid input"));
  }
  if (err instanceof AppError) {
    redirect(back + encodeURIComponent(err.message));
  }
  throw err;
}

// Every write in this file goes through requireMember() below rather than the
// raw @/lib/api import directly, so a session actively rendering as someone
// else can never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

// Owner-only, enforced inside updateBudgetCycle — lets the title/fixed
// costs/deadline be corrected after creation. Fields are left out of the update
// entirely, not overwritten with empty values, when their raw input is blank.
export async function updateBudgetCycleAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const titleRaw = String(formData.get("title") ?? "").trim();
    const deadlineRaw = String(formData.get("proposalDeadline") ?? "").trim();
    // "No deadline" is a real choice, not an absent field: it clears one
    // that was set. A blank date field alone still means "leave it".
    const noDeadline = formData.get("noDeadline") === "on";
    // LineItemsEditor is always pre-loaded with the current fixed costs, so
    // its payload is always the full, deliberately-edited set — sent
    // unconditionally, same as title.
    const input = updateBudgetCycleInput.parse({
      title: titleRaw || undefined,
      fixedCosts: parseLineItemsJson(String(formData.get("fixedCostsJson") ?? "")),
      proposalDeadline: noDeadline
        ? null
        : deadlineRaw
          ? await eventInstantFromLocal(actor.communityId, (await getBudgetCycle(actor, budgetCycleId)).cycleId, deadlineRaw)
          : undefined,
    });
    await updateBudgetCycle(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?cycleUpdated=1`);
}

// Open to any member — "any member submits an itemized proposal". An empty
// `budgetCycleId` is the community's own budget.
export async function submitBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId") ?? "").trim() || null;
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const input = submitBudgetProposalInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || undefined,
      lineItems: parseProposalLineItemsJson(String(formData.get("lineItemsJson") ?? "")),
      branchId: String(formData.get("branchId") ?? "").trim() || null,
    });
    await submitBudgetProposal(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err, "proposal");
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?submitted=1`);
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
      lineItems: parseProposalLineItemsJson(String(formData.get("lineItemsJson") ?? "")),
      branchId: String(formData.get("branchId") ?? "").trim() || null,
    });
    await updateBudgetProposal(actor, proposalId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?updated=1`);
}

// Submitter-only, enforced inside withdrawBudgetProposal.
export async function withdrawBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await withdrawBudgetProposal(actor, proposalId);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?withdrawn=1`);
}

// Back a proposal, or take that back. `supporting` says which; one per member,
// and the proposer is already behind their own (enforced inside).
export async function supportBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await setBudgetProposalSupport(actor, proposalId, formData.get("supporting") === "true");
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(budgetPath(cycleScope));
}

// The budget's owner only, and only up to what the backers cover — both
// enforced inside approveBudgetProposal. A blank amount means "everything that
// is backed".
export async function approveBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const amountRaw = String(formData.get("amount") ?? "").trim();
    await approveBudgetProposal(actor, proposalId, {
      amount: amountRaw ? Number(amountRaw) : undefined,
      note: String(formData.get("note") ?? "").trim() || null,
    });
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?approved=1`);
}

// The budget's owner only, and a decline needs a note — enforced inside
// declineBudgetProposal.
export async function declineBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await declineBudgetProposal(actor, proposalId, { note: String(formData.get("note") ?? "") });
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?declined=1`);
}

// "How much would you contribute?" — set, replace, or (blank) withdraw the
// caller's own pledge for this event.
export async function setBudgetPledgeAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const raw = String(formData.get("amount") ?? "").trim();
    await setBudgetPledge(actor, budgetCycleId, { amount: raw === "" ? null : Number(raw) });
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?pledged=1`);
}

// The owner's own small confirmation (docs/plans/development-plan.md's Phase
// 65) — lets an Admin close this budget's event without the closeCycle
// warning, and finishes the budget. Owner-gated, enforced inside
// markBudgetCycleDone.
export async function markBudgetCycleDoneAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await markBudgetCycleDone(actor, budgetCycleId);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?markedDone=1`);
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

// Records an entry: the holder's expense, income or (for the community's own
// budget, once) opening balance, born confirmed; or a member's own expense,
// born pending. An empty `budgetCycleId` is the community's own budget. A
// refused submission lands back on the open form.
export async function recordEntryAction(formData: FormData) {
  const actor = await requireMember();
  const budgetCycleId = String(formData.get("budgetCycleId") ?? "").trim() || null;
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const amountRaw = String(formData.get("amount") ?? "").trim();
    const input = recordEntryInput.parse({
      kind: String(formData.get("kind") ?? "expense"),
      amount: amountRaw === "" ? Number.NaN : Number(amountRaw),
      description: String(formData.get("description") ?? ""),
      occurredOn: String(formData.get("occurredOn") ?? ""),
      receiptNote: String(formData.get("receiptNote") ?? "").trim() || null,
      proposalId: String(formData.get("proposalId") ?? "").trim() || null,
      memberId: String(formData.get("memberId") ?? "").trim() || null,
    });
    await recordEntry(actor, budgetCycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err, "entry");
  }

  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?recorded=1`);
}

// The budget's holder only, enforced inside each of these.
export async function confirmEntryAction(formData: FormData) {
  const actor = await requireMember();
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  try {
    await confirmEntry(actor, String(formData.get("entryId")));
  } catch (err) {
    redirectWithError(cycleScope, err);
  }
  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?entryConfirmed=1`);
}

export async function rejectEntryAction(formData: FormData) {
  const actor = await requireMember();
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  try {
    await rejectEntry(actor, String(formData.get("entryId")), { note: String(formData.get("note") ?? "").trim() || null });
  } catch (err) {
    redirectWithError(cycleScope, err);
  }
  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?entryRejected=1`);
}

export async function reverseEntryAction(formData: FormData) {
  const actor = await requireMember();
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  try {
    await reverseEntry(actor, String(formData.get("entryId")), { note: String(formData.get("note") ?? "") });
  } catch (err) {
    redirectWithError(cycleScope, err);
  }
  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?entryReversed=1`);
}

export async function reimburseEntryAction(formData: FormData) {
  const actor = await requireMember();
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  try {
    await markEntryReimbursed(actor, String(formData.get("entryId")));
  } catch (err) {
    redirectWithError(cycleScope, err);
  }
  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?reimbursed=1`);
}

// An approved proposal has been spent or abandoned: close it, releasing what is
// left. The budget's holder only, enforced inside closeBudgetProposal.
export async function closeBudgetProposalAction(formData: FormData) {
  const actor = await requireMember();
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  try {
    await closeBudgetProposal(actor, String(formData.get("proposalId")));
  } catch (err) {
    redirectWithError(cycleScope, err);
  }
  revalidatePath(budgetPath(cycleScope));
  redirect(`${budgetPath(cycleScope)}?proposalClosed=1`);
}
