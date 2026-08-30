import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { proposePlacementMove } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// The self-service move/resize/rotate path — see docs/spec.md's
// Multi-user placement. Gated inside proposePlacementMove: the
// Spatial-planning holder edits directly, a confirmed Member link or
// the linkedTaskId holder lands `pending`, anyone else gets a 403.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = await request.json();
    const updated = await proposePlacementMove(actor, id, body);
    return NextResponse.json({ placement: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
