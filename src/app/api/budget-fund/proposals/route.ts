import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse, requireWriteMember } from "@/lib/api";
import { listBudgetProposalViews, submitBudgetProposal, submitBudgetProposalInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

// The community's own budget: proposals that belong to no event.
export async function GET() {
  try {
    const actor = await requireMember();
    const proposals = await listBudgetProposalViews(actor, null);
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireWriteMember();
    const body = submitBudgetProposalInput.parse(await request.json());
    const created = await submitBudgetProposal(actor, null, body);
    return NextResponse.json({ proposal: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
