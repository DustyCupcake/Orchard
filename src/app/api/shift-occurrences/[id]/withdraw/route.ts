import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { withdrawFromShift } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Own signup only — "can withdraw before it starts."
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const withdrawn = await withdrawFromShift(actor, id);
    return NextResponse.json({ signup: withdrawn });
  } catch (err) {
    return errorResponse(err);
  }
}
