import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { acceptPlacementInvite } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// Self-only — acts on the caller's own `invited` PlacementMember row.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const updated = await acceptPlacementInvite(actor, id);
    return NextResponse.json({ member: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
