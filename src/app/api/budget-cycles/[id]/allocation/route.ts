import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember, requireWriteMember } from "@/lib/api";
import { getAllocationOutlook, requestEventAllocation } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// What an event still needs from the community's budget, and whether the caller
// can ask for it now. The figures are open to every member; making the request is
// the event budget's owner's.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    return NextResponse.json({ outlook: await getAllocationOutlook(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// The event budget's owner asks the community's budget for the plan's shortfall,
// as a proposal the community backs. Owner-only, enforced inside
// requestEventAllocation.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    return NextResponse.json({ proposal: await requestEventAllocation(actor, id) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
