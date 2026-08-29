import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { deletePlacement, listPlacementMembers, updatePlacement } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Includes linked Members alongside the Placement itself — the client
// editor needs both to render who's currently attached.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const members = await listPlacementMembers(actor, id);
    return NextResponse.json({ members });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = await request.json();
    const updated = await updatePlacement(actor, id, body);
    return NextResponse.json({ placement: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    await deletePlacement(actor, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
