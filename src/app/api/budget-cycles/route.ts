import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse, requireWriteMember } from "@/lib/api";
import {
  createBudgetCycle,
  createBudgetCycleInput,
  getBudgetCycleForScope,
  getCurrentBudgetCycle,
} from "@/lib/budget";
import { requireAdmins } from "@/lib/settings";

export const dynamic = "force-dynamic";

// `?cycleId=<event id>` returns that event's budget (the newest one it has);
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

// Admin-gated, same reasoning Forms' own creation route uses: entering
// fixed costs and a deadline is a real configuration decision, not an
// open one. Budget authority is configured separately under Settings →
// Access & permissions.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireWriteMember();
    await requireAdmins(actor);
    const body = createBudgetCycleInput.parse(await request.json());
    const created = await createBudgetCycle(actor, body);
    return NextResponse.json({ budgetCycle: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
