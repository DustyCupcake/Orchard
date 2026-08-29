import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getBudgetProposal, updateBudgetProposal, updateBudgetProposalInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; proposalId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { proposalId } = await params;
    const proposal = await getBudgetProposal(actor, proposalId);
    return NextResponse.json({ proposal });
  } catch (err) {
    return errorResponse(err);
  }
}

// Submitter-only, enforced inside updateBudgetProposal — see
// src/lib/budget/proposals.ts.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { proposalId } = await params;
    const body = updateBudgetProposalInput.parse(await request.json());
    const updated = await updateBudgetProposal(actor, proposalId, body);
    return NextResponse.json({ proposal: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
