import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { closeProposalsToVoting } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Owner-only, enforced inside closeProposalsToVoting.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const budgetCycle = await closeProposalsToVoting(actor, id);
    return NextResponse.json({ budgetCycle });
  } catch (err) {
    return errorResponse(err);
  }
}
