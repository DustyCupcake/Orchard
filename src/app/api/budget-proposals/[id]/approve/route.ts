import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { approveBudgetProposal, approveBudgetProposalInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The budget's owner only, and only up to what the backers cover — both
// enforced inside approveBudgetProposal.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = approveBudgetProposalInput.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ proposal: await approveBudgetProposal(actor, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
