import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { declineBudgetProposal, declineBudgetProposalInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The budget's owner only, with a note — enforced inside declineBudgetProposal.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = declineBudgetProposalInput.parse(await request.json());
    return NextResponse.json({ proposal: await declineBudgetProposal(actor, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
