import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember } from "@/lib/api";
import { getContributionSummary } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// What an event asked for and has had paid in. The totals are open to every
// member; who paid what is only for the budget's holder, and each member sees
// their own (see getContributionSummary).
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    return NextResponse.json({ contributions: await getContributionSummary(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
