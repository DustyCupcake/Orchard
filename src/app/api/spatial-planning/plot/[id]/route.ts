import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { updatePlot } from "@/lib/spatial-planning";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireMember();
    const { id } = await params;
    const body = await request.json();
    const updated = await updatePlot(actor, id, body);
    return NextResponse.json({ plot: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
