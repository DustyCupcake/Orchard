import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { signUpForShift } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Open to any member — "any member can sign up ... up to its
// capacity (first-come ... no waitlist for v1)."
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const signup = await signUpForShift(actor, id);
    return NextResponse.json({ signup }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
