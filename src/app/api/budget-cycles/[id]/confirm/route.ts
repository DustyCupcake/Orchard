import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { confirmBudgetCycle, confirmBudgetCycleInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Owner-only, enforced inside confirmBudgetCycle.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = confirmBudgetCycleInput.parse(await request.json());
    const budgetCycle = await confirmBudgetCycle(actor, id, body);
    return NextResponse.json({ budgetCycle });
  } catch (err) {
    return errorResponse(err);
  }
}
