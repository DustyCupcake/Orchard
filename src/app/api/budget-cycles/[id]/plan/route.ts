import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireMember } from "@/lib/api";
import { getEventPlan } from "@/lib/budget";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// An event's plan: its fixed costs plus what has been approved, and the ask
// per member that follows. Open to every member, like the Budget page.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    return NextResponse.json({ plan: await getEventPlan(actor, id) });
  } catch (err) {
    return errorResponse(err);
  }
}
