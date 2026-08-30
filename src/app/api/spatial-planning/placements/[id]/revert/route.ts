import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { revertPendingPlacement } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

// Holder-gated inside revertPendingPlacement. `note` is optional and
// free-text — surfaced to whoever made the reverted change via a real
// PlacementRevertNotice row (see that table's own schema comment).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const updated = await revertPendingPlacement(actor, id, body?.note ?? null);
    return NextResponse.json({ placement: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
