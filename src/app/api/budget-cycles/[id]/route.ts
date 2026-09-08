import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getBudgetCycle, updateBudgetCycle, updateBudgetCycleInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const budgetCycle = await getBudgetCycle(actor, id);
    return NextResponse.json({ budgetCycle });
  } catch (err) {
    return errorResponse(err);
  }
}

// Owner-only, enforced inside updateBudgetCycle.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = updateBudgetCycleInput.parse(await request.json());
    const budgetCycle = await updateBudgetCycle(actor, id, body);
    return NextResponse.json({ budgetCycle });
  } catch (err) {
    return errorResponse(err);
  }
}
