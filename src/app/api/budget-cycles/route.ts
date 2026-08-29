import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createBudgetCycle, createBudgetCycleInput, getCurrentBudgetCycle } from "@/lib/budget";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

// The current (most recently created) cycle for the actor's Community
// — see src/lib/budget/cycles.ts's getCurrentBudgetCycle for why "the
// current one" is enough for v1 (one active cycle at a time).
export async function GET() {
  try {
    const actor = await requireMember();
    const budgetCycle = await getCurrentBudgetCycle(actor);
    return NextResponse.json({ budgetCycle });
  } catch (err) {
    return errorResponse(err);
  }
}

// Admin-gated, same reasoning Forms' own creation route uses: entering
// fixed costs, a deadline, and designating the owner task is a real
// configuration decision, not an open one.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    await requireAdmins(actor);
    const body = createBudgetCycleInput.parse(await request.json());
    const created = await createBudgetCycle(actor, body);
    return NextResponse.json({ budgetCycle: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
