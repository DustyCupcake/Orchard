import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { invitePlacementMember } from "@/lib/spatial-planning";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Open to the Spatial-planning holder or any current editor of the
// Placement — gated inside invitePlacementMember.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const { memberId } = await request.json();
    if (!memberId) throw new AppError("memberId is required");
    const created = await invitePlacementMember(actor, id, memberId);
    return NextResponse.json({ member: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
