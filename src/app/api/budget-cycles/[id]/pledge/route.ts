import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember, requireWriteMember } from "@/lib/api";
import { getBudgetPledges, setBudgetPledge, setBudgetPledgeInput } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// The total is open to every member; who pledged what is only for the
// budget's real holder (see getBudgetPledges).
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    return NextResponse.json({ pledges: await getBudgetPledges(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}

// Set, replace or (null) withdraw the caller's own pledge.
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireWriteMember();
    const { id } = await params;
    const body = setBudgetPledgeInput.parse(await request.json());
    return NextResponse.json({ pledge: await setBudgetPledge(actor, id, body) });
  } catch (err) {
    return errorResponse(err);
  }
}
