import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { declinePlacementInvite } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// Self-only — "declining just drops them from the Placement... no
// explanation required" (docs/spec.md's Shared placements).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    await declinePlacementInvite(actor, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
