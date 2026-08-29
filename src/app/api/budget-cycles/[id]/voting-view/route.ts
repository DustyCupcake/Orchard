import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getBudgetVotingView } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const view = await getBudgetVotingView(actor, id);
    return NextResponse.json(view);
  } catch (err) {
    return errorResponse(err);
  }
}
