import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { markShiftSignupNoShow } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Coordinator-only, enforced inside markShiftSignupNoShow.
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const signup = await markShiftSignupNoShow(actor, id);
    return NextResponse.json({ signup });
  } catch (err) {
    return errorResponse(err);
  }
}
