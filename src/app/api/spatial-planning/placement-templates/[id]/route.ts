import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { deletePlacementTemplate } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireMember();
    await assertNotViewingAs();
    const { id } = await params;
    await deletePlacementTemplate(actor, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
