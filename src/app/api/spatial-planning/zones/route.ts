import { NextRequest, NextResponse } from "next/server";
import { requireMember, errorResponse } from "@/lib/api";
import { createZone, listZones } from "@/lib/spatial-planning";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireMember();
    const plotId = request.nextUrl.searchParams.get("plotId");
    if (!plotId) throw new AppError("plotId is required");
    const zones = await listZones(actor, plotId);
    return NextResponse.json({ zones });
  } catch (err) {
    return errorResponse(err);
  }
}

// Holder-gated inside createZone.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireMember();
    const body = await request.json();
    const { plotId, ...input } = body;
    if (!plotId) throw new AppError("plotId is required");
    const created = await createZone(actor, plotId, input);
    return NextResponse.json({ zone: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
