import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse, requireWriteMember } from "@/lib/api";
import { getBudgetCycle, listBudgetProposalViews, submitBudgetProposal, submitBudgetProposalInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Every proposal in this event's budget, with its backing worked out. Counts
// are open to every member; who is behind them is only for the proposer and
// the budget's owner (see listBudgetProposalViews).
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const budget = await getBudgetCycle(actor, id);
    const proposals = await listBudgetProposalViews(actor, budget.cycleId);
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}

// Open to any member — "any member submits an itemized proposal".
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = submitBudgetProposalInput.parse(await request.json());
    const created = await submitBudgetProposal(actor, id, body);
    return NextResponse.json({ proposal: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
