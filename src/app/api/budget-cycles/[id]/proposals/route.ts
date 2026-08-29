import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listBudgetProposals, submitBudgetProposal, submitBudgetProposalInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const proposals = await listBudgetProposals(actor, id);
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}

// Open to any member — "any member submits an itemized proposal" — no
// Admins gate, unlike creating the cycle itself.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = submitBudgetProposalInput.parse(await request.json());
    const created = await submitBudgetProposal(actor, id, body);
    return NextResponse.json({ proposal: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
