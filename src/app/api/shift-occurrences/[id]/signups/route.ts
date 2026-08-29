import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { listSignupsForOccurrence } from "@/lib/shifts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Coordinator-only, enforced inside listSignupsForOccurrence.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const signups = await listSignupsForOccurrence(actor, id);
    return NextResponse.json({ signups });
  } catch (err) {
    return errorResponse(err);
  }
}
