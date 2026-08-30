import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { removePlacementMember } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// "Drop names freely" — any current editor can remove any linked
// Member; a Member can always remove themselves regardless — gated
// inside removePlacementMember.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const actor = await requireMember();
    const { id, memberId } = await params;
    await removePlacementMember(actor, id, memberId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
