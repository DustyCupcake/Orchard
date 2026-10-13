import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { withdrawBudgetProposal } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The submitter only — enforced inside withdrawBudgetProposal.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    return NextResponse.json({ proposal: await withdrawBudgetProposal(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
