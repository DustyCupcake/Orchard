import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { approvePendingPlacement } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// Holder-gated inside approvePendingPlacement.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const updated = await approvePendingPlacement(actor, id);
    return NextResponse.json({ placement: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
