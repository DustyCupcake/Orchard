import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireWriteMember } from "@/lib/api";
import { closeBudgetProposal } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The budget's holder only: an approved proposal has been spent or abandoned, so
// what was approved and not spent is no longer held back.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    return NextResponse.json({ proposal: await closeBudgetProposal(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
