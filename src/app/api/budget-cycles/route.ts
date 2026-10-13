import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { getBudgetCycleForScope, getCurrentBudgetCycle } from "@/lib/budget";

export const dynamic = "force-dynamic";

// An event's budget is made with the event, so there is no POST: nothing is
// started by hand. `?cycleId=<event id>` returns that event's budget (the newest one it has);
// without it, the most recently created budget in the Community, as before.
// Concurrent events each have a budget now, so a caller that cares which
// event should say so.
export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const cycleId = request.nextUrl.searchParams.get("cycleId");
    const budgetCycle = cycleId
      ? await getBudgetCycleForScope(actor, cycleId)
      : await getCurrentBudgetCycle(actor);
    return NextResponse.json({ budgetCycle });
  } catch (err) {
    return errorResponse(err);
  }
}
