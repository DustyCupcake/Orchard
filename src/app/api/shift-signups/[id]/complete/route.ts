import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { markShiftSignupCompleted } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Self-reported, enforced inside markShiftSignupCompleted.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const signup = await markShiftSignupCompleted(actor, id);
    return NextResponse.json({ signup });
  } catch (err) {
    return errorResponse(err);
  }
}
