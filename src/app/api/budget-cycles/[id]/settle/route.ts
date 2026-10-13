import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember, requireWriteMember } from "@/lib/api";
import { getSettlementState, settleEventBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Where an event's books stand: settled or not, what it holds or owes, any
// overspend waiting on the community's decision, and what was left uncovered.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    return NextResponse.json({ settlement: await getSettlementState(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// Closes the event's books: a surplus returns to the community's budget, and an
// overspend opens a proposal the community decides. The budget's owner, or once
// the event has closed the community budget's — enforced inside settleEventBudget.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const result = await settleEventBudget(actor, id);
    return NextResponse.json({ budget: result.budget, deficitProposal: result.deficitProposal, surplusReturned: result.surplusReturned });
  } catch (err) {
    return errorResponse(err);
  }
}
